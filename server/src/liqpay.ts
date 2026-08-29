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

export function signLiqpayData(data: string, privateKey: string) {
  return createHash('sha1').update(`${privateKey}${data}${privateKey}`, 'utf8').digest('base64')
}

export function sameLiqpaySignature(data: string, signature: string, privateKey: string) {
  const expected = Buffer.from(signLiqpayData(data, privateKey))
  const received = Buffer.from(signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function createLiqpayCheckout(payload: LiqpayCheckoutPayload, privateKey: string) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return { data, signature: signLiqpayData(data, privateKey) }
}
