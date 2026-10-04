import { Router, type RequestHandler } from 'express'
import { authenticate, requireAdmin, type AuthRequest } from '../auth.js'
import { withTransaction } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import { requireCsrf } from '../security.js'
import {
  adminCommentInputSchema,
  adminCommentsQuerySchema,
  adminRatingResetSchema,
  commentParamsSchema,
  customerCommentInputSchema,
  customerCommentUpdateSchema,
  customerRatingInputSchema,
  productIdParamsSchema,
  publicPageQuerySchema,
} from '../reviews/schemas.js'
import {
  consumeCustomerReviewAttempt,
  createAdminComment,
  createCustomerComment,
  deleteAdminComment,
  deleteCustomerComment,
  getAdminComments,
  getMyCommunity,
  getPublicCommunity,
  getPublicRatings,
  putCustomerRating,
  resetProductRating,
  updateCustomerComment,
} from '../reviews/service.js'

const reviewsRouter = Router()

const authenticated: RequestHandler = asyncHandler(async (request, _response, next) => {
  await authenticate(request as AuthRequest)
  next()
})

const requireCustomerMutationQuota: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    const auth = (request as AuthRequest).auth
    if (!auth) throw new ApiError(401, 'Потрібна авторизація')
    await consumeCustomerReviewAttempt(auth.userId)
    next()
  },
)

reviewsRouter.get(
  '/products/:id/community',
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const page = publicPageQuerySchema.parse(request.query)
    response.json(await getPublicCommunity(id, page))
  }),
)

reviewsRouter.get(
  '/products/:id/ratings',
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const page = publicPageQuerySchema.parse(request.query)
    response.json(await getPublicRatings(id, page))
  }),
)

reviewsRouter.get(
  '/products/:id/community/me',
  authenticated,
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const auth = (request as AuthRequest).auth!
    response.json(await getMyCommunity(id, auth.userId))
  }),
)

reviewsRouter.post(
  '/products/:id/ratings',
  authenticated,
  requireCsrf,
  requireCustomerMutationQuota,
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const input = customerRatingInputSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    response.json(
      await withTransaction((client) =>
        putCustomerRating(client, id, auth.userId, input.stars, input.expectedEpoch),
      ),
    )
  }),
)

reviewsRouter.post(
  '/products/:id/comments',
  authenticated,
  requireCsrf,
  requireCustomerMutationQuota,
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const input = customerCommentInputSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    const result = await withTransaction((client) =>
      createCustomerComment(client, id, auth.userId, input),
    )
    response.status(result.replayed ? 200 : 201).json(result)
  }),
)

reviewsRouter.patch(
  '/products/:id/comments/:commentId',
  authenticated,
  requireCsrf,
  requireCustomerMutationQuota,
  asyncHandler(async (request, response) => {
    const { id, commentId } = commentParamsSchema.parse(request.params)
    const { message } = customerCommentUpdateSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    response.json(
      await withTransaction((client) =>
        updateCustomerComment(client, id, commentId, auth.userId, message),
      ),
    )
  }),
)

reviewsRouter.delete(
  '/products/:id/comments/:commentId',
  authenticated,
  requireCsrf,
  requireCustomerMutationQuota,
  asyncHandler(async (request, response) => {
    const { id, commentId } = commentParamsSchema.parse(request.params)
    const auth = (request as AuthRequest).auth!
    await withTransaction((client) => deleteCustomerComment(client, id, commentId, auth.userId))
    response.status(204).end()
  }),
)

reviewsRouter.get(
  '/admin/products/:id/comments',
  authenticated,
  asyncHandler(async (request, response, next) => {
    await requireAdmin(request as AuthRequest, response, next)
  }),
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const query = adminCommentsQuerySchema.parse(request.query)
    response.json(await getAdminComments(id, query))
  }),
)

reviewsRouter.post(
  '/admin/products/:id/comments',
  authenticated,
  requireCsrf,
  asyncHandler(async (request, response, next) => {
    await requireAdmin(request as AuthRequest, response, next)
  }),
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const input = adminCommentInputSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    const result = await withTransaction((client) => createAdminComment(client, id, auth.userId, input))
    response.status(result.replayed ? 200 : 201).json(result)
  }),
)

reviewsRouter.delete(
  '/admin/products/:id/comments/:commentId',
  authenticated,
  requireCsrf,
  asyncHandler(async (request, response, next) => {
    await requireAdmin(request as AuthRequest, response, next)
  }),
  asyncHandler(async (request, response) => {
    const { id, commentId } = commentParamsSchema.parse(request.params)
    const auth = (request as AuthRequest).auth!
    await withTransaction((client) => deleteAdminComment(client, id, commentId, auth.userId))
    response.status(204).end()
  }),
)

reviewsRouter.post(
  '/admin/products/:id/rating-reset',
  authenticated,
  requireCsrf,
  asyncHandler(async (request, response, next) => {
    await requireAdmin(request as AuthRequest, response, next)
  }),
  asyncHandler(async (request, response) => {
    const { id } = productIdParamsSchema.parse(request.params)
    const input = adminRatingResetSchema.parse(request.body)
    const auth = (request as AuthRequest).auth!
    response.json(
      await withTransaction((client) => resetProductRating(client, id, auth.userId, input)),
    )
  }),
)

export { reviewsRouter }
