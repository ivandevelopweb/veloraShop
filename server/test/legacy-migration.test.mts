import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import test, { after, before } from 'node:test'
import { pool } from '../src/db.js'

function migrateToLatest() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
        '-m',
        'server/migrations',
        '--database-url',
        process.env.DATABASE_URL!,
        '--verbose=false',
        'up',
      ],
      { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
    )
    child.once('error', reject)
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('Migration failed'))))
  })
}

const pendingOrderId = randomUUID()
const paidOrderId = randomUUID()

before(async () => {
  const userId = randomUUID()
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash)
     VALUES ($1, 'legacy@example.test', 'Legacy', 'not-used-by-this-migration')`,
    [userId],
  )
  await pool.query(
    `INSERT INTO orders (
      id, code, user_id, status, total_uah, delivery_method, delivery_city, delivery_branch,
      customer_name, customer_phone, customer_email, payment_status, payment_provider,
      payment_order_id, payment_updated_at
    ) VALUES
      ($1, 'VL-2026-LEGACY01', $3, 'new', 100, 'nova_poshta', 'Kyiv', '1', 'Legacy', '1',
       'legacy@example.test', 'pending', 'liqpay', 'legacy-pending', NOW()),
      ($2, 'VL-2026-LEGACY02', $3, 'new', 100, 'nova_poshta', 'Kyiv', '1', 'Legacy', '1',
       'legacy@example.test', 'paid', 'legacy_mock', 'legacy-paid', NOW())`,
    [pendingOrderId, paidOrderId, userId],
  )
})

after(async () => {
  await pool.end()
})

test('005 expires only legacy pending orders without a reservation and leaves paid history intact', async () => {
  await migrateToLatest()
  const { rows } = await pool.query<{
    id: string
    paymentStatus: string
    reason: string | null
  }>(
    `SELECT id, payment_status AS "paymentStatus", payment_reconciliation_reason AS reason
     FROM orders
     WHERE id = ANY($1::uuid[])
     ORDER BY id`,
    [[pendingOrderId, paidOrderId]],
  )
  const pending = rows.find((row) => row.id === pendingOrderId)
  const paid = rows.find((row) => row.id === paidOrderId)
  assert.equal(pending?.paymentStatus, 'expired')
  assert.equal(pending?.reason, 'legacy_pending_without_inventory_reservation')
  assert.equal(paid?.paymentStatus, 'paid')
  assert.equal(paid?.reason, null)

  // A second run has no pending legacy row to mutate and is safe to repeat.
  await migrateToLatest()
  const result = await pool.query<{ paymentStatus: string }>(
    'SELECT payment_status AS "paymentStatus" FROM orders WHERE id = $1',
    [pendingOrderId],
  )
  assert.equal(result.rows[0]?.paymentStatus, 'expired')
})
