import { readFileSync } from 'node:fs'
import type { MigrationBuilder } from 'node-pg-migrate'

// Frozen seed contents from commit 6b85488, verified against the public catalogue.
// Do not import the evolving application seed into this incident recovery.
export const incidentCatalogue = JSON.parse(
  readFileSync(new URL('./fixtures/012_seed_catalogue.json', import.meta.url), 'utf8'),
)
const snapshotSql = JSON.stringify(incidentCatalogue).replace(/'/g, "''")

export const recoverySql = `
CREATE TABLE IF NOT EXISTS catalogue_recovery_backups (
  incident_key TEXT PRIMARY KEY,
  product_records JSONB NOT NULL,
  image_records JSONB NOT NULL,
  category_records JSONB NOT NULL,
  recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
  LOCK TABLE products IN EXCLUSIVE MODE;
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
    -- 010 deliberately lets completed order/reservation snapshots outlive deleted
    -- catalogue IDs. Old history must not be mistaken for a new seed-row sale.
    NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id AND o.created_at >= p.created_at) AS no_new_order,
    NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.product_id = p.id
      AND r.created_at >= p.created_at) AS no_new_reservation,
    NOT EXISTS (SELECT 1 FROM cart_items WHERE product_id = p.id) AS no_cart_items,
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

  -- A resurrected ID also interferes with older orphan reservations: payments.ts
  -- treats a missing catalogue row differently from an existing zero-reserve row.
  -- Preserve exact rows/images for a transactional down migration, then undo only
  -- the accidental inserts. Order/reservation snapshots are never mutated.
  INSERT INTO catalogue_recovery_backups
    (incident_key, product_records, image_records, category_records, recovered_at)
  SELECT '2026-10-06-render-seed',
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM products p WHERE id BETWEEN 1 AND 50),
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.product_id, i.sort_order)
      FROM product_images i WHERE product_id BETWEEN 1 AND 50),
    COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.slug) FROM categories c
      JOIN jsonb_array_elements(snapshot->'categories') expected ON
        jsonb_build_object('name', c.name, 'slug', c.slug, 'description', c.description) = expected
      WHERE date_trunc('milliseconds', c.created_at) = incident_time
        AND c.updated_at = c.created_at AND c.is_archived = FALSE
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id
          AND p.status <> 'archived' AND p.id NOT BETWEEN 1 AND 50)), '[]'::jsonb), NOW()
  ON CONFLICT (incident_key) DO UPDATE SET
    product_records = EXCLUDED.product_records, image_records = EXCLUDED.image_records,
    category_records = EXCLUDED.category_records, recovered_at = EXCLUDED.recovered_at;

  DELETE FROM products WHERE id BETWEEN 1 AND 50
    AND date_trunc('milliseconds', created_at) = incident_time;

  -- Only the backed-up, newly inserted, untouched categories qualify.
  UPDATE categories c SET is_archived = TRUE, updated_at = NOW()
  WHERE c.id IN (SELECT (category->>'id')::uuid FROM catalogue_recovery_backups b,
    jsonb_array_elements(b.category_records) category WHERE b.incident_key = '2026-10-06-render-seed');
  RAISE NOTICE 'Seed recovery complete: 50 accidental product inserts backed up and removed';
END $recovery$;
`

export const restoreSql = `
DO $restore$
DECLARE
  backup catalogue_recovery_backups%ROWTYPE;
  product_columns TEXT;
BEGIN
  LOCK TABLE products IN EXCLUSIVE MODE;
  LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO backup FROM catalogue_recovery_backups
    WHERE incident_key = '2026-10-06-render-seed' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF jsonb_array_length(backup.product_records) <> 50
    OR EXISTS (SELECT 1 FROM products WHERE id BETWEEN 1 AND 50) THEN
    RAISE EXCEPTION 'Seed restore stopped: backed-up product IDs are unavailable or backup is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(backup.category_records) original
    LEFT JOIN categories c ON c.id = (original->>'id')::uuid
    WHERE c.id IS NULL OR c.is_archived = FALSE OR c.updated_at <> backup.recovered_at) THEN
    RAISE EXCEPTION 'Seed restore stopped: recovered category changed';
  END IF;
  -- Generated columns (base_sum) are recomputed; all other original fields,
  -- microsecond timestamps, IDs and image IDs are restored exactly.
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO product_columns
  FROM pg_attribute WHERE attrelid = 'products'::regclass
    AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
  EXECUTE format('INSERT INTO products (%1$s) SELECT %1$s FROM jsonb_populate_recordset(NULL::products, $1)',
    product_columns) USING backup.product_records;
  INSERT INTO product_images SELECT * FROM jsonb_populate_recordset(NULL::product_images, backup.image_records);
  UPDATE categories c SET is_archived = (original->>'is_archived')::boolean,
    updated_at = (original->>'updated_at')::timestamptz
  FROM jsonb_array_elements(backup.category_records) original WHERE c.id = (original->>'id')::uuid;
END $restore$;
`

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(recoverySql)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(restoreSql)
}
