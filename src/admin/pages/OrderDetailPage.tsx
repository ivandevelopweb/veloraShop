import { useEffect, useMemo, useState } from 'react'
import { api, type AdminOrder, type AdminOrderDetails } from '../../api'
import { AdminError, AdminLoading, AdminTitle } from '../components/AdminComponents'
import { formatDate, formatPrice, statusLabel, type RouteState } from '../model/adminModel'

export function OrderDetail({
  code,
  onNavigate,
}: {
  code: string
  onNavigate: (route: RouteState) => void
}) {
  const [order, setOrder] = useState<AdminOrderDetails | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    void api.admin.getOrder(code).then(
      (response) => active && setOrder(response.order),
      (requestError) =>
        active &&
        setError(
          requestError instanceof Error ? requestError.message : 'Не вдалося відкрити замовлення',
        ),
    )
    return () => {
      active = false
    }
  }, [code])
  const available = useMemo(
    () =>
      order
        ? (
            {
              new: ['processing', 'cancelled'],
              processing: ['shipped', 'cancelled'],
              shipped: ['completed'],
              completed: [],
              cancelled: [],
            } as const
          )[order.status]
        : [],
    [order],
  )
  const changeStatus = async (status: AdminOrder['status']) => {
    if (!order || status === order.status) return
    setSaving(true)
    try {
      await api.admin.updateOrderStatus(order.code, status)
      const response = await api.admin.getOrder(order.code)
      setOrder(response.order)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося змінити статус')
    } finally {
      setSaving(false)
    }
  }
  if (error && !order) return <AdminError message={error} />
  if (!order) return <AdminLoading />
  return (
    <section className="admin-page">
      <AdminTitle
        eyebrow="Замовлення"
        title={order.code}
        action="До замовлень"
        onAction={() => onNavigate({ view: 'orders' })}
      />
      {error && <AdminError message={error} />}
      <div className="admin-order-layout">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p>Склад замовлення</p>
              <h2>{order.customerName}</h2>
            </div>
            <strong className="admin-order-total">{formatPrice(order.total)}</strong>
          </div>
          <div className="admin-order-items">
            {order.items.map((item) => (
              <div key={`${item.productId}-${item.name}`}>
                <span>
                  <b>{item.name}</b>
                  <small>
                    {item.quantity} × {formatPrice(item.price)}
                  </small>
                </span>
                <b>{formatPrice(item.quantity * item.price)}</b>
              </div>
            ))}
          </div>
          <div className="admin-customer">
            <span>
              Доставка
              <b>{order.deliveryMethod === 'nova_poshta' ? 'Нова пошта' : 'Кур’єр Velora'}</b>
              <small>
                {order.deliveryCity} · {order.deliveryBranch}
              </small>
            </span>
            <span>
              Контакти<b>{order.customerEmail}</b>
              <small>{order.customerPhone}</small>
            </span>
          </div>
        </section>
        <aside className="admin-panel">
          <p>Статус</p>
          <h2>
            <span className={`status status-${order.status}`}>{statusLabel[order.status]}</span>
          </h2>
          {available.length > 0 && (
            <select
              disabled={saving}
              value={order.status}
              onChange={(event) => void changeStatus(event.target.value as AdminOrder['status'])}
            >
              <option value={order.status}>{statusLabel[order.status]}</option>
              {available.map((value) => (
                <option value={value} key={value}>
                  {statusLabel[value]}
                </option>
              ))}
            </select>
          )}
          <hr />
          <p>Історія</p>
          <div className="admin-events">
            {order.events.map((event, index) => (
              <div key={`${event.createdAt}-${index}`}>
                <b>
                  {event.previousStatus
                    ? `${statusLabel[event.previousStatus as AdminOrder['status']]} → `
                    : ''}
                  {statusLabel[event.nextStatus as AdminOrder['status']]}
                </b>
                <small>{formatDate(event.createdAt)}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

