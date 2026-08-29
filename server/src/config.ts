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
    LIQPAY_PUBLIC_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    LIQPAY_PRIVATE_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    LIQPAY_SANDBOX: z.enum(['true', 'false']).optional(),
    LIQPAY_CALLBACK_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().max(510).optional(),
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
  .refine(
    (value) => Boolean(value.LIQPAY_PUBLIC_KEY) === Boolean(value.LIQPAY_PRIVATE_KEY),
    'LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY must be set together',
  )
  .refine(
    (value) => !value.LIQPAY_PUBLIC_KEY || value.LIQPAY_SANDBOX === 'true',
    'LIQPAY_SANDBOX must be true whenever LiqPay credentials are configured',
  )
  .refine(
    (value) =>
      !value.LIQPAY_PUBLIC_KEY ||
      value.LIQPAY_SANDBOX !== 'true' ||
      value.LIQPAY_PUBLIC_KEY.startsWith('sandbox_'),
    'Sandbox LiqPay keys must use the sandbox_ public key',
  )
  .refine((value) => {
    if (!value.LIQPAY_CALLBACK_URL) return true
    try {
      return new URL(value.LIQPAY_CALLBACK_URL).protocol === 'https:'
    } catch {
      return false
    }
  }, 'LIQPAY_CALLBACK_URL must use HTTPS')
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
  if (!rawConfig.LIQPAY_PUBLIC_KEY || !rawConfig.LIQPAY_PRIVATE_KEY) {
    throw new Error('LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY must be set in production')
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
  liqpay:
    rawConfig.LIQPAY_PUBLIC_KEY && rawConfig.LIQPAY_PRIVATE_KEY
      ? {
          publicKey: rawConfig.LIQPAY_PUBLIC_KEY,
          privateKey: rawConfig.LIQPAY_PRIVATE_KEY,
          sandbox: rawConfig.LIQPAY_SANDBOX === 'true',
          resultUrl: new URL('/payment/result', clientOrigins[0]).toString(),
          callbackUrl:
            rawConfig.LIQPAY_CALLBACK_URL ??
            'https://velora-api-cg44.onrender.com/api/payments/liqpay/callback',
        }
      : undefined,
}
