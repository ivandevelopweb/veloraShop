import { useState } from 'react'
import { api } from '../../api'
import { formatPrice } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'

const price = formatPrice
const paymentStatusLabel = {
  pending: 'Очікуємо підтвердження LiqPay',
  paid: 'Оплату підтверджено',
  failed: 'Оплата не пройшла',
  cancelled: 'Оплату скасовано',
}

export function Account({
  onNavigate,
  user,
  mode,
  onModeChange,
  onAuthenticated,
  onLogout,
  onAdmin,
  orders,
  loading,
}) {
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') || '')
    const password = String(form.get('password') || '')

    try {
      const response =
        mode === 'register'
          ? await api.register({
              name: String(form.get('name') || ''),
              email,
              password,
            })
          : await api.login({ email, password })
      await onAuthenticated(response.user)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не вдалося авторизуватися. Спробуйте ще раз.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <main className="main-content account-page">
      <div className="account-intro">
        <p className="eyebrow">Ваш простір Velora</p>
        <h1>Особистий кабінет</h1>
        <p>Зберігайте улюблене, стежте за замовленнями й отримуйте маленькі знаки уваги.</p>
        <div className="account-benefits">
          <span>
            <Icon name="heart" size={18} /> Обране в одному місці
          </span>
          <span>
            <Icon name="gift" size={18} /> Подарунки для вас
          </span>
          <span>
            <Icon name="sparkles" size={18} /> Ранні новинки
          </span>
        </div>
      </div>
      <section className="auth-card">
        {loading ? (
          <div className="auth-sent">
            <h2>Перевіряємо сесію…</h2>
            <p>Зачекайте мить.</p>
          </div>
        ) : user ? (
          <div className="auth-sent account-profile">
            <span className="confirmation-mark">
              <Icon name="check" size={27} />
            </span>
            <p className="eyebrow">Ваш профіль</p>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <button className="text-link" onClick={onLogout}>
              Вийти з профілю
            </button>
            {user.role === 'admin' && (
              <button className="text-link" onClick={onAdmin}>
                Відкрити адмін-панель
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="auth-tabs">
              <button
                className={mode === 'login' ? 'active' : ''}
                onClick={() => onModeChange('login')}
              >
                Увійти
              </button>
              <button
                className={mode === 'register' ? 'active' : ''}
                onClick={() => onModeChange('register')}
              >
                Створити профіль
              </button>
            </div>
            <form onSubmit={submit}>
              <h2>{mode === 'login' ? 'Раді бачити знову' : 'Ваша історія з Velora'}</h2>
              <p>
                {mode === 'login'
                  ? 'Введіть дані, щоб побачити свої замовлення.'
                  : 'Створіть профіль — це займе лише хвилину.'}
              </p>
              {mode === 'register' && (
                <label>
                  Ім’я
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    placeholder="Як до вас звертатися?"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  required
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@email.com"
                />
              </label>
              <label>
                Пароль
                <input
                  required
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={12}
                  placeholder="Щонайменше 12 символів"
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button-dark full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Зачекайте…' : mode === 'login' ? 'Увійти' : 'Створити профіль'}{' '}
                <Icon name="arrow" size={17} />
              </button>
            </form>
            <p className="auth-note">Пароль має містити щонайменше 12 символів, літеру й цифру.</p>
          </>
        )}
      </section>
      <section className="account-orders">
        <p className="eyebrow">{user ? 'Ваші замовлення' : 'Після авторизації'}</p>
        <h2>
          {user
            ? orders.length
              ? 'Історія ваших замовлень'
              : 'Ваші замовлення з’являться тут після оформлення.'
            : 'Тут будуть ваші замовлення, адреси та улюблені товари.'}
        </h2>
        {user && orders.length > 0 && (
          <div className="order-history">
            {orders.map((order) => (
              <div key={order.code}>
                <span>№ {order.code}</span>
                <b>{price(order.total)} ₴</b>
                <small>
                  Створено · {paymentStatusLabel[order.paymentStatus] ?? 'Статус оновлюється'}
                </small>
              </div>
            ))}
          </div>
        )}
        <button className="text-link" onClick={() => onNavigate('catalog')}>
          Перейти до покупок <Icon name="arrow" size={16} />
        </button>
      </section>
    </main>
  )
}
