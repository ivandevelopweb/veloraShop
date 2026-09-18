import { z } from 'zod'

export const assistantLanguages = ['uk', 'ru', 'en', 'mixed'] as const
export const assistantIntents = [
  'product_search',
  'product_recommendation',
  'product_comparison',
  'product_details',
  'product_usage',
  'ingredient_question',
  'store_info',
  'delivery',
  'payment',
  'returns',
  'contacts',
  'promotions',
  'out_of_scope',
] as const

const userHistoryEntrySchema = z
  .object({ role: z.literal('user'), content: z.string().trim().min(1).max(500) })
  .strict()

const assistantHistoryEntrySchema = z
  .object({ role: z.literal('assistant'), content: z.string().trim().min(1).max(1500) })
  .strict()

export const assistantHistorySchema = z
  .array(z.discriminatedUnion('role', [userHistoryEntrySchema, assistantHistoryEntrySchema]))
  .max(24)

export const assistantMessageRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    history: assistantHistorySchema,
    clientId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
  })
  .strict()

const attributeFilterSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    value: z.union([
      z.string().trim().min(1).max(160),
      z.number().finite().min(-1_000_000).max(1_000_000),
      z.boolean(),
    ]),
  })
  .strict()

export const assistantClassifierSchema = z
  .object({
    intent: z.enum(assistantIntents),
    filters: z
      .object({
        minPrice: z.number().int().min(0).max(1_000_000).nullable(),
        maxPrice: z.number().int().min(0).max(1_000_000).nullable(),
        categorySlug: z.string().trim().max(100).nullable(),
        attributes: z.array(attributeFilterSchema).max(8),
        availability: z.enum(['available', 'any']),
      })
      .strict(),
    preferences: z.array(z.string().trim().min(1).max(160)).max(12),
    mentionedProducts: z.array(z.string().trim().min(1).max(160)).max(8),
    topic: z.string().trim().min(1).max(160),
    language: z.enum(assistantLanguages),
    requiresExactStock: z.boolean(),
    externalCurrentInfo: z.boolean(),
  })
  .strict()

export const assistantSelectionSchema = z
  .object({ productIds: z.array(z.number().int().positive()).max(6) })
  .strict()

export const assistantFinalAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(1500),
    productIds: z.array(z.number().int().positive()).max(6),
  })
  .strict()

export const assistantFeedbackRequestSchema = z
  .object({
    interactionId: z.string().uuid(),
    clientId: z.string().uuid(),
    value: z.enum(['like', 'dislike']),
  })
  .strict()

export type AssistantMessageRequest = z.infer<typeof assistantMessageRequestSchema>
export type AssistantClassifier = z.infer<typeof assistantClassifierSchema>
export type AssistantSelection = z.infer<typeof assistantSelectionSchema>
export type AssistantFinalAnswer = z.infer<typeof assistantFinalAnswerSchema>
export type AssistantFeedbackRequest = z.infer<typeof assistantFeedbackRequestSchema>
export type AssistantLanguage = (typeof assistantLanguages)[number]
export type AssistantIntent = (typeof assistantIntents)[number]
