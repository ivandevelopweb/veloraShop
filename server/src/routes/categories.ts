import { Router } from 'express'
import { pool } from '../db.js'
import { asyncHandler } from '../http.js'

const categoriesRouter = Router()

categoriesRouter.get(
  '/',
  asyncHandler(async (_request, response) => {
    const { rows } = await pool.query<{
      id: string
      name: string
      slug: string
      description: string
      productCount: string
    }>(
      `SELECT
         categories.id,
         categories.name,
         categories.slug,
         categories.description,
         COUNT(products.id) FILTER (
           WHERE products.status = 'active' AND products.is_available = TRUE AND products.stock > 0
         )::text AS "productCount"
       FROM categories
       LEFT JOIN products ON products.category_id = categories.id
       WHERE categories.is_archived = FALSE
       GROUP BY categories.id
       ORDER BY categories.name ASC`,
    )
    response.json({
      categories: rows.map((category) => ({
        ...category,
        productCount: Number(category.productCount),
      })),
    })
  }),
)

export { categoriesRouter }
