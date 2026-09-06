import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiClientError, bootstrapCsrf, type CartItem, type Order, type User } from '../api'
import '../App.css'
import '../fullbleed.css'
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
  const { toast, setToast } = useToast()

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

  const showAuthentication = (message: string, mode: 'login' | 'register' = 'register') => {
    setToast(message)
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
      setToast(`${item.name} додано до кошика`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null)
        setCartItems([])
        showAuthentication('Сесія завершилася. Увійдіть знову, щоб додати товар.', 'login')
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
      navigate('/')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Не вдалося завершити сесію.')
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
      setToast={setToast}
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
