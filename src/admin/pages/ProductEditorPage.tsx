import { type DragEvent, type FormEvent, useEffect, useState } from 'react'
import { api, type AdminProduct, type Category, type ProductInput } from '../../api'
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

  const update = <Key extends keyof ProductInput>(key: Key, value: ProductInput[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = product
        ? await api.admin.updateProduct(product.id, draft)
        : await api.admin.createProduct(draft)
      setProduct(result.product)
      setDraft(productToInput(result.product))
      setNotice('Зміни збережено.')
      if (!id) onNavigate({ view: 'product-editor', id: result.product.id })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося зберегти товар')
    } finally {
      setSaving(false)
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
            <label>
              Рейтинг
              <input
                required
                min="0"
                max="5"
                step="0.1"
                type="number"
                value={draft.rating}
                onChange={(event) => update('rating', Number(event.target.value))}
              />
            </label>
            <label>
              Кількість відгуків
              <input
                required
                min="0"
                type="number"
                value={draft.reviewCount}
                onChange={(event) => update('reviewCount', Number(event.target.value))}
              />
            </label>
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
    </section>
  )
}

