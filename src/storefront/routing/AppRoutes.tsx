import { useEffect } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import AdminApp from '../../admin/AdminApp'
import type { CheckoutDetails, Order, User } from '../../api'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { Footer, Header } from '../components/StorefrontComponents'
import type { ToastState } from '../hooks/useToast'
import type { DisplayCategory, DisplayProduct } from '../model/displayProduct'
import type { DisplayCartItem } from '../model/cart'
import {
  About,
  Account,
  Cart,
  Checkout,
  Home,
  NotFound,
  PaymentResult,
  Wishlist,
} from '../pages'
import { CatalogRoute } from './CatalogRoute'
import { ProductRoute } from './ProductRoute'
import {
  accountModeFromSearch,
  accountPath,
  catalogFiltersFromSearch,
  catalogPath,
  defaultCatalogFilters,
  safeInternalPath,
} from './paths'
import { RouteLoading } from './RouteStates'

function currentPath(location) {
  return `${location.pathname}${location.search}`
}

type StorefrontRouteProps = {
  products: DisplayProduct[]
  categories: DisplayCategory[]
  catalogError: string
  catalogLoading: boolean
  refreshCatalog: () => Promise<boolean>
  cart: DisplayCartItem[]
  wishlist: number[]
  user: User | null
  orders: Order[]
  sessionLoading: boolean
  toast: ToastState | null
  clearToast: () => void
  onAdd: (item: DisplayProduct) => void | Promise<void>
  onWish: (id: number) => void
  onChangeQuantity: (id: number, quantity: number) => void | Promise<void>
  onAuthenticated: (account: User) => void | Promise<void>
  onLogout: () => void | Promise<void>
  onCheckout: (details: CheckoutDetails) => Promise<unknown>
}

function ProtectedRoute({ user, sessionLoading, children }) {
  const location = useLocation()
  if (sessionLoading) return <RouteLoading label="Перевіряємо сесію…" />
  if (!user) {
    return <Navigate replace to={accountPath({ mode: 'login', next: currentPath(location) })} />
  }
  return children
}

function AdminRoute({ user, sessionLoading, onExit, onLogout }) {
  const location = useLocation()
  if (sessionLoading) return <RouteLoading label="Перевіряємо доступ до адмін-панелі…" />
  if (!user)
    return <Navigate replace to={accountPath({ mode: 'login', next: currentPath(location) })} />
  if (user.role !== 'admin') return <Navigate replace to="/" />
  return <AdminApp user={user} onExit={onExit} onLogout={onLogout} />
}

function StorefrontRoutes({
  products,
  categories,
  catalogError,
  catalogLoading,
  refreshCatalog,
  cart,
  wishlist,
  user,
  orders,
  sessionLoading,
  toast,
  clearToast,
  onAdd,
  onWish,
  onChangeQuantity,
  onAuthenticated,
  onLogout,
  onCheckout,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const catalogMatch = location.pathname.match(/^\/catalog(?:\/([^/]+))?$/)
  const headerFilters = catalogMatch
    ? catalogFiltersFromSearch(location.search)
    : defaultCatalogFilters
  const availableWishlistCount = products.filter((product) => wishlist.includes(product.id)).length

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (location.hash) {
        const target = document.getElementById(location.hash.slice(1))
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash, location.pathname])

  const updateHeaderSearch = (search) => {
    navigate(
      catalogPath(null, {
        ...headerFilters,
        search,
      }),
      { replace: Boolean(catalogMatch) },
    )
  }

  const accountNext = safeInternalPath(new URLSearchParams(location.search).get('next'))
  const accountMode = accountModeFromSearch(location.search)

  return (
    <div className="app-shell">
      <Header
        key={`${location.pathname}${location.search}`}
        cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
        wishlistCount={availableWishlistCount}
        search={headerFilters.search}
        onSearchChange={updateHeaderSearch}
        categories={categories}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
      />
      <Routes>
        <Route
          path="/"
          element={
            <Home
              products={products}
              categories={categories}
              cart={cart}
              wishlist={wishlist}
              onAdd={onAdd}
              onWish={onWish}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              refreshCatalog={refreshCatalog}
            />
          }
        />
        <Route
          path="/catalog"
          element={
            <CatalogRoute
              products={products}
              categories={categories}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              refreshCatalog={refreshCatalog}
              cart={cart}
              wishlist={wishlist}
              onAdd={onAdd}
              onWish={onWish}
            />
          }
        />
        <Route
          path="/catalog/:categorySlug"
          element={
            <CatalogRoute
              products={products}
              categories={categories}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              refreshCatalog={refreshCatalog}
              cart={cart}
              wishlist={wishlist}
              onAdd={onAdd}
              onWish={onWish}
            />
          }
        />
        <Route
          path="/product/:productSlug"
          element={
            <ProductRoute
              products={products}
              cart={cart}
              wishlist={wishlist}
              onAdd={onAdd}
              onWish={onWish}
            />
          }
        />
        <Route
          path="/wishlist"
          element={
            <Wishlist
              products={products}
              categories={categories}
              wishlist={wishlist}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              refreshCatalog={refreshCatalog}
              cart={cart}
              onAdd={onAdd}
              onWish={onWish}
            />
          }
        />
        <Route
          path="/cart"
          element={
            <ProtectedRoute user={user} sessionLoading={sessionLoading}>
              <Cart cart={cart} onChange={onChangeQuantity} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkout"
          element={
            <ProtectedRoute user={user} sessionLoading={sessionLoading}>
              <Checkout cart={cart} onComplete={onCheckout} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/payment/result"
          element={
            <PaymentResult
              loading={sessionLoading}
              onSettled={async () => {
                await Promise.all([refreshCatalog()])
              }}
            />
          }
        />
        <Route
          path="/account"
          element={
            <Account
              user={user}
              mode={accountMode}
              onModeChange={(mode) => navigate(accountPath({ mode, next: accountNext ?? undefined }))}
              onAuthenticated={async (account) => {
                await onAuthenticated(account)
                navigate(accountNext ?? '/account', { replace: true })
              }}
              onLogout={onLogout}
              orders={orders}
              loading={sessionLoading}
            />
          }
        />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
      {toast && (
        <div
          className={`toast toast-${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'shield'} size={18} />
          <span>{toast.message}</span>
          <button onClick={clearToast} aria-label="Закрити сповіщення">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export function AppRoutes({
  onExitAdmin,
  ...storefrontProps
}: StorefrontRouteProps & { onExitAdmin: () => void }) {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <AdminRoute
            user={storefrontProps.user}
            sessionLoading={storefrontProps.sessionLoading}
            onExit={onExitAdmin}
            onLogout={storefrontProps.onLogout}
          />
        }
      />
      <Route path="*" element={<StorefrontRoutes {...storefrontProps} />} />
    </Routes>
  )
}
