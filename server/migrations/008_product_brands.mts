import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN brand VARCHAR(120) NOT NULL DEFAULT ''
        CHECK (char_length(btrim(brand)) <= 120);

    -- The seed contains one explicitly branded product. The other demo names
    -- describe product lines without enough evidence to assign a manufacturer.
    UPDATE products
    SET brand = 'Velora'
    WHERE name = 'Velora Signature' AND brand = '';
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('ALTER TABLE products DROP COLUMN brand')
}
