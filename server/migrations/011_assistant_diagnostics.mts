import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE assistant_interactions
    ADD COLUMN IF NOT EXISTS diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb`)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Assistant diagnostic history must be preserved.')
}
