import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../../shared/ui/Brand'
import { Icon } from '../../shared/ui/Icon'
import { CategoryIcon } from './CategoryIcon'
import { formatPrice, formatStock } from '../../shared/lib/format'
import { catalogPath, productPath } from '../routing/paths'

const price = formatPrice
const stockLabel = formatStock

export function ProductCard({ item, cart, isWishlisted, onAdd, onWish }) {
  const inCart = cart.find((product) => product.id === item.id)?.quantity || 0
  const atStockLimit = inCart >= item.stock
  return (
    <article className="product-card">
      <button
        className={`wish-button ${isWishlisted ? 'active' : ''}`}
        onClick={() => onWish(item.id)}
        aria-label="Додати до обраного"
      >
        <Icon name="heart" size={19} />
      </button>
      <Link
        className="product-image"
        to={productPath(item.slug)}
        aria-label={`Відкрити ${item.name}`}
      >
        {item.badge && <span className="product-badge">{item.badge}</span>}
        <img src={item.image} alt={item.name} loading="lazy" />
      </Link>
      <div className="product-copy">
        <p className="product-category">{item.category}</p>
        <Link className="product-name" to={productPath(item.slug)}>
          {item.name}
        </Link>
        <p className="product-subtitle">{item.subtitle}</p>
        <div className="rating">
          <span>★</span>
          {item.rating.toFixed(1)} <small>({item.reviews})</small>
        </div>
        <p className={`stock-note ${item.stock <= 5 ? 'low-stock' : ''}`}>{stockLabel(item.stock)}</p>
        <div className="product-bottom">
          <div className="price-wrap">
            {item.oldPrice && <s>{price(item.oldPrice)} ₴</s>}
            <strong>{price(item.price)} ₴</strong>
          </div>
          <button
            className={`add-card ${inCart ? 'added' : ''}`}
            onClick={() => onAdd(item)}
            disabled={atStockLimit}
            title={atStockLimit ? 'У кошику вже весь доступний залишок' : 'Додати до кошика'}
          >
            {inCart ? (
              <>
                <Icon name="check" size={17} />
                <span>{inCart}</span>
              </>
            ) : (
              <>
                <Icon name="bag" size={17} />
                <span>До кошика</span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  )
}


export function Header({ cartCount, search, onSearchChange }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  return (
    <>
      <div className="topline">
        <span>Доставка безкоштовна для замовлень від 1 500 ₴</span>
        <span>Створено для маленьких ритуалів радості</span>
      </div>
      <header className="site-header">
        <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню">
          <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
        </button>
        <Brand />
        <nav className="header-nav">
          <Link to={catalogPath()}>Магазин</Link>
          <Link to={catalogPath('podarunky')}>Подарунки</Link>
          <Link to="/about">Про Velora</Link>
        </nav>
        <label className="search-box">
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Пошук у Velora"
          />
        </label>
        <div className="header-actions">
          <Link to="/account" aria-label="Особистий кабінет">
            <Icon name="user" size={21} />
          </Link>
          <Link className="header-bag" to="/cart" aria-label="Кошик">
            <Icon name="bag" size={21} />
            {cartCount > 0 && <b>{cartCount}</b>}
          </Link>
        </div>
      </header>
      {menuOpen && (
        <nav className="mobile-panel">
          <Link onClick={closeMenu} to={catalogPath()}>
            Магазин
          </Link>
          <Link onClick={closeMenu} to={catalogPath('podarunky')}>
            Подарунки
          </Link>
          <Link onClick={closeMenu} to="/about">
            Про Velora
          </Link>
          <Link onClick={closeMenu} to="/account">
            Особистий кабінет
          </Link>
        </nav>
      )}
    </>
  )
}


export function CategoryRail({ categories, activeSlug }) {
  return (
    <div className="category-rail">
      {categories.map((category) => (
        <Link
          className={activeSlug === category.slug ? 'active' : ''}
          to={catalogPath(category.slug)}
          key={category.slug ?? 'all'}
        >
          <CategoryIcon name={category.icon} size={19} />
          <span>{category.name}</span>
        </Link>
      ))}
    </div>
  )
}

export function Summary({
  subtotal,
  delivery = 0,
  button,
  onClick = undefined,
  children = null,
  submit = false,
  to = undefined,
}) {
  return (
    <aside className="order-summary">
      <p className="eyebrow">Разом</p>
      {children}
      <div>
        <span>Товари</span>
        <b>{price(subtotal)} ₴</b>
      </div>
      <div>
        <span>Доставка</span>
        <b>{delivery ? `${price(delivery)} ₴` : 'Безкоштовно'}</b>
      </div>
      <div className="summary-total">
        <span>До сплати</span>
        <strong>{price(subtotal + delivery)} ₴</strong>
      </div>
      {to ? (
        <Link className="button-dark full" to={to}>
          {button} <Icon name="arrow" size={17} />
        </Link>
      ) : (
        <button className="button-dark full" type={submit ? 'submit' : 'button'} onClick={onClick}>
          {button} <Icon name="arrow" size={17} />
        </button>
      )}
      <p className="summary-note">
        <Icon name="shield" size={16} /> Ваші дані потрібні лише для оформлення замовлення.
      </p>
    </aside>
  )
}

export function Footer() {
  return (
    <footer>
      <div className="footer-top">
        <div>
          <Brand footer />
          <p>Речі для ваших тихих, красивих моментів.</p>
        </div>
        <div>
          <h3>Магазин</h3>
          <Link to={catalogPath()}>Усі товари</Link>
          <Link to={catalogPath('podarunky')}>Подарункові набори</Link>
          <Link to="/account">Особистий кабінет</Link>
        </div>
        <div>
          <h3>Допомога</h3>
          <Link to="/about">Про Velora</Link>
          <Link to="/cart">Кошик</Link>
          <span>hello@velora.ua</span>
        </div>
        <div className="newsletter">
          <h3>Трохи натхнення</h3>
          <p>Лише красиві новини та особливі пропозиції.</p>
          <div>
            <input placeholder="Ваш email" aria-label="Email для новин" />
            <button aria-label="Підписатися">
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Velora. Усі права захищені.</span>
        <span>Створено з турботою в Україні</span>
      </div>
    </footer>
  )
}
