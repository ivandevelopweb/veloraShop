import { formatPrice, formatStock } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import { Summary } from '../components/StorefrontComponents'

const price = formatPrice
const stockLabel = formatStock

export function Cart({ cart, onChange, onNavigate }) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const delivery = subtotal >= 1500 || !subtotal ? 0 : 90
  return (
    <main className="main-content cart-page">
      <div className="crumbs">
        <button onClick={() => onNavigate('home')}>Головна</button>
        <Icon name="chevron" size={14} />
        <span>Кошик</span>
      </div>
      <div className="cart-heading">
        <div>
          <p className="eyebrow">Ваш вибір</p>
          <h1>Кошик</h1>
        </div>
        <span>{cart.reduce((sum, item) => sum + item.quantity, 0)} товарів</span>
      </div>
      {cart.length ? (
        <div className="cart-layout">
          <section className="cart-list">
            {cart.map((item) => (
              <article className="cart-item" key={item.id}>
                <img src={item.image} alt={item.name} />
                <div className="cart-item-copy">
                  <p>{item.category}</p>
                  <h2>{item.name}</h2>
                  <span>{item.subtitle}</span>
                  <small className={item.stock <= 5 ? 'low-stock' : ''}>{stockLabel(item.stock)}</small>
                </div>
                <div className="quantity">
                  <button
                    onClick={() => onChange(item.id, item.quantity - 1)}
                    disabled={item.quantity === 1}
                    aria-label="Зменшити кількість"
                  >
                    <Icon name="minus" size={15} />
                  </button>
                  <b>{item.quantity}</b>
                  <button
                    onClick={() => onChange(item.id, item.quantity + 1)}
                    disabled={item.quantity >= item.stock}
                    aria-label="Збільшити кількість"
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </div>
                <strong>{price(item.price * item.quantity)} ₴</strong>
                <button
                  className="remove"
                  onClick={() => onChange(item.id, 0)}
                  aria-label="Видалити товар"
                >
                  <Icon name="close" size={18} />
                </button>
              </article>
            ))}
          </section>
          <Summary
            subtotal={subtotal}
            delivery={delivery}
            button="Оформити замовлення"
            onClick={() => onNavigate('checkout')}
          />
        </div>
      ) : (
        <div className="empty-state cart-empty">
          <span className="empty-bag">
            <Icon name="bag" size={34} />
          </span>
          <p className="eyebrow">Поки що порожньо</p>
          <h2>У кошику тихо</h2>
          <p>Знайдіть щось, що відгукнеться саме вам.</p>
          <button className="button-dark" onClick={() => onNavigate('catalog')}>
            Перейти до магазину
          </button>
        </div>
      )}
    </main>
  )
}
