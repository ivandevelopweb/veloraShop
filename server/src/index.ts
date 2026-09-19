import { createServer } from 'node:http'
import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'
import { runPaymentReconciliationWorker } from './payment-reconciliation.js'

async function start() {
  // Fail during startup when the configured database is unavailable. Without
  // this check the HTTP server can appear healthy while every database-backed
  // request fails later with an opaque 500/503 response.
  let databaseReady = false
  let databaseError: unknown
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await pool.query('SELECT 1')
      databaseReady = true
      break
    } catch (error) {
      databaseError = error
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (!databaseReady) throw databaseError ?? new Error('Database connection failed')

  const server = createServer(app)
  let reconciliationTimer: NodeJS.Timeout | undefined
  // A product request can make three provider calls, each with one bounded
  // retry. Keep the HTTP budget aligned with that deliberate retry budget.
  const assistantRequestBudget = config.gemini.timeoutMs * 2 * 3 + 5_000
  server.requestTimeout = Math.max(45_000, assistantRequestBudget)
  server.headersTimeout = server.requestTimeout + 5_000
  server.keepAliveTimeout = 5_000
  const host = config.env === 'production' ? '0.0.0.0' : '127.0.0.1'
  server.listen(config.port, host, () => {
    console.info(`Velora API listens on http://${host}:${config.port}`)
    console.info('Velora database connection verified')
  })
  void runPaymentReconciliationWorker().catch((error: unknown) => {
    console.error(
      'Initial payment reconciliation failed',
      error instanceof Error ? error.message : 'unknown',
    )
  })
  reconciliationTimer = setInterval(() => {
    void runPaymentReconciliationWorker().catch((error: unknown) => {
      console.error(
        'Payment reconciliation failed',
        error instanceof Error ? error.message : 'unknown',
      )
    })
  }, 60_000)
  reconciliationTimer.unref()

  const shutdown = async () => {
    if (reconciliationTimer) clearInterval(reconciliationTimer)
    server.close(() => undefined)
    await pool.end()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

start().catch((error: unknown) => {
  console.error(
    'Unable to start Velora API',
    error instanceof Error ? error.message : 'unknown error',
  )
  process.exit(1)
})
