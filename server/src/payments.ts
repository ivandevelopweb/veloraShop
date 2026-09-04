import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from './db.js'
import { ApiError } from './errors.js'

export const paymentStatuses = [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'reconciliation_required',
] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

export const reservationStates = ['active', 'consumed', 'released'] as const
export type ReservationState = (typeof reservationStates)[number]
export type ProviderPaymentStatus = Extract<PaymentStatus, 'pending' | 'paid' | 'failed' | 'cancelled'>

export type PendingPayment = {
  id: string
  code: string
  total: number
  paymentOrderId: string
  reservationExpiresAt: string | null
}

type LockedOrder = {
  id: string
  userId: string
  code: string
  total: number
  paymentStatus: PaymentStatus
  paymentOrderId: string
  providerPaymentId: string | null
  reservationExpiresAt: string | null
  reconciliationDeadlineAt: string | null
}

type ReservationRow = {
  productId: number
  quantity: number
  state: ReservationState
}

export type ProviderPaymentEvent = {
  paymentOrderId: string
  amount: number
  currency: 'UAH'
  status: ProviderPaymentStatus
  paymentId?: string
  source: 'callback' | 'reconciliation'
}

/**
 * Inventory lock discipline (never invert this order):
 *
 * 1. user row, when a user initiated the operation;
 * 2. order row (or a transaction-local new order shell);
 * 3. that user's cart rows, when checkout needs its snapshot;
 * 4. product rows ordered by ascending `products.id`;
 * 5. reservation rows for that order.
 *
 * Admin stock/archive operations only take the relevant product row. Admin
 * fulfilment cancellation starts at the order and then uses lockProductsById.
 */

export async function lockUserPaymentState(client: PoolClient, userId: string) {
  const lock = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
  if (!lock.rowCount) throw new ApiError(401, 'Потрібна авторизація')
}

export async function getPendingPayment(client: PoolClient, userId: string) {
  const { rows } = await client.query<PendingPayment>(
    `SELECT id, code, total_uah AS "total", payment_order_id AS "paymentOrderId",
            reservation_expires_at AS "reservationExpiresAt"
     FROM orders
     WHERE user_id = $1 AND payment_status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId],
  )
  return rows[0] ?? null
}

export async function assertNoPendingPayment(client: PoolClient, userId: string) {
  const pending = await getPendingPayment(client, userId)
  if (pending) {
    throw new ApiError(409, 'Завершіть або скасуйте поточну спробу оплати перед зміною кошика')
  }
}

export function createOrderCode() {
  return `VL-${new Date().getFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`
}

export async function lockProductsById(client: PoolClient, productIds: number[]) {
  const ids = [...new Set(productIds)].sort((left, right) => left - right)
  if (!ids.length) return []
  const { rows } = await client.query<{
    id: number
    name: string
    slug: string
    price: number
    stock: number
    reservedStock: number
    status: string
    isAvailable: boolean
  }>(
    `SELECT id, name, slug, price_uah AS "price", stock,
            reserved_stock AS "reservedStock", status, is_available AS "isAvailable"
     FROM products
     WHERE id = ANY($1::int[])
     ORDER BY id
     FOR UPDATE`,
    [ids],
  )
  return rows
}

async function getOrderByPaymentOrderIdForUpdate(client: PoolClient, paymentOrderId: string) {
  const { rows } = await client.query<LockedOrder>(
    `SELECT id, user_id AS "userId", code, total_uah AS "total",
            payment_status AS "paymentStatus", payment_order_id AS "paymentOrderId",
            provider_payment_id AS "providerPaymentId",
            reservation_expires_at AS "reservationExpiresAt",
            reconciliation_deadline_at AS "reconciliationDeadlineAt"
     FROM orders
     WHERE payment_order_id = $1
     FOR UPDATE`,
    [paymentOrderId],
  )
  return rows[0] ?? null
}

async function getOrderByCodeForUpdate(client: PoolClient, code: string) {
  const { rows } = await client.query<LockedOrder>(
    `SELECT id, user_id AS "userId", code, total_uah AS "total",
            payment_status AS "paymentStatus", payment_order_id AS "paymentOrderId",
            provider_payment_id AS "providerPaymentId",
            reservation_expires_at AS "reservationExpiresAt",
            reconciliation_deadline_at AS "reconciliationDeadlineAt"
     FROM orders
     WHERE code = $1
     FOR UPDATE`,
    [code],
  )
  return rows[0] ?? null
}

async function reservationRows(client: PoolClient, orderId: string) {
  const { rows } = await client.query<ReservationRow>(
    `SELECT product_id AS "productId", quantity, state
     FROM inventory_reservations
     WHERE order_id = $1
     ORDER BY product_id`,
    [orderId],
  )
  return rows
}

async function hasCompleteReservationSet(client: PoolClient, orderId: string) {
  const { rows } = await client.query<{ orderItemCount: string; reservationCount: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM order_items WHERE order_id = $1) AS "orderItemCount",
       (SELECT COUNT(*)::text FROM inventory_reservations WHERE order_id = $1) AS "reservationCount"`,
    [orderId],
  )
  const counts = rows[0]
  if (!counts) return false
  return counts.orderItemCount === counts.reservationCount && counts.orderItemCount !== '0'
}

function providerEventJson(event: ProviderPaymentEvent) {
  return JSON.stringify({
    paymentId: event.paymentId ?? null,
    status: event.status,
    amount: event.amount,
    currency: event.currency,
    source: event.source,
  })
}

async function markReconciliationRequired(
  client: PoolClient,
  order: LockedOrder,
  event: ProviderPaymentEvent | undefined,
  reason: string,
  persistProviderPaymentId = true,
) {
  await client.query(
    `UPDATE orders
     SET payment_status = 'reconciliation_required',
         provider_payment_id = CASE
           WHEN $5 THEN COALESCE(provider_payment_id, $1)
           ELSE provider_payment_id
         END,
         payment_provider_event = COALESCE($2::jsonb, payment_provider_event),
         payment_reconciliation_reason = $3,
         payment_updated_at = NOW(),
         updated_at = NOW()
     WHERE id = $4`,
    [
      event?.paymentId ?? null,
      event ? providerEventJson(event) : null,
      reason,
      order.id,
      persistProviderPaymentId,
    ],
  )
}

async function lockProviderPaymentId(client: PoolClient, paymentId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [paymentId])
}

async function releaseActiveReservations(
  client: PoolClient,
  orderId: string,
  reason: string,
) {
  const complete = await hasCompleteReservationSet(client, orderId)
  if (!complete) return { released: 0, complete: false }
  const before = await reservationRows(client, orderId)
  const active = before.filter((reservation) => reservation.state === 'active')
  if (!active.length) return { released: 0, complete: true }

  await lockProductsById(
    client,
    active.map((reservation) => reservation.productId),
  )
  const { rows: released } = await client.query<{ productId: number; quantity: number }>(
    `UPDATE inventory_reservations
     SET state = 'released', released_at = NOW(), release_reason = $2
     WHERE order_id = $1 AND state = 'active'
     RETURNING product_id AS "productId", quantity`,
    [orderId, reason],
  )
  for (const reservation of released.sort((left, right) => left.productId - right.productId)) {
    const update = await client.query(
      `UPDATE products
       SET reserved_stock = reserved_stock - $1, updated_at = NOW()
       WHERE id = $2 AND reserved_stock >= $1`,
      [reservation.quantity, reservation.productId],
    )
    if (!update.rowCount) throw new ApiError(409, 'Порушено резервування залишку')
  }
  return { released: released.length, complete: true }
}

async function consumeActiveReservations(client: PoolClient, orderId: string) {
  const complete = await hasCompleteReservationSet(client, orderId)
  if (!complete) return { consumed: 0, complete: false, hadReleasedReservation: false }
  const before = await reservationRows(client, orderId)
  const active = before.filter((reservation) => reservation.state === 'active')
  if (!active.length) {
    return {
      consumed: 0,
      complete: true,
      hadReleasedReservation: before.some((reservation) => reservation.state === 'released'),
    }
  }

  await lockProductsById(
    client,
    active.map((reservation) => reservation.productId),
  )
  const { rows: consumed } = await client.query<{ productId: number; quantity: number }>(
    `UPDATE inventory_reservations
     SET state = 'consumed', consumed_at = NOW()
     WHERE order_id = $1 AND state = 'active'
     RETURNING product_id AS "productId", quantity`,
    [orderId],
  )
  for (const reservation of consumed.sort((left, right) => left.productId - right.productId)) {
    const update = await client.query(
      `UPDATE products
       SET stock = stock - $1, reserved_stock = reserved_stock - $1, updated_at = NOW()
       WHERE id = $2 AND stock >= $1 AND reserved_stock >= $1`,
      [reservation.quantity, reservation.productId],
    )
    if (!update.rowCount) throw new ApiError(409, 'Порушено резервування залишку')
  }
  return {
    consumed: consumed.length,
    complete: true,
    hadReleasedReservation: before.some((reservation) => reservation.state === 'released'),
  }
}

export async function processAuthoritativePaymentEvent(
  client: PoolClient,
  event: ProviderPaymentEvent,
) {
  const order = await getOrderByPaymentOrderIdForUpdate(client, event.paymentOrderId)
  if (!order || order.total !== event.amount || event.currency !== 'UAH') {
    throw new ApiError(400, 'Некоректний callback оплати')
  }
  if (event.paymentId) {
    await lockProviderPaymentId(client, event.paymentId)
    const collision = await client.query<{ id: string }>(
      `SELECT id
       FROM orders
       WHERE provider_payment_id = $1 AND id <> $2
       LIMIT 1`,
      [event.paymentId, order.id],
    )
    if (order.providerPaymentId !== null && order.providerPaymentId !== event.paymentId) {
      await markReconciliationRequired(client, order, event, 'conflicting_provider_payment_id', false)
      return { paymentStatus: 'reconciliation_required' as const, order }
    }
    if (collision.rowCount) {
      await markReconciliationRequired(client, order, event, 'provider_payment_id_used_by_another_order', false)
      return { paymentStatus: 'reconciliation_required' as const, order }
    }
  }
  if (order.paymentStatus === 'paid') return { paymentStatus: 'paid' as const, order }
  if (event.status === 'pending') return { paymentStatus: order.paymentStatus, order }

  if (event.status === 'paid') {
    if (!event.paymentId) throw new ApiError(400, 'Відсутній ідентифікатор платежу LiqPay')
    if (order.paymentStatus !== 'pending' && order.paymentStatus !== 'reconciliation_required') {
      await markReconciliationRequired(client, order, event, 'paid_after_terminal_payment_state')
      return { paymentStatus: 'reconciliation_required' as const, order }
    }
    const consumed = await consumeActiveReservations(client, order.id)
    if (!consumed.complete || !consumed.consumed || consumed.hadReleasedReservation) {
      await markReconciliationRequired(client, order, event, 'paid_without_active_complete_reservation')
      return { paymentStatus: 'reconciliation_required' as const, order }
    }
    await client.query(
      `UPDATE orders
       SET payment_status = 'paid',
           provider_payment_id = COALESCE(provider_payment_id, $1),
           payment_provider_event = $2::jsonb,
           payment_reconciliation_reason = NULL,
           paid_at = COALESCE(paid_at, NOW()),
           payment_updated_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND payment_status IN ('pending', 'reconciliation_required')`,
      [event.paymentId ?? null, providerEventJson(event), order.id],
    )
    await client.query(
      `DELETE FROM cart_items
       USING order_items
       WHERE cart_items.user_id = $1
         AND order_items.order_id = $2
         AND cart_items.product_id = order_items.product_id
         AND cart_items.quantity = order_items.quantity`,
      [order.userId, order.id],
    )
    return { paymentStatus: 'paid' as const, order }
  }

  if (order.paymentStatus !== 'pending' && order.paymentStatus !== 'reconciliation_required') {
    return { paymentStatus: order.paymentStatus, order }
  }
  const beforeRelease = await reservationRows(client, order.id)
  if (!beforeRelease.some((reservation) => reservation.state === 'active')) {
    if (order.paymentStatus === 'reconciliation_required') {
      return { paymentStatus: 'reconciliation_required' as const, order }
    }
    await markReconciliationRequired(client, order, event, 'terminal_provider_event_without_active_reservation')
    return { paymentStatus: 'reconciliation_required' as const, order }
  }
  const released = await releaseActiveReservations(client, order.id, `provider_${event.status}`)
  if (!released.complete) {
    await markReconciliationRequired(client, order, event, 'terminal_provider_event_without_complete_reservation')
    return { paymentStatus: 'reconciliation_required' as const, order }
  }
  await client.query(
    `UPDATE orders
     SET payment_status = $1,
         provider_payment_id = COALESCE(provider_payment_id, $2),
         payment_provider_event = $3::jsonb,
         payment_updated_at = NOW(),
         updated_at = NOW()
     WHERE id = $4 AND payment_status IN ('pending', 'reconciliation_required')`,
    [event.status, event.paymentId ?? null, providerEventJson(event), order.id],
  )
  return { paymentStatus: event.status, order }
}

export async function cancelPendingPayment(client: PoolClient, userId: string, code: string) {
  const order = await getOrderByCodeForUpdate(client, code)
  if (!order || order.userId !== userId) throw new ApiError(404, 'Замовлення не знайдено')
  if (order.paymentStatus === 'paid') throw new ApiError(409, 'Цю оплату вже підтверджено')
  if (order.paymentStatus !== 'pending') {
    throw new ApiError(409, 'Цю спробу оплати вже неможливо скасувати')
  }
  const released = await releaseActiveReservations(client, order.id, 'customer_cancelled')
  if (!released.complete) {
    await markReconciliationRequired(client, order, undefined, 'cancel_without_complete_reservation')
    return { ...order, paymentStatus: 'reconciliation_required' as const }
  }
  await client.query(
    `UPDATE orders
     SET payment_status = 'cancelled', payment_updated_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND payment_status = 'pending'`,
    [order.id],
  )
  return { ...order, paymentStatus: 'cancelled' as const }
}

export async function expiredPendingPaymentCandidates(limit = 20) {
  const { rows } = await pool.query<{
    paymentOrderId: string
    userId: string
  }>(
    `SELECT payment_order_id AS "paymentOrderId",
            user_id AS "userId"
     FROM orders
     WHERE payment_status IN ('pending', 'reconciliation_required')
       AND reservation_expires_at <= NOW()
       AND EXISTS (
         SELECT 1
         FROM inventory_reservations
         WHERE inventory_reservations.order_id = orders.id
           AND inventory_reservations.state = 'active'
       )
     ORDER BY reservation_expires_at ASC
     LIMIT $1`,
    [limit],
  )
  return rows
}

export async function markReconciliationAfterGrace(client: PoolClient, paymentOrderId: string, reason: string) {
  const order = await getOrderByPaymentOrderIdForUpdate(client, paymentOrderId)
  if (!order || order.paymentStatus !== 'pending') return false
  const { rows } = await client.query<{ expired: boolean }>(
    `SELECT reconciliation_deadline_at <= NOW() AS expired
     FROM orders
     WHERE id = $1`,
    [order.id],
  )
  if (!rows[0]?.expired) return false
  await markReconciliationRequired(client, order, undefined, reason)
  return true
}
