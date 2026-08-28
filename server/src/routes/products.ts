import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'

const productsRouter = Router()

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'newest']).default('popular'),
})

const productSlugSchema = z.object({
  slug: z.string().trim().min(1).max(160),
})

type DatabaseImage = {
  id: string
  url: string
  altText: string
  sortOrder: number
}

type DatabaseProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  price: number
  oldPrice: number | null
  rating: string | number
  reviewCount: number
  badge: string
  stock: number
  category: string | null
  categorySlug: string | null
  images: DatabaseImage[]
  createdAt: string
}

const productSelect = `
  SELECT
    products.id,
    products.slug,
    products.name,
    products.short_description AS "shortDescription",
    products.description,
    products.price_uah AS price,
    products.old_price_uah AS "oldPrice",
    products.rating,
    products.review_count AS "reviewCount",
    products.badge,
    products.stock,
    products.created_at AS "createdAt",
    categories.name AS category,
    categories.slug AS "categorySlug",
    COALESCE(images.items, '[]'::json) AS images
  FROM products
  LEFT JOIN categories ON categories.id = products.category_id
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'id', product_images.id,
        'url', product_images.url,
        'altText', product_images.alt_text,
        'sortOrder', product_images.sort_order
      ) ORDER BY product_images.sort_order ASC
    ) AS items
    FROM product_images
    WHERE product_images.product_id = products.id
  ) images ON TRUE
`

function normalizeProduct(product: DatabaseProduct) {
  return {
    ...product,
    rating: Number(product.rating),
    image: product.images[0]?.url ?? null,
  }
}

function sortSql(sort: z.infer<typeof querySchema>['sort']) {
  switch (sort) {
    case 'price_asc':
      return 'products.price_uah ASC, products.id ASC'
    case 'price_desc':
      return 'products.price_uah DESC, products.id ASC'
    case 'newest':
      return 'products.created_at DESC, products.id DESC'
    default:
      return 'products.rating DESC, products.review_count DESC, products.id ASC'
  }
}

productsRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query)
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new ApiError(400, 'Мінімальна ціна не може бути більшою за максимальну')
    }

    const conditions = [
      "products.status = 'active'",
      'products.is_available = TRUE',
      'products.stock > 0',
      '(categories.is_archived = FALSE OR categories.id IS NULL)',
    ]
    const values: Array<string | number> = []
    const addValue = (value: string | number) => {
      values.push(value)
      return `$${values.length}`
    }

    if (query.search) {
      const search = addValue(query.search)
      conditions.push(
        `(products.name ILIKE '%' || ${search} || '%' OR products.short_description ILIKE '%' || ${search} || '%')`,
      )
    }
    if (query.category && query.category !== 'all') {
      conditions.push(`categories.slug = ${addValue(query.category)}`)
    }
    if (query.minPrice !== undefined)
      conditions.push(`products.price_uah >= ${addValue(query.minPrice)}`)
    if (query.maxPrice !== undefined)
      conditions.push(`products.price_uah <= ${addValue(query.maxPrice)}`)

    const where = `WHERE ${conditions.join(' AND ')}`
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM products
       LEFT JOIN categories ON categories.id = products.category_id
       ${where}`,
      values,
    )
    const total = Number(countResult.rows[0]?.count ?? 0)
    const offset = (query.page - 1) * query.pageSize
    const dataValues = [...values, query.pageSize, offset]
    const { rows } = await pool.query<DatabaseProduct>(
      `${productSelect}
       ${where}
       ORDER BY ${sortSql(query.sort)}
       LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues,
    )

    response.json({
      products: rows.map(normalizeProduct),
      page: query.page,
      pageSize: query.pageSize,
      total,
    })
  }),
)

productsRouter.get(
  '/:slug',
  asyncHandler(async (request, response) => {
    const { slug } = productSlugSchema.parse(request.params)
    const { rows } = await pool.query<DatabaseProduct>(
      `${productSelect}
       WHERE products.slug = $1
         AND products.status = 'active'
         AND products.is_available = TRUE
         AND products.stock > 0
         AND (categories.is_archived = FALSE OR categories.id IS NULL)`,
      [slug],
    )
    const product = rows[0]
    if (!product) throw new ApiError(404, 'Товар не знайдено')
    response.json({ product: normalizeProduct(product) })
  }),
)

export { productsRouter }
