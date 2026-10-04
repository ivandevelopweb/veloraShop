import { useCallback, useEffect, useState } from 'react'
import { ApiClientError, api, type CustomerCommunityState, type ProductCommunity, type PublicProductRating, type User } from '../../api'
import { formatDateTime } from '../../shared/lib/format'
import { StorefrontIcon as Icon } from './StorefrontIcon'

const pageSize = 10

type Props = {
  productId: number
  user: User | null
  sessionLoading: boolean
  onRequireLogin: () => void
  onSummaryChange: (summary: ProductCommunity['summary']) => void
  refreshCatalog: () => Promise<boolean>
}

export function ProductReviews({
  productId,
  user,
  sessionLoading,
  onRequireLogin,
  onSummaryChange,
  refreshCatalog,
}: Props) {
  const [community, setCommunity] = useState<ProductCommunity | null>(null)
  const [ratings, setRatings] = useState<PublicProductRating[]>([])
  const [ratingsTotal, setRatingsTotal] = useState(0)
  const [ratingsPage, setRatingsPage] = useState(1)
  const [commentsPage, setCommentsPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingRating, setSavingRating] = useState(false)
  const [savingComment, setSavingComment] = useState(false)
  const [selectedStars, setSelectedStars] = useState('')
  const [commentText, setCommentText] = useState('')
  const [commentRequestId, setCommentRequestId] = useState(() => crypto.randomUUID())
  const [myState, setMyState] = useState<CustomerCommunityState | null>(null)
  const [myStateUserId, setMyStateUserId] = useState('')
  const [privateAuthRequired, setPrivateAuthRequired] = useState(false)
  const [privateStateError, setPrivateStateError] = useState('')
  const [privateRetry, setPrivateRetry] = useState(0)
  const userId = user?.id

  const loadPublic = useCallback(async (commentPage: number, ratingPage: number) => {
    const [communityResponse, ratingsResponse] = await Promise.all([
      api.getCommunity(productId, { page: commentPage, pageSize }),
      api.getProductRatings(productId, { page: ratingPage, pageSize }),
    ])
    setCommunity(communityResponse)
    setRatings(ratingsResponse.ratings)
    setRatingsTotal(ratingsResponse.total)
    onSummaryChange(communityResponse.summary)
    return { communityResponse, ratingsResponse }
  }, [productId, onSummaryChange])

  const loadMyState = useCallback(async (userId: string) => {
    const response = await api.getMyCommunity(productId)
    setMyState(response)
    setMyStateUserId(userId)
    setSelectedStars(response.rating ? String(response.rating.stars) : '')
    setCommentText(response.comment?.message ?? '')
  }, [productId])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => loadPublic(commentsPage, ratingsPage)).catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Не вдалося завантажити оцінки й коментарі.')
    }).finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [loadPublic, commentsPage, ratingsPage])

  useEffect(() => {
    if (!userId || sessionLoading) return
    let active = true
    void api.getMyCommunity(productId).then((response) => {
      if (!active) return
      setMyState(response)
      setMyStateUserId(userId)
      setPrivateAuthRequired(false)
      setPrivateStateError('')
      setSelectedStars(response.rating ? String(response.rating.stars) : '')
      setCommentText(response.comment?.message ?? '')
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        setPrivateAuthRequired(true)
        setPrivateStateError('')
      } else {
        setPrivateStateError(requestError instanceof Error ? requestError.message : 'Не вдалося перевірити право залишити відгук.')
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося перевірити право залишити відгук.')
      }
    })
    return () => {
      active = false
    }
  }, [userId, sessionLoading, privateRetry, productId])

  const reload = async (commentPage = commentsPage, ratingPage = ratingsPage) => {
    const nextCommentPage = Math.max(1, commentPage)
    const nextRatingPage = Math.max(1, ratingPage)
    setLoading(true)
    setCommentsPage(nextCommentPage)
    setRatingsPage(nextRatingPage)
    try {
      const result = await loadPublic(nextCommentPage, nextRatingPage)
      if (user) await loadMyState(user.id)
      await refreshCatalog()
      return result
    } finally {
      setLoading(false)
    }
  }

  const submitRating = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      onRequireLogin()
      return
    }
    if (!selectedStars || !canReview || !myState) return
    setSavingRating(true)
    setError('')
    setNotice('')
    try {
      const response = await api.putProductRating(productId, {
        stars: Number(selectedStars),
        expectedEpoch: myState.ratingEpoch,
      })
      setNotice('Вашу оцінку збережено.')
      onSummaryChange({
        ...community?.summary,
        ...response.summary,
        commentCount: community?.summary.commentCount ?? 0,
      })
      try {
        await reload()
      } catch {
        setError('Оцінку збережено, але оновити каталог і список оцінок не вдалося. Оновіть сторінку.')
      }
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        setPrivateAuthRequired(true)
        setError('Сесія завершилася. Увійдіть знову, щоб надіслати оцінку.')
      } else if (requestError instanceof ApiClientError && requestError.status === 409) {
        await reload().catch(() => undefined)
        setError('Рейтинг змінився. Дані оновлено — перевірте оцінку й спробуйте ще раз.')
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося зберегти оцінку.')
      }
    } finally {
      setSavingRating(false)
    }
  }

  const submitComment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      onRequireLogin()
      return
    }
    if (!canReview || !commentText.trim()) return
    setSavingComment(true)
    setError('')
    setNotice('')
    try {
      if (myState?.comment) {
        await api.updateProductComment(productId, myState.comment.id, commentText)
        setNotice('Ваш коментар оновлено.')
      } else {
        await api.createProductComment(productId, {
          message: commentText,
          clientRequestId: commentRequestId,
        })
        setCommentRequestId(crypto.randomUUID())
        setNotice('Ваш коментар опубліковано.')
      }
      try {
        await reload(1, ratingsPage)
      } catch {
        setError('Коментар збережено, але оновити список не вдалося. Оновіть сторінку.')
      }
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        setPrivateAuthRequired(true)
        setError('Сесія завершилася. Увійдіть знову, щоб зберегти коментар.')
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося зберегти коментар.')
      }
    } finally {
      setSavingComment(false)
    }
  }

  const deleteComment = async () => {
    if (!user || !myState?.comment) return
    setSavingComment(true)
    setError('')
    setNotice('')
    try {
      await api.deleteProductComment(productId, myState.comment.id)
      setCommentText('')
      setCommentRequestId(crypto.randomUUID())
      setNotice('Ваш коментар прибрано з вітрини.')
      try {
        await reload(1, ratingsPage)
      } catch {
        setError('Коментар прибрано, але оновити список не вдалося. Оновіть сторінку.')
      }
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        setPrivateAuthRequired(true)
        setError('Сесія завершилася. Увійдіть знову, щоб видалити коментар.')
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося видалити коментар.')
      }
    } finally {
      setSavingComment(false)
    }
  }

  const canReview = Boolean(user && !privateAuthRequired && myStateUserId === user.id && myState?.canReview)
  const ownStateReady = Boolean(user && myStateUserId === user.id)
  const publicComments = community?.comments

  return (
    <section className="product-reviews" aria-labelledby="product-reviews-title">
      <div className="product-reviews-heading">
        <div>
          <h2 id="product-reviews-title">Оцінки та коментарі</h2>
          {community && (
            <p>
              {community.summary.reviewCount > 0
                ? `Середня оцінка ${community.summary.rating.toFixed(1)} із 5 · ${community.summary.reviewCount} оцінок`
                : 'Ще немає оцінок'}
              {' · '}{community.summary.commentCount} коментарів
            </p>
          )}
        </div>
      </div>

      {error && <p className="product-review-message error" role="alert">{error}</p>}
      {notice && <p className="product-review-message success" role="status">{notice}</p>}

      {sessionLoading ? (
        <div className="product-review-access" role="status">Перевіряємо сесію…</div>
      ) : user && privateAuthRequired ? (
        <div className="product-review-access" role="status">
          <span>Сесія завершилася. Увійдіть знову, щоб оцінити товар або написати коментар.</span>
          <button className="review-secondary" type="button" onClick={onRequireLogin}>Увійти знову</button>
        </div>
      ) : user && ownStateReady && canReview ? (
        <div className="product-review-compose">
          <form className="product-rating-form" onSubmit={submitRating}>
            <fieldset disabled={savingRating} aria-describedby="rating-help">
              <legend>Ваша оцінка</legend>
              <div className="product-star-options">
                {[1, 2, 3, 4, 5].map((stars) => (
                  <label className="product-star-option" key={stars}>
                    <input
                      type="radio"
                      name={`product-rating-${productId}`}
                      value={stars}
                      checked={selectedStars === String(stars)}
                      onChange={(event) => setSelectedStars(event.target.value)}
                    />
                    <span aria-hidden="true"><Icon name="star" size={18} /> {stars}</span>
                    <span className="visually-hidden">{stars} з 5</span>
                  </label>
                ))}
              </div>
              <p id="rating-help" className="product-review-help">
                Оцінка зберігається окремо від коментаря. Її можна змінити будь-коли.
              </p>
              <button className="review-primary" type="submit" disabled={!selectedStars || savingRating}>
                {savingRating ? 'Зберігаємо…' : myState?.rating ? 'Оновити оцінку' : 'Надіслати оцінку'}
              </button>
            </fieldset>
          </form>
          <form className="product-comment-form" onSubmit={(event) => void submitComment(event)}>
            <label htmlFor={`product-comment-${productId}`}>Ваш коментар</label>
            <p className="product-review-help">Ім’я візьмемо з профілю. Коментар можна додати окремо від оцінки.</p>
            <textarea
              id={`product-comment-${productId}`}
              value={commentText}
              maxLength={2000}
              rows={4}
              disabled={savingComment}
              aria-describedby={`product-comment-help-${productId}`}
              onChange={(event) => {
                setCommentText(event.target.value)
                setCommentRequestId(crypto.randomUUID())
              }}
            />
            <p id={`product-comment-help-${productId}`} className="product-review-help">
              До 2000 символів · {commentText.length}/2000
            </p>
            <div className="product-comment-actions">
              <button className="review-primary" type="submit" disabled={!commentText.trim() || savingComment}>
                {savingComment ? 'Зберігаємо…' : myState.comment ? 'Зберегти коментар' : 'Опублікувати коментар'}
              </button>
              {myState.comment && (
                <button className="review-secondary" type="button" disabled={savingComment} onClick={() => void deleteComment()}>
                  Видалити мій коментар
                </button>
              )}
            </div>
          </form>
        </div>
      ) : user ? (
        <div className="product-review-access" role="status">
          {!ownStateReady && !privateStateError
            ? 'Перевіряємо право залишити відгук…'
            : privateStateError
              ? 'Не вдалося перевірити право на відгук.'
              : 'Оцінити й коментувати можна після покупки цього товару.'}
          {privateStateError && (
            <button
              className="review-secondary"
              type="button"
              onClick={() => {
                setPrivateStateError('')
                setPrivateRetry((attempt) => attempt + 1)
              }}
            >
              Перевірити ще раз
            </button>
          )}
        </div>
      ) : (
        <div className="product-review-access">
          <span>Увійдіть, щоб залишити оцінку або коментар. Після входу повернемо вас до цього товару.</span>
          <button className="review-secondary" type="button" onClick={onRequireLogin}>Увійти або створити профіль</button>
        </div>
      )}

      <div className="product-review-columns">
        <section aria-labelledby="product-comments-title">
          <h3 id="product-comments-title">Коментарі</h3>
          {loading ? (
            <p className="product-review-empty" role="status">Завантажуємо коментарі…</p>
          ) : publicComments?.items.length ? (
            <ul className="public-review-list">
              {publicComments.items.map((comment) => (
                <li key={comment.id}>
                  <div className="public-review-meta">
                    <strong>{comment.nickname}</strong>
                    <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
                  </div>
                  <p>{comment.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="product-review-empty">Поки немає коментарів.</p>
          )}
          <nav className="review-pagination" aria-label="Сторінки коментарів">
            <span>{publicComments?.total ? `${(commentsPage - 1) * pageSize + 1}–${Math.min(commentsPage * pageSize, publicComments.total)} з ${publicComments.total}` : '0 коментарів'}</span>
            <div>
              <button type="button" className="review-secondary" disabled={loading || commentsPage <= 1} onClick={() => { setError(''); setLoading(true); setCommentsPage((page) => Math.max(1, page - 1)) }}>Попередні</button>
              <button type="button" className="review-secondary" disabled={loading || commentsPage * pageSize >= (publicComments?.total ?? 0)} onClick={() => { setError(''); setLoading(true); setCommentsPage((page) => page + 1) }}>Наступні</button>
            </div>
          </nav>
        </section>

        <details className="product-ratings-disclosure">
          <summary id="individual-ratings-title">
            Оцінки покупців <span>({ratingsTotal})</span>
          </summary>
          {loading ? (
            <p className="product-review-empty" role="status">Завантажуємо оцінки…</p>
          ) : ratings.length ? (
            <ul className="public-rating-list">
              {ratings.map((rating, index) => (
                <li key={`${rating.createdAt}-${rating.displayName}-${index}`}>
                  <strong>{rating.displayName}</strong>
                  <span aria-label={`${rating.stars} з 5`}><Icon name="star" size={16} /> {rating.stars} з 5</span>
                  <time dateTime={rating.createdAt}>{formatDateTime(rating.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="product-review-empty">Покупецьких оцінок ще немає.</p>
          )}
          <nav className="review-pagination" aria-label="Сторінки оцінок">
            <span>{ratingsTotal ? `${(ratingsPage - 1) * pageSize + 1}–${Math.min(ratingsPage * pageSize, ratingsTotal)} з ${ratingsTotal}` : '0 оцінок'}</span>
            <div>
              <button type="button" className="review-secondary" disabled={loading || ratingsPage <= 1} onClick={() => { setError(''); setLoading(true); setRatingsPage((page) => Math.max(1, page - 1)) }}>Попередні</button>
              <button type="button" className="review-secondary" disabled={loading || ratingsPage * pageSize >= ratingsTotal} onClick={() => { setError(''); setLoading(true); setRatingsPage((page) => page + 1) }}>Наступні</button>
            </div>
          </nav>
        </details>
      </div>
    </section>
  )
}
