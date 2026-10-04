import type { PoolClient } from 'pg'
import { newId, pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

type Page = { page: number; pageSize: number }
type ProductVersion = {
  id: number
  ratingEpoch: string
  ratingRevision: string
  rating: string | number
  reviewCount: number
  baseRating: string | number
  baseCount: string
  baseSum: string
}
type CommunityCommentRow = {
  id: string
  source: 'customer' | 'admin'
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
type AdminCommentInput = {
  nickname: string
  message: string
  clientRequestId: string
}

const publicProductWhere = `
  products.id = $1
  AND products.status = 'active'
  AND products.is_available = TRUE
  AND (categories.is_archived = FALSE OR categories.id IS NULL)
`

async function requirePublicProduct(productId: number) {
  const { rows } = await pool.query<{
    rating: string | number
    reviewCount: number
    ratingEpoch: string
  }>(
    `SELECT products.rating, products.review_count AS "reviewCount",
            products.rating_epoch::text AS "ratingEpoch"
     FROM products
     LEFT JOIN categories ON categories.id = products.category_id
     WHERE ${publicProductWhere}`,
    [productId],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return product
}

async function lockPublicProduct(client: PoolClient, productId: number) {
  const { rows } = await client.query<ProductVersion>(
    `SELECT products.id,
            products.rating_epoch::text AS "ratingEpoch",
            products.rating_revision::text AS "ratingRevision",
            products.rating,
            products.review_count AS "reviewCount",
            products.base_rating AS "baseRating",
            products.base_count::text AS "baseCount",
            products.base_sum::text AS "baseSum"
     FROM products
     LEFT JOIN categories ON categories.id = products.category_id
     WHERE ${publicProductWhere}
     FOR UPDATE OF products`,
    [productId],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return product
}

async function lockAdminProduct(client: PoolClient, productId: number) {
  const { rows } = await client.query<ProductVersion>(
    `SELECT id,
            rating_epoch::text AS "ratingEpoch",
            rating_revision::text AS "ratingRevision",
            rating,
            review_count AS "reviewCount",
            base_rating AS "baseRating",
            base_count::text AS "baseCount",
            base_sum::text AS "baseSum"
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [productId],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return product
}

async function requireEligibleOrderForShareLock(
  client: PoolClient,
  userId: string,
  productId: number,
) {
  const { rows } = await client.query<{ id: string }>(
    `SELECT orders.id
     FROM orders
     JOIN order_items ON order_items.order_id = orders.id
     WHERE orders.user_id = $1
       AND order_items.product_id = $2
       AND orders.payment_status = 'paid'
       AND orders.status <> 'cancelled'
     ORDER BY orders.created_at ASC, orders.id ASC
     LIMIT 1
     FOR SHARE OF orders`,
    [userId, productId],
  )
  const order = rows[0]
  if (!order) throw new ApiError(403, 'Оцінити й коментувати можна після покупки цього товару')
  const verified = await client.query<{
    userId: string
    status: string
    paymentStatus: string
    hasProduct: boolean
  }>(
    `SELECT orders.user_id AS "userId",
            orders.status,
            orders.payment_status AS "paymentStatus",
            EXISTS (
              SELECT 1 FROM order_items
              WHERE order_items.order_id = orders.id AND order_items.product_id = $2
            ) AS "hasProduct"
     FROM orders
     WHERE orders.id = $1
     FOR SHARE OF orders`,
    [order.id, productId],
  )
  const confirmed = verified.rows[0]
  if (
    !confirmed ||
    confirmed.userId !== userId ||
    !confirmed.hasProduct ||
    confirmed.paymentStatus !== 'paid' ||
    confirmed.status === 'cancelled'
  ) {
    throw new ApiError(403, 'Оцінити й коментувати можна після покупки цього товару')
  }
  return order.id
}

export async function consumeCustomerReviewAttempt(userId: string) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO product_review_mutation_limits (user_id, window_started_at, attempt_count)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (user_id) DO UPDATE SET
         window_started_at = CASE
           WHEN product_review_mutation_limits.window_started_at <= NOW() - INTERVAL '10 minutes'
             THEN NOW()
           ELSE product_review_mutation_limits.window_started_at
         END,
         attempt_count = CASE
           WHEN product_review_mutation_limits.window_started_at <= NOW() - INTERVAL '10 minutes'
             THEN 1
           ELSE product_review_mutation_limits.attempt_count + 1
         END
       WHERE product_review_mutation_limits.window_started_at <= NOW() - INTERVAL '10 minutes'
          OR product_review_mutation_limits.attempt_count < 20
       RETURNING attempt_count`,
      [userId],
    )
    if (!result.rowCount) throw new ApiError(429, 'Забагато спроб. Спробуйте ще раз за 10 хвилин.')
  })
}

async function getProductSummary(database: Pick<PoolClient, 'query'>, productId: number) {
  const { rows } = await database.query<{
    rating: string | number
    reviewCount: number
    ratingEpoch: string
    ratingRevision: string
    baseRating: string | number
    baseCount: string
    baseSum: string
  }>(
    `SELECT rating, review_count AS "reviewCount",
            rating_epoch::text AS "ratingEpoch",
            rating_revision::text AS "ratingRevision",
            base_rating AS "baseRating",
            base_count::text AS "baseCount",
            base_sum::text AS "baseSum"
     FROM products
     WHERE id = $1`,
    [productId],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return {
    rating: Number(product.rating),
    reviewCount: product.reviewCount,
    ratingEpoch: product.ratingEpoch,
    ratingRevision: product.ratingRevision,
    baseRating: Number(product.baseRating),
    baseCount: Number(product.baseCount),
    baseSum: product.baseSum,
  }
}

async function getPublicRatingSummary(database: Pick<PoolClient, 'query'>, productId: number) {
  const { rows } = await database.query<{
    rating: string | number
    reviewCount: number
  }>(
    `SELECT rating, review_count AS "reviewCount"
     FROM products
     WHERE id = $1`,
    [productId],
  )
  const product = rows[0]
  if (!product) throw new ApiError(404, 'Товар не знайдено')
  return { rating: Number(product.rating), reviewCount: product.reviewCount }
}

async function recomputeRatingAndBumpRevision(client: PoolClient, productId: number) {
  const { rows } = await client.query(
    `WITH current_votes AS (
       SELECT COUNT(*)::bigint AS vote_count,
              COALESCE(SUM(stars), 0)::numeric AS vote_sum
       FROM product_ratings
       WHERE product_id = $1
         AND epoch = (SELECT rating_epoch FROM products WHERE id = $1)
     )
     UPDATE products
     SET review_count = (products.base_count + current_votes.vote_count)::integer,
         rating = CASE
           WHEN products.base_count + current_votes.vote_count = 0 THEN 0::numeric
           ELSE ROUND(
             (products.base_sum + current_votes.vote_sum)
               / (products.base_count + current_votes.vote_count),
             1
           )::numeric(2, 1)
         END,
         rating_revision = products.rating_revision + 1,
         updated_at = NOW()
     FROM current_votes
     WHERE products.id = $1
     RETURNING products.id`,
    [productId],
  )
  if (!rows[0]) throw new ApiError(404, 'Товар не знайдено')
}

async function writeAdminAudit(
  client: PoolClient,
  adminUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO admin_audit_log (id, admin_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [newId(), adminUserId, action, entityType, entityId, JSON.stringify(details)],
  )
}

function publicComment(row: CommunityCommentRow) {
  return {
    id: row.id,
    nickname: row.authorName,
    message: row.body,
    createdAt: row.createdAt,
  }
}

function adminComment(row: CommunityCommentRow) {
  return {
    id: row.id,
    source: row.source,
    nickname: row.authorName,
    message: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

export async function getPublicCommunity(productId: number, page: Page) {
  const product = await requirePublicProduct(productId)
  const offset = (page.page - 1) * page.pageSize
  const [commentCountResult, commentsResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM product_comments
       WHERE product_id = $1 AND deleted_at IS NULL`,
      [productId],
    ),
    pool.query<CommunityCommentRow>(
      `SELECT id, source, author_name AS "authorName", body,
              created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM product_comments
       WHERE product_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [productId, page.pageSize, offset],
    ),
  ])
  return {
    summary: {
      rating: Number(product.rating),
      reviewCount: product.reviewCount,
      commentCount: Number(commentCountResult.rows[0]?.count ?? 0),
    },
    comments: {
      items: commentsResult.rows.map(publicComment),
      page: page.page,
      pageSize: page.pageSize,
      total: Number(commentCountResult.rows[0]?.count ?? 0),
    },
  }
}

export async function getPublicRatings(productId: number, page: Page) {
  const product = await requirePublicProduct(productId)
  const offset = (page.page - 1) * page.pageSize
  const [countResult, ratingsResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM product_ratings
       WHERE product_id = $1 AND epoch = $2`,
      [productId, product.ratingEpoch],
    ),
    pool.query<{ displayName: string; stars: number; createdAt: string }>(
      `SELECT author_name AS "displayName", stars, created_at AS "createdAt"
       FROM product_ratings
       WHERE product_id = $1 AND epoch = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [productId, product.ratingEpoch, page.pageSize, offset],
    ),
  ])
  return {
    ratings: ratingsResult.rows,
    page: page.page,
    pageSize: page.pageSize,
    total: Number(countResult.rows[0]?.count ?? 0),
  }
}

export async function getMyCommunity(productId: number, userId: string) {
  const product = await requirePublicProduct(productId)
  const [eligibilityResult, ratingResult, commentResult] = await Promise.all([
    pool.query<{ canReview: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM orders
         JOIN order_items ON order_items.order_id = orders.id
         WHERE orders.user_id = $1
           AND order_items.product_id = $2
           AND orders.payment_status = 'paid'
           AND orders.status <> 'cancelled'
       ) AS "canReview"`,
      [userId, productId],
    ),
    pool.query<{ stars: number; updatedAt: string }>(
      `SELECT stars, updated_at AS "updatedAt"
       FROM product_ratings
       WHERE product_id = $1 AND user_id = $2 AND epoch = $3`,
      [productId, userId, product.ratingEpoch],
    ),
    pool.query<CommunityCommentRow>(
      `SELECT id, source, author_name AS "authorName", body,
              created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM product_comments
       WHERE product_id = $1 AND user_id = $2 AND source = 'customer' AND deleted_at IS NULL`,
      [productId, userId],
    ),
  ])
  const canReview = eligibilityResult.rows[0]?.canReview ?? false
  const currentComment = commentResult.rows[0]
  return {
    canReview,
    reason: canReview ? null : 'purchase_required',
    ratingEpoch: product.ratingEpoch,
    rating: ratingResult.rows[0]
      ? { stars: ratingResult.rows[0].stars, updatedAt: ratingResult.rows[0].updatedAt }
      : null,
    comment: currentComment
      ? {
          id: currentComment.id,
          nickname: currentComment.authorName,
          message: currentComment.body,
          createdAt: currentComment.createdAt,
          updatedAt: currentComment.updatedAt,
        }
      : null,
  }
}

export async function putCustomerRating(
  client: PoolClient,
  productId: number,
  userId: string,
  stars: number,
  expectedEpoch: string,
) {
  const orderId = await requireEligibleOrderForShareLock(client, userId, productId)
  const product = await lockPublicProduct(client, productId)
  if (product.ratingEpoch !== expectedEpoch) {
    throw new ApiError(409, 'Сторінка рейтингу застаріла після скидання. Оновіть дані товару.')
  }
  const userResult = await client.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
    userId,
  ])
  const authorName = userResult.rows[0]?.name
  if (!authorName) throw new ApiError(401, 'Потрібна авторизація')

  const inserted = await client.query<{ stars: number; updatedAt: string }>(
    `INSERT INTO product_ratings (id, product_id, user_id, order_id, epoch, stars, author_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (product_id, user_id, epoch) DO UPDATE SET
       order_id = EXCLUDED.order_id,
       stars = EXCLUDED.stars,
       updated_at = NOW()
     WHERE product_ratings.stars IS DISTINCT FROM EXCLUDED.stars
     RETURNING stars, updated_at AS "updatedAt"`,
    [newId(), productId, userId, orderId, product.ratingEpoch, stars, authorName],
  )
  let rating = inserted.rows[0]
  if (rating) {
    await recomputeRatingAndBumpRevision(client, productId)
  } else {
    const existing = await client.query<{ stars: number; updatedAt: string }>(
      `SELECT stars, updated_at AS "updatedAt"
       FROM product_ratings
       WHERE product_id = $1 AND user_id = $2 AND epoch = $3`,
      [productId, userId, product.ratingEpoch],
    )
    rating = existing.rows[0]
    if (!rating) throw new ApiError(409, 'Не вдалося оновити оцінку. Оновіть сторінку товару.')
  }
  return {
    summary: await getPublicRatingSummary(client, productId),
    rating,
  }
}

export async function resetProductRating(
  client: PoolClient,
  productId: number,
  adminUserId: string,
  input: { rating: number; count: number; expectedEpoch: string; expectedRevision: string },
) {
  const current = await lockAdminProduct(client, productId)
  if (
    current.ratingEpoch !== input.expectedEpoch ||
    current.ratingRevision !== input.expectedRevision
  ) {
    throw new ApiError(
      409,
      'Рейтинг змінився після відкриття форми. Оновіть зведення та підтвердьте скидання ще раз.',
    )
  }
  const { rows } = await client.query<{
    ratingEpoch: string
    ratingRevision: string
  }>(
    `UPDATE products
     SET base_rating = $2::numeric(2, 1),
         base_count = $3::bigint,
         rating_epoch = rating_epoch + 1,
         rating_revision = rating_revision + 1,
         rating = CASE WHEN $3::bigint = 0 THEN 0::numeric ELSE $2::numeric(2, 1) END,
         review_count = $3::integer,
         updated_at = NOW()
     WHERE id = $1
     RETURNING rating_epoch::text AS "ratingEpoch",
               rating_revision::text AS "ratingRevision"`,
    [productId, input.rating, input.count],
  )
  const updated = rows[0]
  if (!updated) throw new ApiError(404, 'Товар не знайдено')
  await writeAdminAudit(client, adminUserId, 'product.rating.reset', 'product', String(productId), {
    previousBaseRating: Number(current.baseRating),
    previousBaseCount: Number(current.baseCount),
    previousRating: Number(current.rating),
    previousCount: current.reviewCount,
    previousEpoch: current.ratingEpoch,
    previousRevision: current.ratingRevision,
    newBaseRating: input.rating,
    newBaseCount: input.count,
    newEpoch: updated.ratingEpoch,
    newRevision: updated.ratingRevision,
  })
  return { summary: await getProductSummary(client, productId) }
}

async function findCustomerCommentByRequest(
  client: PoolClient,
  productId: number,
  userId: string,
  clientRequestId: string,
) {
  const { rows } = await client.query<CommunityCommentRow & { deletedAt: string | null }>(
    `SELECT id, source, author_name AS "authorName", body,
            created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
     FROM product_comments
     WHERE product_id = $1 AND user_id = $2 AND client_request_id = $3 AND source = 'customer'
     FOR UPDATE`,
    [productId, userId, clientRequestId],
  )
  return rows[0]
}

function replayExistingComment(
  existing: CommunityCommentRow | undefined,
  message: string,
): { comment: ReturnType<typeof publicComment>; replayed: true } {
  if (!existing) throw new ApiError(409, 'Ви вже залишили коментар до цього товару')
  if (existing.deletedAt) {
    throw new ApiError(409, 'Цей коментар уже видалено. Для нового створення потрібен інший запит.')
  }
  if (existing.body !== message) {
    throw new ApiError(409, 'Ідентифікатор запиту вже використано з іншим текстом')
  }
  return { comment: publicComment(existing), replayed: true }
}

export async function createCustomerComment(
  client: PoolClient,
  productId: number,
  userId: string,
  input: { message: string; clientRequestId: string },
) {
  const orderId = await requireEligibleOrderForShareLock(client, userId, productId)
  await lockPublicProduct(client, productId)
  const existing = await findCustomerCommentByRequest(
    client,
    productId,
    userId,
    input.clientRequestId,
  )
  if (existing) return replayExistingComment(existing, input.message)

  const userResult = await client.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
    userId,
  ])
  const authorName = userResult.rows[0]?.name
  if (!authorName) throw new ApiError(401, 'Потрібна авторизація')
  const { rows } = await client.query<CommunityCommentRow>(
    `INSERT INTO product_comments (
       id, product_id, source, author_name, body, user_id, order_id, client_request_id
     ) VALUES ($1, $2, 'customer', $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING
     RETURNING id, source, author_name AS "authorName", body,
               created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
    [newId(), productId, authorName, input.message, userId, orderId, input.clientRequestId],
  )
  const created = rows[0]
  if (created) return { comment: publicComment(created), replayed: false }

  const duplicate = await findCustomerCommentByRequest(
    client,
    productId,
    userId,
    input.clientRequestId,
  )
  if (duplicate) return replayExistingComment(duplicate, input.message)
  throw new ApiError(409, 'Ви вже залишили коментар до цього товару')
}

export async function updateCustomerComment(
  client: PoolClient,
  productId: number,
  commentId: string,
  userId: string,
  message: string,
) {
  await requireEligibleOrderForShareLock(client, userId, productId)
  await lockPublicProduct(client, productId)
  const { rows } = await client.query<CommunityCommentRow>(
    `UPDATE product_comments
     SET body = $4, updated_at = NOW()
     WHERE id = $1 AND product_id = $2 AND user_id = $3
       AND source = 'customer' AND deleted_at IS NULL
     RETURNING id, source, author_name AS "authorName", body,
               created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
    [commentId, productId, userId, message],
  )
  const updated = rows[0]
  if (!updated) throw new ApiError(404, 'Коментар не знайдено')
  return { comment: publicComment(updated) }
}

export async function deleteCustomerComment(
  client: PoolClient,
  productId: number,
  commentId: string,
  userId: string,
) {
  await requireEligibleOrderForShareLock(client, userId, productId)
  await lockPublicProduct(client, productId)
  const { rows } = await client.query<{ id: string; deletedAt: string | null }>(
    `SELECT id, deleted_at AS "deletedAt"
     FROM product_comments
     WHERE id = $1 AND product_id = $2 AND user_id = $3 AND source = 'customer'
     FOR UPDATE`,
    [commentId, productId, userId],
  )
  const comment = rows[0]
  if (!comment) throw new ApiError(404, 'Коментар не знайдено')
  if (!comment.deletedAt) {
    await client.query(
      `UPDATE product_comments
       SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1`,
      [commentId, userId],
    )
  }
}

async function findAdminCommentByRequest(
  client: PoolClient,
  productId: number,
  adminUserId: string,
  clientRequestId: string,
) {
  const { rows } = await client.query<CommunityCommentRow>(
    `SELECT id, source, author_name AS "authorName", body,
            created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
     FROM product_comments
     WHERE product_id = $1 AND created_by_admin = $2 AND client_request_id = $3 AND source = 'admin'
     FOR UPDATE`,
    [productId, adminUserId, clientRequestId],
  )
  return rows[0]
}

function replayAdminComment(existing: CommunityCommentRow | undefined, input: AdminCommentInput) {
  if (!existing) throw new ApiError(409, 'Не вдалося створити коментар. Спробуйте новий запит.')
  if (existing.deletedAt) {
    throw new ApiError(409, 'Цей коментар уже видалено. Для нового створення потрібен інший запит.')
  }
  if (existing.body !== input.message || existing.authorName !== input.nickname) {
    throw new ApiError(409, 'Ідентифікатор запиту вже використано з іншим вмістом')
  }
  return { comment: adminComment(existing), replayed: true }
}

export async function createAdminComment(
  client: PoolClient,
  productId: number,
  adminUserId: string,
  input: AdminCommentInput,
) {
  await lockAdminProduct(client, productId)
  const existing = await findAdminCommentByRequest(
    client,
    productId,
    adminUserId,
    input.clientRequestId,
  )
  if (existing) return replayAdminComment(existing, input)

  const { rows } = await client.query<CommunityCommentRow>(
    `INSERT INTO product_comments (
       id, product_id, source, author_name, body, created_by_admin, client_request_id
     ) VALUES ($1, $2, 'admin', $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id, source, author_name AS "authorName", body,
               created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`,
    [newId(), productId, input.nickname, input.message, adminUserId, input.clientRequestId],
  )
  const created = rows[0]
  if (!created) {
    const duplicate = await findAdminCommentByRequest(
      client,
      productId,
      adminUserId,
      input.clientRequestId,
    )
    return replayAdminComment(duplicate, input)
  }
  await writeAdminAudit(client, adminUserId, 'product.comment.admin_created', 'product_comment', created.id, {
    productId,
    source: 'admin',
  })
  return { comment: adminComment(created), replayed: false }
}

export async function deleteAdminComment(
  client: PoolClient,
  productId: number,
  commentId: string,
  adminUserId: string,
) {
  await lockAdminProduct(client, productId)
  const { rows } = await client.query<CommunityCommentRow>(
    `SELECT id, source, author_name AS "authorName", body,
            created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
     FROM product_comments
     WHERE product_id = $1 AND id = $2
     FOR UPDATE`,
    [productId, commentId],
  )
  const comment = rows[0]
  if (!comment) throw new ApiError(404, 'Коментар не знайдено')
  if (comment.deletedAt) return
  await client.query(
    `UPDATE product_comments
     SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
     WHERE product_id = $1 AND id = $3 AND deleted_at IS NULL`,
    [productId, adminUserId, commentId],
  )
  await writeAdminAudit(
    client,
    adminUserId,
    'product.comment.admin_deleted',
    'product_comment',
    commentId,
    { productId, source: comment.source },
  )
}

export async function getAdminComments(productId: number, page: Page & { filter: 'active' | 'deleted' | 'all' }) {
  const exists = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId])
  if (!exists.rowCount) throw new ApiError(404, 'Товар не знайдено')
  const conditions = ['product_id = $1']
  if (page.filter === 'active') conditions.push('deleted_at IS NULL')
  if (page.filter === 'deleted') conditions.push('deleted_at IS NOT NULL')
  const where = conditions.join(' AND ')
  const offset = (page.page - 1) * page.pageSize
  const [countResult, activeCountResult, commentsResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM product_comments WHERE ${where}`,
      [productId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM product_comments
       WHERE product_id = $1 AND deleted_at IS NULL`,
      [productId],
    ),
    pool.query<CommunityCommentRow>(
      `SELECT id, source, author_name AS "authorName", body,
              created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM product_comments
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [productId, page.pageSize, offset],
    ),
  ])
  return {
    comments: commentsResult.rows.map(adminComment),
    page: page.page,
    pageSize: page.pageSize,
    total: Number(countResult.rows[0]?.count ?? 0),
    commentCount: Number(activeCountResult.rows[0]?.count ?? 0),
    filter: page.filter,
  }
}
