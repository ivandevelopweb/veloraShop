import { useEffect, useState } from 'react'
import { api, type AdminOrder } from '../../api'
import { AdminError, AdminTitle, EmptyState } from '../components/AdminComponents'
import {
  formatDate,
  formatPrice,
  paymentStatusLabel,
  statusLabel,
  type RouteState,
} from '../model/adminModel'

export function Orders({ onNavigate }: { onNavigate: (route: RouteState) => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [status, setStatus] = useState<'all' | AdminOrder['status']>('all')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void api.admin.getOrders({ status }).then(
      (response) => active && setOrders(response.orders),
      (requestError) =>
        active &&
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Не вдалося завантажити замовлення',
        ),
    )
    return () => {
      active = false
    }
  }, [status])
  return (
    <section className="admin-page">
      <AdminTitle eyebrow="Продажі" title="Замовлення" />
      <div className="admin-toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="all">Усі статуси</option>
          {Object.entries(statusLabel).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && <AdminError message={error} />}
      <section className="admin-panel admin-table-panel">
        {orders.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Замовлення</th>
                  <th>Клієнт</th>
                  <th>Сума</th>
                  <th>Оплата</th>
                  <th>Статус</th>
                  <th>Створено</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.code}>
                    <td>
                      <button
                        className="admin-code"
                        onClick={() => onNavigate({ view: 'order-detail', code: order.code })}
                      >
                        {order.code}
                      </button>
                    </td>
                    <td>
                      <b>{order.customerName}</b>
                      <small>{order.customerEmail}</small>
                    </td>
                    <td>
                      <b>{formatPrice(order.total)}</b>
                    </td>
                    <td>
                      <span className={`status payment-status payment-${order.paymentStatus}`}>
                        {paymentStatusLabel[order.paymentStatus]}
                      </span>
                      {order.paymentProvider && <small>{order.paymentProvider}</small>}
                    </td>
                    <td>
                      <span className={`status status-${order.status}`}>
                        {statusLabel[order.status]}
                      </span>
                    </td>
                    <td>{formatDate(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="За цим статусом замовлень немає." />
        )}
      </section>
    </section>
  )
}

