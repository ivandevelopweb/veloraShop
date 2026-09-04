import { config } from './config.js'
import { withTransaction } from './db.js'
import { getLiqpayPaymentStatus, mapLiqpayPaymentStatus } from './liqpay.js'
import {
  expiredPendingPaymentCandidates,
  lockUserPaymentState,
  markReconciliationAfterGrace,
  processAuthoritativePaymentEvent,
  type ProviderPaymentEvent,
} from './payments.js'

export type ExpiredPaymentCandidate = {
  paymentOrderId: string
  userId: string
}

export type PaymentStatusResolver = (
  candidate: ExpiredPaymentCandidate,
) => Promise<ProviderPaymentEvent>

async function liqpayStatusResolver(
  candidate: ExpiredPaymentCandidate,
): Promise<ProviderPaymentEvent> {
  if (!config.liqpay) throw new Error('LiqPay is not configured')
  const result = await getLiqpayPaymentStatus(config.liqpay, candidate.paymentOrderId)
  return {
    paymentOrderId: result.orderId,
    amount: result.amount,
    currency: result.currency,
    status: mapLiqpayPaymentStatus(result.status, config.liqpay.sandbox),
    paymentId: result.paymentId,
    source: 'reconciliation',
  }
}

/**
 * Reconcile locally expired reservations. A local clock is never used as a
 * reason to release inventory blindly: a provider lookup must report a final
 * failure/cancellation first. Unknown/non-final outcomes retain the
 * reservation through a bounded grace period, then move to explicit manual
 * reconciliation rather than silently returning stock.
 */
export async function reconcileExpiredReservations(
  resolver: PaymentStatusResolver = liqpayStatusResolver,
  limit = 20,
) {
  const rows = await expiredPendingPaymentCandidates(limit)
  const candidates: ExpiredPaymentCandidate[] = rows.map((row) => ({
    paymentOrderId: row.paymentOrderId,
    userId: row.userId,
  }))

  for (const candidate of candidates) {
    try {
      const event = await resolver(candidate)
      if (event.paymentOrderId !== candidate.paymentOrderId) {
        throw new Error('Payment status resolver returned a different order')
      }
      if (event.status === 'pending') {
        await withTransaction(async (client) => {
          await lockUserPaymentState(client, candidate.userId)
          await markReconciliationAfterGrace(client, candidate.paymentOrderId, 'provider_non_final')
        })
        continue
      }
      await withTransaction(async (client) => {
        await lockUserPaymentState(client, candidate.userId)
        await processAuthoritativePaymentEvent(client, event)
      })
    } catch {
      await withTransaction(async (client) => {
        await lockUserPaymentState(client, candidate.userId)
        await markReconciliationAfterGrace(
          client,
          candidate.paymentOrderId,
          'provider_status_unavailable_or_invalid',
        )
      })
    }
  }
  return { scanned: candidates.length }
}

let reconciliationInFlight = false

export async function runPaymentReconciliationWorker() {
  if (reconciliationInFlight) return { scanned: 0, skipped: true }
  reconciliationInFlight = true
  try {
    return await reconcileExpiredReservations()
  } finally {
    reconciliationInFlight = false
  }
}
