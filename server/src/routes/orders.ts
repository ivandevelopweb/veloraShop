import { Router } from 'express'
import { authenticate, type AuthRequest } from '../auth.js'
import { pool } from '../db.js'
import { asyncHandler } from '../http.js'

const ordersRouter = Router()

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
      paymentStatus: string
    }>(
      `SELECT code, status, total_uah AS total, created_at AS "createdAt",
              delivery_method AS "deliveryMethod", payment_status AS "paymentStatus"
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [auth.userId],
    )
    response.json({ orders: rows })
  }),
)

export { ordersRouter }
