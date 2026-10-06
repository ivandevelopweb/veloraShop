import { getStoreContext } from './context.js'
import {
  AssistantProviderError,
  AssistantModelOutputError,
  getAssistantAiProvider,
  type AssistantAiProvider,
} from './gemini.js'
import {
  assistantClassifierSchema,
  assistantFinalAnswerSchema,
  type AssistantClassifier,
  type AssistantIntent,
  type AssistantLanguage,
  type AssistantMessageRequest,
} from './schemas.js'
import {
  clientProduct,
  catalogueDictionary,
  readAssistantCatalogue,
  type CatalogueProduct,
} from './catalogue.js'
import {
  conversationReference,
  explicitCount,
  explicitPrices,
  messageLanguage,
  socialReply,
  giftClarification,
} from './conversation.js'
import {
  classifyPrompt,
  classifierJsonSchema,
  finalPrompt,
  finalAnswerJsonSchema,
} from './prompts.js'

export type AssistantProduct = ReturnType<typeof clientProduct>
export type AssistantDiagnostics = {
  stage: string
  timings: Record<string, number>
  classifier?: AssistantClassifier
  rawClassifier?: AssistantClassifier
  candidateProductIds?: number[]
  catalogueCount?: number
  ignoredFilters?: string[]
  effectiveFilters?: AssistantClassifier['filters']
  providerError?: { stage: string; kind: string; status?: number; reason?: string }
  mode?: 'model' | 'social' | 'catalogue' | 'clarification'
  rejectedProductIds?: number[]
  databaseError?: { stage: string; code: string }
}
export type AssistantProcessingResult = {
  answer: string
  products: AssistantProduct[]
  detectedIntent: AssistantIntent
  classifierResult: AssistantClassifier | null
  candidateProductIds: number[]
  recommendedProductIds: number[]
  language: AssistantLanguage
  status: 'success' | 'out_of_scope' | 'degraded'
  mode: 'model' | 'social' | 'catalogue' | 'clarification'
}
const productIntents = new Set<AssistantIntent>([
  'product_search',
  'product_recommendation',
  'product_comparison',
  'product_details',
  'product_usage',
  'ingredient_question',
])
const recommendationIntents = new Set<AssistantIntent>([
  'product_search',
  'product_recommendation',
  'product_comparison',
])

function parseModel<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value)
  } catch {
    throw new AssistantModelOutputError()
  }
}

function redirect(language: AssistantLanguage, external: boolean) {
  if (external)
    return language === 'ru'
      ? 'Я не могу просматривать веб и проверять актуальную внешнюю информацию. Могу помочь с товарами Velora.'
      : language === 'en'
        ? 'I can’t browse the web or check current external information. I can help with Velora products.'
        : 'Я не можу переглядати веб і перевіряти актуальну зовнішню інформацію. Можу допомогти з товарами Velora.'
  return language === 'ru'
    ? 'Моя специализация — Velora и помощь с выбором. Могу подобрать товар, сравнить варианты или объяснить доставку. Что вас интересует?'
    : language === 'en'
      ? 'I focus on Velora and helping you choose. I can recommend or compare products and explain delivery. What are you looking for?'
      : 'Я спеціалізуюся на Velora й допомозі з вибором. Можу підібрати товар, порівняти варіанти чи пояснити доставку. Що вас цікавить?'
}

function normalizedClassifier(
  payload: AssistantMessageRequest,
  raw: AssistantClassifier,
  catalogue: CatalogueProduct[],
  diagnostics: AssistantDiagnostics,
): AssistantClassifier {
  diagnostics.rawClassifier = raw
  const dictionary = catalogueDictionary(catalogue)
  const ignored: string[] = []
  const category = dictionary.categories.find((entry) => entry.slug === raw.filters.categorySlug)
  if (raw.filters.categorySlug && !category) ignored.push('unknown_category')
  const attributes = raw.filters.attributes.filter(({ key, value }) => {
    const valid = dictionary.attributes.some(
      (entry) => entry.key === key && entry.values.includes(value),
    )
    if (!valid) ignored.push(`unknown_attribute:${key}`)
    return valid
  })
  // A model's inference alone must not create a hard category filter. Verify explicit
  // category naming against the conversation; other preferences remain semantic.
  const text = [
    ...payload.history.filter((entry) => entry.role === 'user').map((entry) => entry.content),
    payload.message,
  ]
    .join(' ')
    .toLowerCase()
  const categoryExplicit =
    !!category &&
    raw.categoryExplicit &&
    (text.includes(category.name.toLowerCase()) || text.includes(category.slug.toLowerCase()))
  if (category && !categoryExplicit) ignored.push('inferred_category_is_soft')
  const prices = explicitPrices(payload)
  const reference = conversationReference(payload)
  const referencedProduct = catalogue.find((product) => product.id === reference.id)
  const cheaperMaximum = reference.cheaper && referencedProduct ? referencedProduct.price - 1 : null
  const classifier = {
    ...raw,
    requestedCount: explicitCount(payload.message) ?? raw.requestedCount,
    categoryExplicit,
    filters: {
      ...raw.filters,
      minPrice: prices.minPrice ?? raw.filters.minPrice,
      maxPrice:
        cheaperMaximum === null
          ? (prices.maxPrice ?? raw.filters.maxPrice)
          : Math.min(cheaperMaximum, prices.maxPrice ?? raw.filters.maxPrice ?? cheaperMaximum),
      categorySlug: category?.slug ?? null,
      attributes,
      availability: 'available' as const,
    },
  }
  diagnostics.ignoredFilters = [...new Set(ignored)]
  diagnostics.classifier = classifier
  diagnostics.effectiveFilters = {
    ...classifier.filters,
    categorySlug:
      reference.cheaper && referencedProduct
        ? referencedProduct.categorySlug
        : categoryExplicit
          ? classifier.filters.categorySlug
          : null,
    attributes: [],
  } // Missing or incomplete attributes never exclude description matches.
  return classifier
}

function eligibleProducts(catalogue: CatalogueProduct[], filters: AssistantClassifier['filters']) {
  return catalogue.filter(
    (product) =>
      (filters.minPrice === null || product.price >= filters.minPrice) &&
      (filters.maxPrice === null || product.price <= filters.maxPrice) &&
      (!filters.categorySlug || product.categorySlug === filters.categorySlug),
  )
}

// Degraded mode is a literal catalogue lookup, not a substitute semantic consultant.
// It must never pick popular but unrelated products or claim suitability.
function literalMatches(message: string, catalogue: CatalogueProduct[]) {
  const terms = message.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const stop = new Set([
    'порадь',
    'порадьте',
    'порекомендуй',
    'один',
    'засіб',
    'для',
    'есть',
    'чи',
    'є',
    'what',
    'recommend',
    'please',
    'show',
    'find',
    'can',
    'you',
    'have',
    'the',
    'and',
    'product',
  ])
  const meaningful = terms.filter(
    (term) => term.length >= 3 && !stop.has(term) && !/^\d+$/u.test(term),
  )
  if (!meaningful.length) return []
  return catalogue.filter((product) => {
    const text =
      `${product.name} ${product.shortDescription} ${product.description} ${(product.aiTags ?? []).join(' ')}`.toLowerCase()
    return meaningful.every((term) => text.includes(term))
  })
}

function catalogueAnswer(language: AssistantLanguage) {
  return language === 'ru'
    ? 'ИИ временно недоступен. По тексту запроса найдены эти товары в каталоге. Я не смог оценить их пригодность; проверьте описание на странице товара.'
    : language === 'en'
      ? 'AI is temporarily unavailable. These catalogue records match your search text. I could not assess their suitability; please check each product description.'
      : 'ШІ тимчасово недоступний. За текстом запиту знайдено ці товари в каталозі. Я не зміг оцінити їхню відповідність потребам; перевірте опис на сторінці товару.'
}

export async function processAssistantMessage(
  payload: AssistantMessageRequest,
  _remainingRequests: number,
  provider: AssistantAiProvider = getAssistantAiProvider(),
  diagnostics: AssistantDiagnostics = { stage: 'validation', timings: {} },
): Promise<AssistantProcessingResult> {
  const measure = async <T>(stage: string, work: () => Promise<T>) => {
    diagnostics.stage = stage
    const started = Date.now()
    try {
      return await work()
    } finally {
      diagnostics.timings[stage] = Date.now() - started
    }
  }
  const makeResult = (
    answer: string,
    records: CatalogueProduct[],
    classifier: AssistantClassifier | null,
    mode: AssistantProcessingResult['mode'],
    status: AssistantProcessingResult['status'] = 'success',
  ): AssistantProcessingResult => {
    diagnostics.mode = mode
    diagnostics.stage = 'complete'
    return {
      answer,
      products: records.map(clientProduct),
      detectedIntent: classifier?.intent ?? (mode === 'social' ? 'social' : 'product_search'),
      classifierResult: classifier,
      candidateProductIds: diagnostics.candidateProductIds ?? [],
      recommendedProductIds: records.map((product) => product.id),
      language: classifier?.language ?? messageLanguage(payload.message),
      status,
      mode,
    }
  }
  const social = socialReply(payload.message)
  if (social) return makeResult(social.answer, [], null, 'social')
  const gift = giftClarification(payload)
  if (gift) return makeResult(gift.answer, [], null, 'clarification')

  // Classification and final answer share one deadline, including retries and failover.
  const deadlineMs = Date.now() + 30_000
  const catalogue = await measure('catalogue', readAssistantCatalogue)
  diagnostics.catalogueCount = catalogue.length
  let classifier: AssistantClassifier | null = null
  let candidates: CatalogueProduct[] = []
  try {
    const raw = await measure('classifier', async () =>
      parseModel(
        assistantClassifierSchema,
        await provider.generateStructured(
          classifyPrompt(payload, catalogue),
          classifierJsonSchema,
          900,
          { deadlineMs },
        ),
      ),
    )
    classifier = normalizedClassifier(payload, raw, catalogue, diagnostics)
    if (classifier.intent === 'out_of_scope' || classifier.externalCurrentInfo) {
      return makeResult(
        redirect(classifier.language, classifier.externalCurrentInfo),
        [],
        classifier,
        'model',
        'out_of_scope',
      )
    }
    const isProduct =
      productIntents.has(classifier.intent) || classifier.mentionedProducts.length > 0
    candidates = isProduct ? eligibleProducts(catalogue, diagnostics.effectiveFilters!) : []
    const reference = conversationReference(payload)
    if (
      !reference.cheaper &&
      reference.id &&
      ['product_details', 'product_usage', 'ingredient_question'].includes(classifier.intent)
    ) {
      candidates = candidates.filter((product) => product.id === reference.id)
    }
    diagnostics.candidateProductIds = candidates.map((product) => product.id)
    const storeContext = await measure('store_context', getStoreContext)
    const output = await measure('answer', async () =>
      parseModel(
        assistantFinalAnswerSchema,
        await provider.generateStructured(
          finalPrompt(payload, classifier!, catalogue, candidates, storeContext),
          {
            ...finalAnswerJsonSchema,
            properties: {
              ...(finalAnswerJsonSchema.properties as Record<string, unknown>),
              productIds: {
                type: 'array',
                maxItems: classifier!.requestedCount,
                items: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
              },
            },
          },
          1500,
          { deadlineMs },
        ),
      ),
    )
    const byId = new Map(candidates.map((product) => [product.id, product]))
    diagnostics.rejectedProductIds = output.productIds.filter((id) => !byId.has(id))
    // Invalid IDs can have matching invented facts in the prose: fail closed and
    // use the explicit catalogue mode rather than display that untrusted answer.
    if (diagnostics.rejectedProductIds.length)
      throw new AssistantModelOutputError('unknown_product_ids')
    if (new Set(output.productIds).size > classifier.requestedCount)
      throw new AssistantModelOutputError('too_many_products')
    const ids = output.outcome === 'matched' ? [...new Set(output.productIds)] : []
    const records = ids.map((id) => byId.get(id)!)
    const mentionedPrices = [
      ...output.answer.matchAll(/(\d[\d \u00a0]*(?:[.,]\d{1,2})?)\s*(?:грн|₴|UAH)/giu),
    ]
    if (
      isProduct &&
      mentionedPrices.some(
        (match) =>
          !records.some(
            (product) =>
              product.price ===
              Number(
                match[1]!
                  .trim()
                  .replace(/[ \u00a0]/g, '')
                  .replace(',', '.'),
              ),
          ),
      )
    ) {
      throw new AssistantModelOutputError('unsupported_price_claim')
    }
    const noMatch =
      classifier.language === 'ru'
        ? 'Не удалось найти подтверждённое соответствие вашим условиям. Уточните тип средства или измените бюджет — попробуем подобрать вариант.'
        : classifier.language === 'en'
          ? 'I could not find a confirmed match within your constraints. Could you specify the product type or adjust the budget?'
          : 'Не вдалося знайти підтверджену відповідність вашим умовам. Уточніть тип засобу або змініть бюджет — спробуємо підібрати варіант.'
    return makeResult(
      isProduct &&
        (output.outcome === 'no_match' ||
          (recommendationIntents.has(classifier.intent) &&
            output.outcome === 'matched' &&
            !records.length))
        ? noMatch
        : output.answer,
      records,
      classifier,
      'model',
    )
  } catch (error) {
    if (!(error instanceof AssistantProviderError)) throw error
    diagnostics.providerError = {
      stage: diagnostics.stage,
      kind: error.kind,
      status: error.providerStatus,
      reason: error.diagnostic,
    }
    const filters = diagnostics.effectiveFilters ?? {
      ...explicitPrices(payload),
      categorySlug: null,
      attributes: [],
      availability: 'available' as const,
    }
    candidates = eligibleProducts(catalogue, filters)
    diagnostics.candidateProductIds = candidates.map((product) => product.id)
    const matches = literalMatches(payload.message, candidates).slice(
      0,
      explicitCount(payload.message) ?? classifier?.requestedCount ?? 3,
    )
    if (!matches.length) throw error
    return makeResult(
      catalogueAnswer(classifier?.language ?? messageLanguage(payload.message)),
      matches,
      classifier,
      'catalogue',
      'degraded',
    )
  }
}
