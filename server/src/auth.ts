import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import { pool, newId } from './db.js'
import { ApiError } from './errors.js'
import { config } from './config.js'

export type UserRole = 'customer' | 'admin'

export type AuthRequest = Request & {
  auth?: { userId: string; sessionId: string; role: UserRole }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')",
    [newId(), userId, hashToken(token)],
  )
  return token
}

export async function deleteSession(token?: string) {
  if (!token) return
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
}

export async function authenticate(request: AuthRequest) {
  const token = request.cookies?.[config.sessionCookieName]
  if (typeof token !== 'string' || token.length < 40)
    throw new ApiError(401, 'Потрібна авторизація')
  const { rows } = await pool.query<{ session_id: string; user_id: string; role: UserRole }>(
    `SELECT sessions.id AS session_id, sessions.user_id, users.role
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
    [hashToken(token)],
  )
  const session = rows[0]
  if (!session) throw new ApiError(401, 'Сесія завершилася. Увійдіть знову')
  request.auth = { userId: session.user_id, sessionId: session.session_id, role: session.role }
  return request.auth
}

export async function requireAuth(request: AuthRequest, _response: Response, next: NextFunction) {
  await authenticate(request)
  next()
}

export async function requireAdmin(request: AuthRequest, _response: Response, next: NextFunction) {
  const auth = await authenticate(request)
  if (auth.role !== 'admin') throw new ApiError(403, 'Доступ лише для адміністратора')
  next()
}

export async function getPublicUser(userId: string) {
  const { rows } = await pool.query<{
    id: string
    name: string
    email: string
    role: UserRole
    createdAt: string
  }>('SELECT id, name, email, role, created_at AS "createdAt" FROM users WHERE id = $1', [userId])
  return rows[0]
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}
