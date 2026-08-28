import { useEffect, useState } from 'react'
import { api, type AdminProduct, type Category } from '../../api'
import { AdminError, AdminLoading, AdminTitle, EmptyState } from '../components/AdminComponents'
import { formatPrice, productStatusLabel, type RouteState } from '../model/adminModel'

export function Products({ onNavigate }: { onNavigate: (route: RouteState) => void }) {
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | AdminProduct['status']>('all')
  const [categoryId, setCategoryId] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.all([
      api.admin.getProducts({
        page,
        pageSize: 12,
        search,
        status,
        categoryId: categoryId || undefined,
      }),
      api.admin.getCategories(),
    ]).then(
      ([productResponse, categoryResponse]) => {
        if (!active) return
        setProducts(productResponse.products)
        setTotal(productResponse.total)
        setCategories(categoryResponse.categories)
        setLoading(false)
      },
      (requestError) => {
        if (!active) return
        setError(
          requestError instanceof Error ? requestError.message : 'Не вдалося завантажити каталог',
        )
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [page, search, status, categoryId])

  const pageCount = Math.max(1, Math.ceil(total / 12))
  const remove = async (product: AdminProduct) => {
    if (!window.confirm(`Остаточно видалити «${product.name}»? Цю дію не можна скасувати.`)) return
    try {
      await api.admin.deleteProduct(product.id)
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setTotal((current) => current - 1)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося видалити товар')
    }
  }

  return (
    <section className="admin-page">
      <AdminTitle
        eyebrow="Каталог"
        title="Товари"
        action="Новий товар"
        onAction={() => onNavigate({ view: 'product-editor' })}
      />
      <div className="admin-toolbar">
        <input
          value={search}
          onChange={(event) => {
            setPage(1)
            setSearch(event.target.value)
          }}
          placeholder="Пошук за назвою або slug"
        />
        <select
          value={status}
          onChange={(event) => {
            setPage(1)
            setStatus(event.target.value as typeof status)
          }}
        >
          <option value="all">Усі статуси</option>
          <option value="active">Активні</option>
          <option value="draft">Чернетки</option>
          <option value="archived">Архів</option>
        </select>
        <select
          value={categoryId}
          onChange={(event) => {
            setPage(1)
            setCategoryId(event.target.value)
          }}
        >
          <option value="">Усі категорії</option>
          {categories.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      {error && <AdminError message={error} />}
      {loading ? (
        <AdminLoading />
      ) : (
        <section className="admin-panel admin-table-panel">
          <div className="admin-table-caption">
            <span>{total} позицій</span>
            <span>
              Сторінка {page} з {pageCount}
            </span>
          </div>
          {products.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Категорія</th>
                    <th>Ціна</th>
                    <th>Запас</th>
                    <th>Статус</th>
                    <th aria-label="Дії" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <button
                          className="admin-product-cell"
                          onClick={() => onNavigate({ view: 'product-editor', id: product.id })}
                        >
                          <img src={product.images[0]?.url} alt="" />
                          <span>
                            <b>{product.name}</b>
                            <small>
                              #{product.id} · {product.slug}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>{product.categoryName ?? 'Без категорії'}</td>
                      <td>
                        <b>{formatPrice(product.priceUah)}</b>
                      </td>
                      <td>{product.stock} шт.</td>
                      <td>
                        <span className={`status product-${product.status}`}>
                          {productStatusLabel[product.status]}
                        </span>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            onClick={() => onNavigate({ view: 'product-editor', id: product.id })}
                          >
                            Редагувати
                          </button>
                          <button className="danger" onClick={() => void remove(product)}>
                            Видалити
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text="За цими фільтрами товарів немає." />
          )}
          <div className="admin-pagination">
            <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
              Назад
            </button>
            <button disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>
              Далі
            </button>
          </div>
        </section>
      )}
    </section>
  )
}

