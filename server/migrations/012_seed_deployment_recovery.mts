import { readFileSync } from 'node:fs'
import type { MigrationBuilder } from 'node-pg-migrate'

// Frozen seed contents from commit 6b85488, verified against the public catalogue.
// Do not import the evolving application seed into this incident recovery.
export const incidentCatalogue = JSON.parse(
  readFileSync(new URL('./fixtures/012_seed_catalogue.json', import.meta.url), 'utf8'),
)
const snapshotSql = JSON.stringify(incidentCatalogue).replace(/'/g, "''")

export const recoverySql = `
DO $recovery$
DECLARE
  incident_time CONSTANT TIMESTAMPTZ := '2026-10-06T11:11:27.313Z';
  snapshot CONSTANT JSONB := '${snapshotSql}'::jsonb;
  incident_count INTEGER;
  timestamp_count INTEGER;
  verified_count INTEGER;
  incident_checks JSONB;
  failed_checks JSONB;
BEGIN
  -- Prevent a concurrent stock/content mutation between verification and archive.
  LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*), COUNT(DISTINCT created_at)
    INTO incident_count, timestamp_count
  FROM products
  WHERE id BETWEEN 1 AND 50
    -- The public Node API exposes milliseconds; PostgreSQL retains microseconds.
    AND date_trunc('milliseconds', created_at) = incident_time;

  IF incident_count = 0 THEN RETURN; END IF;
  IF incident_count <> 50 OR timestamp_count <> 1 THEN
    RAISE EXCEPTION 'Seed recovery stopped: incident product set differs from verified 50 rows';
  END IF;

  IF (SELECT COUNT(*) FROM products WHERE id BETWEEN 1 AND 50
      AND date_trunc('milliseconds', created_at) = incident_time
      AND status = 'archived' AND is_available = FALSE) = 50 THEN
    RETURN;
  END IF;

  -- Diagnostics contain only public IDs and Boolean checks, never field values.
  SELECT jsonb_agg(to_jsonb(checks)) INTO incident_checks FROM (
    SELECT p.id,
    date_trunc('milliseconds', p.created_at) = incident_time AS incident_timestamp,
    p.updated_at = p.created_at AS unchanged_timestamp,
    p.status = 'active' AND p.is_available = TRUE AS active,
    p.reserved_stock = 0 AS no_reserved_stock,
    p.attributes = '{}'::jsonb AS empty_attributes,
    p.ai_tags = ARRAY[]::text[] AS empty_ai_tags,
    p.ai_priority = 0 AS default_ai_priority,
    p.rating_epoch = 0 AND p.rating_revision = 0 AS original_rating_version,
    p.base_rating = (expected->>'rating')::numeric AS original_base_rating,
    p.base_count = (expected->>'reviewCount')::bigint AS original_base_count,
    jsonb_build_object(
      'id', p.id, 'categorySlug', c.slug, 'brand', p.brand, 'name', p.name,
      'slug', p.slug, 'shortDescription', p.short_description, 'description', p.description,
      'priceUah', p.price_uah, 'oldPriceUah', p.old_price_uah,
      'rating', p.rating, 'reviewCount', p.review_count, 'badge', p.badge,
      'stock', p.stock, 'imageUrl', (SELECT url FROM product_images WHERE product_id = p.id LIMIT 1)
    ) = expected AS original_public_fields,
    (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) = 1 AS single_image,
    NOT EXISTS (SELECT 1 FROM order_items WHERE product_id = p.id) AS no_order_history,
    NOT EXISTS (SELECT 1 FROM inventory_reservations WHERE product_id = p.id) AS no_reservation_history,
    NOT EXISTS (SELECT 1 FROM product_ratings WHERE product_id = p.id) AS no_rating_history,
    NOT EXISTS (SELECT 1 FROM product_comments WHERE product_id = p.id) AS no_comment_history
    FROM jsonb_array_elements(snapshot->'products') expected
    JOIN products p ON p.id = (expected->>'id')::integer
    LEFT JOIN categories c ON c.id = p.category_id
  ) checks;

  SELECT COUNT(*) INTO verified_count FROM jsonb_array_elements(incident_checks) checked
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_each(checked) field
    WHERE field.key <> 'id' AND field.value IS DISTINCT FROM 'true'::jsonb);

  IF verified_count <> 50 THEN
    SELECT jsonb_agg(checked) INTO failed_checks FROM jsonb_array_elements(incident_checks) checked
    WHERE EXISTS (SELECT 1 FROM jsonb_each(checked) field
      WHERE field.key <> 'id' AND field.value IS DISTINCT FROM 'true'::jsonb);
    RAISE EXCEPTION 'Seed recovery stopped: product content, stock or history changed. Checks: %', failed_checks;
  END IF;

  -- Retain every record, image and identifier. Only public availability changes.
  UPDATE products SET status = 'archived', is_available = FALSE, updated_at = NOW()
  WHERE id BETWEEN 1 AND 50
    AND date_trunc('milliseconds', created_at) = incident_time;

  -- Only newly inserted, untouched seed categories without live products qualify.
  -- Existing categories (including those sharing a seed slug) remain untouched.
  UPDATE categories c SET is_archived = TRUE, updated_at = NOW()
  FROM jsonb_array_elements(snapshot->'categories') expected
  WHERE date_trunc('milliseconds', c.created_at) = incident_time
    AND c.updated_at = c.created_at AND c.is_archived = FALSE
    AND jsonb_build_object('name', c.name, 'slug', c.slug, 'description', c.description) = expected
    AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.status <> 'archived');
END $recovery$;
`

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(recoverySql)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Recovery keeps all archived records; review and reactivate explicitly instead of undoing deployment.')
}
