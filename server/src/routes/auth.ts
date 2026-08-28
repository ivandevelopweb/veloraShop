import { Router } from 'express'
import { z } from 'zod'
import {
  checkAuthRateLimit,
  clearAuthRateLimit,
  recordFailedAuthAttempt,
} from '../auth-rate-limit.js'
import {
  createSession,
  deleteSession,
  authenticate,
  getPublicUser,
  hashPassword,
  type AuthRequest,
  verifyPassword,
} from '../auth.js'
import { config } from '../config.js'
import { pool, newId } from '../db.js'
import { ApiError } from '../errors.js'
import { asyncHandler } from '../http.js'
import { clearSessionCookie, requireCsrf, setSessionCookie } from '../security.js'

const authRouter = Router()

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(12, 'Пароль має містити щонайменше 12 символів')
    .max(72)
    .regex(/[a-zA-Zа-яА-ЯіІїЇєЄ]/, 'Пароль має містити літеру')
    .regex(/\d/, 'Пароль має містити цифру'),
})

const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(80),
})

const authLimiter = asyncHandler(async (request, _response, next) => {
  await checkAuthRateLimit(request)
  next()
})

async function replyWithSession(response: Parameters<typeof setSessionCookie>[0], userId: string) {
  const session = await createSession(userId)
  setSessionCookie(response, session)
  const user = await getPublicUser(userId)
  if (!user) throw new ApiError(500, 'Не вдалося створити профіль')
  response.status(201).json({ user })
}

authRouter.post(
  '/register',
  authLimiter,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const payload = registrationSchema.parse(request.body)
    const passwordHash = await hashPassword(payload.password)
    const userId = newId()

    try {
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, payload.name, payload.email, passwordHash],
      )
    } catch (error) {
      await recordFailedAuthAttempt(request)
      throw error
    }
    await clearAuthRateLimit(request)
    await replyWithSession(response, userId)
  }),
)

authRouter.post(
  '/login',
  authLimiter,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const payload = credentialsSchema.parse(request.body)
    const { rows } = await pool.query<{ id: string; passwordHash: string }>(
      'SELECT id, password_hash AS "passwordHash" FROM users WHERE email = $1',
      [payload.email],
    )
    const account = rows[0]
    const passwordMatches = account
      ? await verifyPassword(payload.password, account.passwordHash)
      : false

    if (!account || !passwordMatches) {
      await recordFailedAuthAttempt(request)
      throw new ApiError(401, 'Неправильний email або пароль')
    }

    await clearAuthRateLimit(request)
    await replyWithSession(response, account.id)
  }),
)

authRouter.get(
  '/me',
  asyncHandler(async (request, response) => {
    const auth = await authenticate(request as AuthRequest)
    const user = await getPublicUser(auth.userId)
    if (!user) throw new ApiError(401, 'Сесія завершилася. Увійдіть знову')
    response.json({ user })
  }),
)

authRouter.post(
  '/logout',
  requireCsrf,
  asyncHandler(async (request, response) => {
    await authenticate(request as AuthRequest)
    await deleteSession(request.cookies?.[config.sessionCookieName])
    clearSessionCookie(response)
    response.status(204).end()
  }),
)

export { authRouter }
