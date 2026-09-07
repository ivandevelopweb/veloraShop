import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiClientError, bootstrapCsrf, type CartItem, type Order, type User } from '../api'
import '../App.css'
import { readStoredJson } from '../shared/lib/storage'
import { hydrateCartItems } from './model/cart'
import { useCatalog } from './hooks/useCatalog'
import { useToast } from './hooks/useToast'
import { AppRoutes } from './routing/AppRoutes'
import { accountPath } from './routing/paths'

export default function StorefrontApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [wishlist, setWishlist] = useState<number[]>(() => readStoredJson('velora-wishlist', []))
  const [user, setUser] = useState<User | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [sessionLoading, setSessionLoading] = useState(true)
  const { products, categories, catalogError, catalogLoading, refreshCatalog } = useCatalog()
  const { toast, notify, clearToast } = useToast()

  const cart = useMemo(() => hydrateCartItems(products, cartItems), [cartItems, products])
  const currentPath = `${location.pathname}${location.search}`
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
          notify('Не вдалося з’єднатися з сервером. Спробуйте оновити сторінку.', 'error')
        }
      } finally {
        if (isCurrent) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      isCurrent = false
    }
  }, [notify])

  useEffect(() => {
    localStorage.setItem('velora-wishlist', JSON.stringify(wishlist))
  }, [wishlist])

  useEffect(() => {
    if (catalogError) notify('Не вдалося завантажити каталог. Спробуйте оновити сторінку.', 'error')
  }, [catalogError, notify])

  const showAuthentication = (message: string, mode: 'login' | 'register' = 'register') => {
    notify(message, 'status')
    navigate(accountPath({ mode, next: currentPath }))
  }

  const add = async (item) => {
    if (!user) {
      showAuthentication('Щоб додати товар до кошика, створіть профіль або увійдіть.')
      return
    }

    try {
      const response = await api.addToCart(item.id)
      applyCart(response.items)
      notify(`${item.name} додано до кошика`, 'success')
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null)
        setCartItems([])
        showAuthentication('Сесія завершилася. Увійдіть знову, щоб додати товар.', 'login')
        return
      }
      notify(error instanceof Error ? error.message : 'Не вдалося оновити кошик.', 'error')
    }
  }

  const changeQuantity = async (id, quantity) => {
    if (!user) return
    try {
      const response =
        quantity <= 0 ? await api.removeFromCart(id) : await api.updateCart(id, quantity)
      applyCart(response.items)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не вдалося оновити кошик.', 'error')
    }
  }

  const authenticated = async (account) => {
    setUser(account)
    try {
      await Promise.all([syncCart(), syncOrders()])
      notify(`Вітаємо, ${account.name}! Ваш профіль готовий.`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не вдалося завантажити дані профілю.', 'error')
    }
  }

  const logout = async () => {
    try {
      await api.logout()
      setUser(null)
      setCartItems([])
      setOrders([])
      notify('Ви вийшли з профілю.', 'success')
      navigate('/')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не вдалося завершити сесію.', 'error')
    }
  }

  const createLiqpayCheckout = async (details) => {
    try {
      const response = await api.createLiqpayCheckout({
        ...details,
        firstName: String(details.firstName),
        lastName: String(details.lastName),
        phone: String(details.phone),
        email: String(details.email),
        city: String(details.city),
        branch: String(details.branch),
      })
      await syncOrders()
      return response
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null)
        setCartItems([])
        showAuthentication('Увійдіть до профілю, щоб завершити оформлення.', 'login')
      }
      throw error
    }
  }

  const wish = (id) =>
    setWishlist((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )

  return (
    <AppRoutes
      products={products}
      categories={categories}
      catalogError={catalogError}
      catalogLoading={catalogLoading}
      refreshCatalog={refreshCatalog}
      cart={cart}
      wishlist={wishlist}
      user={user}
      orders={orders}
      sessionLoading={sessionLoading}
      toast={toast}
      clearToast={clearToast}
      onAdd={add}
      onWish={wish}
      onChangeQuantity={changeQuantity}
      onAuthenticated={authenticated}
      onLogout={logout}
      onCheckout={createLiqpayCheckout}
      onExitAdmin={() => {
        void refreshCatalog()
        navigate('/')
      }}
    />
  )
}
