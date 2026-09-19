import { Router } from 'express'
import { ZodError } from 'zod'
import { newId, pool } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import {
  AssistantProviderError,
  assistantUnavailableMessage,
} from '../assistant/gemini.js'
import { persistAssistantInteraction } from '../assistant/logging.js'
import {
  assistantFeedbackRequestSchema,
  assistantMessageRequestSchema,
  type AssistantMessageRequest,
} from '../assistant/schemas.js'
import {
  assistantRateLimitMiddleware,
  getAssistantRequestHashes,
  type AssistantRequest,
} from '../assistant/rate-limit.js'
import { processAssistantMessage, type AssistantProcessingResult } from '../assistant/service.js'
import { requireCsrf } from '../security.js'

const assistantRouter = Router()

assistantRouter.post(
  '/message',
  assistantRateLimitMiddleware,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const startedAt = Date.now()
    const interactionId = newId()
    const assistantRequest = request as AssistantRequest
    const hashes = assistantRequest.assistantRateLimit ?? getAssistantRequestHashes(request)
    const rawMessage =
      typeof request.body?.message === 'string' ? request.body.message.trim().slice(0, 500) : ''
    let payload: AssistantMessageRequest | undefined
    let result: AssistantProcessingResult | undefined
    let thrownError: unknown
    let status = 'failed'

    try {
      payload = assistantMessageRequestSchema.parse(request.body)
      result = await processAssistantMessage(payload, assistantRequest.assistantRateLimit?.remainingRequests ?? 0)
      status = result.status
    } catch (error) {
      if (error instanceof AssistantProviderError) {
        status = error.kind === 'invalid_output' ? 'invalid_output' : `provider_${error.kind}`
        console.error('Assistant provider request failed', {
          interactionId,
          kind: error.kind,
          providerStatus: error.providerStatus,
          diagnostic: error.diagnostic,
        })
        thrownError = new ApiError(503, assistantUnavailableMessage)
      } else {
        status = error instanceof ZodError ? 'invalid_request' : 'failed'
        thrownError = error
      }
    } finally {
      try {
        await persistAssistantInteraction({
          id: interactionId,
          sessionId: payload?.sessionId ?? newId(),
          clientHash: hashes.clientHash,
          ipHash: hashes.ipHash,
          userMessage: rawMessage,
          detectedIntent: result?.detectedIntent ?? null,
          classifierResult: result?.classifierResult ?? null,
          candidateProductIds: result?.candidateProductIds ?? [],
          recommendedProductIds: result?.recommendedProductIds ?? [],
          assistantAnswer: result?.answer ?? null,
          language: result?.language ?? null,
          latencyMs: Math.max(0, Date.now() - startedAt),
          status,
        })
      } catch (loggingError) {
        console.error(
          'Unable to persist assistant interaction',
          loggingError instanceof Error ? loggingError.message : 'unknown error',
        )
      }
    }

    if (thrownError) throw thrownError
    if (!result) throw new ApiError(500, 'Внутрішня помилка сервера')
    response.json({
      interactionId,
      answer: result.answer,
      products: result.products,
      remainingRequests: assistantRequest.assistantRateLimit?.remainingRequests ?? 0,
    })
  }),
)

assistantRouter.post(
  '/feedback',
  requireCsrf,
  asyncHandler(async (request, response) => {
    const payload = assistantFeedbackRequestSchema.parse(request.body)
    const { clientHash } = getAssistantRequestHashes(request)
    const updated = await pool.query<{ feedback: 'like' | 'dislike' }>(
      `UPDATE assistant_interactions
       SET feedback = $1
       WHERE id = $2 AND client_hash = $3 AND feedback IS NULL
       RETURNING feedback`,
      [payload.value, payload.interactionId, clientHash],
    )
    if (updated.rows[0]) {
      response.json({ feedback: updated.rows[0].feedback })
      return
    }

    const existing = await pool.query<{ feedback: 'like' | 'dislike' | null }>(
      `SELECT feedback
       FROM assistant_interactions
       WHERE id = $1 AND client_hash = $2`,
      [payload.interactionId, clientHash],
    )
    const feedback = existing.rows[0]?.feedback
    if (!feedback) throw new ApiError(404, 'Відповідь для відгуку не знайдена')
    response.json({ feedback })
  }),
)

export { assistantRouter }
