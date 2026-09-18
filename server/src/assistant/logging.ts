import { pool } from '../db.js'

export type AssistantInteractionLog = {
  id: string
  sessionId: string
  clientHash: string
  ipHash: string
  userMessage: string
  detectedIntent: string | null
  classifierResult: unknown | null
  candidateProductIds: number[]
  recommendedProductIds: number[]
  assistantAnswer: string | null
  language: string | null
  latencyMs: number
  status: string
}

export async function persistAssistantInteraction(interaction: AssistantInteractionLog) {
  await pool.query(
    `INSERT INTO assistant_interactions (
       id, session_id, client_hash, ip_hash, user_message, detected_intent,
       classifier_result, candidate_product_ids, recommended_product_ids,
       assistant_answer, language, latency_ms, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
    [
      interaction.id,
      interaction.sessionId,
      interaction.clientHash,
      interaction.ipHash,
      interaction.userMessage,
      interaction.detectedIntent,
      interaction.classifierResult === null ? null : JSON.stringify(interaction.classifierResult),
      interaction.candidateProductIds,
      interaction.recommendedProductIds,
      interaction.assistantAnswer,
      interaction.language,
      interaction.latencyMs,
      interaction.status,
    ],
  )
}
