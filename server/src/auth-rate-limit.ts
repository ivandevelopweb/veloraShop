import { createHash } from 'node:crypto'
import type { Request } from 'express'
import { pool } from './db.js'
import { ApiError } from './errors.js'

const windowSeconds = 15 * 60
const maximumFailures = 10

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

export async function checkAuthRateLimit(request: Request) {
  const keys = requestKeys(request)
  const { rows } = await pool.query<{ attemptCount: number }>(
    `SELECT MAX(attempt_count)::int AS "attemptCount"
     FROM auth_rate_limits
     WHERE key_hash = ANY($1::char(64)[])
       AND window_started_at > NOW() - ($2::int * INTERVAL '1 second')`,
    [[keys.ip, keys.account].filter(Boolean), windowSeconds],
  )
  if ((rows[0]?.attemptCount ?? 0) >= maximumFailures) {
    throw new ApiError(429, 'Забагато спроб. Спробуйте знову трохи пізніше.')
  }
}

export async function recordFailedAuthAttempt(request: Request) {
  const keys = requestKeys(request)
  for (const key of [keys.ip, keys.account].filter(Boolean)) {
    await pool.query(
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
         END`,
      [key, windowSeconds],
    )
  }
}

export async function clearAuthRateLimit(request: Request) {
  const { account } = requestKeys(request)
  if (account) await pool.query('DELETE FROM auth_rate_limits WHERE key_hash = $1', [account])
}
