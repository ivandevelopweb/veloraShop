import { createServer } from 'node:http'
import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'
import { runPaymentReconciliationWorker } from './payment-reconciliation.js'

async function start() {
  const server = createServer(app)
  let reconciliationTimer: NodeJS.Timeout | undefined
  // A product request can make classifier, selection and final-answer calls.
  // Leave enough time for all three configured provider timeouts to complete.
  server.requestTimeout = 45_000
  server.headersTimeout = 50_000
  server.keepAliveTimeout = 5_000
  const host = config.env === 'production' ? '0.0.0.0' : '127.0.0.1'
  server.listen(config.port, host, () => {
    console.info(`Velora API listens on http://${host}:${config.port}`)
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
