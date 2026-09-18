import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiClientError, type AssistantHistoryEntry, type AssistantProduct } from '../../api'
import { formatPriceWithCurrency } from '../../shared/lib/format'
import { readStoredString, writeStoredString } from '../../shared/lib/storage'
import { StorefrontIcon as Icon } from './StorefrontIcon'
import { productPath } from '../routing/paths'

const assistantClientIdKey = 'velora-assistant-client-id'
const assistantHistoryLimit = 24

type Feedback = 'like' | 'dislike'

type AssistantChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  products?: AssistantProduct[]
  interactionId?: string
  feedback?: Feedback
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function getClientId() {
  const saved = readStoredString(assistantClientIdKey)
  if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) {
    return saved
  }
  const created = createId()
  writeStoredString(assistantClientIdKey, created)
  return created
}

function ProductRecommendation({ product }: { product: AssistantProduct }) {
  return (
    <Link className="assistant-product" to={productPath(product.slug)}>
      <span className="assistant-product-image">
        {product.image ? <img src={product.image} alt={product.name} loading="lazy" /> : <Icon name="gift" size={20} />}
      </span>
      <span className="assistant-product-copy">
        <strong>{product.name}</strong>
        <small>{product.shortDescription}</small>
        <b>{formatPriceWithCurrency(product.price)}</b>
      </span>
      <Icon name="chevron" size={16} />
    </Link>
  )
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedbackLoadingId, setFeedbackLoadingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [remainingRequests, setRemainingRequests] = useState<number | null>(null)
  const [clientId] = useState(getClientId)
  const [sessionId] = useState(createId)
  const [messages, setMessages] = useState<AssistantChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Вітаю! Я допоможу знайти товар, порівняти варіанти та підкажу про доставку, оплату й магазин.',
    },
  ])
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, open])

  const submit = async () => {
    const message = draft.trim()
    if (!message || message.length > 500 || loading) return

    const history: AssistantHistoryEntry[] = messages
      .slice(-assistantHistoryLimit)
      .map(({ role, content }) => ({ role, content }))
    setMessages((current) => [...current, { id: createId(), role: 'user', content: message }])
    setDraft('')
    setError('')
    setLoading(true)

    try {
      const response = await api.sendAssistantMessage({ message, history, clientId, sessionId })
      setRemainingRequests(response.remainingRequests)
      setMessages((current) => [
        ...current,
        {
          id: response.interactionId,
          role: 'assistant',
          content: response.answer,
          products: response.products,
          interactionId: response.interactionId,
        },
      ])
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : 'AI-помічник тимчасово недоступний. Спробуйте ще раз пізніше.',
      )
    } finally {
      setLoading(false)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const submitFeedback = async (message: AssistantChatMessage, value: Feedback) => {
    if (!message.interactionId || message.feedback || feedbackLoadingId) return
    setFeedbackLoadingId(message.interactionId)
    try {
      const response = await api.submitAssistantFeedback({
        interactionId: message.interactionId,
        clientId,
        value,
      })
      setMessages((current) =>
        current.map((item) =>
          item.interactionId === message.interactionId ? { ...item, feedback: response.feedback } : item,
        ),
      )
    } catch {
      setError('Не вдалося зберегти оцінку відповіді.')
    } finally {
      setFeedbackLoadingId(null)
    }
  }

  return (
    <div className={`assistant-widget ${open ? 'is-open' : ''}`}>
      {open && (
        <section id="velora-assistant-panel" className="assistant-panel" role="dialog" aria-label="AI-помічник Velora">
          <header className="assistant-panel-header">
            <div>
              <p className="eyebrow">Velora</p>
              <h2>AI-помічник</h2>
            </div>
            <button className="assistant-close" type="button" onClick={() => setOpen(false)} aria-label="Закрити AI-помічника">
              <Icon name="close" size={18} />
            </button>
          </header>

          <div className="assistant-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`assistant-message assistant-message-${message.role}`}>
                <div className="assistant-message-bubble">
                  <p>{message.content}</p>
                  {message.products && message.products.length > 0 && (
                    <div className="assistant-products" aria-label="Рекомендовані товари">
                      {message.products.map((product) => (
                        <ProductRecommendation key={product.id} product={product} />
                      ))}
                    </div>
                  )}
                </div>
                {message.role === 'assistant' && message.interactionId && (
                  <div className="assistant-feedback" aria-label="Оцінити відповідь">
                    <button
                      type="button"
                      className={message.feedback === 'like' ? 'active' : ''}
                      onClick={() => void submitFeedback(message, 'like')}
                      disabled={Boolean(message.feedback) || feedbackLoadingId === message.interactionId}
                      aria-label="Корисна відповідь"
                      aria-pressed={message.feedback === 'like'}
                    >
                      <Icon name="thumb-up" size={15} />
                    </button>
                    <button
                      type="button"
                      className={message.feedback === 'dislike' ? 'active' : ''}
                      onClick={() => void submitFeedback(message, 'dislike')}
                      disabled={Boolean(message.feedback) || feedbackLoadingId === message.interactionId}
                      aria-label="Некорисна відповідь"
                      aria-pressed={message.feedback === 'dislike'}
                    >
                      <Icon name="thumb-down" size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="assistant-message assistant-message-assistant">
                <div className="assistant-message-bubble assistant-loading" role="status">
                  <span />
                  <span />
                  <span />
                  <em>Думаю…</em>
                </div>
              </div>
            )}
          </div>

          {error && <p className="assistant-error" role="alert">{error}</p>}
          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Напишіть запит про товари чи магазин"
              aria-label="Повідомлення для AI-помічника"
              rows={2}
              disabled={loading}
            />
            <div className="assistant-composer-footer">
              <span className={draft.length > 450 ? 'near-limit' : ''}>
                {draft.length > 400 ? `${draft.length}/500` : 'До 500 символів'}
              </span>
              {remainingRequests !== null && <small>Залишилось: {remainingRequests}</small>}
              <button className="assistant-send" type="submit" disabled={!draft.trim() || loading} aria-label="Надіслати повідомлення">
                <Icon name="arrow" size={17} />
              </button>
            </div>
          </form>
        </section>
      )}
      <button
        className="assistant-launcher"
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          setError('')
        }}
        aria-expanded={open}
        aria-controls="velora-assistant-panel"
      >
        <Icon name="sparkles" size={19} />
        <span>{open ? 'Згорнути' : 'AI-помічник'}</span>
      </button>
    </div>
  )
}
