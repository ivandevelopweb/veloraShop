import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const localClientOrigins = 'http://localhost:5173,http://127.0.0.1:5173'

const rawConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    CLIENT_ORIGINS: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    CSRF_SECRET: z.string().min(32).optional(),
    SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    COOKIE_SAME_SITE: z.enum(['lax', 'none']).optional(),
    ADMIN_EMAIL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().toLowerCase().email().optional(),
    ),
    ADMIN_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(12).max(72).optional(),
    ),
    CLOUDINARY_CLOUD_NAME: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    CLOUDINARY_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    CLOUDINARY_API_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
  })
  .refine(
    (value) => Boolean(value.ADMIN_EMAIL) === Boolean(value.ADMIN_PASSWORD),
    'ADMIN_EMAIL and ADMIN_PASSWORD must be set together',
  )
  .refine((value) => {
    const credentials = [
      value.CLOUDINARY_CLOUD_NAME,
      value.CLOUDINARY_API_KEY,
      value.CLOUDINARY_API_SECRET,
    ]
    return credentials.every(Boolean) || credentials.every((credential) => !credential)
  }, 'All Cloudinary credentials must be set together')
  .parse(process.env)

const clientOrigins = (rawConfig.CLIENT_ORIGINS ?? localClientOrigins)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (rawConfig.NODE_ENV === 'production') {
  if (!rawConfig.CSRF_SECRET) throw new Error('CSRF_SECRET must be set in production')
  if (!rawConfig.CLIENT_ORIGINS)
    throw new Error('CLIENT_ORIGINS must be set explicitly in production')
  if (rawConfig.SESSION_COOKIE_SECURE === 'false')
    throw new Error('SESSION_COOKIE_SECURE cannot be false in production')
  if ((rawConfig.COOKIE_SAME_SITE ?? 'none') !== 'none')
    throw new Error('COOKIE_SAME_SITE must be none for the separate production frontend and API')
  if (
    clientOrigins.some((origin) => {
      try {
        const url = new URL(origin)
        return url.protocol !== 'https:' || url.origin !== origin
      } catch {
        return true
      }
    })
  ) {
    throw new Error('CLIENT_ORIGINS must contain exact HTTPS origins in production')
  }
}

export const config = {
  env: rawConfig.NODE_ENV,
  port: rawConfig.PORT,
  databaseUrl: rawConfig.DATABASE_URL,
  clientOrigins,
  csrfSecret: rawConfig.CSRF_SECRET ?? randomBytes(32).toString('base64url'),
  cookieSecure: rawConfig.SESSION_COOKIE_SECURE
    ? rawConfig.SESSION_COOKIE_SECURE === 'true'
    : rawConfig.NODE_ENV === 'production',
  cookieSameSite: rawConfig.COOKIE_SAME_SITE ?? (rawConfig.NODE_ENV === 'production' ? 'none' : 'lax'),
  sessionCookieName:
    rawConfig.NODE_ENV === 'production' ? '__Host-velora-session' : 'velora_session',
  csrfCookieName: rawConfig.NODE_ENV === 'production' ? '__Host-velora-csrf' : 'velora_csrf',
  adminEmail: rawConfig.ADMIN_EMAIL,
  adminPassword: rawConfig.ADMIN_PASSWORD,
  cloudinary:
    rawConfig.CLOUDINARY_CLOUD_NAME &&
    rawConfig.CLOUDINARY_API_KEY &&
    rawConfig.CLOUDINARY_API_SECRET
      ? {
          cloudName: rawConfig.CLOUDINARY_CLOUD_NAME,
          apiKey: rawConfig.CLOUDINARY_API_KEY,
          apiSecret: rawConfig.CLOUDINARY_API_SECRET,
        }
      : undefined,
}
