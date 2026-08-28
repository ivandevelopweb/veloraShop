import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { config } from './config.js'
import { ApiError } from './errors.js'

const cookieBase = {
  path: '/',
  sameSite: config.cookieSameSite,
  secure: config.cookieSecure,
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function signature(nonce: string) {
  return createHmac('sha256', config.csrfSecret).update(nonce).digest('base64url')
}

export function issueCsrf(response: Response) {
  const nonce = randomBytes(32).toString('base64url')
  const token = `${nonce}.${signature(nonce)}`
  response.cookie(config.csrfCookieName, token, {
    ...cookieBase,
    httpOnly: false,
    maxAge: 60 * 60 * 1000,
  })
  return token
}

export function requireCsrf(request: Request, _response: Response, next: () => void) {
  const cookieToken = request.cookies?.[config.csrfCookieName]
  const headerToken = request.get('x-csrf-token')
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    !safeEqual(cookieToken, headerToken)
  ) {
    throw new ApiError(403, 'Не вдалося перевірити безпечність запиту')
  }
  const [nonce, receivedSignature] = cookieToken.split('.')
  if (!nonce || !receivedSignature || !safeEqual(signature(nonce), receivedSignature)) {
    throw new ApiError(403, 'Не вдалося перевірити безпечність запиту')
  }
  next()
}

export function setSessionCookie(response: Response, token: string) {
  response.cookie(config.sessionCookieName, token, {
    ...cookieBase,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(config.sessionCookieName, { ...cookieBase, httpOnly: true })
}
