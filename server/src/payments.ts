import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { ApiError } from './errors.js'

export const paymentStatuses = ['pending', 'paid', 'failed', 'cancelled'] as const
export type PaymentStatus = (typeof paymentStatuses)[number]

export type PendingPayment = {
  id: string
  code: string
  total: number
  paymentOrderId: string
}

export async function lockUserPaymentState(client: PoolClient, userId: string) {
  const lock = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])
  if (!lock.rowCount) throw new ApiError(401, 'Потрібна авторизація')
}

export async function getPendingPayment(client: PoolClient, userId: string) {
  const { rows } = await client.query<PendingPayment>(
    `SELECT id, code, total_uah AS total, payment_order_id AS "paymentOrderId"
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
