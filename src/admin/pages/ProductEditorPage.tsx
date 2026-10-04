import { type DragEvent, type FormEvent, useEffect, useState } from 'react'
import {
  api,
  ApiClientError,
  type AdminCommunityComment,
  type AdminProduct,
  type Category,
  type InitialAdminComment,
  type ProductInput,
} from '../../api'
import { AdminError, AdminLoading, AdminTitle, EmptyState } from '../components/AdminComponents'
import {
  emptyProduct,
  formatDate,
  productToInput,
  toSlug,
  type RouteState,
} from '../model/adminModel'

export function ProductEditor({
  id,
  onNavigate,
}: {
  id?: number
  onNavigate: (route: RouteState) => void
}) {
  const [product, setProduct] = useState<AdminProduct | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [draft, setDraft] = useState<ProductInput>(emptyProduct())
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null)
  const [initialComments, setInitialComments] = useState<InitialAdminComment[]>([])
  const [initialCommentOpen, setInitialCommentOpen] = useState(false)
  const [initialNickname, setInitialNickname] = useState('')
  const [initialMessage, setInitialMessage] = useState('')
  const [initialCommentError, setInitialCommentError] = useState('')
  const [comments, setComments] = useState<AdminCommunityComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsSaving, setCommentsSaving] = useState(false)
  const [commentsPage, setCommentsPage] = useState(1)
  const [commentsTotal, setCommentsTotal] = useState(0)
  const [activeCommentCount, setActiveCommentCount] = useState(0)
  const [commentsFilter, setCommentsFilter] = useState<'active' | 'deleted' | 'all'>('active')
  const [commentNickname, setCommentNickname] = useState('')
  const [commentMessage, setCommentMessage] = useState('')
  const [adminCommentRequestId, setAdminCommentRequestId] = useState(() => crypto.randomUUID())
  const [ratingResetOpen, setRatingResetOpen] = useState(false)
  const [resetRating, setResetRating] = useState('')
  const [resetCount, setResetCount] = useState('')

  useEffect(() => {
    let active = true
    void api.admin.getCategories().then((response) => active && setCategories(response.categories))
    if (!id)
      return () => {
        active = false
      }
    void api.admin.getProduct(id).then(
      (response) => {
        if (!active) return
        setProduct(response.product)
        setDraft(productToInput(response.product))
        setCommentsLoading(true)
        setLoading(false)
      },
      (requestError) => {
        if (!active) return
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося відкрити товар')
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [id])

  const productId = product?.id
  useEffect(() => {
    if (!productId) return
    let active = true
    void api.admin
      .getProductComments(productId, { page: commentsPage, pageSize: 10, filter: commentsFilter })
      .then((response) => {
        if (!active) return
        setComments(response.comments)
        setCommentsTotal(response.total)
        setActiveCommentCount(response.commentCount)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Не вдалося завантажити коментарі')
      })
      .finally(() => active && setCommentsLoading(false))
    return () => {
      active = false
    }
  }, [productId, commentsPage, commentsFilter])

  const update = <Key extends keyof ProductInput>(key: Key, value: ProductInput[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const createPayload = { ...draft, initialComments }
    if (!product && new TextEncoder().encode(JSON.stringify(createPayload)).byteLength > 20 * 1024) {
      setError('Початкові коментарі перевищують ліміт запиту 20 КБ. Скоротіть текст або збережіть товар, а решту коментарів додайте після створення. Чернетки збережено.')
      setSaving(false)
      return
    }
    try {
      const result = product
        ? await api.admin.updateProduct(product.id, {
            name: draft.name,
            slug: draft.slug,
            categoryId: draft.categoryId,
            shortDescription: draft.shortDescription,
            description: draft.description,
            priceUah: draft.priceUah,
            oldPriceUah: draft.oldPriceUah,
            stock: draft.stock,
            status: draft.status,
            badge: draft.badge,
          })
        : await api.admin.createProduct(createPayload)
      setProduct(result.product)
      setDraft(productToInput(result.product))
      if (!product) setCommentsLoading(true)
      setInitialComments([])
      setNotice('Зміни збережено.')
      if (!id) onNavigate({ view: 'product-editor', id: result.product.id })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося зберегти товар')
    } finally {
      setSaving(false)
    }
  }

  const addInitialComment = () => {
    const nickname = initialNickname.trim()
    const message = initialMessage.trim()
    if (!nickname || !message || nickname.length > 80 || message.length > 2000) {
      setInitialCommentError('Укажіть нік і повідомлення. Перевірте ліміти: до 80 і 2000 символів.')
      return
    }
    setInitialComments((current) => [
      ...current,
      { nickname, message, clientRequestId: crypto.randomUUID() },
    ])
    setInitialNickname('')
    setInitialMessage('')
    setInitialCommentError('')
    setInitialCommentOpen(false)
  }

  const refreshComments = async (
    page = commentsPage,
    filter: typeof commentsFilter = commentsFilter,
  ) => {
    if (!product) return
    setCommentsLoading(true)
    try {
      const result = await api.admin.getProductComments(product.id, {
        page,
        pageSize: 10,
        filter,
      })
      setComments(result.comments)
      setCommentsTotal(result.total)
      setActiveCommentCount(result.commentCount)
      setCommentsPage(page)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося оновити коментарі')
    } finally {
      setCommentsLoading(false)
    }
  }

  const addAdminComment = async (event: FormEvent) => {
    event.preventDefault()
    if (!product) return
    setCommentsSaving(true)
    setError('')
    try {
      await api.admin.createProductComment(product.id, {
        nickname: commentNickname.trim(),
        message: commentMessage.trim(),
        clientRequestId: adminCommentRequestId,
      })
      setCommentNickname('')
      setCommentMessage('')
      setAdminCommentRequestId(crypto.randomUUID())
      setNotice('Коментар додано.')
      setCommentsFilter('active')
      setCommentsPage(1)
      await refreshComments(1, 'active')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося додати коментар')
    } finally {
      setCommentsSaving(false)
    }
  }

  const removeComment = async (comment: AdminCommunityComment) => {
    if (!product || comment.deletedAt || !window.confirm('Прибрати цей коментар з вітрини?')) return
    setCommentsSaving(true)
    setError('')
    try {
      await api.admin.deleteProductComment(product.id, comment.id)
      setNotice('Коментар приховано з вітрини.')
      const nextPage = comments.length === 1 && commentsPage > 1 ? commentsPage - 1 : commentsPage
      await refreshComments(nextPage)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося видалити коментар')
    } finally {
      setCommentsSaving(false)
    }
  }

  const reloadProduct = async () => {
    if (!product) return
    setError('')
    try {
      const result = await api.admin.getProduct(product.id)
      setProduct(result.product)
      setResetRating(String(result.product.baseRating))
      setResetCount(String(result.product.baseCount))
      setNotice('Зведення рейтингу оновлено. Перевірте його перед скиданням.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося оновити рейтинг')
    }
  }

  const resetProductRating = async () => {
    if (!product) return
    const rating = Number(resetRating)
    const count = Number(resetCount)
    if (
      !resetRating.trim() || !resetCount.trim() ||
      !Number.isFinite(rating) || rating < 0 || rating > 5 ||
      Math.abs(rating * 10 - Math.round(rating * 10)) > 1e-8 ||
      !Number.isInteger(count) || count < 0 || count > 1_000_000 ||
      (count > 0 && rating < 1)
    ) {
      setError('Укажіть рейтинг від 0 до 5 із кроком 0,1 та цілу кількість від 0 до 1 000 000. Для ненульової кількості рейтинг має бути від 1 до 5.')
      return
    }
    if (!window.confirm('Ця окрема операція почне новий рейтинг і виключить усі попередні оцінки. Коментарі залишаться. Продовжити?')) return
    setCommentsSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.admin.resetProductRating(product.id, {
        rating,
        count,
        expectedEpoch: product.ratingEpoch,
        expectedRevision: product.ratingRevision,
      })
      setProduct({ ...product, ...result.summary })
      setDraft((current) => ({
        ...current,
        rating: result.summary.baseRating,
        reviewCount: result.summary.baseCount,
      }))
      setResetRating(String(result.summary.baseRating))
      setResetCount(String(result.summary.baseCount))
      setRatingResetOpen(false)
      setNotice('Базовий рейтинг оновлено. Попередні голоси більше не враховуються.')
      void api.admin.getProduct(product.id)
        .then((response) => setProduct(response.product))
        .catch(() => undefined)
    } catch (requestError) {
      if (requestError instanceof ApiClientError && requestError.status === 409) {
        const requestedRating = resetRating
        const requestedCount = resetCount
        try {
          const latest = await api.admin.getProduct(product.id)
          setProduct(latest.product)
          setResetRating(requestedRating)
          setResetCount(requestedCount)
          setError('Рейтинг змінився після відкриття форми. Зведення оновлено; перевірте його та підтвердьте новий рейтинг ще раз.')
        } catch {
          setError('Рейтинг змінився. Нові значення збережено у формі; оновіть зведення перед повторним підтвердженням.')
        }
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Не вдалося скинути рейтинг')
      }
    } finally {
      setCommentsSaving(false)
    }
  }
  const upload = async () => {
    if (!product || !files.length) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.admin.uploadProductImages(product.id, files)
      setProduct(result.product)
      setFiles([])
      setNotice('Зображення завантажено.')
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося завантажити зображення',
      )
    } finally {
      setSaving(false)
    }
  }
  const saveImages = async (images: AdminProduct['images']) => {
    if (!product) return
    try {
      const result = await api.admin.updateProductImages(
        product.id,
        images.map((image, sortOrder) => ({ id: image.id, altText: image.altText, sortOrder })),
      )
      setProduct(result.product)
      setNotice('Порядок і alt-тексти збережено.')
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося оновити зображення',
      )
    }
  }
  const changeImageAlt = (imageId: string, altText: string) =>
    setProduct((current) =>
      current
        ? {
            ...current,
            images: current.images.map((image) =>
              image.id === imageId ? { ...image, altText } : image,
            ),
          }
        : current,
    )
  const moveImage = (targetId: string) => {
    if (!product || !draggedImageId || draggedImageId === targetId) return
    const images = [...product.images]
    const from = images.findIndex((image) => image.id === draggedImageId)
    const to = images.findIndex((image) => image.id === targetId)
    const [moved] = images.splice(from, 1)
    if (!moved) return
    images.splice(to, 0, moved)
    setProduct({ ...product, images })
    setDraggedImageId(null)
  }
  const removeImage = async (imageId: string) => {
    if (!product || !window.confirm('Видалити це зображення?')) return
    try {
      const result = await api.admin.deleteProductImage(product.id, imageId)
      setProduct(result.product)
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося видалити зображення',
      )
    }
  }

  if (loading) return <AdminLoading />
  if (error && !product && id) return <AdminError message={error} />
  return (
    <section className="admin-page">
      <AdminTitle
        eyebrow={product ? `Товар #${product.id}` : 'Новий запис'}
        title={product ? product.name : 'Створити товар'}
        action="До товарів"
        onAction={() => onNavigate({ view: 'products' })}
      />
      {error && <AdminError message={error} />}
      {notice && <p className="admin-notice">{notice}</p>}
      <form className="admin-editor" onSubmit={save}>
        <section className="admin-panel editor-main">
          <div className="admin-form-grid">
            <label className="wide">
              Назва
              <input
                required
                value={draft.name}
                onChange={(event) => {
                  update('name', event.target.value)
                  if (!product) update('slug', toSlug(event.target.value))
                }}
                placeholder="Наприклад, Quiet Morning"
              />
            </label>
            <label>
              Slug
              <input
                required
                value={draft.slug}
                onChange={(event) => update('slug', toSlug(event.target.value))}
                placeholder="quiet-morning"
              />
              <small>Латиниця, цифри та дефіси для URL.</small>
            </label>
            <label>
              Категорія
              <select
                value={draft.categoryId ?? ''}
                onChange={(event) => update('categoryId', event.target.value || null)}
              >
                <option value="">Без категорії</option>
                {categories
                  .filter((category) => !category.isArchived || category.id === draft.categoryId)
                  .map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="wide">
              Короткий опис
              <input
                required
                value={draft.shortDescription}
                onChange={(event) => update('shortDescription', event.target.value)}
                placeholder="Коротко для картки товару"
              />
            </label>
            <label className="wide">
              Повний опис
              <textarea
                required
                rows={5}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="Опишіть товар, матеріали, розмір або призначення"
              />
            </label>
            <label>
              Ціна, ₴
              <input
                required
                min="0"
                type="number"
                value={draft.priceUah}
                onChange={(event) => update('priceUah', Number(event.target.value))}
              />
            </label>
            <label>
              Попередня ціна, ₴
              <input
                min="0"
                type="number"
                value={draft.oldPriceUah ?? ''}
                onChange={(event) =>
                  update(
                    'oldPriceUah',
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
              />
            </label>
            <label>
              Залишок, шт.
              <input
                required
                min="0"
                type="number"
                value={draft.stock}
                onChange={(event) => update('stock', Number(event.target.value))}
              />
            </label>
            <label>
              Статус
              <select
                value={draft.status}
                onChange={(event) => update('status', event.target.value as ProductInput['status'])}
              >
                <option value="draft">Чернетка</option>
                <option value="active">Активний</option>
                <option value="archived">Архів</option>
              </select>
            </label>
            {!product ? (
              <>
                <label>
                  Ручний рейтинг
                  <input
                    required
                    min="0"
                    max="5"
                    step="0.1"
                    type="number"
                    value={draft.rating}
                    onChange={(event) => update('rating', Number(event.target.value))}
                  />
                  <small>Це ручна база. Покупецькі оцінки враховуватимуться окремо.</small>
                </label>
                <label>
                  Кількість оцінок у базі
                  <input
                    required
                    min="0"
                    max="1000000"
                    step="1"
                    type="number"
                    value={draft.reviewCount}
                    onChange={(event) => update('reviewCount', Number(event.target.value))}
                  />
                </label>
                <section className="admin-note-composer wide" aria-labelledby="initial-comments-title">
                  <div className="admin-panel-heading">
                    <div>
                      <p>Коментарі Velora</p>
                      <h2 id="initial-comments-title">Додати до товару</h2>
                    </div>
                    <button
                      className="admin-secondary"
                      type="button"
                      disabled={saving || initialComments.length >= 20}
                      aria-expanded={initialCommentOpen}
                      onClick={() => setInitialCommentOpen((open) => !open)}
                    >
                      {initialCommentOpen ? 'Закрити' : 'Додати коментар'}
                    </button>
                  </div>
                  {initialComments.length > 0 && (
                    <ul className="admin-comment-list">
                      {initialComments.map((comment) => (
                        <li key={comment.clientRequestId}>
                          <div>
                            <strong>{comment.nickname}</strong>
                            <p>{comment.message}</p>
                          </div>
                          <button
                            className="admin-secondary danger"
                            type="button"
                            disabled={saving}
                            aria-label={`Видалити чернетку коментаря від ${comment.nickname}`}
                            onClick={() => setInitialComments((current) => current.filter((item) => item.clientRequestId !== comment.clientRequestId))}
                          >
                            Видалити
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {initialCommentOpen && (
                    <div className="admin-comment-draft-form">
                      <label>
                          Нік користувача
                        <input
                          disabled={saving}
                          required
                          value={initialNickname}
                          maxLength={80}
                          onChange={(event) => {
                            setInitialNickname(event.target.value)
                            setInitialCommentError('')
                          }}
                          aria-describedby={initialCommentError ? 'initial-comment-help initial-comment-error' : 'initial-comment-help'}
                        />
                      </label>
                      <label>
                        Повідомлення
                        <textarea
                          disabled={saving}
                          required
                          value={initialMessage}
                          maxLength={2000}
                          rows={3}
                          onChange={(event) => {
                            setInitialMessage(event.target.value)
                            setInitialCommentError('')
                          }}
                          aria-describedby={initialCommentError ? 'initial-comment-help initial-comment-error' : 'initial-comment-help'}
                        />
                      </label>
                      <p id="initial-comment-help" className="admin-field-help">
                        Чернетки збережуться разом із товаром однією операцією. До 20 коментарів.
                      </p>
                      {initialCommentError && <p id="initial-comment-error" className="admin-error" role="alert">{initialCommentError}</p>}
                      <button
                        className="admin-secondary"
                        type="button"
                        disabled={saving || initialComments.length >= 20}
                        onClick={addInitialComment}
                      >
                        Додати
                      </button>
                      <button
                        className="admin-secondary"
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setInitialNickname('')
                          setInitialMessage('')
                          setInitialCommentError('')
                          setInitialCommentOpen(false)
                        }}
                      >
                        Скасувати
                      </button>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <section className="admin-rating-summary wide" aria-labelledby="rating-summary-title">
                <div className="admin-panel-heading">
                  <div>
                    <p>Оцінки покупців</p>
                    <h2 id="rating-summary-title">Рейтинг товару</h2>
                  </div>
                </div>
                <dl className="admin-rating-values">
                  <div><dt>Поточний рейтинг</dt><dd>{product.reviewCount > 0 ? `${product.rating.toFixed(1)} із 5 · ${product.reviewCount} оцінок` : 'Ще немає оцінок'}</dd></div>
                  <div><dt>Ручна база</dt><dd>{product.baseRating.toFixed(1)} · {product.baseCount} оцінок</dd></div>
                </dl>
                {!ratingResetOpen ? (
                  <button
                    className="admin-secondary"
                    type="button"
                    onClick={() => {
                      setResetRating(String(product.baseRating))
                      setResetCount(String(product.baseCount))
                      setRatingResetOpen(true)
                    }}
                  >
                    Скинути та задати рейтинг заново
                  </button>
                ) : (
                  <div className="admin-rating-reset">
                    <p>
                      Окрема операція: попередні покупецькі оцінки буде виключено, коментарі залишаться.
                      Версія: epoch {product.ratingEpoch}, revision {product.ratingRevision}.
                    </p>
                    <div className="admin-rating-reset-fields">
                      <label>
                        Новий ручний рейтинг
                        <input
                          disabled={commentsSaving}
                          required type="number" min="0" max="5" step="0.1"
                          value={resetRating} onChange={(event) => setResetRating(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void resetProductRating()
                            }
                          }}
                        />
                      </label>
                      <label>
                        Кількість оцінок
                        <input
                          disabled={commentsSaving}
                          required type="number" min="0" max="1000000" step="1"
                          value={resetCount} onChange={(event) => setResetCount(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void resetProductRating()
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="editor-actions">
                      <button className="admin-primary" type="button" disabled={commentsSaving} onClick={() => void resetProductRating()}>
                        {commentsSaving ? 'Оновлюємо…' : 'Підтвердити скидання'}
                      </button>
                      <button className="admin-secondary" type="button" onClick={() => setRatingResetOpen(false)}>
                        Скасувати
                      </button>
                      <button className="admin-link" type="button" onClick={() => void reloadProduct()}>
                        Оновити зведення
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <label className="wide">
              Бейдж
              <input
                value={draft.badge}
                onChange={(event) => update('badge', event.target.value)}
                placeholder="Наприклад, Новинка або Вибір Velora"
              />
            </label>
          </div>
          <div className="editor-actions">
            <button className="admin-primary" type="submit" disabled={saving}>
              {saving ? 'Зберігаємо…' : 'Зберегти товар'}
            </button>
            <span>
              {product
                ? `Оновлено ${formatDate(product.updatedAt)}`
                : 'Спочатку збережіть товар, щоб додати фотографії.'}
            </span>
          </div>
        </section>
        <section className="admin-panel editor-media">
          <div className="admin-panel-heading">
            <div>
              <p>Медіа</p>
              <h2>Фотографії товару</h2>
            </div>
          </div>
          {!product ? (
            <EmptyState text="Після першого збереження з’явиться завантаження файлів." />
          ) : (
            <>
              <div className="admin-upload">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 5))}
                />
                <div>
                  <b>JPG, PNG або WebP до 10 МБ</b>
                  <small>
                    {files.length
                      ? `Обрано файлів: ${files.length}`
                      : 'Файли одразу проходять серверну перевірку перед Cloudinary.'}
                  </small>
                </div>
                <button
                  type="button"
                  className="admin-secondary"
                  disabled={!files.length || saving}
                  onClick={() => void upload()}
                >
                  Завантажити
                </button>
              </div>
              <div className="admin-image-grid">
                {product.images.map((image) => (
                  <article
                    draggable
                    key={image.id}
                    className="admin-image-card"
                    onDragStart={() => setDraggedImageId(image.id)}
                    onDragOver={(event: DragEvent) => event.preventDefault()}
                    onDrop={() => moveImage(image.id)}
                  >
                    <img src={image.url} alt={image.altText || product.name} />
                    <div>
                      <span>Перетягніть для зміни порядку</span>
                      <input
                        value={image.altText}
                        onChange={(event) => changeImageAlt(image.id, event.target.value)}
                        placeholder="Alt-текст"
                      />
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void removeImage(image.id)}
                      >
                        Видалити
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {product.images.length > 0 && (
                <button
                  className="admin-secondary"
                  type="button"
                  onClick={() => void saveImages(product.images)}
                >
                  Зберегти порядок і alt-тексти
                </button>
              )}
            </>
          )}
        </section>
      </form>
      {product && (
        <section className="admin-panel admin-comments-panel" aria-labelledby="product-comments-title">
          <div className="admin-panel-heading">
            <div>
              <p>Покупці та Velora</p>
              <h2 id="product-comments-title">Коментарі · {activeCommentCount} активних</h2>
            </div>
            <label className="admin-comment-filter">
              Показати
              <select
                value={commentsFilter}
                onChange={(event) => {
                  setCommentsLoading(true)
                  setCommentsFilter(event.target.value as typeof commentsFilter)
                  setCommentsPage(1)
                }}
              >
                <option value="active">Активні</option>
                <option value="all">Усі, включно з видаленими</option>
                <option value="deleted">Видалені</option>
              </select>
            </label>
          </div>
          <form className="admin-comment-create" onSubmit={(event) => void addAdminComment(event)}>
            <label>
              Нік Velora
              <input
                required maxLength={80} value={commentNickname} disabled={commentsSaving}
                onChange={(event) => {
                  setCommentNickname(event.target.value)
                  setAdminCommentRequestId(crypto.randomUUID())
                }}
              />
            </label>
            <label>
              Повідомлення
              <textarea
                required maxLength={2000} rows={3} value={commentMessage} disabled={commentsSaving}
                onChange={(event) => {
                  setCommentMessage(event.target.value)
                  setAdminCommentRequestId(crypto.randomUUID())
                }}
              />
            </label>
            <button className="admin-primary" type="submit" disabled={commentsSaving || !commentNickname.trim() || !commentMessage.trim()}>
              {commentsSaving ? 'Зберігаємо…' : 'Додати коментар Velora'}
            </button>
          </form>
          {commentsLoading ? (
            <p className="admin-comments-state" role="status">Завантажуємо коментарі…</p>
          ) : comments.length === 0 ? (
            <p className="admin-comments-state">На цій сторінці коментарів немає.</p>
          ) : (
            <ul className="admin-comment-list admin-managed-comments">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <div className="admin-managed-comment-copy">
                    <div className="admin-comment-meta">
                      <strong>{comment.nickname}</strong>
                      <span className="status">{comment.source === 'customer' ? 'Покупець' : 'Додано адміністратором'}</span>
                      {comment.deletedAt && <span className="status product-archived">Видалено</span>}
                      <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                    </div>
                    <p>{comment.message}</p>
                  </div>
                  {!comment.deletedAt && (
                    <button
                      className="admin-secondary danger"
                      type="button"
                      disabled={commentsSaving}
                      aria-label={`Видалити коментар від ${comment.nickname}`}
                      onClick={() => void removeComment(comment)}
                    >
                      Видалити
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="admin-comments-pagination">
            <span>{commentsTotal ? `${(commentsPage - 1) * 10 + 1}–${Math.min(commentsPage * 10, commentsTotal)} з ${commentsTotal}` : '0 коментарів'}</span>
            <div>
              <button
                className="admin-secondary"
                type="button"
                disabled={commentsLoading || commentsPage <= 1}
                onClick={() => void refreshComments(commentsPage - 1)}
              >
                Попередні
              </button>
              <button
                className="admin-secondary"
                type="button"
                disabled={commentsLoading || commentsPage * 10 >= commentsTotal}
                onClick={() => void refreshComments(commentsPage + 1)}
              >
                Наступні
              </button>
            </div>
          </div>
        </section>
      )}
    </section>
  )
}

