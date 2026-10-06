import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { after, beforeEach } from 'node:test'
import type { SeedCategory, SeedProduct } from '../src/catalog.js'
import { pool, withTransaction } from '../src/db.js'
import { incidentCatalogue, recoverySql } from '../migrations/012_seed_deployment_recovery.mts'

if (process.env.NODE_ENV !== 'test' || new URL(process.env.DATABASE_URL!).hostname !== '127.0.0.1') {
  throw new Error('Run recovery tests only through the isolated Docker test runner')
}
const products = incidentCatalogue.products as SeedProduct[]
const categories = incidentCatalogue.categories as SeedCategory[]
const incidentTime = '2026-10-06T11:11:27.313987Z'

after(async () => { await pool.end() })
beforeEach(async () => {
  await pool.query('TRUNCATE products, categories RESTART IDENTITY CASCADE')
})

async function fixture(timestamp = incidentTime) {
  const categoryIds = new Map<string, string>()
  for (const category of categories) {
    const id = randomUUID()
    categoryIds.set(category.slug, id)
    await pool.query(`INSERT INTO categories (id, name, slug, description, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$5)`, [id, category.name, category.slug, category.description, timestamp])
  }
  for (const product of products) {
    await pool.query(`INSERT INTO products
      (id, name, brand, slug, category_id, short_description, description, price_uah, old_price_uah,
       stock, rating, review_count, base_rating, base_count, badge, is_available, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::integer,$11,$12::bigint,$13,TRUE,'active',$14,$14)`,
    [product.id, product.name, product.brand, product.slug, categoryIds.get(product.categorySlug),
      product.shortDescription, product.description, product.priceUah, product.oldPriceUah,
      product.stock, product.rating, product.reviewCount, product.badge, timestamp])
    await pool.query(`INSERT INTO product_images (id,product_id,provider,url,alt_text,sort_order)
      VALUES ($1,$2,'external',$3,$4,0)`, [randomUUID(), product.id, product.imageUrl, product.name])
  }
  const originalCategory = randomUUID()
  await pool.query(`INSERT INTO categories (id,name,slug,description,created_at,updated_at)
    VALUES ($1,'Original category','original-category','Original description','2026-10-05','2026-10-05')`,
  [originalCategory])
  await pool.query(`INSERT INTO products
    (id,name,price_uah,is_available,slug,category_id,description,stock,status,attributes,ai_tags,ai_priority)
    SELECT id,'Original ' || id,899,TRUE,'original-' || id,$1,'Original content',20,'active',
      '{"hair_type":"dry"}'::jsonb,ARRAY['original'],5 FROM generate_series(80,129) id`,
  [originalCategory])
}

const recover = () => withTransaction((client) => client.query(recoverySql))
async function activeCount() {
  return Number((await pool.query("SELECT COUNT(*) FROM products WHERE status = 'active' AND is_available")).rows[0].count)
}

test('recovery ignores empty databases and seed rows created outside the incident', async () => {
  await recover()
  await fixture('2026-10-05T11:11:27.313Z')
  const before = (await pool.query('SELECT to_jsonb(p) row FROM products p ORDER BY id')).rows
  await recover()
  assert.deepEqual((await pool.query('SELECT to_jsonb(p) row FROM products p ORDER BY id')).rows, before)
  assert.equal(await activeCount(), 100)
})

test('recovery archives precisely 50 incident rows, preserves originals and images, and is repeatable', async () => {
  await fixture()
  // An existing seed category may share a slug; its metadata must stay intact.
  await pool.query("UPDATE categories SET created_at='2026-10-05', updated_at='2026-10-05' WHERE slug='parfumeriia'")
  const originalProducts = (await pool.query('SELECT to_jsonb(p) row FROM products p WHERE id > 50 ORDER BY id')).rows
  const existingCategories = (await pool.query("SELECT to_jsonb(c) row FROM categories c WHERE created_at < '2026-10-06' ORDER BY slug")).rows
  const images = (await pool.query('SELECT to_jsonb(i) row FROM product_images i ORDER BY product_id')).rows
  await recover()
  assert.equal(await activeCount(), 50)
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM products')).rows[0].count), 100)
  assert.equal(Number((await pool.query("SELECT COUNT(*) FROM products WHERE id <= 50 AND status='archived' AND NOT is_available")).rows[0].count), 50)
  assert.deepEqual((await pool.query('SELECT to_jsonb(p) row FROM products p WHERE id > 50 ORDER BY id')).rows, originalProducts)
  assert.deepEqual((await pool.query("SELECT to_jsonb(c) row FROM categories c WHERE created_at < '2026-10-06' ORDER BY slug")).rows, existingCategories)
  assert.deepEqual((await pool.query('SELECT to_jsonb(i) row FROM product_images i ORDER BY product_id')).rows, images)
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM categories WHERE is_archived')).rows[0].count), 6)
  await recover()
  assert.equal(await activeCount(), 50)
})

test('partial incident set stops recovery without archiving other rows', async () => {
  await fixture()
  await pool.query('DELETE FROM products WHERE id=50')
  await assert.rejects(recover, /incident product set differs/)
  assert.equal(await activeCount(), 99)
})

test('changed product content stops recovery atomically even without an updated_at change', async () => {
  await fixture()
  await pool.query('UPDATE products SET price_uah=price_uah+1 WHERE id=3')
  await assert.rejects(recover, /content, stock or history changed/)
  assert.equal(await activeCount(), 100)
})

test('reserved stock stops recovery without modifying products or categories', async () => {
  await fixture()
  await pool.query('UPDATE products SET reserved_stock=1 WHERE id=3')
  await assert.rejects(recover, /content, stock or history changed/)
  assert.equal(await activeCount(), 100)
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM categories WHERE is_archived')).rows[0].count), 0)
})

test('updated incident record stops recovery even when seed content is unchanged', async () => {
  await fixture()
  await pool.query("UPDATE products SET updated_at='2026-10-06T12:00:00Z' WHERE id=3")
  await assert.rejects(recover, /content, stock or history changed/)
  assert.equal(await activeCount(), 100)
})
