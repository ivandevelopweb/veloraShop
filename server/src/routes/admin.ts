import { Router, type RequestHandler } from 'express'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import { requireAdmin, type AuthRequest } from '../auth.js'
import { newId, pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import {
  deleteProductImage,
  productImageUpload,
  uploadProductImage,
  type UploadedProductImage,
} from '../media.js'
import { requireCsrf } from '../security.js'

const adminRouter = Router()
const productStatuses = ['draft', 'active', 'archived'] as const
const orderStatuses = ['new', 'processing', 'shipped', 'completed', 'cancelled'] as const

const idSchema = z.object({ id: z.coerce.number().int().positive() })
const categoryIdSchema = z.object({ id: z.string().uuid() })
const categoryReferenceSchema = z.string().uuid().nullable()

const productInputFieldsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug має містити лише латиницю, цифри та дефіси'),
    categoryId: categoryReferenceSchema,
    shortDescription: z.string().trim().min(2).max(240),
    description: z.string().trim().min(2).max(10_000),
    priceUah: z.coerce.number().int().min(0).max(10_000_000),
    oldPriceUah: z.coerce.number().int().min(0).max(10_000_000).nullable(),
    stock: z.coerce.number().int().min(0).max(100_000),
    status: z.enum(productStatuses),
    rating: z.coerce.number().min(0).max(5),
    reviewCount: z.coerce.number().int().min(0).max(1_000_000),
    badge: z.string().trim().max(80),
  })
  .strict()

const productInputSchema = productInputFieldsSchema
  .superRefine((value, context) => {
    if (value.oldPriceUah !== null && value.oldPriceUah < value.priceUah) {
      context.addIssue({
        code: 'custom',
        path: ['oldPriceUah'],
        message: 'Попередня ціна не може бути меншою за поточну',
      })
    }
  })

const productUpdateSchema = productInputFieldsSchema.partial()

const categoryInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug має містити лише латиницю, цифри та дефіси'),
    description: z.string().trim().max(240),
    isArchived: z.boolean().optional(),
  })
  .strict()

const adminOnly: RequestHandler = asyncHandler(async (request, response, next) => {
  await requireAdmin(request as AuthRequest, response, next)
})

const adminProductSelect = `
  SELECT
    products.id,
    products.slug,
    products.name,
    products.short_description AS "shortDescription",
    products.description,
    products.price_uah AS "priceUah",
    products.old_price_uah AS "oldPriceUah",
    products.stock,
    products.status,
    products.is_available AS "isAvailable",
    products.rating,
    products.review_count AS "reviewCount",
    products.badge,
    products.created_at AS "createdAt",
    products.updated_at AS "updatedAt",
    categories.id AS "categoryId",
    categories.name AS "categoryName",
    COALESCE(images.items, '[]'::json) AS images
  FROM products
  LEFT JOIN categories ON categories.id = products.category_id
  LEFT JOIN LATERAL (
    SELECT json_agg(
      json_build_object(
        'id', product_images.id,
        'provider', product_images.provider,
        'publicId', product_images.public_id,
        'url', product_images.url,
        'altText', product_images.alt_text,
        'width', product_images.width,
        'height', product_images.height,
        'sortOrder', product_images.sort_order
      ) ORDER BY product_images.sort_order ASC
    ) AS items
    FROM product_images
    WHERE product_images.product_id = products.id
  ) images ON TRUE
`

type AdminProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  priceUah: number
  oldPriceUah: number | null
  stock: number
  status: (typeof productStatuses)[number]
  isAvailable: boolean
  rating: string | number
  reviewCount: number
  badge: string
  createdAt: string
  updatedAt: string
  categoryId: string | null
  categoryName: string | null
  images: Array<{
    id: string
    provider: 'cloudinary' | 'external'
    publicId: string | null
    url: string
    altText: string
    width: number | null
    height: number | null
    sortOrder: number
  }>
}

function normalizeAdminProduct(product: AdminProduct) {
  return { ...product, rating: Number(product.rating) }
}

async function getAdminProduct(id: number, client?: PoolClient) {
  const database = client ?? pool
  const { rows } = await database.query<AdminProduct>(
    `${adminProductSelect} WHERE products.id = $1`,
    [id],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return normalizeAdminProduct(product)
}

async function ensureActiveCategory(client: PoolClient, categoryId: string | null) {
  if (categoryId === null) return
  const category = await client.query(
    'SELECT id FROM categories WHERE id = $1 AND is_archived = FALSE',
    [categoryId],
  )
  if (!category.rowCount) throw new ApiError(400, 'Оберіть активну категорію')
}

async function writeAudit(
  client: PoolClient,
  adminUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO admin_audit_log (id, admin_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [newId(), adminUserId, action, entityType, entityId, JSON.stringify(details)],
  )
}

function productChanges(payload: Partial<z.infer<typeof productInputSchema>>) {
  const columns: Array<[string, unknown]> = [
    ['name', payload.name],
    ['slug', payload.slug],
    ['category_id', payload.categoryId],
    ['short_description', payload.shortDescription],
    ['description', payload.description],
    ['price_uah', payload.priceUah],
    ['old_price_uah', payload.oldPriceUah],
    ['stock', payload.stock],
    ['status', payload.status],
    ['rating', payload.rating],
    ['review_count', payload.reviewCount],
    ['badge', payload.badge],
  ]
  return columns.filter(([, value]) => value !== undefined)
}

async function destroyCloudinaryImages(
  images: Array<{ provider: string; publicId: string | null }>,
) {
  await Promise.allSettled(
    images
      .filter((image) => image.provider === 'cloudinary' && image.publicId)
      .map((image) => deleteProductImage(image.publicId!)),
  )
}

adminRouter.get(
  '/dashboard',
  adminOnly,
  asyncHandler(async (_request, response) => {
    const [catalogResult, orderResult, lowStockResult, recentOrdersResult] = await Promise.all([
      pool.query<{
        totalProducts: string
        activeProducts: string
        draftProducts: string
        archivedProducts: string
        totalStock: string
      }>(
        `SELECT
           COUNT(*)::text AS "totalProducts",
           COUNT(*) FILTER (WHERE status = 'active')::text AS "activeProducts",
           COUNT(*) FILTER (WHERE status = 'draft')::text AS "draftProducts",
           COUNT(*) FILTER (WHERE status = 'archived')::text AS "archivedProducts",
           COALESCE(SUM(stock), 0)::text AS "totalStock"
         FROM products`,
      ),
      pool.query<{
        totalOrders: string
        openOrders: string
        revenueUah: string
      }>(
        `SELECT
           COUNT(*)::text AS "totalOrders",
           COUNT(*) FILTER (WHERE status IN ('new', 'processing', 'shipped'))::text AS "openOrders",
           COALESCE(SUM(total_uah) FILTER (WHERE status <> 'cancelled'), 0)::text AS "revenueUah"
         FROM orders`,
      ),
      pool.query<{ id: number; name: string; stock: number }>(
        `SELECT id, name, stock
         FROM products
         WHERE status = 'active' AND stock <= 5
         ORDER BY stock ASC, name ASC
         LIMIT 8`,
      ),
      pool.query<{
        code: string
        customerName: string
        total: number
        status: string
        createdAt: string
      }>(
        `SELECT
           code,
           customer_name AS "customerName",
           total_uah AS total,
           status,
           created_at AS "createdAt"
         FROM orders
         ORDER BY created_at DESC
         LIMIT 6`,
      ),
    ])

    response.json({
      catalog: Object.fromEntries(
        Object.entries(catalogResult.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      orders: Object.fromEntries(
        Object.entries(orderResult.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      lowStock: lowStockResult.rows,
      recentOrders: recentOrdersResult.rows,
    })
  }),
)

adminRouter.get(
  '/products',
  adminOnly,
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().trim().max(100).optional(),
        status: z.enum([...productStatuses, 'all']).default('all'),
        categoryId: z.string().uuid().optional(),
      })
      .parse(request.query)
    const conditions: string[] = []
    const values: Array<string | number> = []
    const addValue = (value: string | number) => {
      values.push(value)
      return `$${values.length}`
    }

    if (query.search) {
      const search = addValue(query.search)
      conditions.push(
        `(products.name ILIKE '%' || ${search} || '%' OR products.slug ILIKE '%' || ${search} || '%')`,
      )
    }
    if (query.status !== 'all') conditions.push(`products.status = ${addValue(query.status)}`)
    if (query.categoryId) conditions.push(`products.category_id = ${addValue(query.categoryId)}`)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM products ${where}`,
      values,
    )
    const total = Number(count.rows[0]?.count ?? 0)
    const dataValues = [...values, query.pageSize, (query.page - 1) * query.pageSize]
    const { rows } = await pool.query<AdminProduct>(
      `${adminProductSelect}
       ${where}
       ORDER BY products.updated_at DESC, products.id DESC
       LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues,
    )

    response.json({
      products: rows.map(normalizeAdminProduct),
      page: query.page,
      pageSize: query.pageSize,
      total,
    })
  }),
)

adminRouter.get(
  '/products/:id',
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = idSchema.parse(request.params)
    response.json({ product: await getAdminProduct(id) })
  }),
)

adminRouter.post(
  '/products',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const payload = productInputSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    const product = await withTransaction(async (client) => {
      await ensureActiveCategory(client, payload.categoryId)
      const result = await client.query<{ id: number }>(
        `INSERT INTO products (
          name, slug, category_id, short_description, description, price_uah, old_price_uah,
          stock, status, is_available, rating, review_count, badge
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          payload.name,
          payload.slug,
          payload.categoryId,
          payload.shortDescription,
          payload.description,
          payload.priceUah,
          payload.oldPriceUah,
          payload.stock,
          payload.status,
          payload.status === 'active',
          payload.rating,
          payload.reviewCount,
          payload.badge,
        ],
      )
      const id = result.rows[0]?.id
      if (!id) throw new ApiError(500, 'Не вдалося створити товар')
      await writeAudit(client, auth.userId, 'product.created', 'product', String(id), {
        name: payload.name,
      })
      return getAdminProduct(id, client)
    })
    response.status(201).json({ product })
  }),
)

adminRouter.patch(
  '/products/:id',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const payload = productUpdateSchema.parse(request.body)
    if (!Object.keys(payload).length)
      throw new ApiError(400, 'Передайте хоча б одне поле для оновлення')
    if (
      payload.oldPriceUah !== undefined &&
      payload.priceUah !== undefined &&
      payload.oldPriceUah !== null &&
      payload.oldPriceUah < payload.priceUah
    ) {
      throw new ApiError(400, 'Попередня ціна не може бути меншою за поточну')
    }

    const auth = (request as AuthRequest).auth!
    const product = await withTransaction(async (client) => {
      const current = await getAdminProduct(id, client)
      if (payload.categoryId !== undefined) await ensureActiveCategory(client, payload.categoryId)
      const nextPrice = payload.priceUah ?? current.priceUah
      const nextOldPrice =
        payload.oldPriceUah === undefined ? current.oldPriceUah : payload.oldPriceUah
      if (nextOldPrice !== null && nextOldPrice < nextPrice) {
        throw new ApiError(400, 'Попередня ціна не може бути меншою за поточну')
      }
      const changes = productChanges(payload)
      if (payload.status !== undefined) changes.push(['is_available', payload.status === 'active'])
      changes.push(['updated_at', new Date()])
      const values = changes.map(([, value]) => value)
      const assignments = changes.map(([column], index) => `${column} = $${index + 1}`)
      values.push(id)
      await client.query(
        `UPDATE products SET ${assignments.join(', ')} WHERE id = $${values.length}`,
        values,
      )
      await writeAudit(client, auth.userId, 'product.updated', 'product', String(id), {
        fields: changes.map(([column]) => column),
      })
      return getAdminProduct(id, client)
    })
    response.json({ product })
  }),
)

adminRouter.delete(
  '/products/:id',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const auth = (request as AuthRequest).auth!
    const images = await withTransaction(async (client) => {
      const product = await getAdminProduct(id, client)
      await client.query('DELETE FROM cart_items WHERE product_id = $1', [id])
      await client.query('DELETE FROM products WHERE id = $1', [id])
      await writeAudit(client, auth.userId, 'product.deleted', 'product', String(id), {
        name: product.name,
      })
      return product.images
    })
    await destroyCloudinaryImages(images)
    response.status(204).end()
  }),
)

adminRouter.post(
  '/products/:id/images',
  requireCsrf,
  adminOnly,
  productImageUpload.array('images', 5),
  asyncHandler(async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const files = Array.isArray(request.files) ? request.files : []
    if (!files.length) throw new ApiError(400, 'Оберіть від одного до п’яти зображень')
    const auth = (request as AuthRequest).auth!
    const uploaded: UploadedProductImage[] = []

    try {
      for (const file of files) uploaded.push(await uploadProductImage(file))
      const product = await withTransaction(async (client) => {
        await getAdminProduct(id, client)
        const positionResult = await client.query<{ nextPosition: number }>(
          `SELECT COALESCE(MAX(sort_order) + 1, 0)::int AS "nextPosition"
           FROM product_images WHERE product_id = $1`,
          [id],
        )
        const startPosition = positionResult.rows[0]?.nextPosition ?? 0
        for (const [index, image] of uploaded.entries()) {
          await client.query(
            `INSERT INTO product_images (
              id, product_id, provider, public_id, url, alt_text, width, height, sort_order
            ) VALUES ($1, $2, 'cloudinary', $3, $4, $5, $6, $7, $8)`,
            [
              newId(),
              id,
              image.publicId,
              image.url,
              '',
              image.width,
              image.height,
              startPosition + index,
            ],
          )
        }
        await writeAudit(client, auth.userId, 'product.images_uploaded', 'product', String(id), {
          count: uploaded.length,
        })
        return getAdminProduct(id, client)
      })
      response.status(201).json({ product })
    } catch (error) {
      await destroyCloudinaryImages(
        uploaded.map((image) => ({ provider: 'cloudinary', publicId: image.publicId })),
      )
      throw error
    }
  }),
)

adminRouter.patch(
  '/products/:id/images',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = idSchema.parse(request.params)
    const payload = z
      .object({
        images: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                altText: z.string().trim().max(160),
                sortOrder: z.coerce.number().int().min(0).max(100),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .parse(request.body)
    const ids = new Set(payload.images.map((image) => image.id))
    const positions = new Set(payload.images.map((image) => image.sortOrder))
    if (ids.size !== payload.images.length || positions.size !== payload.images.length) {
      throw new ApiError(400, 'Зображення та їх порядок мають бути унікальними')
    }

    const auth = (request as AuthRequest).auth!
    const product = await withTransaction(async (client) => {
      const current = await client.query<{ id: string }>(
        'SELECT id FROM product_images WHERE product_id = $1',
        [id],
      )
      if (current.rows.length !== payload.images.length) {
        throw new ApiError(400, 'Надішліть повний актуальний список зображень товару')
      }
      const currentIds = new Set(current.rows.map((image) => image.id))
      if ([...ids].some((imageId) => !currentIds.has(imageId))) {
        throw new ApiError(400, 'Одне із зображень не належить цьому товару')
      }
      await client.query(
        'UPDATE product_images SET sort_order = sort_order + 1000 WHERE product_id = $1',
        [id],
      )
      for (const image of payload.images) {
        await client.query(
          `UPDATE product_images
           SET alt_text = $1, sort_order = $2
           WHERE id = $3 AND product_id = $4`,
          [image.altText, image.sortOrder, image.id, id],
        )
      }
      await writeAudit(client, auth.userId, 'product.images_reordered', 'product', String(id))
      return getAdminProduct(id, client)
    })
    response.json({ product })
  }),
)

adminRouter.delete(
  '/products/:productId/images/:imageId',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { productId, imageId } = z
      .object({ productId: z.coerce.number().int().positive(), imageId: z.string().uuid() })
      .parse(request.params)
    const auth = (request as AuthRequest).auth!
    const product = await withTransaction(async (client) => {
      const result = await client.query<{
        provider: string
        publicId: string | null
        sortOrder: number
      }>(
        `DELETE FROM product_images
         WHERE id = $1 AND product_id = $2
         RETURNING provider, public_id AS "publicId", sort_order AS "sortOrder"`,
        [imageId, productId],
      )
      const image = result.rows[0]
      if (!image) throw new ApiError(404, 'Зображення не знайдено')
      await client.query(
        `UPDATE product_images
         SET sort_order = sort_order - 1
         WHERE product_id = $1 AND sort_order > $2`,
        [productId, image.sortOrder],
      )
      await writeAudit(client, auth.userId, 'product.image_deleted', 'product', String(productId))
      return { image, product: await getAdminProduct(productId, client) }
    })
    await destroyCloudinaryImages([product.image])
    response.json({ product: product.product })
  }),
)

adminRouter.get(
  '/categories',
  adminOnly,
  asyncHandler(async (_request, response) => {
    const { rows } = await pool.query<{
      id: string
      name: string
      slug: string
      description: string
      isArchived: boolean
      productCount: string
    }>(
      `SELECT
         categories.id,
         categories.name,
         categories.slug,
         categories.description,
         categories.is_archived AS "isArchived",
         COUNT(products.id)::text AS "productCount"
       FROM categories
       LEFT JOIN products ON products.category_id = categories.id
       GROUP BY categories.id
       ORDER BY categories.is_archived ASC, categories.name ASC`,
    )
    response.json({
      categories: rows.map((category) => ({
        ...category,
        productCount: Number(category.productCount),
      })),
    })
  }),
)

adminRouter.post(
  '/categories',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const payload = categoryInputSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO categories (id, name, slug, description, is_archived)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [newId(), payload.name, payload.slug, payload.description, payload.isArchived ?? false],
    )
    const category = rows[0]
    if (!category) throw new ApiError(500, 'Не вдалося створити категорію')
    await withTransaction((client) =>
      writeAudit(client, auth.userId, 'category.created', 'category', category.id, {
        name: payload.name,
      }),
    )
    response.status(201).json({ id: category.id })
  }),
)

adminRouter.patch(
  '/categories/:id',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = categoryIdSchema.parse(request.params)
    const payload = categoryInputSchema.partial().strict().parse(request.body)
    if (!Object.keys(payload).length)
      throw new ApiError(400, 'Передайте хоча б одне поле для оновлення')
    const auth = (request as AuthRequest).auth!
    const changes: Array<[string, unknown]> = []
    if (payload.name !== undefined) changes.push(['name', payload.name])
    if (payload.slug !== undefined) changes.push(['slug', payload.slug])
    if (payload.description !== undefined) changes.push(['description', payload.description])
    if (payload.isArchived !== undefined) changes.push(['is_archived', payload.isArchived])
    changes.push(['updated_at', new Date()])
    const values = changes.map(([, value]) => value)
    const assignments = changes.map(([column], index) => `${column} = $${index + 1}`)
    values.push(id)
    const result = await pool.query(
      `UPDATE categories SET ${assignments.join(', ')} WHERE id = $${values.length}`,
      values,
    )
    if (!result.rowCount) throw new ApiError(404, 'Категорію не знайдено')
    await withTransaction((client) =>
      writeAudit(client, auth.userId, 'category.updated', 'category', id, {
        fields: changes.map(([column]) => column),
      }),
    )
    response.status(204).end()
  }),
)

adminRouter.delete(
  '/categories/:id',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { id } = categoryIdSchema.parse(request.params)
    const auth = (request as AuthRequest).auth!
    await withTransaction(async (client) => {
      const usage = await client.query('SELECT 1 FROM products WHERE category_id = $1 LIMIT 1', [
        id,
      ])
      if (usage.rowCount) {
        throw new ApiError(409, 'Спершу перепризначте або архівуйте товари цієї категорії')
      }
      const deleted = await client.query('DELETE FROM categories WHERE id = $1', [id])
      if (!deleted.rowCount) throw new ApiError(404, 'Категорію не знайдено')
      await writeAudit(client, auth.userId, 'category.deleted', 'category', id)
    })
    response.status(204).end()
  }),
)

const orderTransitions: Record<
  (typeof orderStatuses)[number],
  Array<(typeof orderStatuses)[number]>
> = {
  new: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
}

adminRouter.get(
  '/orders',
  adminOnly,
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        status: z.enum([...orderStatuses, 'all']).default('all'),
      })
      .parse(request.query)
    const values: Array<string | number> = []
    const where =
      query.status === 'all'
        ? ''
        : (() => {
            values.push(query.status)
            return 'WHERE orders.status = $1'
          })()
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM orders ${where}`,
      values,
    )
    const offset = (query.page - 1) * query.pageSize
    const dataValues = [...values, query.pageSize, offset]
    const { rows } = await pool.query<{
      code: string
      status: string
      total: number
      customerName: string
      customerEmail: string
      createdAt: string
    }>(
      `SELECT
         code,
         status,
         total_uah AS total,
         customer_name AS "customerName",
         customer_email AS "customerEmail",
         created_at AS "createdAt"
       FROM orders
       ${where}
       ORDER BY created_at DESC
       LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`,
      dataValues,
    )
    response.json({
      orders: rows,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    })
  }),
)

adminRouter.get(
  '/orders/:code',
  adminOnly,
  asyncHandler(async (request, response) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(32) }).parse(request.params)
    const { rows } = await pool.query<{
      id: string
      code: string
      status: (typeof orderStatuses)[number]
      total: number
      deliveryMethod: string
      deliveryCity: string
      deliveryBranch: string
      customerName: string
      customerPhone: string
      customerEmail: string
      createdAt: string
      updatedAt: string
    }>(
      `SELECT
         id,
         code,
         status,
         total_uah AS total,
         delivery_method AS "deliveryMethod",
         delivery_city AS "deliveryCity",
         delivery_branch AS "deliveryBranch",
         customer_name AS "customerName",
         customer_phone AS "customerPhone",
         customer_email AS "customerEmail",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM orders
       WHERE code = $1`,
      [code],
    )
    const order = rows[0]
    if (!order) throw new ApiError(404, 'Замовлення не знайдено')
    const [items, events] = await Promise.all([
      pool.query<{ productId: number; name: string; price: number; quantity: number }>(
        `SELECT
           product_id AS "productId",
           product_name AS name,
           price_uah AS price,
           quantity
         FROM order_items
         WHERE order_id = $1
         ORDER BY product_name ASC`,
        [order.id],
      ),
      pool.query<{
        previousStatus: string | null
        nextStatus: string
        createdAt: string
        changedBy: string | null
      }>(
        `SELECT
           previous_status AS "previousStatus",
           next_status AS "nextStatus",
           created_at AS "createdAt",
           changed_by AS "changedBy"
         FROM order_status_events
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [order.id],
      ),
    ])
    response.json({ order: { ...order, items: items.rows, events: events.rows } })
  }),
)

adminRouter.patch(
  '/orders/:code/status',
  requireCsrf,
  adminOnly,
  asyncHandler(async (request, response) => {
    const { code } = z.object({ code: z.string().trim().min(1).max(32) }).parse(request.params)
    const { status } = z
      .object({ status: z.enum(orderStatuses) })
      .strict()
      .parse(request.body)
    const auth = (request as AuthRequest).auth!
    const order = await withTransaction(async (client) => {
      const currentResult = await client.query<{
        id: string
        status: (typeof orderStatuses)[number]
      }>('SELECT id, status FROM orders WHERE code = $1 FOR UPDATE', [code])
      const current = currentResult.rows[0]
      if (!current) throw new ApiError(404, 'Замовлення не знайдено')
      if (!orderTransitions[current.status].includes(status)) {
        throw new ApiError(409, 'Цей перехід статусу недоступний')
      }

      if (status === 'cancelled') {
        const { rows: items } = await client.query<{ productId: number; quantity: number }>(
          'SELECT product_id AS "productId", quantity FROM order_items WHERE order_id = $1',
          [current.id],
        )
        for (const item of items) {
          await client.query(
            'UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
            [item.quantity, item.productId],
          )
        }
      }

      await client.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [
        status,
        current.id,
      ])
      await client.query(
        `INSERT INTO order_status_events (id, order_id, previous_status, next_status, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), current.id, current.status, status, auth.userId],
      )
      await writeAudit(client, auth.userId, 'order.status_changed', 'order', current.id, {
        previousStatus: current.status,
        nextStatus: status,
      })
      return current
    })
    response.json({ code, previousStatus: order.status, status })
  }),
)

export { adminRouter }
