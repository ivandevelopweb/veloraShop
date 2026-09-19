import { z } from 'zod'
import { config } from '../config.js'

export type GeminiJsonSchema = Record<string, unknown>

export type AssistantAiProvider = {
  generateStructured: (
    prompt: string,
    schema: GeminiJsonSchema,
    maxOutputTokens: number,
  ) => Promise<unknown>
}

export const assistantUnavailableMessage =
  'AI-помічник тимчасово недоступний. Спробуйте ще раз пізніше.'

export type AssistantProviderErrorKind =
  | 'unavailable'
  | 'invalid_output'
  | 'auth'
  | 'model_not_found'
  | 'rate_limited'
  | 'request_rejected'

export class AssistantProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: AssistantProviderErrorKind = 'unavailable',
    public readonly providerStatus?: number,
    public readonly diagnostic?: string,
  ) {
    super(message)
    this.name = 'AssistantProviderError'
  }
}

export class AssistantModelOutputError extends AssistantProviderError {
  constructor(diagnostic = 'invalid_structured_output') {
    super('Gemini returned an invalid structured response', 'invalid_output', undefined, diagnostic)
    this.name = 'AssistantModelOutputError'
  }
}

const geminiResponseEnvelopeSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(z.object({ text: z.string().optional() }).passthrough()),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()

const maxProviderAttempts = 2

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function diagnosticExcerpt(value: string) {
  const withoutControlCharacters = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
  return withoutControlCharacters
    .replace(/\s+/g, ' ')
    .replace(/((?:api[-_ ]?key|authorization|token)\s*[:=]\s*)[^,}\s]+/gi, '$1[redacted]')
    .trim()
    .slice(0, 1_000)
}

function parseRetryAfterMs(response: Response) {
  const value = response.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined
}

function isHardQuotaFailure(body: string) {
  return /resource_exhausted|quota|daily|per\s+day|limit\s*:\s*0/i.test(body)
}

function isRetryableHttpStatus(status: number, body: string, retryAfterMs: number | undefined) {
  if ([408, 425].includes(status) || (status >= 500 && status <= 599)) return true
  if (status !== 429 || isHardQuotaFailure(body)) return false
  return retryAfterMs === undefined || retryAfterMs <= 2_000
}

function providerErrorKind(status: number): AssistantProviderErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model_not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'request_rejected'
  return 'unavailable'
}

function backoffMs(attempt: number, retryAfterMs: number | undefined) {
  const requested = retryAfterMs ?? 250 * 2 ** (attempt - 1)
  return Math.min(2_000, Math.max(250, requested))
}

function parseJsonText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    throw new AssistantModelOutputError('invalid_json_text')
  }
}

function parseGeminiResponse(body: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new AssistantModelOutputError('invalid_response_json')
  }

  const payload = geminiResponseEnvelopeSchema.safeParse(parsed)
  if (!payload.success) throw new AssistantModelOutputError('invalid_response_envelope')
  const text = payload.data.candidates[0]?.content.parts
    .map((part) => part.text ?? '')
    .join('')
    .trim()
  if (!text) throw new AssistantModelOutputError('empty_response_text')
  return parseJsonText(text)
}

export class GeminiHttpProvider implements AssistantAiProvider {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly options: {
      apiKey?: string
      model: string
      timeoutMs: number
      fetchImpl?: typeof fetch
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async generateStructured(
    prompt: string,
    schema: GeminiJsonSchema,
    maxOutputTokens: number,
  ): Promise<unknown> {
    if (!this.options.apiKey) {
      console.error('Gemini provider configuration failure', { reason: 'missing_api_key' })
      throw new AssistantProviderError('Gemini API key is not configured')
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.options.model,
    )}:generateContent`

    for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs)

      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'You are a constrained backend component. Follow the supplied instructions exactly. Do not browse the web, call tools, access databases, execute code, or invent facts.',
                },
              ],
            },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseFormat: {
                text: {
                  mimeType: 'APPLICATION_JSON',
                  schema,
                },
              },
              maxOutputTokens,
              temperature: 0.2,
            },
          }),
        })
        const body = await response.text()

        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response)
          const retryable =
            attempt < maxProviderAttempts && isRetryableHttpStatus(response.status, body, retryAfterMs)
          console.error('Gemini provider HTTP failure', {
            model: this.options.model,
            status: response.status,
            attempt,
            retrying: retryable,
            body: diagnosticExcerpt(body),
          })
          if (retryable) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, retryAfterMs)))
            continue
          }
          throw new AssistantProviderError(
            'Gemini request was rejected',
            providerErrorKind(response.status),
            response.status,
            diagnosticExcerpt(body),
          )
        }

        try {
          return parseGeminiResponse(body)
        } catch (error) {
          const outputError =
            error instanceof AssistantModelOutputError ? error : new AssistantModelOutputError()
          const retryable = attempt < maxProviderAttempts
          console.error('Gemini provider response failure', {
            model: this.options.model,
            status: response.status,
            attempt,
            retrying: retryable,
            reason: outputError.diagnostic ?? 'invalid_structured_output',
          })
          if (retryable) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, undefined)))
            continue
          }
          throw outputError
        }
      } catch (error) {
        if (error instanceof AssistantProviderError) throw error
        const timedOut = isAbortError(error)
        const retryable = attempt < maxProviderAttempts
        console.error('Gemini provider network failure', {
          model: this.options.model,
          attempt,
          retrying: retryable,
          timeout: timedOut,
          error: error instanceof Error ? error.message : 'unknown error',
        })
        if (retryable) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, undefined)))
          continue
        }
        throw new AssistantProviderError(
          'Gemini request was unavailable',
          'unavailable',
          undefined,
          timedOut ? 'timeout' : 'network_error',
        )
      } finally {
        clearTimeout(timeout)
      }
    }

    throw new AssistantProviderError('Gemini request was unavailable')
  }
}

const defaultProvider = new GeminiHttpProvider(config.gemini)
let providerOverride: AssistantAiProvider | undefined

export function getAssistantAiProvider() {
  return providerOverride ?? defaultProvider
}

export function setAssistantProviderForTests(provider: AssistantAiProvider | undefined) {
  providerOverride = provider
}
