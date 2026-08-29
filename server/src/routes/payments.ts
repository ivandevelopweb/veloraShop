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
  createOrderCode,
  getPendingPayment,
  lockUserPaymentState,
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

function checkoutFor(order: { code: string; total: number; paymentOrderId: string }) {
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

      const { rows: items } = await client.query<{
        productId: number
        name: string
        price: number
        quantity: number
        stock: number
        status: string
        isAvailable: boolean
      }>(
        `SELECT
           cart_items.product_id AS "productId",
           products.name,
           products.price_uah AS price,
           cart_items.quantity,
           products.stock,
           products.status,
           products.is_available AS "isAvailable"
         FROM cart_items
         JOIN products ON products.id = cart_items.product_id
         WHERE cart_items.user_id = $1
         ORDER BY cart_items.product_id
         FOR UPDATE OF cart_items, products`,
        [auth.userId],
      )
      if (!items.length) throw new ApiError(400, 'Кошик порожній')
      if (
        items.some(
          (item) => !item.isAvailable || item.status !== 'active' || item.stock < item.quantity,
        )
      ) {
        throw new ApiError(409, 'Один або кілька товарів більше недоступні у потрібній кількості')
      }

      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const delivery = subtotal >= 1500 ? 0 : 90
      const id = newId()
      const code = createOrderCode()
      const total = subtotal + delivery
      await client.query(
        `INSERT INTO orders (
          id, code, user_id, status, total_uah, delivery_method, delivery_city, delivery_branch,
          customer_name, customer_phone, customer_email, payment_status, payment_provider,
          payment_order_id, payment_updated_at
        ) VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8, $9, $10, 'pending', 'liqpay', $11, NOW())`,
        [
          id,
          code,
          auth.userId,
          total,
          details.deliveryMethod,
          details.city,
          details.branch,
          `${details.firstName} ${details.lastName}`,
          details.phone,
          details.email,
          code,
        ],
      )
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price_uah, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, item.productId, item.name, item.price, item.quantity],
        )
      }
      await client.query(
        `INSERT INTO order_status_events (id, order_id, previous_status, next_status, changed_by)
         VALUES ($1, $2, NULL, 'new', $3)`,
        [newId(), id, auth.userId],
      )
      return { id, code, total, paymentOrderId: code }
    })
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
      `SELECT code, total_uah AS total, payment_status AS "paymentStatus"
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
      const { rows } = await client.query<{
        code: string
        total: number
        paymentStatus: PaymentStatus
      }>(
        `SELECT code, total_uah AS total, payment_status AS "paymentStatus"
         FROM orders
         WHERE code = $1 AND user_id = $2
         FOR UPDATE`,
        [code, auth.userId],
      )
      const current = rows[0]
      if (!current) throw new ApiError(404, 'Замовлення не знайдено')
      if (current.paymentStatus === 'paid') {
        throw new ApiError(409, 'Цю оплату вже підтверджено')
      }
      if (current.paymentStatus === 'pending') {
        await client.query(
          `UPDATE orders
           SET payment_status = 'cancelled', payment_updated_at = NOW(), updated_at = NOW()
           WHERE code = $1`,
          [code],
        )
      }
      return { ...current, paymentStatus: current.paymentStatus === 'pending' ? 'cancelled' : current.paymentStatus }
    })
    response.json({ order })
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

    const mappedStatus: PaymentStatus = mapLiqpayPaymentStatus(callback.status, liqpay.sandbox)

    if (mappedStatus !== 'pending') {
      await withTransaction(async (client) => {
        const owner = await client.query<{ userId: string }>(
          'SELECT user_id AS "userId" FROM orders WHERE payment_order_id = $1',
          [callback.order_id],
        )
        const userId = owner.rows[0]?.userId
        if (!userId) throw new ApiError(404, 'Замовлення не знайдено')
        await lockUserPaymentState(client, userId)
        const { rows } = await client.query<{
          id: string
          total: number
          paymentStatus: PaymentStatus
          providerPaymentId: string | null
          paymentOrderId: string
        }>(
          `SELECT id, total_uah AS total, payment_status AS "paymentStatus",
                  provider_payment_id AS "providerPaymentId", payment_order_id AS "paymentOrderId"
           FROM orders
           WHERE payment_order_id = $1
           FOR UPDATE`,
          [callback.order_id],
        )
        const order = rows[0]
        if (!order || order.paymentOrderId !== callback.order_id || order.total !== callback.amount) {
          throw new ApiError(400, 'Некоректний callback оплати')
        }
        if (order.providerPaymentId && callback.payment_id && order.providerPaymentId !== callback.payment_id) {
          throw new ApiError(409, 'Конфлікт ідентифікатора платежу')
        }
        if (order.paymentStatus === 'paid') return

        if (mappedStatus !== 'paid') {
          await client.query(
            `UPDATE orders
             SET payment_status = $1,
                 provider_payment_id = COALESCE(provider_payment_id, $2),
                 payment_updated_at = NOW(), updated_at = NOW()
             WHERE id = $3`,
            [mappedStatus, callback.payment_id ?? null, order.id],
          )
          return
        }

        const { rows: items } = await client.query<{
          productId: number
          quantity: number
          stock: number
          status: string
          isAvailable: boolean
        }>(
          `SELECT order_items.product_id AS "productId", order_items.quantity, products.stock,
                  products.status, products.is_available AS "isAvailable"
           FROM order_items
           JOIN products ON products.id = order_items.product_id
           WHERE order_items.order_id = $1
           ORDER BY order_items.product_id
           FOR UPDATE OF products`,
          [order.id],
        )
        if (
          items.some(
            (item) => !item.isAvailable || item.status !== 'active' || item.stock < item.quantity,
          )
        ) {
          throw new ApiError(409, 'Неможливо підтвердити оплату через зміну залишку')
        }
        for (const item of items) {
          const update = await client.query(
            `UPDATE products
             SET stock = stock - $1, updated_at = NOW()
             WHERE id = $2 AND stock >= $1`,
            [item.quantity, item.productId],
          )
          if (!update.rowCount) throw new ApiError(409, 'Неможливо підтвердити оплату через зміну залишку')
        }
        await client.query(
          `UPDATE orders
           SET payment_status = 'paid', provider_payment_id = COALESCE(provider_payment_id, $1),
               paid_at = COALESCE(paid_at, NOW()), payment_updated_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [callback.payment_id ?? null, order.id],
        )
        const otherPendingPayment = await client.query(
          `SELECT 1
           FROM orders
           WHERE user_id = $1 AND payment_status = 'pending' AND id <> $2
           LIMIT 1`,
          [userId, order.id],
        )
        if (!otherPendingPayment.rowCount) {
          await client.query(
            `DELETE FROM cart_items
             USING order_items
             WHERE cart_items.user_id = $1
               AND order_items.order_id = $2
               AND cart_items.product_id = order_items.product_id
               AND cart_items.quantity = order_items.quantity`,
            [userId, order.id],
          )
        }
      })
    }
    response.type('text/plain').send('ok')
  }),
)

export { paymentsRouter }
