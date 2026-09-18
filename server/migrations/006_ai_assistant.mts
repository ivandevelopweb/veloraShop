import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_tags TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_priority SMALLINT NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS assistant_rate_limit_events (
      id UUID PRIMARY KEY,
      scope VARCHAR(16) NOT NULL CHECK (scope IN ('client', 'ip')),
      key_hash CHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS assistant_rate_limit_events_key_created_idx
      ON assistant_rate_limit_events(key_hash, created_at DESC);

    CREATE TABLE IF NOT EXISTS assistant_interactions (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL,
      client_hash CHAR(64) NOT NULL,
      ip_hash CHAR(64) NOT NULL,
      user_message VARCHAR(500) NOT NULL,
      detected_intent VARCHAR(48),
      classifier_result JSONB,
      candidate_product_ids INTEGER[] NOT NULL DEFAULT '{}',
      recommended_product_ids INTEGER[] NOT NULL DEFAULT '{}',
      assistant_answer VARCHAR(1500),
      language VARCHAR(12),
      latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
      status VARCHAR(32) NOT NULL,
      feedback VARCHAR(8) CHECK (feedback IN ('like', 'dislike')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS assistant_interactions_created_idx
      ON assistant_interactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS assistant_interactions_intent_idx
      ON assistant_interactions(detected_intent, created_at DESC);
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error('Rolling back the AI assistant migration is intentionally blocked to protect analytics data.')
}
