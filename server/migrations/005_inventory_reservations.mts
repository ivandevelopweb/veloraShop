import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS reserved_stock INTEGER NOT NULL DEFAULT 0;
    UPDATE products SET reserved_stock = 0 WHERE reserved_stock IS NULL;

    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_reservation_check;
    ALTER TABLE products
      ADD CONSTRAINT products_stock_reservation_check
      CHECK (stock >= 0 AND reserved_stock >= 0 AND reserved_stock <= stock);

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciliation_deadline_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reconciliation_reason VARCHAR(160);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider_event JSONB;

    ALTER TABLE orders ALTER COLUMN payment_status TYPE VARCHAR(32);
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
    ALTER TABLE orders
      ADD CONSTRAINT orders_payment_status_check
      CHECK (payment_status IN (
        'pending', 'paid', 'failed', 'cancelled', 'expired', 'reconciliation_required'
      ));

    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_slug VARCHAR(160) NOT NULL DEFAULT '';
    UPDATE order_items
    SET product_slug = products.slug
    FROM products
    WHERE products.id = order_items.product_id
      AND order_items.product_slug = '';

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_product_quantity_unique'
      ) THEN
        ALTER TABLE order_items
          ADD CONSTRAINT order_items_order_product_quantity_unique
          UNIQUE (order_id, product_id, quantity);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS inventory_reservations (
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      state VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'consumed', 'released')),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      released_at TIMESTAMPTZ,
      release_reason VARCHAR(160),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (order_id, product_id),
      CONSTRAINT inventory_reservations_order_item_fk
        FOREIGN KEY (order_id, product_id, quantity)
        REFERENCES order_items(order_id, product_id, quantity)
        ON DELETE CASCADE,
      CONSTRAINT inventory_reservations_state_timestamps_check
        CHECK (
          (state = 'active' AND consumed_at IS NULL AND released_at IS NULL)
          OR (state = 'consumed' AND consumed_at IS NOT NULL AND released_at IS NULL)
          OR (state = 'released' AND released_at IS NOT NULL AND consumed_at IS NULL)
        )
    );

    CREATE INDEX IF NOT EXISTS inventory_reservations_active_expiry_idx
      ON inventory_reservations(expires_at, order_id)
      WHERE state = 'active';
    CREATE INDEX IF NOT EXISTS orders_pending_reservation_expiry_idx
      ON orders(reservation_expires_at, id)
      WHERE payment_status = 'pending';

    CREATE OR REPLACE FUNCTION enforce_inventory_reservation_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.state IN ('consumed', 'released') AND NEW.state <> OLD.state THEN
        RAISE EXCEPTION 'inventory reservation terminal state cannot change';
      END IF;
      IF OLD.state = 'active' AND NEW.state NOT IN ('active', 'consumed', 'released') THEN
        RAISE EXCEPTION 'invalid inventory reservation transition';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS inventory_reservations_state_transition_guard ON inventory_reservations;
    CREATE TRIGGER inventory_reservations_state_transition_guard
      BEFORE UPDATE OF state ON inventory_reservations
      FOR EACH ROW
      EXECUTE FUNCTION enforce_inventory_reservation_transition();

    -- Pre-reservation checkout forms were sandbox-only and have no durable inventory hold.
    -- Expire only those legacy pending rows; paid history is intentionally untouched.
    UPDATE orders
    SET payment_status = 'expired',
        payment_reconciliation_reason = 'legacy_pending_without_inventory_reservation',
        payment_updated_at = NOW(),
        updated_at = NOW()
    WHERE payment_status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM inventory_reservations
        WHERE inventory_reservations.order_id = orders.id
      );
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back inventory reservations is intentionally blocked to protect order history.')
}
