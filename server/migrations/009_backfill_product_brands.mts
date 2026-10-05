import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    UPDATE products
    SET brand = CASE
      WHEN name LIKE 'Anua %' THEN 'Anua'
      WHEN name LIKE 'Beauty of Joseon %' THEN 'Beauty of Joseon'
      WHEN name LIKE 'Bioderma %' THEN 'Bioderma'
      WHEN name LIKE 'CeraVe %' THEN 'CeraVe'
      WHEN name LIKE 'COSRX %' THEN 'COSRX'
      WHEN name LIKE 'Dove %' THEN 'Dove'
      WHEN name LIKE 'essence %' THEN 'essence'
      WHEN name LIKE 'Garnier %' THEN 'Garnier'
      WHEN name LIKE 'L''Oréal Paris %' THEN 'L''Oréal Paris'
      WHEN name LIKE 'La Roche-Posay %' THEN 'La Roche-Posay'
      WHEN name LIKE 'Maybelline New York %' THEN 'Maybelline New York'
      WHEN name LIKE 'Moroccanoil %' THEN 'Moroccanoil'
      WHEN name LIKE 'Neutrogena %' THEN 'Neutrogena'
      WHEN name LIKE 'NIVEA %' THEN 'NIVEA'
      WHEN name LIKE 'NYX Professional Makeup %' THEN 'NYX Professional Makeup'
      WHEN name LIKE 'OLAPLEX %' THEN 'OLAPLEX'
      WHEN name LIKE 'Real Techniques %' THEN 'Real Techniques'
      WHEN name LIKE 'SKIN1004 %' THEN 'SKIN1004'
      WHEN name LIKE 'Tangle Teezer %' THEN 'Tangle Teezer'
      WHEN name LIKE 'The Ordinary %' THEN 'The Ordinary'
      WHEN name LIKE 'Tree Hut %' THEN 'Tree Hut'
      WHEN name LIKE 'Tweezerman %' THEN 'Tweezerman'
      WHEN name LIKE 'Vaseline %' THEN 'Vaseline'
    END
    WHERE btrim(brand) = ''
      AND (
        name LIKE 'Anua %'
        OR name LIKE 'Beauty of Joseon %'
        OR name LIKE 'Bioderma %'
        OR name LIKE 'CeraVe %'
        OR name LIKE 'COSRX %'
        OR name LIKE 'Dove %'
        OR name LIKE 'essence %'
        OR name LIKE 'Garnier %'
        OR name LIKE 'L''Oréal Paris %'
        OR name LIKE 'La Roche-Posay %'
        OR name LIKE 'Maybelline New York %'
        OR name LIKE 'Moroccanoil %'
        OR name LIKE 'Neutrogena %'
        OR name LIKE 'NIVEA %'
        OR name LIKE 'NYX Professional Makeup %'
        OR name LIKE 'OLAPLEX %'
        OR name LIKE 'Real Techniques %'
        OR name LIKE 'SKIN1004 %'
        OR name LIKE 'Tangle Teezer %'
        OR name LIKE 'The Ordinary %'
        OR name LIKE 'Tree Hut %'
        OR name LIKE 'Tweezerman %'
        OR name LIKE 'Vaseline %'
      );
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Keep inferred values on rollback so this cannot erase later admin edits.
  pgm.sql('SELECT 1')
}
