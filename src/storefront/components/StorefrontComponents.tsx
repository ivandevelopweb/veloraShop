import { useState } from 'react'
import { Brand } from '../../shared/ui/Brand'
import { Icon } from '../../shared/ui/Icon'
import { formatPrice, formatStock } from '../../shared/lib/format'

const price = formatPrice
const stockLabel = formatStock

export function ProductCard({ item, cart, isWishlisted, onAdd, onOpen, onWish }) {
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
      <button
        className="product-image"
        onClick={() => onOpen(item)}
        aria-label={`Відкрити ${item.name}`}
      >
        {item.badge && <span className="product-badge">{item.badge}</span>}
        <img src={item.image} alt={item.name} loading="lazy" />
      </button>
      <div className="product-copy">
        <p className="product-category">{item.category}</p>
        <button className="product-name" onClick={() => onOpen(item)}>
          {item.name}
        </button>
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


export function Header({ cartCount, onNavigate, onCatalog, search, setSearch }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const go = (page) => {
    setMenuOpen(false)
    onNavigate(page)
  }
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
        <Brand onClick={() => go('home')} />
        <nav className="header-nav">
          <button onClick={() => onCatalog('Усе')}>Магазин</button>
          <button onClick={() => onCatalog('Подарунки')}>Подарунки</button>
          <button onClick={() => go('about')}>Про Velora</button>
        </nav>
        <label className="search-box">
          <Icon name="search" size={18} />
          <input
            value={search}
            onFocus={() => onNavigate('catalog')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Пошук у Velora"
          />
        </label>
        <div className="header-actions">
          <button onClick={() => go('account')} aria-label="Особистий кабінет">
            <Icon name="user" size={21} />
          </button>
          <button className="header-bag" onClick={() => go('cart')} aria-label="Кошик">
            <Icon name="bag" size={21} />
            {cartCount > 0 && <b>{cartCount}</b>}
          </button>
        </div>
      </header>
      {menuOpen && (
        <nav className="mobile-panel">
          <button onClick={() => onCatalog('Усе')}>Магазин</button>
          <button onClick={() => onCatalog('Подарунки')}>Подарунки</button>
          <button onClick={() => go('about')}>Про Velora</button>
          <button onClick={() => go('account')}>Особистий кабінет</button>
        </nav>
      )}
    </>
  )
}


export function CategoryRail({ categories, active, onSelect }) {
  return (
    <div className="category-rail">
      {categories.map(([label, icon]) => (
        <button
          className={active === label ? 'active' : ''}
          onClick={() => onSelect(label)}
          key={label}
        >
          <Icon name={icon} size={19} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

export function Summary({ subtotal, delivery = 0, button, onClick = undefined, children = null, submit = false }) {
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
      <button className="button-dark full" type={submit ? 'submit' : 'button'} onClick={onClick}>
        {button} <Icon name="arrow" size={17} />
      </button>
      <p className="summary-note">
        <Icon name="shield" size={16} /> Ваші дані потрібні лише для оформлення замовлення.
      </p>
    </aside>
  )
}

export function Footer({ onNavigate, onCatalog }) {
  return (
    <footer>
      <div className="footer-top">
        <div>
          <Brand footer onClick={() => onNavigate('home')} />
          <p>Речі для ваших тихих, красивих моментів.</p>
        </div>
        <div>
          <h3>Магазин</h3>
          <button onClick={() => onCatalog('Усе')}>Усі товари</button>
          <button onClick={() => onCatalog('Подарунки')}>Подарункові набори</button>
          <button onClick={() => onNavigate('account')}>Особистий кабінет</button>
        </div>
        <div>
          <h3>Допомога</h3>
          <button onClick={() => onNavigate('about')}>Про Velora</button>
          <button onClick={() => onNavigate('cart')}>Кошик</button>
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
