import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api, ApiClientError, bootstrapCsrf, type CartItem, type Order, type User } from '../api'
import '../App.css'
import '../fullbleed.css'
import { readStoredJson } from '../shared/lib/storage'
import { Icon } from '../shared/ui/Icon'
import { Footer, Header } from './components/StorefrontComponents'
import { hydrateCartItems } from './model/cart'
import { type DisplayProduct } from './model/displayProduct'
import { useCatalog } from './hooks/useCatalog'
import { useToast } from './hooks/useToast'
import { About, Account, Cart, Catalog, Checkout, Home, ProductView } from './pages'

const AdminApp = lazy(() => import('../admin/AdminApp'))

export default function StorefrontApp() {
  const [page, setPage] = useState(() =>
    window.location.pathname.startsWith('/admin') ? 'admin' : 'home',
  )
  const [activeCategory, setActiveCategory] = useState('Усе')
  const [search, setSearch] = useState('')
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [wishlist, setWishlist] = useState<number[]>(() => readStoredJson('velora-wishlist', []))
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [sessionLoading, setSessionLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login')
  const { products, categories, catalogError, refreshCatalog } = useCatalog()
  const { toast, setToast } = useToast()

  const cart = useMemo(() => hydrateCartItems(products, cartItems), [cartItems, products])
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  )

  const applyCart = (items: CartItem[]) => setCartItems(items)

  const syncCart = async () => {
    const response = await api.getCart()
    applyCart(response.items)
  }

  const syncOrders = async () => {
    const response = await api.getOrders()
    setOrders(response.orders)
  }

  useEffect(() => {
    let isCurrent = true

    const restoreSession = async () => {
      try {
        await bootstrapCsrf()
        const response = await api.me()
        if (!isCurrent) return
        setUser(response.user)
        const [cartResponse, orderResponse] = await Promise.all([api.getCart(), api.getOrders()])
        if (!isCurrent) return
        applyCart(cartResponse.items)
        setOrders(orderResponse.orders)
      } catch (error) {
        if (isCurrent && !(error instanceof ApiClientError && error.status === 401)) {
          setToast('Не вдалося з’єднатися з сервером. Спробуйте оновити сторінку.')
        }
      } finally {
        if (isCurrent) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      isCurrent = false
    }
  }, [setToast])

  useEffect(() => {
    localStorage.setItem('velora-wishlist', JSON.stringify(wishlist))
  }, [wishlist])
  useEffect(() => {
    if (catalogError) setToast('Не вдалося завантажити каталог. Спробуйте оновити сторінку.')
  }, [catalogError, setToast])
  useEffect(() => {
    if (page !== 'admin' || sessionLoading) return
    if (user?.role === 'admin') return
    window.location.replace('/')
  }, [page, sessionLoading, user])
  const navigate = (next) => {
    if (!user && (next === 'cart' || next === 'checkout')) {
      setAuthMode('login')
      setToast('Щоб перейти до кошика, увійдіть або створіть профіль.')
      setPage('account')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (window.location.pathname.startsWith('/admin')) window.history.pushState(null, '', '/')
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const catalog = (category = 'Усе') => {
    setActiveCategory(category)
    setSearch('')
    navigate('catalog')
  }
  const openAdmin = () => {
    if (user?.role !== 'admin') {
      setAuthMode('login')
      setPage('account')
      setToast('Увійдіть як адміністратор, щоб продовжити.')
      return
    }
    window.history.pushState(null, '', '/admin')
    setPage('admin')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const openProduct = (item: DisplayProduct) => {
    setSelectedProductId(item.id)
    navigate('product')
  }
  const showRegistration = (message) => {
    setAuthMode('register')
    setToast(message)
    setPage('account')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const add = async (item) => {
    if (!user) {
      showRegistration('Щоб додати товар до кошика, створіть профіль або увійдіть.')
      return
    }

    try {
      const response = await api.addToCart(item.id)
      applyCart(response.items)
      setToast(`${item.name} додано до кошика`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null)
        setCartItems([])
        showRegistration('Сесія завершилася. Увійдіть знову, щоб додати товар.')
        return
      }
      setToast(error instanceof Error ? error.message : 'Не вдалося оновити кошик.')
    }
  }

  const changeQuantity = async (id, quantity) => {
    if (!user) return
    try {
      const response =
        quantity <= 0 ? await api.removeFromCart(id) : await api.updateCart(id, quantity)
      applyCart(response.items)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не вдалося оновити кошик.')
    }
  }

  const authenticated = async (account) => {
    setUser(account)
    try {
      await Promise.all([syncCart(), syncOrders()])
      setToast(`Вітаємо, ${account.name}! Ваш профіль готовий.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не вдалося завантажити дані профілю.')
    }
  }

  const logout = async () => {
    try {
      await api.logout()
      setUser(null)
      setCartItems([])
      setOrders([])
      setToast('Ви вийшли з профілю.')
      navigate('home')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не вдалося завершити сесію.')
    }
  }

  const createOrder = async (details) => {
    try {
      const response = await api.createOrder({
        ...details,
        firstName: String(details.firstName),
        lastName: String(details.lastName),
        phone: String(details.phone),
        email: String(details.email),
        city: String(details.city),
        branch: String(details.branch),
      })
      setCartItems([])
      await Promise.all([syncOrders(), refreshCatalog()])
      return response.order
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null)
        setCartItems([])
        showRegistration('Увійдіть до профілю, щоб завершити оформлення.')
      }
      throw error
    }
  }

  const wish = (id) =>
    setWishlist((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  if (page === 'admin') {
    if (sessionLoading) {
      return (
        <div className="app-shell admin-route-loading">Перевіряємо доступ до адмін-панелі…</div>
      )
    }
    if (user?.role === 'admin') {
      return (
        <Suspense
          fallback={<div className="app-shell admin-route-loading">Відкриваємо адмін-панель…</div>}
        >
          <AdminApp
            user={user}
            onExit={() => {
              void refreshCatalog()
              navigate('home')
            }}
            onLogout={logout}
          />
        </Suspense>
      )
    }
    return null
  }
  return (
    <div className="app-shell">
      <Header
        cartCount={cartCount}
        onNavigate={navigate}
        onCatalog={catalog}
        search={search}
        setSearch={setSearch}
      />
      {page === 'home' && (
        <Home
          products={products}
          categories={categories}
          onCatalog={catalog}
          onOpen={openProduct}
          cart={cart}
          wishlist={wishlist}
          onAdd={add}
          onWish={wish}
        />
      )}
      {page === 'catalog' && (
        <Catalog
          products={products}
          categories={categories}
          activeCategory={activeCategory}
          setCategory={setActiveCategory}
          search={search}
          setSearch={setSearch}
          cart={cart}
          wishlist={wishlist}
          onAdd={add}
          onOpen={openProduct}
          onWish={wish}
        />
      )}
      {page === 'product' && selectedProduct && (
        <ProductView
          products={products}
          item={selectedProduct}
          cart={cart}
          wishlist={wishlist}
          onAdd={add}
          onWish={wish}
          onCatalog={catalog}
          onOpen={openProduct}
        />
      )}
      {page === 'cart' && <Cart cart={cart} onChange={changeQuantity} onNavigate={navigate} />}
      {page === 'checkout' && (
        <Checkout cart={cart} onNavigate={navigate} onComplete={createOrder} />
      )}
      {page === 'account' && (
        <Account
          onNavigate={navigate}
          user={user}
          mode={authMode}
          onModeChange={setAuthMode}
          onAuthenticated={authenticated}
          onLogout={logout}
          onAdmin={openAdmin}
          orders={orders}
          loading={sessionLoading}
        />
      )}
      {page === 'about' && <About onNavigate={navigate} />}
      <Footer onNavigate={navigate} onCatalog={catalog} />
      {toast && (
        <div className="toast">
          <Icon name="check" size={18} />
          {toast}
          <button onClick={() => setToast('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

