import { z } from 'zod'

const idSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
const uuidSchema = z.string().uuid()
const maxPostgresBigint = 9_223_372_036_854_775_807n
const versionSchema = z
  .string()
  .max(19)
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => BigInt(value) <= maxPostgresBigint)

export const productIdParamsSchema = z.object({ id: idSchema }).strict()

export const commentParamsSchema = z
  .object({ id: idSchema, commentId: uuidSchema })
  .strict()

export const publicPageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict()

export const adminCommentsQuerySchema = publicPageQuerySchema.extend({
  filter: z.enum(['active', 'deleted', 'all']).default('active'),
})

export const customerRatingInputSchema = z
  .object({
    stars: z.number().int().min(1).max(5),
    expectedEpoch: versionSchema,
  })
  .strict()

export const customerCommentInputSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    clientRequestId: uuidSchema,
  })
  .strict()

export const customerCommentUpdateSchema = z
  .object({ message: z.string().trim().min(1).max(2000) })
  .strict()

export const adminCommentInputSchema = z
  .object({
    nickname: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000),
    clientRequestId: uuidSchema,
  })
  .strict()

export const initialAdminCommentSchema = adminCommentInputSchema

const ratingSchema = z
  .number()
  .finite()
  .min(0)
  .max(5)
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-8)

export const adminRatingResetSchema = z
  .object({
    rating: ratingSchema,
    count: z.number().int().min(0).max(1_000_000),
    expectedEpoch: versionSchema,
    expectedRevision: versionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.count > 0 && value.rating < 1) {
      context.addIssue({
        code: 'custom',
        path: ['rating'],
        message: 'За наявності оцінок середній рейтинг має бути від 1 до 5',
      })
    }
  })

export const adminBaseRatingSchema = z
  .object({
    rating: ratingSchema,
    reviewCount: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reviewCount > 0 && value.rating < 1) {
      context.addIssue({
        code: 'custom',
        path: ['rating'],
        message: 'За наявності оцінок середній рейтинг має бути від 1 до 5',
      })
    }
  })

export const initialCommentsSchema = z
  .array(initialAdminCommentSchema)
  .max(20)
  .superRefine((comments, context) => {
    const ids = new Set<string>()
    comments.forEach((comment, index) => {
      if (ids.has(comment.clientRequestId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'clientRequestId'],
          message: 'Ідентифікатор повторюється в списку чернеток',
        })
      }
      ids.add(comment.clientRequestId)
    })
  })
