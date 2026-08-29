import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(16);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(32);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_order_id VARCHAR(255);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(128);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;

    UPDATE orders
    SET payment_status = 'paid', payment_provider = 'legacy_mock', paid_at = created_at,
        payment_updated_at = created_at
    WHERE payment_status IS NULL;

    ALTER TABLE orders ALTER COLUMN payment_status SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN payment_updated_at SET NOT NULL;

    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
    ALTER TABLE orders
      ADD CONSTRAINT orders_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled'));

    CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_order_id_unique
      ON orders(payment_order_id) WHERE payment_order_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment_id_unique
      ON orders(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS orders_one_pending_payment_per_user
      ON orders(user_id) WHERE payment_status = 'pending';
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back the LiqPay payment migration is intentionally blocked to protect data.')
}
