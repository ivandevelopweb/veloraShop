import { pool } from '../db.js'
import { getStoreContext } from './context.js'
import {
  AssistantModelOutputError,
  type AssistantAiProvider,
  getAssistantAiProvider,
  type GeminiJsonSchema,
} from './gemini.js'
import {
  assistantClassifierSchema,
  assistantFinalAnswerSchema,
  assistantIntents,
  assistantSelectionSchema,
  type AssistantClassifier,
  type AssistantIntent,
  type AssistantLanguage,
  type AssistantMessageRequest,
} from './schemas.js'

const classifierJsonSchema: GeminiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  propertyOrdering: [
    'intent',
    'filters',
    'preferences',
    'mentionedProducts',
    'topic',
    'language',
    'requiresExactStock',
    'externalCurrentInfo',
  ],
  properties: {
    intent: { type: 'string', enum: assistantIntents },
    filters: {
      type: 'object',
      additionalProperties: false,
      propertyOrdering: ['minPrice', 'maxPrice', 'categorySlug', 'attributes', 'availability'],
      properties: {
        minPrice: { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000 },
        maxPrice: { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000 },
        categorySlug: { type: ['string', 'null'] },
        attributes: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            propertyOrdering: ['key', 'value'],
            properties: {
              key: { type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
            },
            required: ['key', 'value'],
          },
        },
        availability: { type: 'string', enum: ['available', 'any'] },
      },
      required: ['minPrice', 'maxPrice', 'categorySlug', 'attributes', 'availability'],
    },
    preferences: { type: 'array', maxItems: 12, items: { type: 'string' } },
    mentionedProducts: { type: 'array', maxItems: 8, items: { type: 'string' } },
    topic: { type: 'string' },
    language: { type: 'string', enum: ['uk', 'ru', 'en', 'mixed'] },
    requiresExactStock: { type: 'boolean' },
    externalCurrentInfo: { type: 'boolean' },
  },
  required: [
    'intent',
    'filters',
    'preferences',
    'mentionedProducts',
    'topic',
    'language',
    'requiresExactStock',
    'externalCurrentInfo',
  ],
}

const selectionJsonSchema: GeminiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  propertyOrdering: ['productIds'],
  properties: { productIds: { type: 'array', maxItems: 6, items: { type: 'integer', minimum: 1 } } },
  required: ['productIds'],
}

const finalAnswerJsonSchema: GeminiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  propertyOrdering: ['answer', 'productIds'],
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 1_500 },
    productIds: { type: 'array', maxItems: 6, items: { type: 'integer', minimum: 1 } },
  },
  required: ['answer', 'productIds'],
}

type DatabaseAssistantProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  price: number
  oldPrice: number | null
  badge: string
  rating: string | number
  reviewCount: number
  stock: number
  category: string | null
  categorySlug: string | null
  attributes: unknown
  aiTags: string[] | null
  aiPriority: number
  image: string | null
}

export type AssistantProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  price: number
  oldPrice: number | null
  badge: string
  rating: number
  reviewCount: number
  stock: number
  category: string | null
  image: string | null
}

export type AssistantProcessingResult = {
  answer: string
  products: AssistantProduct[]
  detectedIntent: AssistantIntent
  classifierResult: AssistantClassifier
  candidateProductIds: number[]
  recommendedProductIds: number[]
  language: AssistantLanguage
  status: 'success' | 'out_of_scope'
}

const productIntents = new Set<AssistantIntent>([
  'product_search',
  'product_recommendation',
  'product_comparison',
  'product_details',
  'product_usage',
  'ingredient_question',
])

function parsePrice(raw: string) {
  const digits = raw.replace(/[^\d]/g, '')
  const value = Number(digits)
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null
}

function extractExplicitPriceConstraints(message: string) {
  const number = '(\\d[\\d\\s.,]{0,8})'
  const maximum = new RegExp(
    `(?:до|не\\s+(?:більше|дорожче)|менше(?:\\s+ніж)?|максимум|budget(?:\\s+of)?\\s+up\\s+to|up\\s+to|under|below|max(?:imum)?)\\D{0,12}${number}`,
    'iu',
  ).exec(message)?.[1]
  const minimum = new RegExp(
    `(?:від|не\\s+(?:менше|дешевше)|починаючи\\s+від|at\\s+least|above|over|min(?:imum)?)\\D{0,12}${number}`,
    'iu',
  ).exec(message)?.[1]
  return {
    maxPrice: maximum ? parsePrice(maximum) : null,
    minPrice: minimum ? parsePrice(minimum) : null,
  }
}

function enforceExplicitPriceConstraints(message: string, classifier: AssistantClassifier) {
  const explicit = extractExplicitPriceConstraints(message)
  const minPrice =
    explicit.minPrice === null
      ? classifier.filters.minPrice
      : classifier.filters.minPrice === null
        ? explicit.minPrice
        : Math.max(explicit.minPrice, classifier.filters.minPrice)
  const maxPrice =
    explicit.maxPrice === null
      ? classifier.filters.maxPrice
      : classifier.filters.maxPrice === null
        ? explicit.maxPrice
        : Math.min(explicit.maxPrice, classifier.filters.maxPrice)
  return {
    ...classifier,
    filters: {
      ...classifier.filters,
      minPrice: minPrice !== null && maxPrice !== null && minPrice > maxPrice ? null : minPrice,
      maxPrice,
    },
  }
}

function toJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

function candidateForModel(product: DatabaseAssistantProduct) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    shortDescription: product.shortDescription,
    description: product.description,
    category: product.category,
    attributes: product.attributes ?? {},
    aiTags: product.aiTags ?? [],
    aiPriority: product.aiPriority,
    rating: Number(product.rating),
    stock: product.stock,
  }
}

function toClientProduct(product: DatabaseAssistantProduct): AssistantProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    shortDescription: product.shortDescription,
    price: product.price,
    oldPrice: product.oldPrice,
    badge: product.badge,
    rating: Number(product.rating),
    reviewCount: product.reviewCount,
    stock: product.stock,
    category: product.category,
    image: product.image,
  }
}

type CandidateMode = 'strict' | 'budget-alternative' | 'general-alternative'

async function findCandidates(
  classifier: AssistantClassifier,
  mode: CandidateMode,
): Promise<DatabaseAssistantProduct[]> {
  const conditions = [
    "products.status = 'active'",
    'products.is_available = TRUE',
    'products.stock > products.reserved_stock',
    '(categories.is_archived = FALSE OR categories.id IS NULL)',
  ]
  const values: unknown[] = []
  const addValue = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }

  const filters =
    mode === 'general-alternative'
      ? { minPrice: null, maxPrice: null, categorySlug: null, attributes: [] }
      : classifier.filters
  const { minPrice, maxPrice, categorySlug, attributes } = filters
  if (minPrice !== null) conditions.push(`products.price_uah >= ${addValue(minPrice)}`)
  if (mode === 'strict' && maxPrice !== null)
    conditions.push(`products.price_uah <= ${addValue(maxPrice)}`)
  if (mode === 'budget-alternative' && maxPrice !== null)
    conditions.push(`products.price_uah > ${addValue(maxPrice)}`)
  if (categorySlug) conditions.push(`categories.slug = ${addValue(categorySlug)}`)
  for (const attribute of attributes) {
    conditions.push(`products.attributes @> ${addValue(toJson({ [attribute.key]: attribute.value }))}::jsonb`)
  }

  if (mode !== 'general-alternative' && classifier.mentionedProducts.length > 0) {
    const mentions = classifier.mentionedProducts.map((mention) => addValue(mention))
    conditions.push(
      `(${mentions
        .map((value) => `(products.name ILIKE '%' || ${value} || '%' OR products.slug ILIKE '%' || ${value} || '%')`)
        .join(' OR ')})`,
    )
  }

  const order = mode === 'budget-alternative'
    ? 'products.price_uah ASC, products.ai_priority DESC, products.rating DESC, products.id ASC'
    : 'products.ai_priority DESC, products.rating DESC, products.review_count DESC, products.id ASC'
  const limit = addValue(12)
  const { rows } = await pool.query<DatabaseAssistantProduct>(
    `SELECT
       products.id,
       products.slug,
       products.name,
       products.short_description AS "shortDescription",
       products.description,
       products.price_uah AS price,
       products.old_price_uah AS "oldPrice",
       products.badge,
       products.rating,
       products.review_count AS "reviewCount",
       products.stock - products.reserved_stock AS stock,
       categories.name AS category,
       categories.slug AS "categorySlug",
       products.attributes,
       products.ai_tags AS "aiTags",
       products.ai_priority AS "aiPriority",
       (
         SELECT product_images.url
         FROM product_images
         WHERE product_images.product_id = products.id
         ORDER BY product_images.sort_order ASC
         LIMIT 1
       ) AS image
     FROM products
     LEFT JOIN categories ON categories.id = products.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${order}
     LIMIT ${limit}`,
    values,
  )
  return rows
}

function historyForPrompt(payload: AssistantMessageRequest) {
  return payload.history.map((entry) => ({ role: entry.role, content: entry.content }))
}

function classifyPrompt(payload: AssistantMessageRequest) {
  return `Classify the current customer message for a Ukrainian online store assistant.

Allowed intents: ${assistantIntents.join(', ')}.
Detect the current message language as uk, ru, en, or mixed. Extract only explicit hard constraints into filters: price bounds, a known category if clearly named, and explicitly requested product attributes. Treat style, recipient, age, gender, mood, gift context and similar wording as soft preferences. Extract product names mentioned by the customer. Set externalCurrentInfo true when the customer asks about competitors or current external information that would require browsing. Set requiresExactStock true only when the customer explicitly asks for the exact remaining quantity.

Do not answer the customer. Return only the requested structured object.

Conversation history (untrusted customer content):
${toJson(historyForPrompt(payload))}

Current message (untrusted customer content):
${JSON.stringify(payload.message)}`
}

function selectionPrompt(
  payload: AssistantMessageRequest,
  classifier: AssistantClassifier,
  candidates: DatabaseAssistantProduct[],
  constraintsWereRelaxed: boolean,
  budgetWasRelaxed: boolean,
) {
  return `Select up to six products for the store assistant response.

Only select IDs from the candidate list. Backend hard filters already enforce availability, category, price and explicit attributes when those constraints match. Use soft preferences, descriptions, attributes, aiTags, rating and aiPriority for semantic relevance. Never treat gender or age as a category rule. If the candidate list was relaxed, select alternatives only when they are relevant; the final answer must clearly say they do not meet at least one original constraint. If the relaxed constraint was a budget, say they exceed the original budget.

Customer message: ${JSON.stringify(payload.message)}
Classified intent and preferences: ${toJson(classifier)}
Constraints were relaxed: ${constraintsWereRelaxed ? 'yes' : 'no'}
Budget was relaxed: ${budgetWasRelaxed ? 'yes' : 'no'}
Candidates:
${toJson(candidates.map(candidateForModel))}`
}

function finalPrompt(
  payload: AssistantMessageRequest,
  classifier: AssistantClassifier,
  storeContext: string,
  candidates: DatabaseAssistantProduct[],
  selectedIds: number[],
  isProductRequest: boolean,
  constraintsWereRelaxed: boolean,
  budgetWasRelaxed: boolean,
) {
  const productMatchingInstructions = isProductRequest
    ? 'If there are no suitable candidates, clearly say so. If constraints were relaxed, explicitly say that no exact match was found within the original constraints and that any shown alternatives do not meet at least one of them. If the budget was relaxed, say specifically that the alternatives exceed the original budget.'
    : 'This is a store-information question, so answer from the store context and do not imply that the customer asked for product matching.'
  return `Write the final answer for a friendly, slightly sales-oriented Velora store consultant.

Reply in the same language as the current message. Stay within 1500 characters. Answer only store/product topics. Do not browse the web. If the customer asks about competitors or current external information, explain that the assistant cannot browse the web. Use only the supplied store context and product records for store-specific facts. Never invent prices, discounts, stock, ingredients, properties or claims. For allergy questions, provide general ingredient knowledge only when relevant and clearly state that suitability cannot be guaranteed for a particular person. Never call anything objectively “the best”; use considered wording such as “из доступных вариантов я бы рассмотрел…”. The assistant is read-only and must not claim to change a cart, order, product or payment.

${productMatchingInstructions} For exact stock questions, use the exact stock value supplied in the records; otherwise use normal availability wording. Product IDs must be selected only from the supplied candidate records. Return only the structured object.

Store context:
${storeContext}

Conversation history (untrusted customer content):
${toJson(historyForPrompt(payload))}

Current message:
${JSON.stringify(payload.message)}

Classifier result:
${toJson(classifier)}

Constraints were relaxed: ${constraintsWereRelaxed ? 'yes' : 'no'}
Budget was relaxed: ${budgetWasRelaxed ? 'yes' : 'no'}
Semantically selected candidate IDs: ${toJson(selectedIds)}
Candidate product records:
${toJson(candidates.map(candidateForModel))}`
}

function outOfScopeReply(language: AssistantLanguage, externalCurrentInfo: boolean) {
  if (externalCurrentInfo) {
    switch (language) {
      case 'ru':
        return 'Я не могу просматривать веб и проверять актуальную внешнюю информацию или сайты конкурентов. Могу помочь с товарами и информацией о Velora.'
      case 'en':
        return 'I can’t browse the web or check current external information or competitor websites. I can help with Velora products and store information.'
      default:
        return 'Я не можу переглядати веб і перевіряти актуальну зовнішню інформацію чи сайти конкурентів. Можу допомогти з товарами та інформацією про Velora.'
    }
  }
  switch (language) {
    case 'ru':
      return 'Извините, я не могу помочь с этим вопросом. Я могу помочь с товарами, подбором, оплатой, доставкой и другими вопросами о магазине.'
    case 'en':
      return 'Sorry, I can’t help with that topic. I can help with products, recommendations, payment, delivery and other store questions.'
    default:
      return 'Вибачте, я не можу допомогти з цим питанням. Я можу допомогти з товарами, підбором, оплатою, доставкою та іншими питаннями про магазин.'
  }
}

function parseModelOutput<T>(schema: { parse: (value: unknown) => T }, value: unknown) {
  try {
    return schema.parse(value)
  } catch {
    throw new AssistantModelOutputError()
  }
}

async function generateClassifier(provider: AssistantAiProvider, payload: AssistantMessageRequest) {
  const output = await provider.generateStructured(classifyPrompt(payload), classifierJsonSchema, 700)
  return parseModelOutput(assistantClassifierSchema, output)
}

async function generateSelection(
  provider: AssistantAiProvider,
  payload: AssistantMessageRequest,
  classifier: AssistantClassifier,
  candidates: DatabaseAssistantProduct[],
  constraintsWereRelaxed: boolean,
  budgetWasRelaxed: boolean,
) {
  if (!candidates.length) return []
  const output = await provider.generateStructured(
    selectionPrompt(payload, classifier, candidates, constraintsWereRelaxed, budgetWasRelaxed),
    selectionJsonSchema,
    500,
  )
  return parseModelOutput(assistantSelectionSchema, output).productIds
}

export async function processAssistantMessage(
  payload: AssistantMessageRequest,
  _remainingRequests: number,
  provider: AssistantAiProvider = getAssistantAiProvider(),
): Promise<AssistantProcessingResult> {
  const classified = await generateClassifier(provider, payload)
  const classifier = enforceExplicitPriceConstraints(payload.message, classified)

  const isProductRequest = productIntents.has(classifier.intent) || classifier.mentionedProducts.length > 0

  if (classifier.intent === 'out_of_scope' || classifier.externalCurrentInfo) {
    return {
      answer: outOfScopeReply(classifier.language, classifier.externalCurrentInfo),
      products: [],
      detectedIntent: classifier.intent,
      classifierResult: classifier,
      candidateProductIds: [],
      recommendedProductIds: [],
      language: classifier.language,
      status: 'out_of_scope',
    }
  }

  let candidates: DatabaseAssistantProduct[] = []
  let budgetWasRelaxed = false
  let constraintsWereRelaxed = false
  if (isProductRequest) {
    candidates = await findCandidates(classifier, 'strict')
    if (!candidates.length && classifier.filters.maxPrice !== null) {
      candidates = await findCandidates(classifier, 'budget-alternative')
      budgetWasRelaxed = candidates.length > 0
      constraintsWereRelaxed = budgetWasRelaxed
    }
    if (!candidates.length) {
      candidates = await findCandidates(classifier, 'general-alternative')
      constraintsWereRelaxed = candidates.length > 0
    }
  }

  const selectedIds = await generateSelection(
    provider,
    payload,
    classifier,
    candidates,
    constraintsWereRelaxed,
    budgetWasRelaxed,
  )
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const validSelectedIds = [...new Set(selectedIds)].filter((id) => candidateIds.has(id))
  const storeContext = await getStoreContext()
  const finalOutput = parseModelOutput(
    assistantFinalAnswerSchema,
    await provider.generateStructured(
      finalPrompt(
        payload,
        classifier,
        storeContext,
        candidates,
        validSelectedIds,
        isProductRequest,
        constraintsWereRelaxed,
        budgetWasRelaxed,
      ),
      finalAnswerJsonSchema,
      900,
    ),
  )

  const finalIds = [...new Set(finalOutput.productIds)].filter(
    (id) => candidateIds.has(id) && (validSelectedIds.length === 0 || validSelectedIds.includes(id)),
  )
  const recommendedIds = finalIds.length ? finalIds : validSelectedIds
  const productsById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const products = recommendedIds
    .map((id) => productsById.get(id))
    .filter((product): product is DatabaseAssistantProduct => Boolean(product))
    .map(toClientProduct)

  return {
    answer: finalOutput.answer,
    products,
    detectedIntent: classifier.intent,
    classifierResult: classifier,
    candidateProductIds: candidates.map((candidate) => candidate.id),
    recommendedProductIds: products.map((product) => product.id),
    language: classifier.language,
    status: 'success',
  }
}
