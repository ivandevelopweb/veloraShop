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
  language: 'uk'
  sandbox?: 1
}

export type LiqpayPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

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
