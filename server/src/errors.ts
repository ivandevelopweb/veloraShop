import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function notFound(_request: Request, response: Response) {
  response.status(404).json({ error: 'Маршрут не знайдено' })
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof ApiError) return response.status(error.status).json({ error: error.message })
  if (error instanceof ZodError)
    return response.status(400).json({ error: 'Перевірте коректність введених даних' })
  if (error instanceof MulterError) {
    return response.status(400).json({ error: 'Файл не відповідає обмеженням завантаження' })
  }
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
    const constraint =
      'constraint' in error && typeof error.constraint === 'string' ? error.constraint : ''
    const message = constraint.includes('users')
      ? 'Цей email вже зареєстрований'
      : 'Запис із таким значенням уже існує'
    return response.status(409).json({ error: message })
  }
  console.error('Unexpected API error', error instanceof Error ? error.message : 'unknown error')
  return response.status(500).json({ error: 'Внутрішня помилка сервера' })
}
