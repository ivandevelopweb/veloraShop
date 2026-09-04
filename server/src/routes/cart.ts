import { Router } from 'express'
import { z } from 'zod'
import { authenticate, type AuthRequest } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import { requireCsrf } from '../security.js'
import { assertNoPendingPayment, lockUserPaymentState } from '../payments.js'

const cartRouter = Router()

const productSchema = z.object({
  productId: z.coerce.number().int().positive(),
})

const quantitySchema = productSchema.extend({
  quantity: z.coerce.number().int().min(1).max(100_000),
})

async function respondWithCart(response: import('express').Response, userId: string) {
  const { rows } = await pool.query<{
    productId: number
    quantity: number
    name: string
    price: number
    stock: number
  }>(
    `SELECT cart_items.product_id AS "productId", cart_items.quantity, products.name,
            products.price_uah AS price, products.stock - products.reserved_stock AS stock
     FROM cart_items
     JOIN products ON products.id = cart_items.product_id
     WHERE cart_items.user_id = $1
       AND products.is_available = TRUE
       AND products.status = 'active'
        AND products.stock > products.reserved_stock
     ORDER BY cart_items.product_id`,
    [userId],
  )
  response.json({ items: rows })
}

cartRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const userId = (await authenticate(request as AuthRequest)).userId
    await respondWithCart(response, userId)
  }),
)

cartRouter.post(
  '/',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const userId = (await authenticate(request as AuthRequest)).userId
    const { productId } = productSchema.parse(request.body)
    await withTransaction(async (client) => {
      await lockUserPaymentState(client, userId)
      await assertNoPendingPayment(client, userId)
      const exists = await client.query<{ stock: number; reservedStock: number }>(
        `SELECT stock, reserved_stock AS "reservedStock"
         FROM products
         WHERE id = $1
           AND is_available = TRUE
           AND status = 'active'
           AND stock > reserved_stock
         FOR UPDATE`,
        [productId],
      )
      if (!exists.rowCount) throw new ApiError(404, 'Товар недоступний')
      await client.query(
        `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET quantity = LEAST(
           cart_items.quantity + 1,
            (
              SELECT stock - reserved_stock
              FROM products
              WHERE products.id = EXCLUDED.product_id
            )
         )`,
        [userId, productId],
      )
    })
    await respondWithCart(response, userId)
  }),
)

cartRouter.patch(
  '/:productId',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const userId = (await authenticate(request as AuthRequest)).userId
    const { productId, quantity } = quantitySchema.parse({
      productId: request.params.productId,
      quantity: request.body?.quantity,
    })
    await withTransaction(async (client) => {
      await lockUserPaymentState(client, userId)
      await assertNoPendingPayment(client, userId)
      const result = await client.query(
        `UPDATE cart_items
         SET quantity = LEAST($1, products.stock - products.reserved_stock)
         FROM products
         WHERE cart_items.user_id = $2
           AND cart_items.product_id = $3
           AND products.id = cart_items.product_id
           AND products.is_available = TRUE
           AND products.status = 'active'
            AND products.stock > products.reserved_stock`,
        [quantity, userId, productId],
      )
      if (!result.rowCount) throw new ApiError(404, 'Товару немає в кошику')
    })
    await respondWithCart(response, userId)
  }),
)

cartRouter.delete(
  '/:productId',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const userId = (await authenticate(request as AuthRequest)).userId
    const { productId } = productSchema.parse({ productId: request.params.productId })
    await withTransaction(async (client) => {
      await lockUserPaymentState(client, userId)
      await assertNoPendingPayment(client, userId)
      await client.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [
        userId,
        productId,
      ])
    })
    await respondWithCart(response, userId)
  }),
)

export { cartRouter }
