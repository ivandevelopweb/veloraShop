import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'
import { app } from '../src/app.js'
import { createSession } from '../src/auth.js'
import { newId, pool } from '../src/db.js'

let server: Server
let origin = ''

class ReviewBrowserClient {
  private readonly cookies = new Map<string, string>()
  private csrfToken = ''

  private captureCookies(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  async useSession(token: string) {
    this.cookies.set('velora_session', token)
    const response = await this.request('/api/auth/csrf')
    assert.equal(response.status, 200)
    const body = (await response.json()) as { csrfToken: string }
    this.csrfToken = body.csrfToken
  }

  async request(
    path: string,
    options: { method?: string; body?: unknown; csrf?: boolean | 'invalid' } = {},
  ) {
    const method = options.method ?? 'GET'
    const headers = new Headers()
    const cookie = this.cookieHeader()
    if (cookie) headers.set('cookie', cookie)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (options.csrf === true) headers.set('x-csrf-token', this.csrfToken)
    if (options.csrf === 'invalid') headers.set('x-csrf-token', `${this.csrfToken}invalid`)
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    this.captureCookies(response)
    return response
  }

  async json<T>(
    path: string,
    options: { method?: string; body?: unknown; csrf?: boolean | 'invalid' } = {},
  ) {
    const response = await this.request(path, options)
    const body = response.status === 204 ? ({} as T) : ((await response.json()) as T)
    return { status: response.status, body, response }
  }
}

async function customer(name: string, role: 'customer' | 'admin' = 'customer') {
  const userId = newId()
  const email = `${userId}@example.test`
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, $2, $3, 'test-only', $4)`,
    [userId, name, email, role],
  )
  const token = await createSession(userId)
  const client = new ReviewBrowserClient()
  await client.useSession(token)
  return { userId, client }
}

async function product(suffix: string, status: 'active' | 'draft' | 'archived' = 'active') {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO products (
       name, slug, short_description, description, price_uah, stock, status,
       is_available, rating, review_count, base_rating, base_count, badge
     ) VALUES ($1, $2, 'Короткий опис', 'Повний опис', 1000, 0, $3, $4, 0, 0, 4.8, 0, '')
     RETURNING id`,
    [`Review product ${suffix}`, `review-product-${suffix}`, status, status === 'active'],
  )
  const id = rows[0]?.id
  assert(id)
  return id
}

async function paidOrder(
  userId: string,
  productId: number,
  status = 'processing',
  paymentStatus = 'paid',
) {
  const id = newId()
  const email = `${userId}@example.test`
  await pool.query(
    `INSERT INTO orders (
       id, code, user_id, status, total_uah, delivery_method, delivery_city,
       delivery_branch, customer_name, customer_phone, customer_email,
       payment_status, payment_provider, payment_updated_at
     ) VALUES ($1, $2, $3, $4, 1000, 'nova_poshta', 'Київ', 'Тест',
              'Test buyer', '+380000000000', $5, $6, 'legacy_mock', NOW())`,
    [id, `RV-${id.slice(0, 8)}`, userId, status, email, paymentStatus],
  )
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, product_name, price_uah, quantity, product_slug)
     VALUES ($1, $2, 'Review product', 1000, 1, 'review-product')`,
    [id, productId],
  )
  return id
}

before(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await pool.end()
})

beforeEach(async () => {
  await pool.query('TRUNCATE users, products, categories, auth_rate_limits RESTART IDENTITY CASCADE')
})

test('exact weighted ratings, concurrent voices, and reset generations stay consistent', async () => {
  const weightedProductId = await product('weighted')
  await pool.query(
    `UPDATE products
     SET base_rating = 4.5, base_count = 10, rating = 4.5, review_count = 10
     WHERE id = $1`,
    [weightedProductId],
  )
  const firstBuyer = await customer('First buyer')
  const secondBuyer = await customer('Second buyer')
  await paidOrder(firstBuyer.userId, weightedProductId)
  await paidOrder(secondBuyer.userId, weightedProductId)

  const firstVote = await firstBuyer.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${weightedProductId}/ratings`, {
    method: 'POST',
    csrf: true,
    body: { stars: 5, expectedEpoch: '0' },
  })
  assert.equal(firstVote.status, 200)
  assert.deepEqual(firstVote.body.summary, { rating: 4.5, reviewCount: 11 })

  const secondVote = await secondBuyer.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${weightedProductId}/ratings`, {
    method: 'POST',
    csrf: true,
    body: { stars: 2, expectedEpoch: '0' },
  })
  assert.equal(secondVote.status, 200)
  assert.deepEqual(secondVote.body.summary, { rating: 4.3, reviewCount: 12 })

  const changedVote = await firstBuyer.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${weightedProductId}/ratings`, {
    method: 'POST',
    csrf: true,
    body: { stars: 4, expectedEpoch: '0' },
  })
  assert.equal(changedVote.status, 200)
  assert.deepEqual(changedVote.body.summary, { rating: 4.3, reviewCount: 12 })
  const revisionBeforeReplay = await pool.query<{ revision: string }>(
    'SELECT rating_revision::text AS revision FROM products WHERE id = $1',
    [weightedProductId],
  )
  const repeatedVote = await firstBuyer.client.json<{ summary: { reviewCount: number } }>(
    `/api/products/${weightedProductId}/ratings`,
    { method: 'POST', csrf: true, body: { stars: 4, expectedEpoch: '0' } },
  )
  assert.equal(repeatedVote.status, 200)
  assert.equal(repeatedVote.body.summary.reviewCount, 12)
  const revisionAfterReplay = await pool.query<{ revision: string }>(
    'SELECT rating_revision::text AS revision FROM products WHERE id = $1',
    [weightedProductId],
  )
  assert.equal(revisionAfterReplay.rows[0]?.revision, revisionBeforeReplay.rows[0]?.revision)

  const resetProductId = await product('reset')
  const buyers = await Promise.all(
    Array.from({ length: 10 }, (_, index) => customer(`Concurrent buyer ${index + 1}`)),
  )
  await Promise.all(buyers.map((buyer) => paidOrder(buyer.userId, resetProductId)))
  const parallelVotes = await Promise.all(
    buyers.map((buyer) =>
      buyer.client.json<{ summary: { rating: number; reviewCount: number } }>(
        `/api/products/${resetProductId}/ratings`,
        { method: 'POST', csrf: true, body: { stars: 2, expectedEpoch: '0' } },
      ),
    ),
  )
  assert(parallelVotes.every((result) => result.status === 200))
  const parallelFinal = await buyers[0]!.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${resetProductId}/community`)
  assert.deepEqual(parallelFinal.body.summary, {
    rating: 2,
    reviewCount: 10,
    commentCount: 0,
  })

  const commentRequestId = randomUUID()
  const preservedComment = await buyers[0]!.client.json<{
    comment: { id: string; message: string }
  }>(`/api/products/${resetProductId}/comments`, {
    method: 'POST',
    csrf: true,
    body: { message: 'Коментар зберігається після зміни бази.', clientRequestId: commentRequestId },
  })
  assert.equal(preservedComment.status, 201)

  const admin = await customer('Review admin', 'admin')
  const reset = await admin.client.json<{
    summary: {
      rating: number
      reviewCount: number
      baseRating: number
      baseCount: number
      ratingEpoch: string
      ratingRevision: string
    }
  }>(`/api/admin/products/${resetProductId}/rating-reset`, {
    method: 'POST',
    csrf: true,
    body: { rating: 5, count: 5, expectedEpoch: '0', expectedRevision: '10' },
  })
  assert.equal(reset.status, 200)
  assert.equal(reset.body.summary.rating, 5)
  assert.equal(reset.body.summary.reviewCount, 5)
  assert.equal(reset.body.summary.baseRating, 5)
  assert.equal(reset.body.summary.baseCount, 5)
  assert.equal(reset.body.summary.ratingEpoch, '1')
  assert.equal(reset.body.summary.ratingRevision, '11')

  const oldRatings = await buyers[0]!.client.json<{ total: number }>(
    `/api/products/${resetProductId}/ratings`,
  )
  assert.equal(oldRatings.status, 200)
  assert.equal(oldRatings.body.total, 0)
  const commentsAfterReset = await buyers[0]!.client.json<{
    summary: { commentCount: number; reviewCount: number }
    comments: { items: Array<{ message: string; nickname: string }> }
  }>(`/api/products/${resetProductId}/community`)
  assert.equal(commentsAfterReset.body.summary.commentCount, 1)
  assert.equal(commentsAfterReset.body.summary.reviewCount, 5)
  assert.equal(commentsAfterReset.body.comments.items[0]?.message, 'Коментар зберігається після зміни бази.')
  assert.equal(commentsAfterReset.body.comments.items[0]?.nickname, 'Concurrent buyer 1')

  const staleReset = await admin.client.json(`/api/admin/products/${resetProductId}/rating-reset`, {
    method: 'POST',
    csrf: true,
    body: { rating: 5, count: 5, expectedEpoch: '0', expectedRevision: '10' },
  })
  assert.equal(staleReset.status, 409)
  assert.equal(
    (await buyers[1]!.client.json(`/api/products/${resetProductId}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 3, expectedEpoch: '0' },
    })).status,
    409,
  )

  const newGenerationVote = await buyers[0]!.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${resetProductId}/ratings`, {
    method: 'POST',
    csrf: true,
    body: { stars: 2, expectedEpoch: '1' },
  })
  assert.equal(newGenerationVote.status, 200)
  assert.deepEqual(newGenerationVote.body.summary, { rating: 4.5, reviewCount: 6 })
  const revisedVote = await buyers[0]!.client.json<{
    summary: { rating: number; reviewCount: number }
  }>(`/api/products/${resetProductId}/ratings`, {
    method: 'POST',
    csrf: true,
    body: { stars: 4, expectedEpoch: '1' },
  })
  assert.equal(revisedVote.status, 200)
  assert.deepEqual(revisedVote.body.summary, { rating: 4.8, reviewCount: 6 })

  const history = await pool.query<{ epoch: string; count: number; stars: number }>(
    `SELECT epoch::text AS epoch, COUNT(*)::int AS count, SUM(stars)::int AS stars
     FROM product_ratings
     WHERE product_id = $1
     GROUP BY epoch
     ORDER BY epoch`,
    [resetProductId],
  )
  assert.deepEqual(history.rows, [
    { epoch: '0', count: 10, stars: 20 },
    { epoch: '1', count: 1, stars: 4 },
  ])
  const resetAudit = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM admin_audit_log
     WHERE action = 'product.rating.reset' AND entity_id = $1`,
    [String(resetProductId)],
  )
  assert.equal(resetAudit.rows[0]?.count, '1')

  const precisionProductId = await product('precision-series')
  const precisionBuyers = await Promise.all(
    Array.from({ length: 8 }, (_, index) => customer(`Precision buyer ${index + 1}`)),
  )
  await Promise.all(precisionBuyers.map((buyer) => paidOrder(buyer.userId, precisionProductId)))
  let precisionSummary = { rating: 0, reviewCount: 0 }
  for (const [index, precisionBuyer] of precisionBuyers.entries()) {
    const result = await precisionBuyer.client.json<{
      summary: { rating: number; reviewCount: number }
    }>(`/api/products/${precisionProductId}/ratings`, {
      method: 'POST', csrf: true,
      body: { stars: index < 6 ? 1 : 2, expectedEpoch: '0' },
    })
    assert.equal(result.status, 200)
    precisionSummary = result.body.summary
  }
  assert.deepEqual(precisionSummary, { rating: 1.3, reviewCount: 8 })
})

test('public reads, purchase ownership, payment state, CSRF, role and validation boundaries hold', async () => {
  const productA = await product('permissions-a')
  const productB = await product('permissions-b')
  const draftProduct = await product('permissions-draft', 'draft')
  const archivedProduct = await product('permissions-archived', 'archived')
  const buyer = await customer('Eligible buyer')
  assert.equal(
    (await buyer.client.json('/api/cart', {
      method: 'POST', csrf: true, body: { productId: productA },
    })).status,
    404,
  )
  const stranger = await customer('Different account')
  const otherOrderOwner = await customer('Other order owner')
  const admin = await customer('Ratings admin', 'admin')
  const buyerOrder = await paidOrder(buyer.userId, productA, 'processing', 'paid')
  const completedBuyer = await customer('Completed buyer')
  const sandboxBuyer = await customer('Sandbox buyer')
  await paidOrder(completedBuyer.userId, productA, 'completed', 'paid')
  const sandboxOrder = await paidOrder(sandboxBuyer.userId, productA, 'processing', 'paid')
  await paidOrder(otherOrderOwner.userId, productA, 'processing', 'paid')
  await pool.query("UPDATE orders SET payment_provider = 'liqpay_sandbox' WHERE id = $1", [sandboxOrder])

  const guest = new ReviewBrowserClient()
  const community = await guest.json<{
    summary: { rating: number; reviewCount: number; commentCount: number }
    comments: { items: unknown[] }
  }>(`/api/products/${productA}/community`)
  assert.equal(community.status, 200)
  assert.deepEqual(community.body.summary, { rating: 0, reviewCount: 0, commentCount: 0 })
  assert.deepEqual(Object.keys(community.body.summary).sort(), ['commentCount', 'rating', 'reviewCount'])
  assert.equal((await guest.json('/api/products/review-product-permissions-a')).status, 200)
  assert.equal((await guest.json(`/api/products/${draftProduct}/community`)).status, 404)
  assert.equal((await guest.json(`/api/products/${archivedProduct}/community`)).status, 404)
  assert.equal((await guest.json(`/api/products/${productA}/community/me`)).status, 401)
  assert.equal(
    (await guest.json(`/api/products/${productA}/ratings`, {
      method: 'POST', body: { stars: 5, expectedEpoch: '0' },
    })).status,
    401,
  )

  assert.equal(
    (await stranger.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
    })).status,
    200,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productB}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await completedBuyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 4, expectedEpoch: '0' },
    })).status,
    200,
  )
  assert.equal(
    (await sandboxBuyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 3, expectedEpoch: '0' },
    })).status,
    200,
  )

  for (const [index, paymentStatus] of [
    'pending', 'failed', 'expired', 'reconciliation_required', 'cancelled',
  ].entries()) {
    const ineligible = await customer(`Ineligible ${paymentStatus}`)
    await paidOrder(ineligible.userId, productA, 'processing', paymentStatus)
    const response = await ineligible.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: index % 5 + 1, expectedEpoch: '0' },
    })
    assert.equal(response.status, 403, `${paymentStatus} payment must not grant review access`)
  }
  const cancelledOrderBuyer = await customer('Cancelled order buyer')
  await paidOrder(cancelledOrderBuyer.userId, productA, 'cancelled', 'paid')
  assert.equal(
    (await cancelledOrderBuyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 3, expectedEpoch: '0' },
    })).status,
    403,
  )
  const ownOrder = await pool.query<{ id: string }>(
    'SELECT id FROM orders WHERE id = $1 AND user_id = $2', [buyerOrder, buyer.userId],
  )
  assert.equal(ownOrder.rowCount, 1)
  const buyerState = await buyer.client.json<{ canReview: boolean; reason: string | null }>(
    `/api/products/${productA}/community/me`,
  )
  assert.deepEqual({ canReview: buyerState.body.canReview, reason: buyerState.body.reason }, { canReview: true, reason: null })
  const strangerState = await stranger.client.json<{ canReview: boolean; reason: string }>(
    `/api/products/${productA}/community/me`,
  )
  assert.deepEqual({ canReview: strangerState.body.canReview, reason: strangerState.body.reason }, {
    canReview: false, reason: 'purchase_required',
  })

  assert.equal(
    (await buyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', body: { stars: 4, expectedEpoch: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: 'invalid', body: { stars: 4, expectedEpoch: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true,
      body: {
        stars: 4, expectedEpoch: '0', userId: stranger.userId,
        orderId: buyerOrder, source: 'admin', nickname: 'Impersonator',
      },
    })).status,
    400,
  )
  for (const stars of [0, 6, 2.5, '5', null]) {
    assert.equal(
      (await buyer.client.json(`/api/products/${productA}/ratings`, {
        method: 'POST', csrf: true, body: { stars, expectedEpoch: '0' },
      })).status,
      400,
    )
  }
  assert.equal(
    (await buyer.client.json(`/api/products/${productA}/ratings`, {
      method: 'POST', csrf: true,
      body: { stars: 5, expectedEpoch: '99999999999999999999' },
    })).status,
    400,
  )

  assert.equal(
    (await buyer.client.json(`/api/admin/products/${productA}/rating-reset`, {
      method: 'POST', csrf: true,
      body: { rating: 5, count: 5, expectedEpoch: '0', expectedRevision: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productA}/rating-reset`, {
      method: 'POST', body: { rating: 5, count: 5, expectedEpoch: '0', expectedRevision: '0' },
    })).status,
    403,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productA}/rating-reset`, {
      method: 'POST', csrf: true,
      body: { rating: 5, count: 5, expectedEpoch: '0', expectedRevision: '0', source: 'customer' },
    })).status,
    400,
  )
  for (const [rating, count] of [[5.1, 1], [5, -1], [5, 1.5], [0.5, 1]]) {
    assert.equal(
      (await admin.client.json(`/api/admin/products/${productA}/rating-reset`, {
        method: 'POST', csrf: true,
        body: { rating, count, expectedEpoch: '0', expectedRevision: '0' },
      })).status,
      400,
    )
  }
  assert.equal(
    (await admin.client.json(`/api/products/${productA}/community?page=1&pageSize=51`)).status,
    400,
  )

  const ratingPublic = await guest.json<{
    ratings: Array<Record<string, unknown>>
  }>(`/api/products/${productA}/ratings`)
  assert.equal(ratingPublic.status, 200)
  assert.equal(ratingPublic.body.ratings.length, 3)
  assert.deepEqual(Object.keys(ratingPublic.body.ratings[0] ?? {}).sort(), [
    'createdAt', 'displayName', 'stars',
  ])
})

test('customer and admin comments are idempotent, paginated, owned and independent of ratings', async () => {
  const productId = await product('comments')
  const otherProductId = await product('comments-other')
  const buyer = await customer('Buyer profile name')
  const otherBuyer = await customer('Other buyer')
  const admin = await customer('Comment admin', 'admin')
  const guest = new ReviewBrowserClient()
  await paidOrder(buyer.userId, productId)
  await paidOrder(otherBuyer.userId, productId)

  const rating = await buyer.client.json(`/api/products/${productId}/ratings`, {
    method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
  })
  assert.equal(rating.status, 200)
  const firstRequestId = randomUUID()
  const firstComment = await buyer.client.json<{
    comment: { id: string; nickname: string; message: string }
    replayed: boolean
  }>(`/api/products/${productId}/comments`, {
    method: 'POST', csrf: true,
    body: {
      message: '<script>alert("x")</script> український текст\nдовгесловобезпробілів',
      clientRequestId: firstRequestId,
      nickname: 'Spoofed author', source: 'admin', userId: otherBuyer.userId,
    },
  })
  assert.equal(firstComment.status, 400)
  const postBody = {
    message: '<script>alert("x")</script> український текст\nдовгесловобезпробілів',
    clientRequestId: firstRequestId,
  }
  const created = await buyer.client.json<{
    comment: { id: string; nickname: string; message: string }
    replayed: boolean
  }>(`/api/products/${productId}/comments`, { method: 'POST', csrf: true, body: postBody })
  assert.equal(created.status, 201)
  assert.equal(created.body.comment.nickname, 'Buyer profile name')
  assert.equal(created.body.comment.message, postBody.message)
  assert.equal(created.body.replayed, false)
  const sameRetry = await buyer.client.json<{ comment: { id: string }; replayed: boolean }>(
    `/api/products/${productId}/comments`,
    { method: 'POST', csrf: true, body: postBody },
  )
  assert.equal(sameRetry.status, 200)
  assert.equal(sameRetry.body.comment.id, created.body.comment.id)
  assert.equal(sameRetry.body.replayed, true)
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments`, {
      method: 'POST', csrf: true,
      body: { ...postBody, message: 'Змінений текст під тим самим ID' },
    })).status,
    409,
  )
  assert.equal(
    (await otherBuyer.client.json(`/api/products/${productId}/comments`, {
      method: 'POST', csrf: true,
      body: { message: 'Другий покупець', clientRequestId: randomUUID() },
    })).status,
    201,
  )
  const publicXssText = await guest.json<{
    comments: { items: Array<Record<string, unknown>> }
  }>(`/api/products/${productId}/community?pageSize=50`)
  assert.equal(publicXssText.body.comments.items.length, 2)
  assert.equal(
    publicXssText.body.comments.items.some((comment) =>
      comment.message === postBody.message && comment.nickname === 'Buyer profile name',
    ),
    true,
  )
  assert.deepEqual(Object.keys(publicXssText.body.comments.items[0] ?? {}).sort(), [
    'createdAt', 'id', 'message', 'nickname',
  ])
  const commentCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM product_comments WHERE product_id = $1', [productId],
  )
  assert.equal(commentCount.rows[0]?.count, '2')

  assert.equal(
    (await otherBuyer.client.json(`/api/products/${productId}/comments/${created.body.comment.id}`, {
      method: 'PATCH', csrf: true, body: { message: 'Чужий текст' },
    })).status,
    404,
  )
  const updated = await buyer.client.json<{ comment: { nickname: string; message: string } }>(
    `/api/products/${productId}/comments/${created.body.comment.id}`,
    { method: 'PATCH', csrf: true, body: { message: 'Оновлення з профілю' } },
  )
  assert.equal(updated.status, 200)
  assert.equal(updated.body.comment.nickname, 'Buyer profile name')
  assert.equal(updated.body.comment.message, 'Оновлення з профілю')
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments/${created.body.comment.id}`, {
      method: 'PATCH', csrf: true, body: { message: ' ' },
    })).status,
    400,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments/${created.body.comment.id}`, {
      method: 'PATCH', csrf: true, body: { message: 'a'.repeat(2001) },
    })).status,
    400,
  )

  const adminInput = { nickname: 'Velora Editor', message: 'Коментар від Velora', clientRequestId: randomUUID() }
  const adminCreated = await admin.client.json<{ comment: { id: string }; replayed: boolean }>(
    `/api/admin/products/${productId}/comments`, { method: 'POST', csrf: true, body: adminInput },
  )
  assert.equal(adminCreated.status, 201)
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments`, {
      method: 'POST', csrf: true,
      body: { ...adminInput, clientRequestId: randomUUID(), nickname: ' ', message: 'valid message' },
    })).status,
    400,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments`, {
      method: 'POST', csrf: true, body: adminInput,
    })).status,
    200,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments`, {
      method: 'POST', csrf: true, body: { ...adminInput, nickname: 'Other' },
    })).status,
    409,
  )
  const foreignCommentId = adminCreated.body.comment.id
  assert.equal(
    (await admin.client.json(`/api/admin/products/${otherProductId}/comments/${foreignCommentId}`, {
      method: 'DELETE', csrf: true,
    })).status,
    404,
  )

  const initialComments = await admin.client.json<{
    product: { id: number; brand: string; rating: number; reviewCount: number; baseRating: number; baseCount: number }
  }>('/api/admin/products', {
    method: 'POST', csrf: true,
    body: {
      name: 'Created with notes', slug: 'created-with-notes', categoryId: null,
      brand: 'Test Brand',
      shortDescription: 'Короткий опис', description: 'Опис товару', priceUah: 1000,
      oldPriceUah: null, stock: 3, status: 'active', rating: 3.5, reviewCount: 4, badge: '',
      initialComments: [
        { nickname: 'Editor One', message: 'Перший коментар', clientRequestId: randomUUID() },
        { nickname: 'Editor Two', message: 'Другий коментар', clientRequestId: randomUUID() },
      ],
    },
  })
  assert.equal(initialComments.status, 201)
  assert.equal(initialComments.body.product.rating, 3.5)
  assert.equal(initialComments.body.product.brand, 'Test Brand')
  assert.equal(initialComments.body.product.reviewCount, 4)
  assert.equal(initialComments.body.product.baseRating, 3.5)
  assert.equal(initialComments.body.product.baseCount, 4)
  const createdAdminComments = await admin.client.json<{
    total: number; commentCount: number; comments: Array<{ source: string; nickname: string }>
  }>(`/api/admin/products/${initialComments.body.product.id}/comments?pageSize=1`)
  assert.equal(createdAdminComments.body.total, 2)
  assert.equal(createdAdminComments.body.commentCount, 2)
  assert.equal(createdAdminComments.body.comments.length, 1)
  const pageTwo = await admin.client.json<{ comments: Array<{ nickname: string }> }>(
    `/api/admin/products/${initialComments.body.product.id}/comments?page=2&pageSize=1`,
  )
  assert.equal(pageTwo.body.comments.length, 1)

  const publicProduct = await admin.client.json<{
    products: Array<{ id: number; brand: string }>
  }>('/api/products?search=Test%20Brand&pageSize=100')
  assert(publicProduct.body.products.some((item) =>
    item.id === initialComments.body.product.id && item.brand === 'Test Brand',
  ))

  const brandEdit = await admin.client.json<{ product: { brand: string } }>(
    `/api/admin/products/${initialComments.body.product.id}`,
    { method: 'PATCH', csrf: true, body: { brand: 'Updated Brand' } },
  )
  assert.equal(brandEdit.status, 200)
  assert.equal(brandEdit.body.product.brand, 'Updated Brand')

  const beforeEdit = await pool.query<{ rating: string; reviewCount: number }>(
    'SELECT rating::text, review_count AS "reviewCount" FROM products WHERE id = $1', [productId],
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}`, {
      method: 'PATCH', csrf: true,
      body: { description: 'Текст товару змінено', rating: 1, reviewCount: 0 },
    })).status,
    400,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}`, {
      method: 'PATCH', csrf: true, body: { description: 'Текст товару змінено' },
    })).status,
    200,
  )
  const afterEdit = await pool.query<{ rating: string; reviewCount: number }>(
    'SELECT rating::text, review_count AS "reviewCount" FROM products WHERE id = $1', [productId],
  )
  assert.deepEqual(afterEdit.rows, beforeEdit.rows)

  const revisionBeforeTextMutation = await pool.query<{ revision: string }>(
    'SELECT rating_revision::text AS revision FROM products WHERE id = $1', [productId],
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments/${created.body.comment.id}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments`, {
      method: 'POST', csrf: true, body: postBody,
    })).status,
    409,
  )
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/comments/${created.body.comment.id}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )
  const publicAfterCustomerDelete = await guest.json<{
    summary: { reviewCount: number; commentCount: number }
  }>(`/api/products/${productId}/community`)
  assert.deepEqual(publicAfterCustomerDelete.body.summary, { rating: 5, reviewCount: 1, commentCount: 2 })
  const revisionAfterTextMutation = await pool.query<{ revision: string }>(
    'SELECT rating_revision::text AS revision FROM products WHERE id = $1', [productId],
  )
  assert.equal(revisionAfterTextMutation.rows[0]?.revision, revisionBeforeTextMutation.rows[0]?.revision)

  const activeAdminList = await admin.client.json<{
    comments: Array<{ id: string; source: string; nickname: string }>
  }>(`/api/admin/products/${productId}/comments?filter=active&pageSize=50`)
  assert.deepEqual(new Set(activeAdminList.body.comments.map((comment) => comment.source)), new Set(['customer', 'admin']))
  const customerCommentId = activeAdminList.body.comments.find(
    (comment) => comment.source === 'customer' && comment.nickname === 'Other buyer',
  )?.id
  assert(customerCommentId)
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments/${customerCommentId}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments/${customerCommentId}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )

  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments/${foreignCommentId}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments`, {
      method: 'POST', csrf: true, body: adminInput,
    })).status,
    409,
  )
  assert.equal(
    (await admin.client.json(`/api/admin/products/${productId}/comments/${foreignCommentId}`, {
      method: 'DELETE', csrf: true,
    })).status,
    204,
  )
  const deleted = await admin.client.json<{ total: number; commentCount: number }>(
    `/api/admin/products/${productId}/comments?filter=deleted`,
  )
  assert.equal(deleted.body.total, 3)
  assert.equal(deleted.body.commentCount, 0)
  const publicAfterAdminDelete = await guest.json<{ summary: { commentCount: number } }>(
    `/api/products/${productId}/community`,
  )
  assert.equal(publicAfterAdminDelete.body.summary.commentCount, 0)
  const deleteAudits = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM admin_audit_log
     WHERE action = 'product.comment.admin_deleted' AND entity_id = $1`, [foreignCommentId],
  )
  assert.equal(deleteAudits.rows[0]?.count, '1')
  const customerDeleteAudit = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM admin_audit_log
     WHERE action = 'product.comment.admin_deleted' AND entity_id = $1`, [customerCommentId],
  )
  assert.equal(customerDeleteAudit.rows[0]?.count, '1')
})

test('review mutation quota is enforced by the database across retries', async () => {
  const productId = await product('quota')
  const buyer = await customer('Quota buyer')
  await paidOrder(buyer.userId, productId)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await buyer.client.json(`/api/products/${productId}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
    })
    assert.equal(response.status, 200, `review mutation ${attempt + 1} should remain in quota`)
  }
  assert.equal(
    (await buyer.client.json(`/api/products/${productId}/ratings`, {
      method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
    })).status,
    429,
  )
})

test('same-request and competing customer comments remain idempotent under concurrency', async () => {
  const productId = await product('comment-race')
  const buyer = await customer('Concurrent comment author')
  await paidOrder(buyer.userId, productId)
  const clientRequestId = randomUUID()
  const body = { message: 'Один запит у двох одночасних вкладках', clientRequestId }
  const [first, second] = await Promise.all([
    buyer.client.json<{ comment: { id: string }; replayed: boolean }>(
      `/api/products/${productId}/comments`, { method: 'POST', csrf: true, body },
    ),
    buyer.client.json<{ comment: { id: string }; replayed: boolean }>(
      `/api/products/${productId}/comments`, { method: 'POST', csrf: true, body },
    ),
  ])
  assert.deepEqual([first.status, second.status].sort(), [200, 201])
  assert.equal(first.body.comment.id, second.body.comment.id)

  const differentRequest = await buyer.client.json(`/api/products/${productId}/comments`, {
    method: 'POST', csrf: true, body: { message: 'Другий активний текст', clientRequestId: randomUUID() },
  })
  assert.equal(differentRequest.status, 409)

  const rating = await buyer.client.json(`/api/products/${productId}/ratings`, {
    method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
  })
  assert.equal(rating.status, 200)
  const storedVote = await pool.query<{ orderId: string; stars: number }>(
    `SELECT order_id AS "orderId", stars FROM product_ratings
     WHERE product_id = $1 AND user_id = $2 AND epoch = 0`, [productId, buyer.userId],
  )
  let duplicateConstraint = ''
  try {
    await pool.query(
      `INSERT INTO product_ratings (id, product_id, user_id, order_id, epoch, stars, author_name)
       VALUES ($1, $2, $3, $4, 0, $5, 'Duplicate test')`,
      [newId(), productId, buyer.userId, storedVote.rows[0]?.orderId, storedVote.rows[0]?.stars],
    )
  } catch (requestError) {
    duplicateConstraint = (requestError as { code?: string }).code ?? ''
  }
  assert.equal(duplicateConstraint, '23505')
  const voteCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM product_ratings
     WHERE product_id = $1 AND user_id = $2 AND epoch = 0`, [productId, buyer.userId],
  )
  assert.equal(voteCount.rows[0]?.count, '1')
})

test('product creation rolls back all initial comments on transaction failure and large input is rejected safely', async () => {
  const admin = await customer('Atomic creation admin', 'admin')
  await pool.query(`
    DROP TRIGGER IF EXISTS reviews_atomic_creation_failure ON product_comments;
    DROP FUNCTION IF EXISTS reviews_atomic_creation_failure();
    CREATE FUNCTION reviews_atomic_creation_failure() RETURNS trigger AS $$
    BEGIN
      IF NEW.author_name = 'Force failure' THEN
        RAISE unique_violation USING
          MESSAGE = 'isolated duplicate request test',
          CONSTRAINT = 'product_comments_admin_request_idx';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reviews_atomic_creation_failure
      BEFORE INSERT ON product_comments
      FOR EACH ROW EXECUTE FUNCTION reviews_atomic_creation_failure();
  `)
  try {
    const failedCreate = await admin.client.json('/api/admin/products', {
      method: 'POST', csrf: true,
      body: {
        name: 'Atomic rollback probe', slug: 'atomic-rollback-probe', categoryId: null,
        shortDescription: 'Короткий опис', description: 'Опис товару', priceUah: 100,
        oldPriceUah: null, stock: 1, status: 'active', rating: 4.2, reviewCount: 3, badge: '',
        initialComments: [
          { nickname: 'First valid draft', message: 'Цей рядок має бути відкачений', clientRequestId: randomUUID() },
          { nickname: 'Force failure', message: 'Цей рядок навмисно спричинить помилку', clientRequestId: randomUUID() },
        ],
      },
    })
    assert.equal(failedCreate.status, 409)
    const rolledBack = await pool.query<{ products: string; comments: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM products WHERE slug = 'atomic-rollback-probe') AS products,
         (SELECT COUNT(*)::text FROM product_comments
           WHERE product_id = (SELECT id FROM products WHERE slug = 'atomic-rollback-probe')) AS comments`,
    )
    assert.deepEqual(rolledBack.rows[0], { products: '0', comments: '0' })
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS reviews_atomic_creation_failure ON product_comments')
    await pool.query('DROP FUNCTION IF EXISTS reviews_atomic_creation_failure()')
  }

  const publicProductId = await product('large-payload')
  const buyer = await customer('Large payload buyer')
  await paidOrder(buyer.userId, publicProductId)
  const marker = 'private-payload-marker-that-must-not-appear-in-errors'
  const tooLarge = await buyer.client.json(`/api/products/${publicProductId}/comments`, {
    method: 'POST', csrf: true,
    body: { message: 'короткий', clientRequestId: randomUUID(), ignored: marker + 'x'.repeat(22_000) },
  })
  assert.equal(tooLarge.status, 413)
  assert.equal(JSON.stringify(tooLarge.body).includes(marker), false)
})

test('empty reset starts at zero and an overlapping vote/reset resolves to one consistent generation', async () => {
  const emptyProductId = await product('empty-reset')
  const emptyBuyer = await customer('Empty rating buyer')
  const admin = await customer('Concurrent reset admin', 'admin')
  await paidOrder(emptyBuyer.userId, emptyProductId)
  const emptyReset = await admin.client.json<{
    summary: { rating: number; reviewCount: number; baseRating: number; baseCount: number; baseSum: string }
  }>(`/api/admin/products/${emptyProductId}/rating-reset`, {
    method: 'POST', csrf: true,
    body: { rating: 4.8, count: 0, expectedEpoch: '0', expectedRevision: '0' },
  })
  assert.equal(emptyReset.status, 200)
  assert.deepEqual(emptyReset.body.summary, {
    rating: 0, reviewCount: 0, ratingEpoch: '1', ratingRevision: '1',
    baseRating: 4.8, baseCount: 0, baseSum: '0.0',
  })
  const nextVote = await emptyBuyer.client.json<{ summary: { rating: number; reviewCount: number } }>(
    `/api/products/${emptyProductId}/ratings`,
    { method: 'POST', csrf: true, body: { stars: 3, expectedEpoch: '1' } },
  )
  assert.deepEqual(nextVote.body.summary, { rating: 3, reviewCount: 1 })

  const racedProductId = await product('reset-race')
  const racingBuyer = await customer('Rating race buyer')
  await paidOrder(racingBuyer.userId, racedProductId)
  const votePromise = racingBuyer.client.json(`/api/products/${racedProductId}/ratings`, {
    method: 'POST', csrf: true, body: { stars: 5, expectedEpoch: '0' },
  })
  const resetPromise = admin.client.json(`/api/admin/products/${racedProductId}/rating-reset`, {
    method: 'POST', csrf: true,
    body: { rating: 4.2, count: 7, expectedEpoch: '0', expectedRevision: '0' },
  })
  const [racedVote, racedReset] = await Promise.all([votePromise, resetPromise])
  assert(
    (racedVote.status === 200 && racedReset.status === 409) ||
      (racedVote.status === 409 && racedReset.status === 200),
    `vote/reset statuses were ${racedVote.status}/${racedReset.status}`,
  )
  const current = await pool.query<{
    epoch: string; revision: string; baseRating: string; baseCount: string; baseSum: string;
    rating: string; reviewCount: number; activeVotes: string; voteSum: string;
  }>(
    `SELECT products.rating_epoch::text AS epoch, products.rating_revision::text AS revision,
            products.base_rating::text AS "baseRating", products.base_count::text AS "baseCount",
            products.base_sum::text AS "baseSum", products.rating::text AS rating,
            products.review_count AS "reviewCount",
            COUNT(product_ratings.id)::text AS "activeVotes",
            COALESCE(SUM(product_ratings.stars), 0)::text AS "voteSum"
     FROM products
     LEFT JOIN product_ratings ON product_ratings.product_id = products.id
       AND product_ratings.epoch = products.rating_epoch
     WHERE products.id = $1
     GROUP BY products.id`, [racedProductId],
  )
  const productState = current.rows[0]
  assert(productState)
  const expectedCount = Number(productState.baseCount) + Number(productState.activeVotes)
  const expectedAverage = expectedCount === 0
    ? 0
    : Math.round(((Number(productState.baseSum) + Number(productState.voteSum)) / expectedCount) * 10) / 10
  assert.equal(productState.reviewCount, expectedCount)
  assert.equal(Number(productState.rating), expectedAverage)
  assert.equal(productState.revision, '1')
  assert.equal(Number(productState.epoch), racedReset.status === 200 ? 1 : 0)
  assert.equal(Number(productState.activeVotes), racedVote.status === 200 && productState.epoch === '0' ? 1 : 0)
})
