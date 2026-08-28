import type { User } from '../../api'
import veloraLogo from '../../assets/velora-logo.png'
import type { AdminView, RouteState } from '../model/adminModel'

export function AdminSidebar({
  route,
  onNavigate,
  onExit,
  onLogout,
  user,
}: {
  route: RouteState
  onNavigate: (route: RouteState) => void
  onExit: () => void
  onLogout: () => void
  user: User
}) {
  const links: Array<{ view: AdminView; label: string }> = [
    { view: 'dashboard', label: 'Огляд' },
    { view: 'products', label: 'Товари' },
    { view: 'orders', label: 'Замовлення' },
    { view: 'categories', label: 'Категорії' },
  ]
  return (
    <aside className="admin-sidebar">
      <button className="admin-brand" onClick={() => onNavigate({ view: 'dashboard' })}>
        <img src={veloraLogo} alt="Velora" />
        <span>VELORA</span>
        <small>Studio</small>
      </button>
      <nav aria-label="Адміністративна навігація">
        {links.map((link) => (
          <button
            className={
              route.view === link.view ||
              (link.view === 'products' && route.view === 'product-editor')
                ? 'active'
                : ''
            }
            key={link.view}
            onClick={() => onNavigate({ view: link.view })}
          >
            {link.label}
          </button>
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <span className="admin-user-initial">{user.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{user.name}</b>
          <small>Адміністратор</small>
        </div>
        <button className="admin-text-button" onClick={onExit}>
          До магазину
        </button>
        <button className="admin-text-button muted" onClick={onLogout}>
          Вийти
        </button>
      </div>
    </aside>
  )
}


export function AdminTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <header className="admin-title">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action && onAction && (
        <button className="admin-primary" onClick={onAction}>
          {action}
        </button>
      )}
    </header>
  )
}
export function AdminLoading() {
  return (
    <section className="admin-page">
      <div className="admin-loading">Завантажуємо дані Velora…</div>
    </section>
  )
}
export function AdminError({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      {message}
    </p>
  )
}
export function EmptyState({ text }: { text: string }) {
  return <div className="admin-empty">{text}</div>
}
