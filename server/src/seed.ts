import { hashPassword } from './auth.js'
import { catalog, seedCategories } from './catalog.js'
import { config } from './config.js'
import { newId, pool, withTransaction } from './db.js'

async function seedCatalog() {
  await withTransaction(async (client) => {
    for (const category of seedCategories) {
      await client.query(
        `INSERT INTO categories (id, name, slug, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [newId(), category.name, category.slug, category.description],
      )
    }

    const { rows: categories } = await client.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM categories',
    )
    const categoryIds = new Map(categories.map((category) => [category.slug, category.id]))

    for (const product of catalog) {
      const categoryId = categoryIds.get(product.categorySlug)
      if (!categoryId) throw new Error(`Missing category ${product.categorySlug}`)

      await client.query(
        `INSERT INTO products (
          id, name, price_uah, is_available, slug, category_id, short_description, description,
          old_price_uah, stock, status, rating, review_count, badge
        ) VALUES (
          $1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price_uah = EXCLUDED.price_uah,
          is_available = TRUE,
          slug = EXCLUDED.slug,
          category_id = EXCLUDED.category_id,
          short_description = EXCLUDED.short_description,
          description = EXCLUDED.description,
          old_price_uah = EXCLUDED.old_price_uah,
          stock = EXCLUDED.stock,
          status = 'active',
          rating = EXCLUDED.rating,
          review_count = EXCLUDED.review_count,
          badge = EXCLUDED.badge,
          updated_at = NOW()
        WHERE products.slug IS NULL OR products.description = ''`,
        [
          product.id,
          product.name,
          product.priceUah,
          product.slug,
          categoryId,
          product.shortDescription,
          product.description,
          product.oldPriceUah,
          product.stock,
          product.rating,
          product.reviewCount,
          product.badge,
        ],
      )

      const imageExists = await client.query(
        'SELECT 1 FROM product_images WHERE product_id = $1 LIMIT 1',
        [product.id],
      )
      if (!imageExists.rowCount) {
        await client.query(
          `INSERT INTO product_images (
            id, product_id, provider, public_id, url, alt_text, sort_order
          ) VALUES ($1, $2, 'external', NULL, $3, $4, 0)`,
          [newId(), product.id, product.imageUrl, product.name],
        )
      }
    }

    await client.query(
      "SELECT setval('products_id_seq', (SELECT COALESCE(MAX(id), 1) FROM products), true)",
    )
  })
}

async function seedFirstAdmin() {
  if (!config.adminEmail || !config.adminPassword) return false

  const passwordHash = await hashPassword(config.adminPassword)
  const result = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, 'Адміністратор Velora', $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
     WHERE users.role = 'admin'`,
    [newId(), config.adminEmail, passwordHash],
  )
  if (!result.rowCount) {
    throw new Error('The configured administrator email already belongs to a customer account')
  }
  return true
}

async function seed() {
  await seedCatalog()
  const adminCreated = await seedFirstAdmin()
  console.info(
    `Seeded ${catalog.length} test products${adminCreated ? ' and the configured admin' : ''}.`,
  )
}

seed()
  .catch((error: unknown) => {
    console.error(
      'Unable to seed Velora data',
      error instanceof Error ? error.message : 'unknown error',
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
