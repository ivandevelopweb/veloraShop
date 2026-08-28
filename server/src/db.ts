import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { config } from './config.js'

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 20_000,
})

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const newId = () => randomUUID()
