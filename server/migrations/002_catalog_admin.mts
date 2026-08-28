import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'customer';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin'));
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY,
      name VARCHAR(80) UNIQUE NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      description VARCHAR(240) NOT NULL DEFAULT '',
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS slug VARCHAR(160);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description VARCHAR(240) NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price_uah INTEGER CHECK (old_price_uah IS NULL OR old_price_uah >= 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 20 CHECK (stock >= 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS rating NUMERIC(2, 1) NOT NULL DEFAULT 4.8 CHECK (rating BETWEEN 0 AND 5);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(80) NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    UPDATE products
    SET status = CASE WHEN is_available THEN 'active' ELSE 'archived' END
    WHERE status NOT IN ('draft', 'active', 'archived') OR status IS NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_status_check'
      ) THEN
        ALTER TABLE products
          ADD CONSTRAINT products_status_check CHECK (status IN ('draft', 'active', 'archived'));
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx ON products(slug) WHERE slug IS NOT NULL;
    CREATE INDEX IF NOT EXISTS products_status_idx ON products(status);
    CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);

    CREATE SEQUENCE IF NOT EXISTS products_id_seq;
    ALTER TABLE products ALTER COLUMN id SET DEFAULT nextval('products_id_seq');

    CREATE TABLE IF NOT EXISTS product_images (
      id UUID PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      provider VARCHAR(16) NOT NULL CHECK (provider IN ('cloudinary', 'external')),
      public_id VARCHAR(255),
      url TEXT NOT NULL,
      alt_text VARCHAR(160) NOT NULL DEFAULT '',
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (product_id, sort_order)
    );

    CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id, sort_order);

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    UPDATE orders SET status = 'new' WHERE status = 'payment_pending';

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check'
      ) THEN
        ALTER TABLE orders
          ADD CONSTRAINT orders_status_check
          CHECK (status IN ('new', 'processing', 'shipped', 'completed', 'cancelled'));
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS order_status_events (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      previous_status VARCHAR(32),
      next_status VARCHAR(32) NOT NULL,
      changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS order_status_events_order_idx
      ON order_status_events(order_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id UUID PRIMARY KEY,
      admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(120) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS admin_audit_log_entity_idx
      ON admin_audit_log(entity_type, entity_id, created_at DESC);
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back the catalogue migration is intentionally blocked to protect data.')
}
