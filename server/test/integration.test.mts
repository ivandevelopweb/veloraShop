import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'
import { app } from '../src/app.js'
import { pool } from '../src/db.js'
import { signLiqpayData } from '../src/liqpay.js'
import {
  reconcileExpiredReservations,
  type PaymentStatusResolver,
} from '../src/payment-reconciliation.js'

const password = process.env.TEST_PASSWORD
const liqpayPrivateKey = process.env.LIQPAY_PRIVATE_KEY
const liqpayPublicKey = process.env.LIQPAY_PUBLIC_KEY
assert(password)
assert(liqpayPrivateKey)
assert(liqpayPublicKey)

let server: Server
let origin = ''

type JsonResponse<T> = { status: number; body: T; response: Response }

class BrowserClient {
  private readonly cookies = new Map<string, string>()
  private csrfToken = ''

  private updateCookies(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }

  async request(
    path: string,
    options: {
      method?: string
      body?: unknown
      csrf?: 'valid' | 'missing' | 'invalid'
      form?: URLSearchParams
    } = {},
  ) {
    const method = options.method ?? 'GET'
    const headers = new Headers()
    const cookie = this.cookieHeader()
    if (cookie) headers.set('cookie', cookie)
    if (options.form) headers.set('content-type', 'application/x-www-form-urlencoded')
    else if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (options.csrf === 'valid') headers.set('x-csrf-token', this.csrfToken)
    if (options.csrf === 'invalid') headers.set('x-csrf-token', `${this.csrfToken}invalid`)
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
    this.updateCookies(response)
    return response
  }

  async csrf() {
    const response = await this.request('/api/auth/csrf')
    assert.equal(response.status, 200)
    const body = (await response.json()) as { csrfToken: string }
    this.csrfToken = body.csrfToken
  }

  async json<T>(
    path: string,
    options: {
      method?: string
      body?: unknown
      csrf?: 'valid' | 'missing' | 'invalid'
      form?: URLSearchParams
    } = {},
  ): Promise<JsonResponse<T>> {
    const response = await this.request(path, options)
    const body = response.status === 204 ? ({} as T) : ((await response.json()) as T)
    return { status: response.status, body, response }
  }
}

const checkoutDetails = {
  firstName: 'Тест',
  lastName: 'Покупець',
  phone: '+380501234567',
  email: 'buyer@example.test',
  deliveryMethod: 'nova_poshta' as const,
  city: 'Київ',
  branch: 'Відділення 1',
}

async function register(label: string) {
  const client = new BrowserClient()
  await client.csrf()
  const response = await client.json<{ user: { id: string; role: string } }>('/api/auth/register', {
    method: 'POST',
    csrf: 'valid',
    body: { name: label, email: `${label.toLowerCase()}@example.test`, password },
  })
  assert.equal(response.status, 201)
  return { client, userId: response.body.user.id, email: `${label.toLowerCase()}@example.test` }
}

async function registerAdmin(label = 'Admin') {
  const user = await register(label)
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.userId])
  return user
}

async function seedProduct(stock = 3, suffix = 'main') {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO products (
      name, slug, short_description, description, price_uah, stock, status,
      is_available, rating, review_count, badge
    ) VALUES ($1, $2, 'Короткий опис', 'Повний опис', 1000, $3, 'active', TRUE, 4.8, 0, '')
     RETURNING id`,
    [`Product ${suffix}`, `product-${suffix}`, stock],
  )
  const id = rows[0]?.id
  assert(id)
  return id
}

async function addToCart(client: BrowserClient, productId: number) {
  const response = await client.json<{ items: unknown[] }>('/api/cart', {
    method: 'POST',
    csrf: 'valid',
    body: { productId },
  })
  assert.equal(response.status, 200)
}

async function checkout(client: BrowserClient) {
  return client.json<{ order: { code: string; total: number }; checkout: { data: string; signature: string } }>(
    '/api/payments/liqpay/checkout',
    { method: 'POST', csrf: 'valid', body: checkoutDetails },
  )
}

function callbackForm(
  orderId: string,
  amount: number,
  overrides: Record<string, unknown> = {},
  signature?: string,
) {
  const payload = {
    action: 'pay',
    version: 3,
    public_key: liqpayPublicKey,
    order_id: orderId,
    amount,
    currency: 'UAH',
    status: 'sandbox',
    payment_id: `sandbox-${orderId}`,
    ...overrides,
  }
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return new URLSearchParams({ data, signature: signature ?? signLiqpayData(data, liqpayPrivateKey) })
}

async function postCallback(form: URLSearchParams) {
  const response = await fetch(`${origin}/api/payments/liqpay/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  return { status: response.status, text: await response.text() }
}

async function paymentStatus(client: BrowserClient, code: string) {
  return client.json<{ order: { paymentStatus: string } }>(`/api/payments/liqpay/orders/${code}`)
}

async function inventory(productId: number) {
  const result = await pool.query<{ stock: number; reservedStock: number }>(
    'SELECT stock, reserved_stock AS "reservedStock" FROM products WHERE id = $1',
    [productId],
  )
  return result.rows[0]
}

before(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await pool.end()
})

beforeEach(async () => {
  await pool.query('TRUNCATE users, products, categories, auth_rate_limits RESTART IDENTITY CASCADE')
})

test('guests are denied protected routes and CSRF protects authenticated mutations', async () => {
  const guest = new BrowserClient()
  assert.equal((await guest.json('/api/cart')).status, 401)
  assert.equal((await guest.json('/api/orders')).status, 401)
  assert.equal((await guest.json('/api/admin/dashboard')).status, 401)
  await guest.csrf()
  assert.equal(
    (await guest.json('/api/payments/liqpay/checkout', { method: 'POST', csrf: 'valid', body: checkoutDetails })).status,
    401,
  )

  const user = await register('CsrfUser')
  const productId = await seedProduct()
  assert.equal(
    (await user.client.json('/api/cart', { method: 'POST', csrf: 'missing', body: { productId } })).status,
    403,
  )
  assert.equal(
    (await user.client.json('/api/cart', { method: 'POST', csrf: 'invalid', body: { productId } })).status,
    403,
  )
  await addToCart(user.client, productId)
})

test('ownership, admin authorization, and mass assignment cannot cross security boundaries', async () => {
  const unauthenticated = new BrowserClient()
  await unauthenticated.csrf()
  const elevation = await unauthenticated.json('/api/auth/register', {
    method: 'POST',
    csrf: 'valid',
    body: { name: 'Attempt', email: 'attempt@example.test', password, role: 'admin', isAdmin: true },
  })
  assert.equal(elevation.status, 400)

  const userA = await register('OwnerA')
  const userB = await register('OwnerB')
  const productId = await seedProduct(2, 'ownership')
  await addToCart(userA.client, productId)
  const created = await checkout(userA.client)
  assert.equal(created.status, 201)
  const code = created.body.order.code

  assert.equal((await paymentStatus(userB.client, code)).status, 404)
  assert.equal(
    (await userB.client.json(`/api/payments/liqpay/orders/${code}/cancel`, { method: 'POST', csrf: 'valid' })).status,
    404,
  )
  assert.equal(
    (await userB.client.json(`/api/cart/${productId}`, { method: 'PATCH', csrf: 'valid', body: { quantity: 2 } })).status,
    404,
  )
  assert.equal((await userA.client.json('/api/admin/dashboard')).status, 403)

  const admin = await registerAdmin('RealAdmin')
  assert.equal((await admin.client.json('/api/admin/dashboard')).status, 200)
})

test('checkout ignores all client-controlled money, owner, status, and inventory fields', async () => {
  const user = await register('PricingUser')
  const productId = await seedProduct(3, 'pricing')
  await addToCart(user.client, productId)
  const injected = await user.client.json('/api/payments/liqpay/checkout', {
    method: 'POST',
    csrf: 'valid',
    body: {
      ...checkoutDetails,
      price: 1,
      subtotal: 1,
      total: 1,
      delivery: 0,
      userId: '00000000-0000-0000-0000-000000000000',
      paymentStatus: 'paid',
      orderStatus: 'completed',
    },
  })
  assert.equal(injected.status, 400)
  assert.deepEqual(await inventory(productId), { stock: 3, reservedStock: 0 })

  const created = await checkout(user.client)
  assert.equal(created.status, 201)
  assert.equal(created.body.order.total, 1090)
  const row = await pool.query<{
    total: number
    paymentStatus: string
    customerUserId: string
    itemPrice: number
  }>(
    `SELECT orders.total_uah AS total, orders.payment_status AS "paymentStatus",
            orders.user_id AS "customerUserId", order_items.price_uah AS "itemPrice"
     FROM orders JOIN order_items ON order_items.order_id = orders.id`,
  )
  assert.equal(row.rows[0]?.total, 1090)
  assert.equal(row.rows[0]?.itemPrice, 1000)
  assert.equal(row.rows[0]?.paymentStatus, 'pending')
  assert.equal(row.rows[0]?.customerUserId, user.userId)
})

test('quantity and product validity are rejected before an order can reserve stock', async () => {
  const user = await register('QuantityUser')
  const productId = await seedProduct(1, 'quantity')
  const unavailableId = await seedProduct(0, 'unavailable')
  assert.equal(
    (await user.client.json('/api/cart', { method: 'POST', csrf: 'valid', body: { productId: 999_999 } })).status,
    404,
  )
  assert.equal(
    (await user.client.json('/api/cart', { method: 'POST', csrf: 'valid', body: { productId: unavailableId } })).status,
    404,
  )
  await addToCart(user.client, productId)
  for (const quantity of [0, -1, 100_001]) {
    assert.equal(
      (await user.client.json(`/api/cart/${productId}`, { method: 'PATCH', csrf: 'valid', body: { quantity } })).status,
      400,
    )
  }
  assert.equal((await checkout(user.client)).status, 201)
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 1 })
})

test('forged and mismatched LiqPay callbacks are rejected', async () => {
  const user = await register('CallbackUser')
  const productId = await seedProduct(1, 'callback')
  await addToCart(user.client, productId)
  const created = await checkout(user.client)
  assert.equal(created.status, 201)
  const { code, total } = created.body.order
  assert.equal((await postCallback(callbackForm(code, total, {}, 'A'.repeat(28)))).status, 400)
  assert.equal((await postCallback(callbackForm(code, total + 1))).status, 400)
  assert.equal((await postCallback(callbackForm(code, total, { currency: 'USD' }))).status, 400)
  assert.equal((await postCallback(callbackForm(code, total, { public_key: 'sandbox_other' }))).status, 400)
  assert.equal((await postCallback(callbackForm('other-order', total))).status, 404)
  assert.equal((await paymentStatus(user.client, code)).body.order.paymentStatus, 'pending')
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 1 })
})

test('two users racing for the final unit produce exactly one durable reservation', async () => {
  const userA = await register('RaceA')
  const userB = await register('RaceB')
  const productId = await seedProduct(1, 'last-unit')
  await addToCart(userA.client, productId)
  await addToCart(userB.client, productId)
  const results = await Promise.all([checkout(userA.client), checkout(userB.client)])
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    [201, 409],
  )
  const winner = results.find((result) => result.status === 201)
  assert(winner)
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 1 })
  const reservations = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM inventory_reservations')
  assert.equal(reservations.rows[0]?.count, '1')
  assert.equal((await postCallback(callbackForm(winner.body.order.code, winner.body.order.total))).status, 200)
  assert.deepEqual(await inventory(productId), { stock: 0, reservedStock: 0 })
})

test('callback replays and concurrent callbacks consume stock exactly once', async () => {
  const user = await register('ReplayUser')
  const productId = await seedProduct(1, 'replay')
  await addToCart(user.client, productId)
  const created = await checkout(user.client)
  assert.equal(created.status, 201)
  const form = callbackForm(created.body.order.code, created.body.order.total)
  const results = await Promise.all([postCallback(form), postCallback(form)])
  assert.deepEqual(results.map((result) => result.status), [200, 200])
  assert.equal((await paymentStatus(user.client, created.body.order.code)).body.order.paymentStatus, 'paid')
  assert.deepEqual(await inventory(productId), { stock: 0, reservedStock: 0 })
  const state = await pool.query<{ state: string }>('SELECT state FROM inventory_reservations')
  assert.equal(state.rows[0]?.state, 'consumed')
  await assert.rejects(
    pool.query("UPDATE inventory_reservations SET state = 'released' WHERE state = 'consumed'"),
  )
})

test('a provider payment ID cannot be applied to a second order', async () => {
  const userA = await register('ProviderA')
  const userB = await register('ProviderB')
  const productId = await seedProduct(2, 'provider-id')
  await addToCart(userA.client, productId)
  await addToCart(userB.client, productId)
  const orderA = await checkout(userA.client)
  const orderB = await checkout(userB.client)
  assert.equal(orderA.status, 201)
  assert.equal(orderB.status, 201)
  const duplicatePaymentId = 'sandbox-single-provider-payment'
  assert.equal(
    (
      await postCallback(
        callbackForm(orderA.body.order.code, orderA.body.order.total, { payment_id: duplicatePaymentId }),
      )
    ).status,
    200,
  )
  assert.equal(
    (
      await postCallback(
        callbackForm(orderB.body.order.code, orderB.body.order.total, { payment_id: duplicatePaymentId }),
      )
    ).status,
    200,
  )
  assert.equal((await paymentStatus(userA.client, orderA.body.order.code)).body.order.paymentStatus, 'paid')
  assert.equal(
    (await paymentStatus(userB.client, orderB.body.order.code)).body.order.paymentStatus,
    'reconciliation_required',
  )
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 1 })
})

test('archive and physical stock mutation respect active reservations during checkout races', async () => {
  const admin = await registerAdmin('InventoryAdmin')
  const user = await register('InventoryUser')
  const productId = await seedProduct(1, 'admin-race')
  await addToCart(user.client, productId)
  const concurrent = await Promise.all([
    checkout(user.client),
    admin.client.json(`/api/admin/products/${productId}`, { method: 'PATCH', csrf: 'valid', body: { stock: 0 } }),
  ])
  const concurrentStatuses = concurrent.map((result) => result.status).sort()
  assert(
    JSON.stringify(concurrentStatuses) === JSON.stringify([201, 409]) ||
      JSON.stringify(concurrentStatuses) === JSON.stringify([200, 409]),
  )
  const product = await inventory(productId)
  assert(product)
  assert(product.stock >= product.reservedStock)

  const checkoutResult = concurrent[0]
  if (checkoutResult.status === 201) {
    assert.equal(
      (
        await admin.client.json(`/api/admin/products/${productId}`, {
          method: 'PATCH',
          csrf: 'valid',
          body: { priceUah: 2000 },
        })
      ).status,
      200,
    )
    assert.equal(
      (await admin.client.json(`/api/admin/products/${productId}`, { method: 'DELETE', csrf: 'valid' })).status,
      204,
    )
    assert.equal((await postCallback(callbackForm(checkoutResult.body.order.code, checkoutResult.body.order.total))).status, 200)
    assert.equal((await paymentStatus(user.client, checkoutResult.body.order.code)).body.order.paymentStatus, 'paid')
    const snapshot = await pool.query<{ price: number; slug: string }>(
      `SELECT price_uah AS price, product_slug AS slug
       FROM order_items
       JOIN orders ON orders.id = order_items.order_id
       WHERE orders.code = $1`,
      [checkoutResult.body.order.code],
    )
    assert.equal(snapshot.rows[0]?.price, 1000)
    assert.equal(snapshot.rows[0]?.slug, 'product-admin-race')
  } else {
    assert.equal((await admin.client.json(`/api/admin/products/${productId}`)).body.product.status, 'active')
  }
})

test('checkout racing with archive never creates a reservation for an archived product', async () => {
  const admin = await registerAdmin('ArchiveAdmin')
  const user = await register('ArchiveUser')
  const productId = await seedProduct(1, 'archive-race')
  await addToCart(user.client, productId)
  const [created, archived] = await Promise.all([
    checkout(user.client),
    admin.client.json(`/api/admin/products/${productId}`, { method: 'DELETE', csrf: 'valid' }),
  ])
  assert([201, 409].includes(created.status))
  assert.equal(archived.status, 204)
  const status = await pool.query<{ status: string }>('SELECT status FROM products WHERE id = $1', [productId])
  assert.equal(status.rows[0]?.status, 'archived')
  if (created.status === 201) {
    assert.equal((await postCallback(callbackForm(created.body.order.code, created.body.order.total))).status, 200)
  }
})

test('expiry reconciliation and callback race safely, and unavailable provider status retains stock for reconciliation', async () => {
  const user = await register('ExpiryUser')
  const productId = await seedProduct(3, 'expiry')
  await addToCart(user.client, productId)
  const first = await checkout(user.client)
  assert.equal(first.status, 201)
  await pool.query(
    `UPDATE orders
     SET reservation_expires_at = NOW() - INTERVAL '1 minute',
         reconciliation_deadline_at = NOW() + INTERVAL '5 minutes'
     WHERE code = $1`,
    [first.body.order.code],
  )
  const resolver: PaymentStatusResolver = async () => ({
    paymentOrderId: first.body.order.code,
    amount: first.body.order.total,
    currency: 'UAH',
    status: 'paid',
    paymentId: `sandbox-${first.body.order.code}`,
    source: 'reconciliation',
  })
  const [callback] = await Promise.all([
    postCallback(callbackForm(first.body.order.code, first.body.order.total)),
    reconcileExpiredReservations(resolver),
  ])
  assert.equal(callback.status, 200)
  assert.equal((await paymentStatus(user.client, first.body.order.code)).body.order.paymentStatus, 'paid')
  assert.deepEqual(await inventory(productId), { stock: 2, reservedStock: 0 })

  await addToCart(user.client, productId)
  const second = await checkout(user.client)
  assert.equal(second.status, 201)
  await pool.query(
    `UPDATE orders
     SET reservation_expires_at = NOW() - INTERVAL '20 minutes',
         reconciliation_deadline_at = NOW() - INTERVAL '1 minute'
     WHERE code = $1`,
    [second.body.order.code],
  )
  await reconcileExpiredReservations(async () => {
    throw new Error('temporary provider outage')
  })
  assert.equal(
    (await paymentStatus(user.client, second.body.order.code)).body.order.paymentStatus,
    'reconciliation_required',
  )
  assert.deepEqual(await inventory(productId), { stock: 2, reservedStock: 1 })
  await reconcileExpiredReservations(async () => ({
    paymentOrderId: second.body.order.code,
    amount: second.body.order.total,
    currency: 'UAH',
    status: 'paid',
    paymentId: `sandbox-${second.body.order.code}`,
    source: 'reconciliation',
  }))
  assert.equal((await paymentStatus(user.client, second.body.order.code)).body.order.paymentStatus, 'paid')
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 0 })

  await addToCart(user.client, productId)
  const third = await checkout(user.client)
  assert.equal(third.status, 201)
  await pool.query(
    `UPDATE orders
     SET reservation_expires_at = NOW() - INTERVAL '1 minute',
         reconciliation_deadline_at = NOW() + INTERVAL '5 minutes'
     WHERE code = $1`,
    [third.body.order.code],
  )
  await reconcileExpiredReservations(async () => ({
    paymentOrderId: third.body.order.code,
    amount: third.body.order.total,
    currency: 'UAH',
    status: 'failed',
    paymentId: `sandbox-${third.body.order.code}`,
    source: 'reconciliation',
  }))
  assert.equal((await paymentStatus(user.client, third.body.order.code)).body.order.paymentStatus, 'failed')
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 0 })
  await reconcileExpiredReservations(async () => {
    throw new Error('the terminal order is no longer a worker candidate')
  })
  assert.deepEqual(await inventory(productId), { stock: 1, reservedStock: 0 })
})

test('cancel versus callback, repeated release, and late paid callbacks have no double-restock path', async () => {
  const user = await register('CancelUser')
  const productId = await seedProduct(2, 'cancel')
  await addToCart(user.client, productId)
  const first = await checkout(user.client)
  assert.equal(first.status, 201)
  const [cancelled, callback] = await Promise.all([
    user.client.json(`/api/payments/liqpay/orders/${first.body.order.code}/cancel`, { method: 'POST', csrf: 'valid' }),
    postCallback(callbackForm(first.body.order.code, first.body.order.total)),
  ])
  assert([200, 409].includes(cancelled.status))
  assert.equal(callback.status, 200)
  const firstStatus = (await paymentStatus(user.client, first.body.order.code)).body.order.paymentStatus
  assert(['paid', 'reconciliation_required'].includes(firstStatus))
  const afterRace = await inventory(productId)
  assert(afterRace)
  assert(afterRace.stock >= afterRace.reservedStock)

  if (firstStatus === 'reconciliation_required') {
    assert.equal(afterRace.stock, 2)
    assert.equal(afterRace.reservedStock, 0)
  }

  const event = await pool.query<{ paymentId: string | null }>(
    'SELECT provider_payment_id AS "paymentId" FROM orders WHERE code = $1',
    [first.body.order.code],
  )
  if (firstStatus === 'reconciliation_required') {
    assert.equal(event.rows[0]?.paymentId, `sandbox-${first.body.order.code}`)
  }

  // A standalone cancel releases once; a repeated call cannot release again.
  const otherProductId = await seedProduct(1, 'repeat-release')
  await addToCart(user.client, otherProductId)
  const second = await checkout(user.client)
  assert.equal(second.status, 201)
  assert.equal(
    (await user.client.json(`/api/payments/liqpay/orders/${second.body.order.code}/cancel`, { method: 'POST', csrf: 'valid' })).status,
    200,
  )
  assert.equal(
    (await user.client.json(`/api/payments/liqpay/orders/${second.body.order.code}/cancel`, { method: 'POST', csrf: 'valid' })).status,
    409,
  )
  assert.deepEqual(await inventory(otherProductId), { stock: 1, reservedStock: 0 })
})

test('database reservation constraints reject impossible inventory and atomic login quota limits parallel failures', async () => {
  const productId = await seedProduct(1, 'constraints')
  await assert.rejects(
    pool.query('UPDATE products SET reserved_stock = stock + 1 WHERE id = $1', [productId]),
    { code: '23514' },
  )

  const user = await register('LimiterUser')
  await user.client.csrf()
  const attempts = await Promise.all(
    Array.from({ length: 20 }, () =>
      user.client.json('/api/auth/login', {
        method: 'POST',
        csrf: 'valid',
        body: { email: user.email, password: `${password}wrong` },
      }),
    ),
  )
  assert.equal(attempts.filter((attempt) => attempt.status === 401).length, 10)
  assert.equal(attempts.filter((attempt) => attempt.status === 429).length, 10)
})
