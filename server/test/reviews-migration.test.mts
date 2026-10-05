import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import test, { after } from 'node:test'
import { catalog } from '../src/catalog.js'
import { pool } from '../src/db.js'

after(async () => {
  await pool.end()
})

test('migration 007 preserves existing rated products as exact manual bases', async () => {
  const { rows } = await pool.query<{
    id: number
    rating: string
    reviewCount: number
    baseRating: string
    baseCount: string
    baseSum: string
    ratingEpoch: string
    ratingRevision: string
  }>(
    `SELECT id, rating::text,
            review_count AS "reviewCount",
            base_rating::text AS "baseRating",
            base_count::text AS "baseCount",
            base_sum::text AS "baseSum",
            rating_epoch::text AS "ratingEpoch",
            rating_revision::text AS "ratingRevision"
     FROM products
     WHERE id IN (9001, 9002)
     ORDER BY id`,
  )

  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    id: 9001,
    rating: '2.0',
    reviewCount: 10,
    baseRating: '2.0',
    baseCount: '10',
    baseSum: '20.0',
    ratingEpoch: '0',
    ratingRevision: '0',
  })
  assert.deepEqual(rows[1], {
    id: 9002,
    rating: '0.0',
    reviewCount: 0,
    baseRating: '4.5',
    baseCount: '0',
    baseSum: '0.0',
    ratingEpoch: '0',
    ratingRevision: '0',
  })
})

test('migration 008 backfills only the explicitly branded product and preserves its other fields', async () => {
  const { rows } = await pool.query<{
    id: number
    name: string
    brand: string
    price: number
    description: string
  }>(
    `SELECT id, name, brand, price_uah AS price, description
     FROM products
     WHERE id IN (9001, 9002, 9003)
     ORDER BY id`,
  )

  assert.deepEqual(rows, [
    { id: 9001, name: 'Migration rating fixture', brand: '', price: 100, description: 'Fixture' },
    { id: 9002, name: 'Migration empty fixture', brand: '', price: 100, description: 'Fixture' },
    {
      id: 9003,
      name: 'Velora Signature',
      brand: 'Velora',
      price: 3490,
      description: 'Preserve this description',
    },
  ])
})

test('migration 009 backfills reliable title brands without overwriting curated values or product data', async () => {
  const { rows } = await pool.query<{
    id: number
    name: string
    brand: string
    price: number
    description: string
  }>(
    `SELECT id, name, brand, price_uah AS price, description
     FROM products
     WHERE id IN (9004, 9005, 9006)
     ORDER BY id`,
  )

  assert.deepEqual(rows, [
    {
      id: 9004,
      name: 'Garnier Fructis Hair Food Banana 3-in-1 Mask',
      brand: 'Garnier',
      price: 899,
      description: 'Preserve Garnier description',
    },
    {
      id: 9005,
      name: 'Moroccanoil Treatment Original',
      brand: 'Curated Brand',
      price: 1200,
      description: 'Preserve Moroccanoil description',
    },
    {
      id: 9006,
      name: 'Beauty of Joseon Glow Serum : Propolis + Niacinamide',
      brand: 'Beauty of Joseon',
      price: 750,
      description: 'Preserve Joseon description',
    },
  ])
})

test('repeated seed leaves a reset base and existing buyer votes intact', async () => {
  const productId = catalog[0]!.id
  const userId = randomUUID()
  const orderId = randomUUID()
  const ratingId = randomUUID()

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1, 'Migration buyer', $2, 'test-only')`,
    [userId, `${userId}@example.test`],
  )
  await pool.query(
    `INSERT INTO orders (
       id, code, user_id, status, total_uah, delivery_method, delivery_city,
       delivery_branch, customer_name, customer_phone, customer_email,
       payment_status, payment_updated_at
     ) VALUES ($1, $2, $3, 'processing', 100, 'nova_poshta', 'Київ', 'Тест',
              'Migration buyer', '+380000000000', $4, 'paid', NOW())`,
    [orderId, `MIG-${userId.slice(0, 8)}`, userId, `${userId}@example.test`],
  )
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, product_name, price_uah, quantity, product_slug)
     VALUES ($1, $2, 'Seed test item', 100, 1, 'seed-test-item')`,
    [orderId, productId],
  )
  await pool.query(
    `INSERT INTO product_ratings (id, product_id, user_id, order_id, epoch, stars, author_name)
     VALUES ($1, $2, $3, $4, 0, 2, 'Migration buyer')`,
    [ratingId, productId, userId, orderId],
  )
  await pool.query(
    `UPDATE products
     SET base_rating = 5.0, base_count = 5, rating = 4.5, review_count = 6,
         rating_epoch = 0, rating_revision = 1, description = ''
     WHERE id = $1`,
    [productId],
  )

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/seed.ts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Repeated isolated seed exited with status ${code}`))
    })
  })

  const { rows } = await pool.query<{
    rating: string
    reviewCount: number
    baseRating: string
    baseCount: string
    baseSum: string
    ratingEpoch: string
    ratingRevision: string
    description: string
    voiceCount: number
    voiceStars: number
  }>(
    `SELECT products.rating::text,
            products.review_count AS "reviewCount",
            products.base_rating::text AS "baseRating",
            products.base_count::text AS "baseCount",
            products.base_sum::text AS "baseSum",
            products.rating_epoch::text AS "ratingEpoch",
            products.rating_revision::text AS "ratingRevision",
            products.description,
            COUNT(product_ratings.id)::int AS "voiceCount",
            COALESCE(SUM(product_ratings.stars), 0)::int AS "voiceStars"
     FROM products
     LEFT JOIN product_ratings
       ON product_ratings.product_id = products.id AND product_ratings.epoch = products.rating_epoch
     WHERE products.id = $1
     GROUP BY products.id`,
    [productId],
  )

  assert.deepEqual(rows[0], {
    rating: '4.5',
    reviewCount: 6,
    baseRating: '5.0',
    baseCount: '5',
    baseSum: '25.0',
    ratingEpoch: '0',
    ratingRevision: '1',
    description: catalog[0]!.description,
    voiceCount: 1,
    voiceStars: 2,
  })
})
