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

export class AssistantProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'unavailable' | 'invalid_output' = 'unavailable',
  ) {
    super(message)
  }
}

export class AssistantModelOutputError extends AssistantProviderError {
  constructor() {
    super('Gemini returned an invalid structured response', 'invalid_output')
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

function parseJsonText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    throw new AssistantModelOutputError()
  }
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
    if (!this.options.apiKey) throw new AssistantProviderError('Gemini API key is not configured')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs)
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.options.model,
    )}:generateContent`

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
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            maxOutputTokens,
            temperature: 0.2,
          },
        }),
      })

      if (!response.ok) throw new AssistantProviderError(`Gemini request failed with ${response.status}`)
      const payload = geminiResponseEnvelopeSchema.safeParse(await response.json())
      if (!payload.success) throw new AssistantModelOutputError()
      const text = payload.data.candidates[0]?.content.parts
        .map((part) => part.text ?? '')
        .join('')
        .trim()
      if (!text) throw new AssistantModelOutputError()
      return parseJsonText(text)
    } catch (error) {
      if (error instanceof AssistantProviderError) throw error
      throw new AssistantProviderError('Gemini request was unavailable')
    } finally {
      clearTimeout(timeout)
    }
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
