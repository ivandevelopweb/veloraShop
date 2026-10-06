import { pool } from '../db.js'
import { ApiError } from '../errors.js'

export type CatalogueProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  price: number
  oldPrice: number | null
  badge: string
  rating: string | number
  reviewCount: number
  stock: number
  category: string | null
  categorySlug: string | null
  attributes: Record<string, unknown>
  aiTags: string[]
  aiPriority: number
  image: string | null
}

// Read the entire small prototype catalogue, not a popularity shortlist. The explicit
// guard prevents silently making catalogue-wide claims if this grows into a large store.
export async function readAssistantCatalogue(): Promise<CatalogueProduct[]> {
  const { rows } = await pool.query<CatalogueProduct>(`SELECT p.id, p.slug, p.name,
    p.short_description AS "shortDescription", p.description, p.price_uah AS price,
    p.old_price_uah AS "oldPrice", p.badge, p.rating, p.review_count AS "reviewCount",
    p.stock - p.reserved_stock AS stock, c.name AS category, c.slug AS "categorySlug",
    p.attributes, p.ai_tags AS "aiTags", p.ai_priority AS "aiPriority",
    (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) AS image
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active' AND p.is_available = TRUE AND p.stock > p.reserved_stock
      AND (c.is_archived = FALSE OR c.id IS NULL)
    ORDER BY p.id LIMIT 2001`)
  if (rows.length > 2000)
    throw new ApiError(503, 'Пошук помічника тимчасово недоступний. Скористайтеся каталогом.')
  return rows
}

export function catalogueDictionary(products: CatalogueProduct[]) {
  const categories = new Map<string, string>()
  const attributes = new Map<string, Set<string | number | boolean>>()
  for (const product of products) {
    if (product.categorySlug && product.category)
      categories.set(product.categorySlug, product.category)
    for (const [key, value] of Object.entries(product.attributes ?? {})) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue
      const values = attributes.get(key) ?? new Set<string | number | boolean>()
      if (values.size < 100) values.add(value as string | number | boolean)
      attributes.set(key, values)
    }
  }
  return {
    categories: [...categories].map(([slug, name]) => ({ slug, name })),
    attributes: [...attributes].map(([key, values]) => ({ key, values: [...values] })),
  }
}

export function clientProduct(product: CatalogueProduct) {
  const {
    attributes: _attributes,
    aiTags: _tags,
    aiPriority: _priority,
    description: _description,
    categorySlug: _slug,
    ...publicFields
  } = product
  return { ...publicFields, rating: Number(product.rating) }
}

export function modelProduct(product: CatalogueProduct) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    category: product.category,
    categorySlug: product.categorySlug,
    shortDescription: product.shortDescription,
    description: product.description.slice(0, 3000),
    attributes: product.attributes ?? {},
    aiTags: product.aiTags ?? [],
    rating: Number(product.rating),
    aiPriority: product.aiPriority,
  }
}
