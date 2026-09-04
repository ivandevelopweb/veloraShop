import { createHash } from 'node:crypto'
import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from './db.js'
import { ApiError } from './errors.js'

const windowSeconds = 15 * 60
const maximumFailures = 10
const registrationWindowSeconds = 60 * 60
const maximumRegistrations = 5

function requestKeys(request: Request) {
  const address = request.ip ?? request.socket.remoteAddress ?? 'unknown'
  const email =
    typeof request.body?.email === 'string'
      ? request.body.email.trim().toLocaleLowerCase('en-US').slice(0, 254)
      : ''
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  return {
    ip: hash(`ip:${address}`),
    account: email ? hash(`account:${address}:${email}`) : undefined,
  }
}

/**
 * Atomically consumes one quota slot.  The conditional UPSERT is deliberately
 * the check and increment in one statement: parallel login requests cannot all
 * observe the same pre-increment counter and proceed.
 */
async function reserveQuota(
  client: PoolClient,
  key: string,
  window: number,
  maximum: number,
  message: string,
) {
  const result = await client.query(
    `INSERT INTO auth_rate_limits (key_hash, window_started_at, attempt_count)
     VALUES ($1, NOW(), 1)
     ON CONFLICT (key_hash)
     DO UPDATE SET
       attempt_count = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($2::int * INTERVAL '1 second')
           THEN 1
         ELSE auth_rate_limits.attempt_count + 1
       END,
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at <= NOW() - ($2::int * INTERVAL '1 second')
           THEN NOW()
         ELSE auth_rate_limits.window_started_at
       END
     WHERE auth_rate_limits.window_started_at <= NOW() - ($2::int * INTERVAL '1 second')
        OR auth_rate_limits.attempt_count < $3
     RETURNING attempt_count`,
    [key, window, maximum],
  )
  if (!result.rowCount) throw new ApiError(429, message)
}

export async function reserveLoginAttempt(request: Request) {
  const keys = requestKeys(request)
  const limits = [keys.ip, keys.account].filter((key): key is string => Boolean(key)).sort()
  await withTransaction(async (client) => {
    for (const key of limits) {
      await reserveQuota(
        client,
        key,
        windowSeconds,
        maximumFailures,
        'Забагато спроб. Спробуйте знову трохи пізніше.',
      )
    }
  })
}

export async function clearAuthRateLimit(request: Request) {
  const { account } = requestKeys(request)
  if (account) await pool.query('DELETE FROM auth_rate_limits WHERE key_hash = $1', [account])
}

export async function reserveRegistrationAttempt(request: Request) {
  const { ip } = requestKeys(request)
  const registrationKey = createHash('sha256').update(`registration:${ip}`).digest('hex')
  await withTransaction((client) =>
    reserveQuota(
      client,
      registrationKey,
      registrationWindowSeconds,
      maximumRegistrations,
      'Забагато реєстрацій. Спробуйте знову трохи пізніше.',
    ),
  )
}
