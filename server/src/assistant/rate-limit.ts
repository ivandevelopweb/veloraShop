import { createHmac } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { newId, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const windowHours = 1
const clientLimit = 50
const ipLimit = 150
export const assistantRateLimitMessage =
  'Слишком много запросов. Подождите некоторое время и попробуйте снова.'

const clientIdSchema = z.string().uuid()

export type AssistantRateLimitState = {
  clientHash: string
  ipHash: string
  remainingRequests: number
}

export type AssistantRequest = Request & {
  assistantRateLimit?: AssistantRateLimitState
}

function hashIdentifier(scope: string, value: string) {
  return createHmac('sha256', config.csrfSecret).update(`${scope}:${value}`).digest('hex')
}

function requestIdentity(request: Request) {
  const address = request.ip ?? request.socket.remoteAddress ?? 'unknown'
  const rawClientId = typeof request.body?.clientId === 'string' ? request.body.clientId : ''
  const parsedClientId = clientIdSchema.safeParse(rawClientId)
  return {
    ipHash: hashIdentifier('ip', address),
    clientHash: hashIdentifier('client', rawClientId || 'missing'),
    clientKey: parsedClientId.success ? hashIdentifier('client', parsedClientId.data) : undefined,
  }
}

async function reserveQuota(
  request: AssistantRequest,
): Promise<AssistantRateLimitState> {
  const identity = requestIdentity(request)
  const limits = [
    { scope: 'ip' as const, keyHash: identity.ipHash, maximum: ipLimit },
    ...(identity.clientKey
      ? [{ scope: 'client' as const, keyHash: identity.clientKey, maximum: clientLimit }]
      : []),
  ].sort((left, right) => left.keyHash.localeCompare(right.keyHash))

  const result = await withTransaction(async (client) => {
    for (const limit of limits) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [limit.keyHash])
    }

    const keyHashes = limits.map((limit) => limit.keyHash)
    await client.query(
      `DELETE FROM assistant_rate_limit_events
       WHERE key_hash = ANY($1::char(64)[])
         AND created_at <= NOW() - ($2::int * INTERVAL '1 hour')`,
      [keyHashes, windowHours],
    )

    for (const limit of limits) {
      await client.query(
        `INSERT INTO assistant_rate_limit_events (id, scope, key_hash)
         VALUES ($1, $2, $3)`,
        [newId(), limit.scope, limit.keyHash],
      )
    }

    const counts = await client.query<{ keyHash: string; count: number }>(
      `SELECT key_hash AS "keyHash", COUNT(*)::int AS count
       FROM assistant_rate_limit_events
       WHERE key_hash = ANY($1::char(64)[])
         AND created_at > NOW() - ($2::int * INTERVAL '1 hour')
       GROUP BY key_hash`,
      [keyHashes, windowHours],
    )
    const countByKey = new Map(counts.rows.map((row) => [row.keyHash.trim(), row.count]))
    const exceeded = limits.some((limit) => (countByKey.get(limit.keyHash) ?? 0) > limit.maximum)
    const remaining = Math.min(
      ...limits.map((limit) => Math.max(0, limit.maximum - (countByKey.get(limit.keyHash) ?? 0))),
    )
    return { exceeded, remaining }
  })

  if (result.exceeded) throw new ApiError(429, assistantRateLimitMessage)
  return {
    clientHash: identity.clientHash,
    ipHash: identity.ipHash,
    remainingRequests: result.remaining,
  }
}

export const assistantRateLimitMiddleware: RequestHandler = (
  request: Request,
  _response: Response,
  next: NextFunction,
) => {
  void reserveQuota(request as AssistantRequest)
    .then((state) => {
      ;(request as AssistantRequest).assistantRateLimit = state
      next()
    })
    .catch(next)
}

export async function getAssistantRateLimitState(request: AssistantRequest) {
  return reserveQuota(request)
}

export function getAssistantRequestHashes(request: Request) {
  const identity = requestIdentity(request)
  return { clientHash: identity.clientHash, ipHash: identity.ipHash }
}
