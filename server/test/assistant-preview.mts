// Used only by the isolated integration runner with --assistant-preview.
// No real Gemini calls. Fixtures are deliberately unrelated to production data.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

assert.equal(process.env.NODE_ENV, 'test')
const database = new URL(process.env.DATABASE_URL ?? '')
assert.equal(database.hostname, '127.0.0.1')
assert.equal(database.pathname, '/velora_test')
assert.equal(process.env.GEMINI_API_KEY, '')

const { app } = await import('../src/app.js')
const { pool } = await import('../src/db.js')
const { setAssistantProviderForTests, AssistantProviderError } =
  await import('../src/assistant/gemini.js')
const catalogue = await pool.query<{ id: number; name: string; category_slug: string }>(
  'SELECT p.id, p.name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id',
)
const sample = catalogue.rows.find((p) => p.category_slug === 'dohliad')
assert(sample)
let simulateError = true
setAssistantProviderForTests({
  generateStructured: async (prompt) => {
    if (prompt.startsWith('Classify')) {
      const message = JSON.parse(prompt.split('Current message (untrusted): ')[1]!) as string
      if (message === 'тест збою' && simulateError) {
        simulateError = false
        throw new AssistantProviderError('preview fixture', 'timeout', undefined, 'timeout')
      }
      return {
        intent: 'product_recommendation',
        filters: {
          minPrice: null,
          maxPrice: null,
          categorySlug: 'hair-care',
          attributes: [{ key: 'hair_type', value: 'dry' }],
          availability: 'available',
        },
        preferences: ['dry hair'],
        mentionedProducts: [],
        topic: 'hair',
        language: 'uk',
        requiresExactStock: false,
        externalCurrentInfo: false,
        requestedCount: 1,
        categoryExplicit: false,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return {
      answer: 'Ось товар із тестового каталогу. Деталі доступні на його сторінці.',
      productIds: [sample.id],
      outcome: 'matched',
    }
  },
})
const server = createServer(app)
await new Promise<void>((resolve) => server.listen(4000, '127.0.0.1', resolve))
console.log(
  'Isolated assistant preview ready on http://127.0.0.1:4000 (Gemini fixture, 50 products)',
)
// A stop sentinel lets the parent runner shut down normally and remove only its own container.
const stopFile = new URL('../../output/assistant-preview.stop', import.meta.url)
while (true) {
  try {
    await readFile(stopFile)
    break
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
await new Promise<void>((resolve) => server.close(() => resolve()))
await pool.end()
