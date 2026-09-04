import { createHash, timingSafeEqual } from 'node:crypto'

export type LiqpayCheckoutPayload = {
  version: 3
  public_key: string
  action: 'pay'
  amount: number
  currency: 'UAH'
  description: string
  order_id: string
  result_url: string
  server_url: string
  expired_date: string
  language: 'uk'
  sandbox?: 1
}

export type LiqpayPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type LiqpayStatusResult = {
  orderId: string
  publicKey: string
  amount: number
  currency: 'UAH'
  status: string
  paymentId?: string
}

function sign(data: string, privateKey: string, algorithm: 'sha1' | 'sha3-256') {
  return createHash(algorithm).update(`${privateKey}${data}${privateKey}`, 'utf8').digest('base64')
}

export function signLiqpayData(data: string, privateKey: string) {
  return sign(data, privateKey, 'sha1')
}

function sameSignature(expectedSignature: string, signature: string) {
  const expected = Buffer.from(expectedSignature)
  const received = Buffer.from(signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function sameLiqpayCheckoutSignature(data: string, signature: string, privateKey: string) {
  return sameSignature(signLiqpayData(data, privateKey), signature)
}

export function sameLiqpayCallbackSignature(data: string, signature: string, privateKey: string) {
  // LiqPay's current callback prose specifies SHA3-256, while its executable
  // examples and Checkout signature use SHA-1. Both variants still require the
  // configured private key, so accepting either preserves verification and lets
  // us safely interoperate with both provider implementations.
  const matchesSha1 = sameSignature(sign(data, privateKey, 'sha1'), signature)
  const matchesSha3 = sameSignature(sign(data, privateKey, 'sha3-256'), signature)
  return matchesSha1 || matchesSha3
}

export function mapLiqpayPaymentStatus(status: string, sandbox: boolean): LiqpayPaymentStatus {
  if (status === 'success' || (sandbox && status === 'sandbox')) return 'paid'
  if (status === 'reversed') return 'cancelled'
  if (status === 'error' || status === 'failure') return 'failed'
  return 'pending'
}

export function createLiqpayCheckout(payload: LiqpayCheckoutPayload, privateKey: string) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return { data, signature: signLiqpayData(data, privateKey) }
}

/**
 * The endpoint is fixed to LiqPay's documented API host.  This is a signed,
 * server-side reconciliation lookup; callers still treat it as an observation
 * and serialise the resulting state transition in PostgreSQL.
 */
export async function getLiqpayPaymentStatus(
  credentials: { publicKey: string; privateKey: string },
  paymentOrderId: string,
): Promise<LiqpayStatusResult> {
  const data = Buffer.from(
    JSON.stringify({ version: 3, public_key: credentials.publicKey, action: 'status', order_id: paymentOrderId }),
    'utf8',
  ).toString('base64')
  const response = await fetch('https://www.liqpay.ua/api/request', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data, signature: signLiqpayData(data, credentials.privateKey) }),
    signal: AbortSignal.timeout(7_000),
  })
  if (!response.ok) throw new Error(`LiqPay status request failed with ${response.status}`)
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > 65_536) throw new Error('LiqPay status response is too large')
  const text = await response.text()
  if (text.length > 65_536) throw new Error('LiqPay status response is too large')

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('LiqPay status response is not JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LiqPay status response has an invalid shape')
  }
  const raw = value as Record<string, unknown>
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount)
  const paymentId = raw.payment_id
  if (
    raw.public_key !== credentials.publicKey ||
    raw.order_id !== paymentOrderId ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    raw.currency !== 'UAH' ||
    typeof raw.status !== 'string' ||
    raw.status.length > 64 ||
    (paymentId !== undefined && typeof paymentId !== 'string' && typeof paymentId !== 'number')
  ) {
    throw new Error('LiqPay status response does not match the requested payment')
  }
  return {
    orderId: paymentOrderId,
    publicKey: credentials.publicKey,
    amount,
    currency: 'UAH',
    status: raw.status,
    ...(paymentId === undefined ? {} : { paymentId: String(paymentId) }),
  }
}
