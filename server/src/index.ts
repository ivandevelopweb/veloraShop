import { createServer } from 'node:http'
import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

async function start() {
  const server = createServer(app)
  server.requestTimeout = 15_000
  server.headersTimeout = 16_000
  server.keepAliveTimeout = 5_000
  const host = config.env === 'production' ? '0.0.0.0' : '127.0.0.1'
  server.listen(config.port, host, () => {
    console.info(`Velora API listens on http://${host}:${config.port}`)
  })

  const shutdown = async () => {
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
