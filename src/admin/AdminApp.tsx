import { useEffect, useState } from 'react'
import type { User } from '../api'
import '../admin.css'
import { AdminSidebar } from './components/AdminComponents'
import { pathForRoute, routeFromLocation, type RouteState } from './model/adminModel'
import {
  Categories,
  Dashboard,
  OrderDetail,
  Orders,
  ProductEditor,
  Products,
} from './pages'

export default function AdminApp({
  user,
  onExit,
  onLogout,
}: {
  user: User
  onExit: () => void
  onLogout: () => void
}) {
  const [route, setRoute] = useState<RouteState>(routeFromLocation)
  const navigate = (next: RouteState) => {
    window.history.pushState(null, '', pathForRoute(next))
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    const handler = () => setRoute(routeFromLocation())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  return (
    <main className="admin-shell">
      <AdminSidebar route={route} onNavigate={navigate} onExit={onExit} onLogout={onLogout} user={user} />
      <div className="admin-content">
        {route.view === 'dashboard' && <Dashboard onNavigate={navigate} />}
        {route.view === 'products' && <Products onNavigate={navigate} />}
        {route.view === 'product-editor' && <ProductEditor id={route.id} onNavigate={navigate} />}
        {route.view === 'orders' && <Orders onNavigate={navigate} />}
        {route.view === 'order-detail' && route.code && (
          <OrderDetail code={route.code} onNavigate={navigate} />
        )}
        {route.view === 'categories' && <Categories />}
      </div>
    </main>
  )
}
