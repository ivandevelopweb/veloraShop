import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    -- Reservations retain product_id as order history. They must not keep a
    -- permanently archived catalogue row alive after an administrator deletes it.
    ALTER TABLE inventory_reservations
      DROP CONSTRAINT IF EXISTS inventory_reservations_product_id_fkey;

    COMMENT ON COLUMN inventory_reservations.product_id IS
      'Product id captured in the order reservation; may outlive the catalogue product.';
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error(
    'Rolling back archived product deletion is intentionally blocked to preserve reservation history.',
  )
}
