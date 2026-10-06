import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'
import { app } from '../src/app.js'
import { pool } from '../src/db.js'
import {
  setAssistantProviderForTests,
  type AssistantAiProvider,
  GeminiHttpProvider,
  AssistantProviderError,
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
  const schemas: Record<string, unknown>[] = []
  const provider: AssistantAiProvider = {
    generateStructured: async (prompt, schema) => {
      calls.push(prompt)
      schemas.push(schema)
      if (prompt.startsWith('Classify')) return classifier
      if (prompt.startsWith('Select')) return selection
      return finalAnswer
    },
  }
  return { provider, calls, schemas }
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
      productIds: [cheapProductId],
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
  assert.equal(mocked.calls.length, 2)

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
  assert.match(response.body.answer, /Velora/i)
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

async function chat(message: string, history: unknown[] = []) {
  const client = new BrowserClient()
  await client.csrf()
  return client.json<{
    interactionId: string
    answer: string
    products: Array<{ id: number; price: number }>
    mode: string
    error?: string
  }>('/api/assistant/message', {
    method: 'POST',
    csrf: 'valid',
    body: { message, history, clientId: uuid(), sessionId: uuid() },
  })
}

test('greetings, gratitude and identity work without Gemini, with CSRF still enforced', async () => {
  let calls = 0
  setAssistantProviderForTests({
    generateStructured: async () => {
      calls++
      throw new Error('must not call')
    },
  })
  for (const message of ['Привет', 'Привіт!', 'Hello', 'Спасибо', 'Хто ти?', 'Що ти вмієш?']) {
    const response = await chat(message)
    assert.equal(response.status, 200)
    assert.equal(response.body.mode, 'social')
    assert.deepEqual(response.body.products, [])
    assert.doesNotMatch(response.body.answer, /не можу допомогти|не могу помочь/iu)
  }
  assert.equal(calls, 0)
  const client = new BrowserClient()
  await client.csrf()
  const rejected = await client.json('/api/assistant/message', {
    method: 'POST',
    csrf: 'missing',
    body: { message: 'Привет', history: [], clientId: uuid() },
  })
  assert.equal(rejected.status, 403)
})

test('the screenshot gift request asks a useful question without Gemini or invented products', async () => {
  setAssistantProviderForTests({ generateStructured: async () => { throw new Error('must not call') } })
  const response = await chat('порекомендуй подарунок для дівчини')
  assert.equal(response.status, 200)
  assert.equal(response.body.mode, 'clarification')
  assert.match(response.body.answer, /бюджет/iu)
  assert.deepEqual(response.body.products, [])
  const followup = await chat('порадь подарунок для мами', [{ role: 'user', content: 'до 500 грн' }])
  assert.equal(followup.status, 200)
  assert.match(followup.body.answer, /Що їй подобається/iu)
})

test('a specific gift requirement still reaches semantic matching with one shared deadline', async () => {
  const id = await seedProduct(349, 'Dry hair mask')
  const deadlines: number[] = []
  const start = Date.now()
  setAssistantProviderForTests({
    generateStructured: async (prompt, _schema, _tokens, options) => {
      assert(options)
      deadlines.push(options.deadlineMs)
      return prompt.startsWith('Classify') ? baseClassifier : {
        answer: 'Маска з каталогу.', productIds: [id], outcome: 'matched',
      }
    },
  })
  const response = await chat('Порадь подарунок для дівчини із сухим волоссям')
  assert.equal(response.status, 200)
  assert.equal(response.body.mode, 'model')
  assert.deepEqual(response.body.products.map((product) => product.id), [id])
  assert.equal(deadlines.length, 2)
  assert.equal(deadlines[0], deadlines[1])
  assert(deadlines[0]! >= start + 30_000 && deadlines[0]! <= Date.now() + 30_000)
})

test('Garnier below twelve popular products survives unknown category and missing attributes', async () => {
  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (id, name, slug) VALUES ($1, 'Догляд за волоссям', 'hair') RETURNING id",
    [uuid()],
  )
  for (let index = 0; index < 15; index++) {
    const id = await seedProduct(200, `Popular unrelated ${index}`)
    await pool.query(
      'UPDATE products SET ai_priority = 100, rating = 5, attributes = $1::jsonb WHERE id = $2',
      [JSON.stringify({ skin_type: 'oily' }), id],
    )
  }
  const garnier = await seedProduct(349, 'Garnier Fructis Hair Food Banana 3-in-1 Mask')
  await pool.query(
    'UPDATE products SET category_id = $1, description = $2, rating = 3.5 WHERE id = $3',
    [category.rows[0]!.id, 'Маска підходить для сухого волосся.', garnier],
  )
  const mocked = providerFor(
    {
      ...baseClassifier,
      filters: {
        ...baseClassifier.filters,
        categorySlug: 'hair-care',
        attributes: [{ key: 'hair_type', value: 'dry' }],
      },
    },
    {},
    {
      answer: 'Я б розглянув цю маску: в описі зазначено догляд за сухим волоссям.',
      productIds: [garnier],
    },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Порадь один засіб для сухого волосся.')
  assert.equal(response.status, 200)
  assert.deepEqual(
    response.body.products.map((p) => p.id),
    [garnier],
  )
  assert.equal(mocked.calls.length, 2)
  assert.match(mocked.calls[0]!, /"slug":"hair"/u)
  assert.match(mocked.calls[0]!, /skin_type/u)
  assert.match(mocked.calls[1]!, /Маска підходить для сухого волосся/u)
  const finalSchema = mocked.schemas[1] as { properties: { productIds: { maxItems: number } } }
  assert.equal(finalSchema.properties.productIds.maxItems, 1)
  const logs = await pool.query<{ ids: number[]; diagnostics: { ignoredFilters: string[] } }>(
    'SELECT candidate_product_ids AS ids, diagnostics FROM assistant_interactions WHERE id = $1',
    [response.body.interactionId],
  )
  assert.equal(logs.rows[0]!.ids.length, 16)
  assert(logs.rows[0]!.ids.includes(garnier))
  assert(logs.rows[0]!.diagnostics.ignoredFilters.includes('unknown_category'))
  assert(logs.rows[0]!.diagnostics.ignoredFilters.includes('unknown_attribute:hair_type'))
})

test('known AI attributes still do not exclude a matching description with empty metadata', async () => {
  const tagged = await seedProduct(100, 'Tagged dry hair shampoo')
  await pool.query('UPDATE products SET attributes = $1::jsonb WHERE id = $2', [
    JSON.stringify({ hair_type: 'dry' }),
    tagged,
  ])
  const mask = await seedProduct(349, 'Banana mask')
  await pool.query('UPDATE products SET description = $1 WHERE id = $2', [
    'Для сухого волосся',
    mask,
  ])
  const mocked = providerFor(
    {
      ...baseClassifier,
      filters: { ...baseClassifier.filters, attributes: [{ key: 'hair_type', value: 'dry' }] },
    },
    {},
    { answer: 'Маска для сухого волосся.', productIds: [mask] },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Порадь один засіб для сухого волосся')
  assert.equal(response.status, 200)
  assert.deepEqual(
    response.body.products.map((p) => p.id),
    [mask],
  )
  assert.match(mocked.calls[1]!, /Tagged dry hair shampoo/u)
  assert.match(mocked.calls[1]!, /Banana mask/u)
})

test('budget and availability never relax when the model invents IDs outside the eligible catalogue', async () => {
  const expensive = await seedProduct(900, 'Mask')
  await seedProduct(100, 'Unavailable Mask', 0)
  const mocked = providerFor(
    baseClassifier,
    {},
    { answer: 'Ось маска у бюджеті.', productIds: [expensive] },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Порадь маску до 300 грн')
  assert.equal(response.status, 503)
  assert.deepEqual(JSON.parse(mocked.calls[1]!.split('Candidate product records: ')[1]!), [])
  const log = await pool.query<{
    diagnostics: { providerError: { reason: string }; effectiveFilters: { maxPrice: number } }
  }>('SELECT diagnostics FROM assistant_interactions ORDER BY created_at DESC LIMIT 1')
  assert.equal(log.rows[0]!.diagnostics.providerError.reason, 'unknown_product_ids')
  assert.equal(log.rows[0]!.diagnostics.effectiveFilters.maxPrice, 300)
})

test('no-match is qualified by constraints and does not become a catalogue-wide absence claim', async () => {
  await seedProduct(900, 'Mask')
  setAssistantProviderForTests(
    providerFor(
      baseClassifier,
      {},
      {
        answer: 'У магазині взагалі немає масок.',
        productIds: [],
        outcome: 'no_match',
      },
    ).provider,
  )
  const response = await chat('Порадь маску до 100 грн')
  assert.equal(response.status, 200)
  assert.match(response.body.answer, /вашим умовам/u)
  assert.doesNotMatch(response.body.answer, /взагалі немає/u)
  assert.deepEqual(response.body.products, [])
})

test('ordered historical IDs resolve second product and unknown historical IDs are never trusted', async () => {
  const first = await seedProduct(500, 'First cream')
  const second = await seedProduct(200, 'Second cream')
  const mocked = providerFor(
    { ...baseClassifier, intent: 'product_details' },
    {},
    {
      answer: 'Ціна другого товару показана в картці.',
      productIds: [second],
    },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Яка ціна другого?', [
    { role: 'user', content: 'Порадь крем до 600 грн' },
    { role: 'assistant', content: 'Два варіанти', productIds: [first, second, 999999] },
  ])
  assert.equal(response.status, 200)
  assert.deepEqual(
    response.body.products.map((p) => p.id),
    [second],
  )
  const candidates = JSON.parse(mocked.calls[1]!.split('Candidate product records: ')[1]!) as {
    id: number
  }[]
  assert.deepEqual(
    candidates.map((p) => p.id),
    [second],
  )
  assert.doesNotMatch(mocked.calls[0]!, /999999/u)
})

test('cheaper follow-up inherits the original budget and lowers the price in the same category', async () => {
  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (id, name, slug) VALUES ($1, 'Креми', 'creams') RETURNING id",
    [uuid()],
  )
  const expensive = await seedProduct(400, 'Cream')
  const cheap = await seedProduct(250, 'Cheaper cream')
  const unrelated = await seedProduct(100, 'Brush')
  await pool.query('UPDATE products SET category_id = $1 WHERE id = ANY($2::int[])', [
    category.rows[0]!.id,
    [expensive, cheap],
  ])
  const mocked = providerFor(baseClassifier, {}, { answer: 'Дешевший крем.', productIds: [cheap] })
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('А є дешевше?', [
    { role: 'user', content: 'Порадь крем до 500 грн' },
    { role: 'assistant', content: 'Цей крем', productIds: [expensive] },
  ])
  assert.equal(response.status, 200)
  assert.deepEqual(
    response.body.products.map((p) => p.id),
    [cheap],
  )
  const candidates = JSON.parse(mocked.calls[1]!.split('Candidate product records: ')[1]!) as {
    id: number
  }[]
  assert.deepEqual(
    candidates.map((p) => p.id),
    [cheap],
  )
  assert(!candidates.some((p) => p.id === unrelated))
})

test('Gemini failure after classification keeps diagnostics and returns only literal catalogue facts', async () => {
  const id = await seedProduct(349, 'Garnier Banana Mask')
  setAssistantProviderForTests({
    generateStructured: async (prompt) => {
      if (prompt.startsWith('Classify')) return { ...baseClassifier, language: 'en' }
      throw new AssistantProviderError('temporary failure', 'timeout', undefined, 'timeout')
    },
  })
  const response = await chat('Garnier Banana Mask')
  assert.equal(response.status, 200)
  assert.equal(response.body.mode, 'catalogue')
  assert.match(response.body.answer, /could not assess/u)
  assert.deepEqual(
    response.body.products.map((p) => p.id),
    [id],
  )
  const log = await pool.query<{
    classifier_result: unknown
    candidate_product_ids: number[]
    diagnostics: { providerError: { stage: string; kind: string }; timings: Record<string, number> }
  }>(
    'SELECT classifier_result, candidate_product_ids, diagnostics FROM assistant_interactions WHERE id = $1',
    [response.body.interactionId],
  )
  assert(log.rows[0]!.classifier_result)
  assert.deepEqual(log.rows[0]!.candidate_product_ids, [id])
  assert.equal(log.rows[0]!.diagnostics.providerError.stage, 'answer')
  assert.equal(log.rows[0]!.diagnostics.providerError.kind, 'timeout')
  assert.equal(typeof log.rows[0]!.diagnostics.timings.answer, 'number')
})

test('Gemini failure with no literal match gives 503 and preserves classifier and candidate IDs', async () => {
  const id = await seedProduct(300, 'Unrelated cream')
  setAssistantProviderForTests({
    generateStructured: async (prompt) => {
      if (prompt.startsWith('Classify')) return baseClassifier
      throw new AssistantProviderError('provider down', 'rate_limited', 429, 'quota_exhausted')
    },
  })
  const response = await chat('Порадь шампунь')
  assert.equal(response.status, 503)
  const log = await pool.query<{
    classifier_result: unknown
    candidate_product_ids: number[]
    diagnostics: { providerError: { stage: string; kind: string } }
  }>(
    'SELECT classifier_result, candidate_product_ids, diagnostics FROM assistant_interactions ORDER BY created_at DESC LIMIT 1',
  )
  assert(log.rows[0]!.classifier_result)
  assert.deepEqual(log.rows[0]!.candidate_product_ids, [id])
  assert.equal(log.rows[0]!.diagnostics.providerError.stage, 'answer')
  assert.equal(log.rows[0]!.diagnostics.providerError.kind, 'rate_limited')
})

test('related care questions go through final answering rather than a strict topical refusal', async () => {
  const mocked = providerFor(
    { ...baseClassifier, intent: 'product_usage' },
    {},
    {
      answer: 'Для сухого волосся почніть з м’якого очищення та догляду за інструкцією засобу.',
      productIds: [],
      outcome: 'matched',
    },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Як доглядати за сухим волоссям?')
  assert.equal(response.status, 200)
  assert.equal(mocked.calls.length, 2)
  assert.match(mocked.calls[0]!, /General hair\/skin care/u)
  assert.match(response.body.answer, /м’якого очищення/u)
})

test('malformed historical IDs are validated before calling the model', async () => {
  const mocked = providerFor(baseClassifier)
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Ціна?', [{ role: 'assistant', content: 'Товар', productIds: [-1] }])
  assert.equal(response.status, 400)
  assert.equal(mocked.calls.length, 0)
})

test('invented numerical prices fail closed rather than appear in the answer', async () => {
  const id = await seedProduct(349, 'Banana Mask')
  setAssistantProviderForTests(
    providerFor(baseClassifier, {}, { answer: 'Маска коштує 10 грн.', productIds: [id] }).provider,
  )
  const response = await chat('Banana Mask')
  assert.equal(response.status, 200)
  assert.equal(response.body.mode, 'catalogue')
  assert.doesNotMatch(response.body.answer, /10 грн/u)
  assert.equal(response.body.products[0]!.price, 349)
})

test('explicit category, available stock and price range remain hard constraints', async () => {
  const categoryId = uuid()
  await pool.query("INSERT INTO categories (id, name, slug) VALUES ($1, 'Креми', 'creams')", [
    categoryId,
  ])
  const cream = await seedProduct(250, 'Cream')
  const reserved = await seedProduct(260, 'Reserved cream', 1)
  const draft = await seedProduct(270, 'Draft cream')
  const tooCheap = await seedProduct(50, 'Cheap cream')
  await seedProduct(220, 'Other category')
  await pool.query('UPDATE products SET category_id = $1 WHERE id = ANY($2::int[])', [
    categoryId,
    [cream, reserved, draft, tooCheap],
  ])
  await pool.query('UPDATE products SET reserved_stock = 1 WHERE id = $1', [reserved])
  await pool.query("UPDATE products SET status = 'draft' WHERE id = $1", [draft])
  const mocked = providerFor(
    {
      ...baseClassifier,
      categoryExplicit: true,
      filters: { ...baseClassifier.filters, categorySlug: 'creams' },
    },
    {},
    { answer: 'Цей крем відповідає умовам.', productIds: [cream] },
  )
  setAssistantProviderForTests(mocked.provider)
  const response = await chat('Покажи Креми від 100 до 300 грн')
  assert.equal(response.status, 200)
  const candidates = JSON.parse(mocked.calls[1]!.split('Candidate product records: ')[1]!) as {
    id: number
  }[]
  assert.deepEqual(
    candidates.map((p) => p.id),
    [cream],
  )
})

test('a request for one item is enforced even when the model returns two', async () => {
  const first = await seedProduct(200, 'Cream One')
  const second = await seedProduct(300, 'Cream Two')
  setAssistantProviderForTests(
    providerFor(baseClassifier, {}, { answer: 'Два креми.', productIds: [first, second] }).provider,
  )
  const response = await chat('Порадь один крем')
  assert.equal(response.status, 503)
  const log = await pool.query<{ diagnostics: { providerError: { reason: string } } }>(
    'SELECT diagnostics FROM assistant_interactions ORDER BY created_at DESC LIMIT 1',
  )
  assert.equal(log.rows[0]!.diagnostics.providerError.reason, 'too_many_products')
})

test('catalogue database errors are distinct from provider errors', async () => {
  const mocked = providerFor(baseClassifier)
  setAssistantProviderForTests(mocked.provider)
  const originalQuery = pool.query
  pool.query = ((...args: unknown[]) => {
    if (String(args[0]).includes('FROM products p LEFT JOIN categories')) {
      throw Object.assign(new Error('fixture database failure'), { code: 'ECONNREFUSED' })
    }
    return (originalQuery as (...args: unknown[]) => unknown).apply(pool, args)
  }) as typeof pool.query
  try {
    const response = await chat('Порадь крем')
    assert.equal(response.status, 500)
    assert.match(response.body.error!, /прочитати каталог/u)
    assert.equal(mocked.calls.length, 0)
    const log = await pool.query<{
      status: string
      diagnostics: { databaseError: { stage: string; code: string } }
    }>('SELECT status, diagnostics FROM assistant_interactions ORDER BY created_at DESC LIMIT 1')
    assert.equal(log.rows[0]!.status, 'database_error')
    assert.equal(log.rows[0]!.diagnostics.databaseError.stage, 'catalogue')
  } finally {
    pool.query = originalQuery
  }
})

test('provider errors distinguish invalid key, missing model, quota, rejection and safe diagnostics', async () => {
  for (const [status, message, kind, attempts] of [
    [400, 'API_KEY_INVALID sensitive-echo-must-not-be-logged', 'auth', 1],
    [404, 'missing model sensitive-echo-must-not-be-logged', 'model_not_found', 1],
    [429, 'RESOURCE_EXHAUSTED quota sensitive-echo-must-not-be-logged', 'rate_limited', 1],
    [400, 'invalid schema sensitive-echo-must-not-be-logged', 'request_rejected', 1],
    [503, 'unavailable sensitive-echo-must-not-be-logged', 'unavailable', 2],
  ] as const) {
    let count = 0
    const provider = new GeminiHttpProvider({
      apiKey: 'fixture',
      model: 'fixture',
      timeoutMs: 2000,
      fetchImpl: async () => {
        count++
        return new Response(JSON.stringify({ error: { message } }), { status })
      },
    })
    await assert.rejects(
      provider.generateStructured('fixture', { type: 'object' }, 100),
      (error: unknown) => {
        assert(error instanceof AssistantProviderError)
        assert.equal(error.kind, kind)
        assert.equal(error.providerStatus, status)
        assert.doesNotMatch(error.diagnostic ?? '', /sensitive-echo/u)
        return true
      },
    )
    assert.equal(count, attempts)
  }
})

test('provider network, timeout and malformed output errors remain distinct', async () => {
  for (const kind of ['network', 'timeout', 'invalid_output'] as const) {
    const provider = new GeminiHttpProvider({
      apiKey: 'fixture',
      model: 'fixture',
      timeoutMs: 2000,
      fetchImpl: async () => {
        if (kind === 'invalid_output') return new Response('{bad json', { status: 200 })
        const error = new Error('fixture')
        if (kind === 'timeout') error.name = 'AbortError'
        throw error
      },
    })
    await assert.rejects(
      provider.generateStructured('fixture', { type: 'object' }, 100),
      (error: unknown) => {
        assert(error instanceof AssistantProviderError)
        assert.equal(error.kind, kind)
        return true
      },
    )
  }
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

test('Gemini 503 and timeouts switch models within two attempts and reuse a healthy fallback', async () => {
  for (const failure of ['503', 'timeout'] as const) {
    const models: string[] = []
    const provider = new GeminiHttpProvider({
      apiKey: 'fixture', model: 'gemini-3.1-flash-lite',
      fallbackModels: ['gemini-3.5-flash-lite'], timeoutMs: 15,
      fetchImpl: async (input, init) => {
        models.push(new URL(String(input)).pathname.split('/').at(-1)!)
        const body = JSON.parse(String(init?.body))
        assert.equal(body.generationConfig.temperature, 1)
        if (models.length === 1) {
          if (failure === '503') return new Response('{}', { status: 503 })
          await new Promise<void>((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')), { once: true })
          })
        }
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }))
      },
    })
    assert.deepEqual(await provider.generateStructured('fixture', {}, 100), { ok: true })
    assert.deepEqual(models, ['gemini-3.1-flash-lite:generateContent', 'gemini-3.5-flash-lite:generateContent'])
    assert.deepEqual(await provider.generateStructured('next stage', {}, 100), { ok: true })
    assert.equal(models[2], 'gemini-3.5-flash-lite:generateContent')
  }
})

test('model failover never retries invalid credentials, schema errors or exhausted quota', async () => {
  for (const [status, body] of [[401, '{}'], [400, 'invalid schema'], [429, 'RESOURCE_EXHAUSTED quota']] as const) {
    let calls = 0
    const provider = new GeminiHttpProvider({
      apiKey: 'fixture', model: 'primary', fallbackModels: ['fallback'], timeoutMs: 1000,
      fetchImpl: async () => { calls++; return new Response(body, { status }) },
    })
    await assert.rejects(provider.generateStructured('fixture', {}, 100), AssistantProviderError)
    assert.equal(calls, 1)
  }
})

test('the shared deadline stops retries and aborts provider work still in flight', async () => {
  let calls = 0
  const provider = new GeminiHttpProvider({
    apiKey: 'fixture', model: 'primary', fallbackModels: ['fallback'], timeoutMs: 1000,
    fetchImpl: async (_input, init) => {
      calls++
      await new Promise<void>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')), { once: true })
      })
      throw new Error('unreachable')
    },
  })
  await assert.rejects(provider.generateStructured('fixture', {}, 100, { deadlineMs: Date.now() + 20 }),
    (error: unknown) => error instanceof AssistantProviderError && error.kind === 'timeout' && error.diagnostic === 'request_deadline')
  assert.equal(calls, 1)
})
