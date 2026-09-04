import { Router } from 'express'
import { z } from 'zod'
import { authenticate, type AuthRequest } from '../auth.js'
import { config } from '../config.js'
import { newId, pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import {
  createLiqpayCheckout,
  mapLiqpayPaymentStatus,
  sameLiqpayCallbackSignature,
} from '../liqpay.js'
import {
  cancelPendingPayment,
  createOrderCode,
  getPendingPayment,
  lockProductsById,
  lockUserPaymentState,
  processAuthoritativePaymentEvent,
  type PaymentStatus,
} from '../payments.js'
import { requireCsrf } from '../security.js'

const paymentsRouter = Router()

const checkoutSchema = z
  .object({
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(8).max(32),
    email: z.string().trim().toLowerCase().email().max(254),
    deliveryMethod: z.enum(['nova_poshta', 'velora_courier']),
    city: z.string().trim().min(2).max(80),
    branch: z.string().trim().min(1).max(120),
  })
  .strict()

const orderCodeSchema = z.object({ code: z.string().trim().min(1).max(32) }).strict()

const callbackEnvelopeSchema = z
  .object({
    data: z
      .string()
      .min(4)
      .max(16_384)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    signature: z.string().min(20).max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()

const callbackPayloadSchema = z
  .object({
    action: z.literal('pay'),
    version: z.coerce.number().int().min(3),
    public_key: z.string().min(1).max(255),
    order_id: z.string().min(1).max(255),
    amount: z.coerce.number().int().min(0).max(10_000_000),
    currency: z.literal('UAH'),
    status: z.string().min(1).max(64),
    payment_id: z.union([z.string(), z.number()]).transform(String).optional(),
  })
  .passthrough()

function getLiqpayConfig() {
  if (!config.liqpay) throw new ApiError(503, 'Онлайн-оплата тимчасово недоступна')
  return config.liqpay
}

function liqpayUtcDate(value: string) {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19)
}

function checkoutFor(order: {
  code: string
  total: number
  paymentOrderId: string
  reservationExpiresAt: string | null
}) {
  if (
    !order.reservationExpiresAt ||
    !Number.isFinite(Date.parse(order.reservationExpiresAt)) ||
    Date.parse(order.reservationExpiresAt) <= Date.now()
  ) {
    throw new ApiError(409, 'Строк резервування минув; очікується звірка платежу')
  }
  const liqpay = getLiqpayConfig()
  return createLiqpayCheckout(
    {
      version: 3,
      public_key: liqpay.publicKey,
      action: 'pay',
      amount: order.total,
      currency: 'UAH',
      description: `Замовлення Velora ${order.code}`,
      order_id: order.paymentOrderId,
      result_url: `${liqpay.resultUrl}?order=${encodeURIComponent(order.code)}`,
      server_url: liqpay.callbackUrl,
      expired_date: liqpayUtcDate(order.reservationExpiresAt),
      language: 'uk',
      ...(liqpay.sandbox ? { sandbox: 1 } : {}),
    },
    liqpay.privateKey,
  )
}

paymentsRouter.post(
  '/liqpay/checkout',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const details = checkoutSchema.parse(request.body)
    const order = await withTransaction(async (client) => {
      await lockUserPaymentState(client, auth.userId)
      const existing = await getPendingPayment(client, auth.userId)
      if (existing) return existing

      // Lock order is user -> order -> cart -> products (ascending ID) -> reservations.
      // The new order is a transaction-local shell until trusted product rows are locked
      // and its server-calculated total is written below.
      const id = newId()
      const code = createOrderCode()
      const reservationExpiresAt = new Date(
        Date.now() + config.paymentReservationMinutes * 60_000,
      ).toISOString()
      const reconciliationDeadlineAt = new Date(
        Date.parse(reservationExpiresAt) + config.paymentReconciliationGraceMinutes * 60_000,
      ).toISOString()
      await client.query(
        `INSERT INTO orders (
          id, code, user_id, status, total_uah, delivery_method, delivery_city, delivery_branch,
          customer_name, customer_phone, customer_email, payment_status, payment_provider,
          payment_order_id, payment_updated_at, reservation_expires_at, reconciliation_deadline_at
        ) VALUES (
          $1, $2, $3, 'new', 0, $4, $5, $6, $7, $8, $9, 'pending', 'liqpay',
          $10, NOW(), $11, $12
        )`,
        [
          id,
          code,
          auth.userId,
          details.deliveryMethod,
          details.city,
          details.branch,
          `${details.firstName} ${details.lastName}`,
          details.phone,
          details.email,
          code,
          reservationExpiresAt,
          reconciliationDeadlineAt,
        ],
      )

      const { rows: cartItems } = await client.query<{ productId: number; quantity: number }>(
        `SELECT product_id AS "productId", quantity
         FROM cart_items
         WHERE user_id = $1
         ORDER BY product_id
         FOR UPDATE`,
        [auth.userId],
      )
      if (!cartItems.length) throw new ApiError(400, 'Кошик порожній')

      const products = await lockProductsById(
        client,
        cartItems.map((item) => item.productId),
      )
      const productsById = new Map(products.map((product) => [product.id, product]))
      const items = cartItems.map((cartItem) => {
        const product = productsById.get(cartItem.productId)
        if (
          !product ||
          !product.isAvailable ||
          product.status !== 'active' ||
          product.stock - product.reservedStock < cartItem.quantity
        ) {
          throw new ApiError(409, 'Один або кілька товарів більше недоступні у потрібній кількості')
        }
        return { ...cartItem, ...product }
      })

      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const delivery = subtotal >= 1500 ? 0 : 90
      const total = subtotal + delivery
      await client.query(
        'UPDATE orders SET total_uah = $1, updated_at = NOW() WHERE id = $2',
        [total, id],
      )
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_slug, price_uah, quantity
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, item.productId, item.name, item.slug, item.price, item.quantity],
        )
        await client.query(
          `INSERT INTO inventory_reservations (order_id, product_id, quantity, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [id, item.productId, item.quantity, reservationExpiresAt],
        )
      }
      for (const item of items) {
        const reserved = await client.query(
          `UPDATE products
           SET reserved_stock = reserved_stock + $1, updated_at = NOW()
           WHERE id = $2 AND stock - reserved_stock >= $1`,
          [item.quantity, item.productId],
        )
        if (!reserved.rowCount) {
          throw new ApiError(409, 'Один або кілька товарів більше недоступні у потрібній кількості')
        }
      }
      await client.query(
        `INSERT INTO order_status_events (id, order_id, previous_status, next_status, changed_by)
         VALUES ($1, $2, NULL, 'new', $3)`,
        [newId(), id, auth.userId],
      )
      return { id, code, total, paymentOrderId: code, reservationExpiresAt }
    })

    // The payment form is created only after the reservation transaction committed.
    const checkout = checkoutFor(order)
    response.status(201).json({ order: { code: order.code, total: order.total }, checkout })
  }),
)

paymentsRouter.get(
  '/liqpay/orders/:code',
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const { code } = orderCodeSchema.parse(request.params)
    const { rows } = await pool.query<{
      code: string
      total: number
      paymentStatus: PaymentStatus
    }>(
      `SELECT code, total_uah AS "total", payment_status AS "paymentStatus"
       FROM orders
       WHERE code = $1 AND user_id = $2`,
      [code, auth.userId],
    )
    const order = rows[0]
    if (!order) throw new ApiError(404, 'Замовлення не знайдено')
    response.json({ order })
  }),
)

paymentsRouter.post(
  '/liqpay/orders/:code/cancel',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const { code } = orderCodeSchema.parse(request.params)
    const order = await withTransaction(async (client) => {
      await lockUserPaymentState(client, auth.userId)
      return cancelPendingPayment(client, auth.userId, code)
    })
    response.json({ order: { code: order.code, total: order.total, paymentStatus: order.paymentStatus } })
  }),
)

paymentsRouter.post(
  '/liqpay/callback',
  asyncHandler(async (request, response) => {
    if (!request.is('application/x-www-form-urlencoded')) {
      throw new ApiError(415, 'Некоректний формат callback оплати')
    }
    const liqpay = getLiqpayConfig()
    const envelope = callbackEnvelopeSchema.parse(request.body)
    if (!sameLiqpayCallbackSignature(envelope.data, envelope.signature, liqpay.privateKey)) {
      throw new ApiError(400, 'Некоректний callback оплати')
    }
    const decoded = Buffer.from(envelope.data, 'base64').toString('utf8')
    let rawPayload: unknown
    try {
      rawPayload = JSON.parse(decoded)
    } catch {
      throw new ApiError(400, 'Некоректний callback оплати')
    }
    const callback = callbackPayloadSchema.parse(rawPayload)
    if (callback.public_key !== liqpay.publicKey) {
      throw new ApiError(400, 'Некоректний callback оплати')
    }

    const status = mapLiqpayPaymentStatus(callback.status, liqpay.sandbox)
    if (status !== 'pending') {
      const owner = await pool.query<{ userId: string }>(
        `SELECT user_id AS "userId" FROM orders WHERE payment_order_id = $1`,
        [callback.order_id],
      )
      const userId = owner.rows[0]?.userId
      if (!userId) throw new ApiError(404, 'Замовлення не знайдено')
      await withTransaction(async (client) => {
        await lockUserPaymentState(client, userId)
        return processAuthoritativePaymentEvent(client, {
          paymentOrderId: callback.order_id,
          amount: callback.amount,
          currency: callback.currency,
          status,
          paymentId: callback.payment_id,
          source: 'callback',
        })
      })
    }
    response.type('text/plain').send('ok')
  }),
)

export { paymentsRouter }
