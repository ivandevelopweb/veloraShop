import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN base_rating NUMERIC(2, 1),
      ADD COLUMN base_count BIGINT,
      ADD COLUMN rating_epoch BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN rating_revision BIGINT NOT NULL DEFAULT 0;

    UPDATE products
    SET base_rating = rating,
        base_count = review_count;

    ALTER TABLE products
      ALTER COLUMN base_rating SET NOT NULL,
      ALTER COLUMN base_count SET NOT NULL,
      ALTER COLUMN base_rating SET DEFAULT 0,
      ALTER COLUMN base_count SET DEFAULT 0,
      ADD COLUMN base_sum NUMERIC GENERATED ALWAYS AS (base_rating * base_count) STORED,
      ADD CONSTRAINT products_rating_base_range_check
        CHECK (base_rating BETWEEN 0 AND 5),
      ADD CONSTRAINT products_rating_base_count_check
        CHECK (base_count >= 0),
      ADD CONSTRAINT products_rating_versions_check
        CHECK (rating_epoch >= 0 AND rating_revision >= 0);

    -- A zero-count legacy rating remains available in base_rating, while the
    -- compatible public aggregate correctly represents an empty rating.
    UPDATE products
    SET rating = 0,
        review_count = 0
    WHERE review_count = 0;

    CREATE TABLE product_ratings (
      id UUID PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      order_id UUID NOT NULL,
      epoch BIGINT NOT NULL CHECK (epoch >= 0),
      stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
      author_name VARCHAR(80) NOT NULL CHECK (char_length(btrim(author_name)) BETWEEN 1 AND 80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT product_ratings_one_vote_per_epoch UNIQUE (product_id, user_id, epoch),
      CONSTRAINT product_ratings_order_item_fk
        FOREIGN KEY (order_id, product_id)
        REFERENCES order_items(order_id, product_id)
        ON DELETE RESTRICT
    );

    CREATE INDEX product_ratings_product_epoch_created_idx
      ON product_ratings(product_id, epoch, created_at DESC, id DESC);
    CREATE INDEX product_ratings_user_product_idx
      ON product_ratings(user_id, product_id, epoch DESC);

    CREATE TABLE product_comments (
      id UUID PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      source VARCHAR(16) NOT NULL CHECK (source IN ('customer', 'admin')),
      author_name VARCHAR(80) NOT NULL CHECK (char_length(btrim(author_name)) BETWEEN 1 AND 80),
      body VARCHAR(2000) NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
      user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
      order_id UUID,
      created_by_admin UUID REFERENCES users(id) ON DELETE RESTRICT,
      client_request_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT product_comments_source_fields_check CHECK (
        (source = 'customer' AND user_id IS NOT NULL AND order_id IS NOT NULL AND created_by_admin IS NULL)
        OR
        (source = 'admin' AND user_id IS NULL AND order_id IS NULL AND created_by_admin IS NOT NULL)
      ),
      CONSTRAINT product_comments_order_item_fk
        FOREIGN KEY (order_id, product_id)
        REFERENCES order_items(order_id, product_id)
        ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX product_comments_one_active_customer_idx
      ON product_comments(product_id, user_id)
      WHERE source = 'customer' AND deleted_at IS NULL;
    CREATE UNIQUE INDEX product_comments_customer_request_idx
      ON product_comments(product_id, user_id, client_request_id)
      WHERE source = 'customer';
    CREATE UNIQUE INDEX product_comments_admin_request_idx
      ON product_comments(product_id, created_by_admin, client_request_id)
      WHERE source = 'admin';
    CREATE INDEX product_comments_product_created_idx
      ON product_comments(product_id, created_at DESC, id DESC);
    CREATE INDEX product_comments_product_active_created_idx
      ON product_comments(product_id, created_at DESC, id DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE product_review_mutation_limits (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      window_started_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 20)
    );
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back product reviews is intentionally blocked to protect review history.')
}
