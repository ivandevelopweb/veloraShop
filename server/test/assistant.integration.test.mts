import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'
import { app } from '../src/app.js'
import { pool } from '../src/db.js'
import {
  setAssistantProviderForTests,
  type AssistantAiProvider,
  GeminiHttpProvider,
} from '../src/assistant/gemini.js'

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
    options: { method?: string; body?: unknown; csrf?: 'valid' | 'missing' | 'invalid' } = {},
  ) {
    const method = options.method ?? 'GET'
    const headers = new Headers()
    const cookie = this.cookieHeader()
    if (cookie) headers.set('cookie', cookie)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (options.csrf === 'valid') headers.set('x-csrf-token', this.csrfToken)
    if (options.csrf === 'invalid') headers.set('x-csrf-token', `${this.csrfToken}invalid`)
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
    options: { method?: string; body?: unknown; csrf?: 'valid' | 'missing' | 'invalid' } = {},
  ): Promise<JsonResponse<T>> {
    const response = await this.request(path, options)
    return {
      status: response.status,
      body: (await response.json()) as T,
      response,
    }
  }
}

function uuid() {
  return crypto.randomUUID()
}

async function seedProduct(price: number, name: string, stock = 5) {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO products (
       name, slug, short_description, description, price_uah, stock, status,
       is_available, rating, review_count, badge
     ) VALUES ($1, $2, 'Короткий опис', 'Повний опис', $3, $4, 'active', TRUE, 4.8, 4, '')
     RETURNING id`,
    [name, `${name.toLowerCase().replace(/\s+/g, '-')}-${uuid().slice(0, 8)}`, price, stock],
  )
  const id = result.rows[0]?.id
  assert(id)
  return id
}

function providerFor(
  classifier: Record<string, unknown>,
  selection: Record<string, unknown> = { productIds: [] },
  finalAnswer: Record<string, unknown> = { answer: 'Готово.', productIds: [] },
) {
  const calls: string[] = []
  const provider: AssistantAiProvider = {
    generateStructured: async (prompt) => {
      calls.push(prompt)
      if (prompt.startsWith('Classify')) return classifier
      if (prompt.startsWith('Select')) return selection
      return finalAnswer
    },
  }
  return { provider, calls }
}

const baseClassifier = {
  intent: 'product_recommendation',
  filters: {
    minPrice: null,
    maxPrice: null,
    categorySlug: null,
    attributes: [],
    availability: 'available',
  },
  preferences: ['подарунок'],
  mentionedProducts: [],
  topic: 'товари',
  language: 'uk',
  requiresExactStock: false,
  externalCurrentInfo: false,
}

before(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  setAssistantProviderForTests(undefined)
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await pool.end()
})

beforeEach(async () => {
  setAssistantProviderForTests(undefined)
  await pool.query(
    'TRUNCATE assistant_interactions, assistant_rate_limit_events, products, categories, auth_rate_limits RESTART IDENTITY CASCADE',
  )
})

test('assistant classifies, hard-filters candidates, validates IDs, logs and accepts one feedback value', async () => {
  const cheapProductId = await seedProduct(400, 'Cheap Gift')
  const expensiveProductId = await seedProduct(1000, 'Expensive Gift')
  const classifier = {
    ...baseClassifier,
    filters: { ...baseClassifier.filters, maxPrice: 500 },
  }
  const mocked = providerFor(
    classifier,
    { productIds: [cheapProductId, expensiveProductId, 999999] },
    {
      answer: 'Ось доступний варіант у вашому бюджеті.',
      productIds: [cheapProductId, expensiveProductId, 999999],
    },
  )
  setAssistantProviderForTests(mocked.provider)

  const client = new BrowserClient()
  await client.csrf()
  const clientId = uuid()
  const message = await client.json<{
    interactionId: string
    answer: string
    products: Array<{ id: number }>
    remainingRequests: number
  }>('/api/assistant/message', {
    method: 'POST',
    csrf: 'valid',
    body: {
      message: 'Порадьте подарунок до 500 грн',
      history: [],
      clientId,
      sessionId: uuid(),
    },
  })

  assert.equal(message.status, 200)
  assert.equal(message.body.answer, 'Ось доступний варіант у вашому бюджеті.')
  assert.deepEqual(
    message.body.products.map((product) => product.id),
    [cheapProductId],
  )
  assert.equal(message.body.remainingRequests, 49)
  assert.equal(mocked.calls.length, 3)

  const log = await pool.query<{
    candidateProductIds: number[]
    recommendedProductIds: number[]
    status: string
  }>(
    `SELECT candidate_product_ids AS "candidateProductIds",
            recommended_product_ids AS "recommendedProductIds", status
     FROM assistant_interactions
     WHERE id = $1`,
    [message.body.interactionId],
  )
  assert.deepEqual(log.rows[0]?.candidateProductIds, [cheapProductId])
  assert.deepEqual(log.rows[0]?.recommendedProductIds, [cheapProductId])
  assert.equal(log.rows[0]?.status, 'success')

  const feedback = await client.json<{ feedback: string }>('/api/assistant/feedback', {
    method: 'POST',
    csrf: 'valid',
    body: { interactionId: message.body.interactionId, clientId, value: 'like' },
  })
  assert.equal(feedback.status, 200)
  assert.equal(feedback.body.feedback, 'like')
  const repeated = await client.json<{ feedback: string }>('/api/assistant/feedback', {
    method: 'POST',
    csrf: 'valid',
    body: { interactionId: message.body.interactionId, clientId, value: 'dislike' },
  })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.body.feedback, 'like')
  assert.notEqual(expensiveProductId, cheapProductId)
})

test('out-of-scope requests stop after the classifier and use the detected language', async () => {
  const mocked = providerFor({
    ...baseClassifier,
    intent: 'out_of_scope',
    language: 'en',
  })
  setAssistantProviderForTests(mocked.provider)
  const client = new BrowserClient()
  await client.csrf()
  const response = await client.json<{ answer: string; products: unknown[] }>(
    '/api/assistant/message',
    {
      method: 'POST',
      csrf: 'valid',
      body: {
        message: 'Write an essay about WWII',
        history: [],
        clientId: uuid(),
        sessionId: uuid(),
      },
    },
  )
  assert.equal(response.status, 200)
  assert.match(response.body.answer, /Sorry/i)
  assert.deepEqual(response.body.products, [])
  assert.equal(mocked.calls.length, 1)
})

test('competitor and current-external questions stop before product selection', async () => {
  const mocked = providerFor({
    ...baseClassifier,
    language: 'en',
    externalCurrentInfo: true,
  })
  setAssistantProviderForTests(mocked.provider)
  const client = new BrowserClient()
  await client.csrf()
  const response = await client.json<{ answer: string; products: unknown[] }>(
    '/api/assistant/message',
    {
      method: 'POST',
      csrf: 'valid',
      body: {
        message: 'What is better than your competitors right now?',
        history: [],
        clientId: uuid(),
        sessionId: uuid(),
      },
    },
  )
  assert.equal(response.status, 200)
  assert.match(response.body.answer, /browse the web/i)
  assert.deepEqual(response.body.products, [])
  assert.equal(mocked.calls.length, 1)
})

test('malformed requests count toward the client quota and Gemini failures are user-friendly', async () => {
  const mocked = providerFor(baseClassifier)
  setAssistantProviderForTests(mocked.provider)
  const client = new BrowserClient()
  await client.csrf()
  const clientId = uuid()
  const invalid = await client.json<{ error: string }>('/api/assistant/message', {
    method: 'POST',
    csrf: 'valid',
    body: { message: 'x'.repeat(501), history: [], clientId, sessionId: uuid() },
  })
  assert.equal(invalid.status, 400)
  assert.equal(mocked.calls.length, 0)

  setAssistantProviderForTests(undefined)
  const unavailable = await client.json<{ error: string }>('/api/assistant/message', {
    method: 'POST',
    csrf: 'valid',
    body: { message: 'Порадьте аромат', history: [], clientId: uuid(), sessionId: uuid() },
  })
  assert.equal(unavailable.status, 503)
  assert.match(unavailable.body.error, /AI-помічник тимчасово недоступний/)
  const logs = await pool.query<{ status: string }>(
    `SELECT status FROM assistant_interactions ORDER BY created_at ASC`,
  )
  assert.deepEqual(
    logs.rows.map((row) => row.status),
    ['invalid_request', 'provider_unavailable'],
  )
})

test('assistant enforces the 50-message rolling client limit while counting the rejected request', async () => {
  const mocked = providerFor({ ...baseClassifier, intent: 'out_of_scope' })
  setAssistantProviderForTests(mocked.provider)
  const client = new BrowserClient()
  await client.csrf()
  const clientId = uuid()
  const statuses: number[] = []
  for (let index = 0; index < 51; index += 1) {
    const response = await client.json('/api/assistant/message', {
      method: 'POST',
      csrf: 'valid',
      body: { message: `off-topic ${index}`, history: [], clientId, sessionId: uuid() },
    })
    statuses.push(response.status)
  }
  assert.equal(statuses.filter((status) => status === 200).length, 50)
  assert.equal(statuses[statuses.length - 1], 429)
  const events = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM assistant_rate_limit_events WHERE scope = 'client'`,
  )
  assert.equal(events.rows[0]?.count, '51')
})

test('the public Gemini adapter uses server-side structured REST output without tools', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  const provider = new GeminiHttpProvider({
    apiKey: 'server-only-test-key',
    model: 'gemini-test-model',
    timeoutMs: 2_000,
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  const result = await provider.generateStructured('test prompt', { type: 'object' }, 100)
  assert.deepEqual(result, { ok: true })
  assert.match(
    requestUrl,
    /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test-model:generateContent$/,
  )
  assert(requestInit)
  assert.equal(
    (requestInit.headers as Record<string, string>)['x-goog-api-key'],
    'server-only-test-key',
  )
  const body = JSON.parse(String(requestInit?.body)) as {
    generationConfig: {
      responseFormat: { text: { mimeType: string; schema: unknown } }
    }
    tools?: unknown
  }
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON')
  assert.deepEqual(body.generationConfig.responseFormat.text.schema, { type: 'object' })
  assert.equal(body.tools, undefined)
})

test('the Gemini adapter retries transient failures but does not retry permanent provider errors', async () => {
  let transientAttempts = 0
  const transientProvider = new GeminiHttpProvider({
    apiKey: 'server-only-test-key',
    model: 'gemini-test-model',
    timeoutMs: 2_000,
    fetchImpl: async () => {
      transientAttempts += 1
      if (transientAttempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'temporary upstream failure' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  assert.deepEqual(
    await transientProvider.generateStructured('test prompt', { type: 'object' }, 100),
    { ok: true },
  )
  assert.equal(transientAttempts, 2)

  let authAttempts = 0
  const authProvider = new GeminiHttpProvider({
    apiKey: 'server-only-test-key',
    model: 'gemini-test-model',
    timeoutMs: 2_000,
    fetchImpl: async () => {
      authAttempts += 1
      return new Response(
        JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  await assert.rejects(
    authProvider.generateStructured('test prompt', { type: 'object' }, 100),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.equal((error as { kind?: string }).kind, 'auth')
      assert.equal((error as { providerStatus?: number }).providerStatus, 401)
      assert.match((error as { diagnostic?: string }).diagnostic ?? '', /API key not valid/)
      return true
    },
  )
  assert.equal(authAttempts, 1)
})
