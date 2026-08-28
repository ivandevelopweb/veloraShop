import { useState } from 'react'
import { formatPrice } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import { Summary } from '../components/StorefrontComponents'

const price = formatPrice

export function Checkout({ cart, onNavigate, onComplete }) {
  const [delivery, setDelivery] = useState('Нова пошта')
  const [orderCode, setOrderCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const deliveryCost = subtotal >= 1500 || !subtotal ? 0 : 90

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    const form = new FormData(event.currentTarget)

    try {
      const order = await onComplete({
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        phone: form.get('phone'),
        email: form.get('email'),
        city: form.get('city'),
        branch: form.get('branch'),
        deliveryMethod: delivery === 'Нова пошта' ? 'nova_poshta' : 'velora_courier',
      })
      setOrderCode(order.code)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не вдалося створити замовлення. Спробуйте ще раз.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (orderCode)
    return (
      <main className="main-content confirmation">
        <div className="confirmation-mark">
          <Icon name="check" size={38} />
        </div>
        <p className="eyebrow">Velora каже</p>
        <h1>Усе добре!</h1>
        <p>
          Замовлення <b>№ {orderCode}</b> створене. У цьому прототипі оплата не списується —
          підключимо її на наступному етапі.
        </p>
        <button className="button-dark" onClick={() => onNavigate('home')}>
          Повернутися на головну <Icon name="arrow" size={17} />
        </button>
      </main>
    )
  return (
    <main className="main-content checkout-page">
      <div className="crumbs">
        <button onClick={() => onNavigate('cart')}>Кошик</button>
        <Icon name="chevron" size={14} />
        <span>Оформлення</span>
      </div>
      <div className="checkout-heading">
        <p className="eyebrow">Майже готово</p>
        <h1>Оформлення замовлення</h1>
      </div>
      <form className="checkout-layout" onSubmit={submit}>
        <div className="checkout-form">
          <section>
            <h2>Контактні дані</h2>
            <div className="form-grid">
              <label>
                Ім’я
                <input required name="firstName" placeholder="Ваше ім’я" />
              </label>
              <label>
                Прізвище
                <input required name="lastName" placeholder="Ваше прізвище" />
              </label>
              <label>
                Телефон
                <input required name="phone" type="tel" placeholder="+380" />
              </label>
              <label>
                Email
                <input required name="email" type="email" placeholder="name@email.com" />
              </label>
            </div>
          </section>
          <section>
            <h2>Доставка</h2>
            <div className="delivery-options">
              {['Нова пошта', 'Кур’єр Velora'].map((method) => (
                <label className={delivery === method ? 'selected' : ''} key={method}>
                  <input
                    type="radio"
                    name="delivery"
                    checked={delivery === method}
                    onChange={() => setDelivery(method)}
                  />
                  <span className="radio-dot" />
                  <span>
                    <b>{method}</b>
                    <small>
                      {method === 'Нова пошта' ? 'Відділення або поштомат' : 'У межах Києва'}
                    </small>
                  </span>
                  <Icon name={method === 'Нова пошта' ? 'truck' : 'home'} size={21} />
                </label>
              ))}
            </div>
            <div className="form-grid address-fields">
              <label>
                Місто
                <input required name="city" placeholder="Київ" />
              </label>
              <label>
                Відділення
                <input required name="branch" placeholder="№ або адреса" />
              </label>
            </div>
          </section>
          <section>
            <h2>Оплата</h2>
            <div className="payment-stub">
              <Icon name="shield" size={20} />
              <span>
                <b>Онлайн-оплата</b>
                <small>Тестовий режим — гроші не списуються.</small>
              </span>
            </div>
          </section>
        </div>
        <Summary
          subtotal={subtotal}
          delivery={deliveryCost}
          button={isSubmitting ? 'Створюємо замовлення…' : 'Підтвердити й оплатити'}
          submit
        >
          <div className="checkout-items">
            {cart.map((item) => (
              <div className="mini-item" key={item.id}>
                <span>
                  {item.name} × {item.quantity}
                </span>
                <b>{price(item.price * item.quantity)} ₴</b>
              </div>
            ))}
          </div>
        </Summary>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
