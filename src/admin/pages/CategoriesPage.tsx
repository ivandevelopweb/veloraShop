import { type FormEvent, useEffect, useState } from 'react'
import { api, type Category } from '../../api'
import { AdminError, AdminTitle } from '../components/AdminComponents'
import { toSlug } from '../model/adminModel'

export function Categories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', isArchived: false })
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const response = await api.admin.getCategories()
      setCategories(response.categories)
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося завантажити категорії',
      )
    }
  }
  useEffect(() => {
    let active = true
    void api.admin.getCategories().then(
      (response) => active && setCategories(response.categories),
      (requestError) =>
        active &&
        setError(
          requestError instanceof Error ? requestError.message : 'Не вдалося завантажити категорії',
        ),
    )
    return () => {
      active = false
    }
  }, [])
  const reset = () => {
    setEditing(null)
    setForm({ name: '', slug: '', description: '', isArchived: false })
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      if (editing) await api.admin.updateCategory(editing.id, form)
      else await api.admin.createCategory(form)
      reset()
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося зберегти категорію',
      )
    }
  }
  const edit = (category: Category) => {
    setEditing(category)
    setForm({
      name: category.name,
      slug: category.slug,
      description: category.description,
      isArchived: Boolean(category.isArchived),
    })
  }
  const remove = async (category: Category) => {
    if (!window.confirm(`Видалити категорію «${category.name}»?`)) return
    try {
      await api.admin.deleteCategory(category.id)
      await load()
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не вдалося видалити категорію',
      )
    }
  }
  return (
    <section className="admin-page">
      <AdminTitle eyebrow="Структура каталогу" title="Категорії" />
      {error && <AdminError message={error} />}
      <div className="admin-two-columns categories-layout">
        <form className="admin-panel admin-category-form" onSubmit={save}>
          <p>{editing ? 'Редагування' : 'Нова категорія'}</p>
          <h2>{editing ? editing.name : 'Додайте напрям'}</h2>
          <label>
            Назва
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                  slug: editing ? current.slug : toSlug(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Slug
            <input
              required
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: toSlug(event.target.value) }))
              }
            />
          </label>
          <label>
            Опис
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={form.isArchived}
              onChange={(event) =>
                setForm((current) => ({ ...current, isArchived: event.target.checked }))
              }
            />{' '}
            Архівна категорія
          </label>
          <div className="editor-actions">
            <button className="admin-primary" type="submit">
              {editing ? 'Зберегти' : 'Створити'}
            </button>
            {editing && (
              <button className="admin-secondary" type="button" onClick={reset}>
                Скасувати
              </button>
            )}
          </div>
        </form>
        <section className="admin-panel">
          {' '}
          <div className="admin-panel-heading">
            <div>
              <p>Усі категорії</p>
              <h2>{categories.length} напрямів</h2>
            </div>
          </div>
          <div className="admin-category-list">
            {categories.map((category) => (
              <article key={category.id}>
                <div>
                  <b>{category.name}</b>
                  <small>
                    {category.slug} · {category.productCount ?? 0} товарів
                  </small>
                  <p>{category.description || 'Без опису'}</p>
                </div>
                <div>
                  <span
                    className={
                      category.isArchived ? 'status product-archived' : 'status product-active'
                    }
                  >
                    {category.isArchived ? 'Архів' : 'Активна'}
                  </span>
                  <button onClick={() => edit(category)}>Редагувати</button>
                  <button
                    className="danger"
                    disabled={Boolean(category.productCount)}
                    onClick={() => void remove(category)}
                  >
                    Видалити
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

