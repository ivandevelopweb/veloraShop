import type { MigrationBuilder } from 'node-pg-migrate'

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email VARCHAR(254) UNIQUE NOT NULL,
      name VARCHAR(80) NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash CHAR(64) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      key_hash CHAR(64) PRIMARY KEY,
      window_started_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      price_uah INTEGER NOT NULL CHECK (price_uah >= 0),
      is_available BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
      PRIMARY KEY (user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id),
      status VARCHAR(32) NOT NULL,
      total_uah INTEGER NOT NULL CHECK (total_uah >= 0),
      delivery_method VARCHAR(32) NOT NULL,
      delivery_city VARCHAR(80) NOT NULL,
      delivery_branch VARCHAR(120) NOT NULL,
      customer_name VARCHAR(161) NOT NULL,
      customer_phone VARCHAR(32) NOT NULL,
      customer_email VARCHAR(254) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(120) NOT NULL,
      price_uah INTEGER NOT NULL CHECK (price_uah >= 0),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
      PRIMARY KEY (order_id, product_id)
    );
  `)
}

export async function down(_pgm: MigrationBuilder): Promise<void> {
  throw new Error(
    'Rolling back the initial Velora schema is intentionally blocked to protect data.',
  )
}
