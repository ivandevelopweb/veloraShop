import { useEffect, useState } from 'react'
import { api, type AdminOrder } from '../../api'
import { AdminError, AdminLoading, AdminTitle, EmptyState } from '../components/AdminComponents'
import { formatDate, formatPrice, statusLabel, type RouteState } from '../model/adminModel'

export function Dashboard({ onNavigate }: { onNavigate: (route: RouteState) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.dashboard>> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api.admin.dashboard().then(
      (response) => active && setData(response),
      (requestError) =>
        active &&
        setError(
          requestError instanceof Error ? requestError.message : 'Не вдалося завантажити дані',
        ),
    )
    return () => {
      active = false
    }
  }, [])

  if (error) return <AdminError message={error} />
  if (!data) return <AdminLoading />
  const metrics = [
    ['Виручка', formatPrice(data.orders.revenueUah), 'Лише підтверджені LiqPay платежі'],
    ['Відкриті замовлення', String(data.orders.openOrders), `Усього: ${data.orders.totalOrders}`],
    [
      'Активні товари',
      String(data.catalog.activeProducts),
      `Чернеток: ${data.catalog.draftProducts}`,
    ],
    [
      'Одиниць на складі',
      String(data.catalog.totalStock),
      `Архів: ${data.catalog.archivedProducts}`,
    ],
  ]
  return (
    <section className="admin-page">
      <AdminTitle
        eyebrow="Операційний центр"
        title="Доброго дня, команда."
        action="Додати товар"
        onAction={() => onNavigate({ view: 'product-editor' })}
      />
      <div className="admin-metrics">
        {metrics.map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="admin-two-columns">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p>Останні замовлення</p>
              <h2>Пульс магазину</h2>
            </div>
            <button className="admin-link" onClick={() => onNavigate({ view: 'orders' })}>
              Усі замовлення
            </button>
          </div>
          {data.recentOrders.length ? (
            <div className="admin-mini-list">
              {data.recentOrders.map((order) => (
                <button
                  key={order.code}
                  onClick={() => onNavigate({ view: 'order-detail', code: order.code })}
                >
                  <span>
                    <b>{order.code}</b>
                    <small>
                      {order.customerName} · {formatDate(order.createdAt)}
                    </small>
                  </span>
                  <span>
                    <b>{formatPrice(order.total)}</b>
                    <small className={`status status-${order.status}`}>
                      {statusLabel[order.status as AdminOrder['status']]}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text="Перші замовлення з’являться тут після оформлення на вітрині." />
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p>Потребує уваги</p>
              <h2>Низькі залишки</h2>
            </div>
            <button className="admin-link" onClick={() => onNavigate({ view: 'products' })}>
              Каталог
            </button>
          </div>
          {data.lowStock.length ? (
            <div className="admin-mini-list low-stock-list">
              {data.lowStock.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate({ view: 'product-editor', id: item.id })}
                >
                  <span>
                    <b>{item.name}</b>
                    <small>Артикул #{item.id}</small>
                  </span>
                  <em>{item.stock} шт.</em>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text="У всіх активних товарах запас вищий за п’ять одиниць." />
          )}
        </section>
      </div>
    </section>
  )
}

