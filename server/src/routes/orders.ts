import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, type AuthRequest } from '../auth.js'
import { newId, pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import { requireCsrf } from '../security.js'

const ordersRouter = Router()

const checkoutSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(32),
  email: z.string().trim().toLowerCase().email().max(254),
  deliveryMethod: z.enum(['nova_poshta', 'velora_courier']),
  city: z.string().trim().min(2).max(80),
  branch: z.string().trim().min(1).max(120),
})

function orderCode() {
  return `VL-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`
}

ordersRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const { rows } = await pool.query<{
      code: string
      status: string
      total: number
      createdAt: string
      deliveryMethod: string
    }>(
      `SELECT code, status, total_uah AS total, created_at AS "createdAt",
              delivery_method AS "deliveryMethod"
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [auth.userId],
    )
    response.json({ orders: rows })
  }),
)

ordersRouter.post(
  '/',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const details = checkoutSchema.parse(request.body)
    const order = await withTransaction(async (client) => {
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
      const code = orderCode()

      await client.query(
        `INSERT INTO orders (
          id, code, user_id, status, total_uah, delivery_method, delivery_city, delivery_branch,
          customer_name, customer_phone, customer_email
        ) VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          code,
          auth.userId,
          subtotal + delivery,
          details.deliveryMethod,
          details.city,
          details.branch,
          `${details.firstName} ${details.lastName}`,
          details.phone,
          details.email,
        ],
      )

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price_uah, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, item.productId, item.name, item.price, item.quantity],
        )
        const stockUpdate = await client.query(
          `UPDATE products
           SET stock = stock - $1, updated_at = NOW()
           WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.productId],
        )
        if (!stockUpdate.rowCount) {
          throw new ApiError(
            409,
            'Не вдалося зарезервувати товар. Оновіть кошик і спробуйте ще раз.',
          )
        }
      }

      await client.query(
        `INSERT INTO order_status_events (id, order_id, previous_status, next_status, changed_by)
         VALUES ($1, $2, NULL, 'new', $3)`,
        [newId(), id, auth.userId],
      )

      await client.query('DELETE FROM cart_items WHERE user_id = $1', [auth.userId])
      return { code, total: subtotal + delivery }
    })

    response.status(201).json({
      order: {
        ...order,
        status: 'new',
        message: 'Замовлення створено. Оплата тимчасово працює у тестовому режимі.',
      },
    })
  }),
)

export { ordersRouter }
