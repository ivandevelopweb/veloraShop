import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_quantity_check;
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_quantity_check CHECK (quantity >= 1);

    ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check;
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 1);

    UPDATE products
    SET stock = 8 + (((id - 1) * 7) % 37), updated_at = NOW()
    WHERE id BETWEEN 1 AND 50 AND stock = 20;
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back the inventory quantity migration is intentionally blocked to protect data.')
}
