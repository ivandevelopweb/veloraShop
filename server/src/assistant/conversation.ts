import type { AssistantLanguage, AssistantMessageRequest } from './schemas.js'

export function messageLanguage(message: string): AssistantLanguage {
  if (/[іїєґ]/iu.test(message)) return 'uk'
  if (
    /[ыэёъ]/iu.test(message) ||
    /привет|спасибо|помощник|умеешь|здравствуй|кто ты|как дела/iu.test(message)
  )
    return 'ru'
  return /[а-я]/iu.test(message) ? 'uk' : 'en'
}

export function socialReply(
  message: string,
): { answer: string; language: AssistantLanguage } | null {
  const text = message
    .toLowerCase()
    .replace(/[!?.,:;😊👋]/gu, '')
    .trim()
  const greeting =
    /^(привіт|привет|вітаю|вітання|добрий (день|ранок|вечір)|здравствуй(те)?|добрый (день|вечер)|hi|hello|hey)$/iu.test(
      text,
    )
  const thanks =
    /^(дякую( дуже)?|спасибі|спасибо( большое)?|thanks( a lot)?|thank you|ок|окей|okay|ok)$/iu.test(
      text,
    )
  const identity =
    /^(хто ти|кто ты|що (ти )?вмієш|что (ты )?умеешь|як ти можеш допомогти|who are you|what can you do)$/iu.test(
      text,
    )
  const smallTalk = /^(як справи|как дела|how are you|ти бот|ты бот|are you a bot)$/iu.test(text)
  if (!greeting && !thanks && !identity && !smallTalk) return null
  const language = messageLanguage(message)
  const answer =
    language === 'ru'
      ? thanks
        ? 'Пожалуйста! Если понадобится помощь с выбором, я рядом.'
        : 'Привет! Я помощник Velora. Помогу подобрать товары по вашим пожеланиям и бюджету, сравнить их и разобраться с доставкой или возвратом. Что ищете?'
      : language === 'en'
        ? thanks
          ? 'You’re welcome! I’m here if you need help choosing.'
          : 'Hi! I’m the Velora assistant. I can help choose and compare products, work with your budget, and explain delivery or returns. What are you looking for?'
        : thanks
          ? 'Будь ласка! Якщо потрібна допомога з вибором, я поруч.'
          : 'Привіт! Я помічник Velora. Допоможу підібрати товари за вашими побажаннями й бюджетом, порівняти їх і розібратися з доставкою чи поверненням. Що шукаєте?'
  return { answer, language }
}

export function explicitPrices(payload: AssistantMessageRequest) {
  let minPrice: number | null = null
  let maxPrice: number | null = null
  // Most recent explicit bound replaces the previous one; mere follow-ups keep it.
  for (const message of [
    ...payload.history.filter((entry) => entry.role === 'user').map((entry) => entry.content),
    payload.message,
  ]) {
    const number = '(\\d[\\d \\u00a0]{0,8}(?:[.,]\\d{1,2})?)'
    const max = new RegExp(
      `(?:до|не\\s+(?:більше|дорожче|больше)|менше(?:\\s+ніж)?|не дороже|максимум|up\\s+to|under|below|max(?:imum)?)\\s*${number}`,
      'iu',
    ).exec(message)?.[1]
    const min = new RegExp(
      `(?:від|от|не\\s+(?:менше|дешевше|меньше)|at\\s+least|above|over|min(?:imum)?)\\s*${number}`,
      'iu',
    ).exec(message)?.[1]
    const parse = (raw: string) => Number(raw.replace(/[ \u00a0]/g, '').replace(',', '.'))
    if (max && parse(max) <= 1_000_000) maxPrice = Math.floor(parse(max))
    if (min && parse(min) <= 1_000_000) minPrice = Math.ceil(parse(min))
  }
  return { minPrice, maxPrice }
}

export function explicitCount(message: string): number | null {
  if (
    /(?:^|[^\p{L}\p{N}])(?:один|одну|одне|одна|одного|one|single)(?=$|[^\p{L}\p{N}])/iu.test(
      message,
    )
  )
    return 1
  const numeric = /(?:порадь|порекомендуй|покажи|suggest|recommend|show)\s+(\d)/iu.exec(
    message,
  )?.[1]
  return numeric ? Math.min(6, Math.max(1, Number(numeric))) : null
}

// A recipient alone gives no preferences. Ask for a budget without depending on Gemini.
// Anchor the whole message so specific hair/skin needs and product names still reach the model.
export function giftClarification(payload: AssistantMessageRequest) {
  const text = payload.message.toLowerCase().replace(/[!?.,:;]/gu, '').trim()
  const broadGift = /^(?:(?:порадь(?:те)?|порекомендуй(?:те)?|підбери|посоветуй|подбери|recommend|suggest)\s+)?(?:подарунок|подарок|(?:a\s+)?gift)(?:\s+(?:для|for)\s+(?:дівчини|девушки|жінки|женщины|мами|мамы|a girlfriend|my girlfriend|my wife|my mother))?$/iu.test(text)
  if (!broadGift) return null
  const language = messageLanguage(payload.message)
  const prices = explicitPrices(payload)
  const hasBudget = prices.minPrice !== null || prices.maxPrice !== null
  return {
    language,
    answer: language === 'ru'
      ? hasBudget
        ? 'Что ей нравится: парфюмерия, уход или макияж? Подберём подарок с учётом вашего бюджета.'
        : 'Помогу выбрать подарок! На какой бюджет в гривнах рассчитываете?'
      : language === 'en'
        ? hasBudget
          ? 'What does she like: fragrance, skincare or makeup? We can choose a gift within your budget.'
          : 'I can help choose a gift! What is your budget in Ukrainian hryvnias?'
        : hasBudget
          ? 'Що їй подобається: парфумерія, догляд чи макіяж? Підберемо подарунок з урахуванням вашого бюджету.'
          : 'Допоможу вибрати подарунок! На який бюджет у гривнях розраховуєте?',
  }
}

export function conversationReference(payload: AssistantMessageRequest) {
  const previous = [...payload.history]
    .reverse()
    .find((entry) => entry.role === 'assistant' && entry.productIds?.length)
  const ids = previous?.role === 'assistant' ? (previous.productIds ?? []) : []
  const text = payload.message.toLowerCase()
  const index = /друг(?:ий|ой|ого|ому)|втор(?:ой|ого|ому)|second/iu.test(text)
    ? 1
    : /трет(?:ій|ий|ього|ьему)|third/iu.test(text)
      ? 2
      : 0
  const refers =
    /друг(?:ий|ой|ого|ому)|втор(?:ой|ого|ому)|second|трет(?:ій|ий|ього|ьему)|third|перш(?:ий|ого|ому)|перв(?:ый|ого|ому)|first|\b(?:its|this|it)\b|(?:^|\s)(?:його|него|его|цей|этот|ціна|цена)(?:\s|[?!.,]|$)/iu.test(
      text,
    )
  const cheaper = /дешев|cheaper|less expensive/iu.test(text)
  return { id: refers || cheaper ? ids[index] : undefined, cheaper }
}
