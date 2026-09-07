import { Link } from 'react-router-dom'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { catalogPath } from '../routing/paths'

export function About() {
  return (
    <main className="main-content about-page">
      <div className="crumbs">
        <Link to="/">Головна</Link>
        <Icon name="chevron" size={14} />
        <span>Інформація</span>
      </div>

      <section className="about-intro">
        <p className="eyebrow">Про Velora</p>
        <h1>Інтернет-магазин Velora</h1>
        <p>
          Velora — український магазин товарів для дому, догляду та особистого стилю з каталогом і
          цінами в гривнях. Обирайте товари, зберігайте улюблені позиції та оформлюйте замовлення
          онлайн.
        </p>
        <Link className="button-dark" to={catalogPath()}>
          Відкрити каталог <Icon name="arrow" size={17} />
        </Link>
      </section>

      <div className="about-sections">
        <section id="delivery" className="about-section">
          <p className="eyebrow">01</p>
          <h2>Доставка</h2>
          <p>
            У формі оформлення доступні «Нова пошта» — відділення або поштомат — і «Кур’єр Velora»
            у межах Києва. Доставка безкоштовна для замовлень від 1500 ₴, для замовлень меншої
            суми — 90 ₴.
          </p>
        </section>
        <section id="payment" className="about-section">
          <p className="eyebrow">02</p>
          <h2>Оплата</h2>
          <p>
            Під час оформлення доступна захищена оплата через LiqPay. Після підтвердження замовлення
            ви перейдете на сторінку платіжного сервісу, а статус оплати буде доступний на сторінці
            результату.
          </p>
        </section>
        <section id="contacts" className="about-section">
          <p className="eyebrow">03</p>
          <h2>Контакти</h2>
          <p>Служба підтримки Velora допоможе з питаннями щодо товарів, доставки та замовлень.</p>
        </section>
      </div>
    </main>
  )
}
