import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../../shared/ui/Brand'
import { StorefrontIcon as Icon } from './StorefrontIcon'
import { formatPrice, formatPriceWithCurrency, formatStock } from '../../shared/lib/format'
import { catalogPath, productPath } from '../routing/paths'

const stockLabel = formatStock
const price = formatPrice

export function ProductCard({ item, cart, isWishlisted, onAdd, onWish }) {
  const inCart = cart.find((product) => product.id === item.id)?.quantity || 0
  const atStockLimit = inCart >= item.stock
  const imageSource = item.image ?? item.images?.[0]?.url ?? null
  const hasDiscount = item.oldPrice !== null && item.oldPrice > item.price
  return (
    <article className="product-card">
      <button
        className={`wish-button ${isWishlisted ? 'active' : ''}`}
        onClick={() => onWish(item.id)}
        aria-label={isWishlisted ? `Прибрати ${item.name} з обраного` : `Додати ${item.name} до обраного`}
        aria-pressed={isWishlisted}
      >
        <Icon name={isWishlisted ? 'heart-filled' : 'heart'} size={20} />
      </button>
      <Link className="product-image" to={productPath(item.slug)} aria-label={`Відкрити ${item.name}`}>
        {item.badge && <span className="product-badge">{item.badge}</span>}
        {imageSource ? (
          <img src={imageSource} alt={item.images?.[0]?.altText || item.name} loading="lazy" />
        ) : (
          <span className="product-image-placeholder">Фото відсутнє</span>
        )}
      </Link>
      <div className="product-copy">
        <p className="product-category">{item.category}</p>
        <div className="product-text-group">
          <Link className="product-name" to={productPath(item.slug)}>
            {item.name}
          </Link>
          <p className="product-subtitle">{item.shortDescription}</p>
        </div>
        <div className="product-meta">
          <div className="rating">
            <Icon name="star" size={16} />
            {item.rating.toFixed(1)} <small>· {item.reviewCount} оцінок</small>
          </div>
          <p className={`stock-note ${item.stock <= 5 ? 'low-stock' : ''}`}>{stockLabel(item.stock)}</p>
        </div>
        <div className="product-bottom">
          <div className="price-wrap">
            {hasDiscount && <s>{formatPriceWithCurrency(item.oldPrice)}</s>}
            <strong>{formatPriceWithCurrency(item.price)}</strong>
          </div>
          <button
            className={`add-card ${inCart ? 'added' : ''}`}
            onClick={() => onAdd(item)}
            disabled={atStockLimit}
            title={atStockLimit ? 'У кошику вже весь доступний залишок' : 'Додати до кошика'}
          >
            <Icon name={inCart ? 'check' : 'bag'} size={17} />
            <span>{inCart ? `У кошику · ${inCart}` : 'До кошика'}</span>
          </button>
        </div>
      </div>
    </article>
  )
}


export function Header({
  cartCount,
  wishlistCount,
  search,
  onSearchChange,
  categories,
  catalogLoading,
  catalogError,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [draftSearch, setDraftSearch] = useState(search)
  const mobileTriggerRef = useRef(null)
  const catalogTriggerRef = useRef(null)
  const menuRef = useRef(null)

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        const trigger = window.matchMedia('(max-width: 1023px)').matches
          ? mobileTriggerRef.current
          : catalogTriggerRef.current
        trigger?.focus()
      })
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined
    const focusFirst = () => {
      const firstFocusable = menuRef.current?.querySelector('a, button')
      firstFocusable?.focus()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = [...(menuRef.current?.querySelectorAll('a, button') ?? [])]
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(focusFirst)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeMenu, menuOpen])

  const submitSearch = (event) => {
    event.preventDefault()
    onSearchChange(draftSearch.trim())
  }

  const realCategories = categories.filter((category) => category.slug)
  return (
    <>
      <header className="site-header">
        <div className="header-row">
          <button
            className="mobile-menu"
            ref={mobileTriggerRef}
            onClick={() => setMenuOpen((current) => !current)}
            aria-label={menuOpen ? 'Закрити меню' : 'Відкрити меню'}
            aria-expanded={menuOpen}
            aria-controls="catalog-menu"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
          <Brand />
          <button
            className="catalog-trigger"
            ref={catalogTriggerRef}
            onClick={() => setMenuOpen((current) => !current)}
            aria-expanded={menuOpen}
            aria-controls="catalog-menu"
          >
            <Icon name="menu" size={18} />
            Каталог
          </button>
          <form className="search-box" onSubmit={submitSearch} role="search">
            <label className="visually-hidden" htmlFor="header-search">
              Пошук товарів
            </label>
            <Icon name="search" size={18} />
            <input
              id="header-search"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Пошук товарів"
              type="search"
              autoComplete="off"
            />
          </form>
          <div className="header-actions">
            <Link className="header-action" to="/wishlist" aria-label="Обране">
              <Icon name="heart" size={20} />
              <span>Обране</span>
              {wishlistCount > 0 && <b>{wishlistCount}</b>}
            </Link>
            <Link className="header-action account-action" to="/account" aria-label="Кабінет">
              <Icon name="user" size={20} />
              <span>Кабінет</span>
            </Link>
            <Link className="header-action header-bag" to="/cart" aria-label="Кошик">
              <Icon name="bag" size={20} />
              <span>Кошик</span>
              {cartCount > 0 && <b>{cartCount}</b>}
            </Link>
          </div>
        </div>
        <nav className="main-nav" aria-label="Інформація про магазин">
          <Link to="/about">Про магазин</Link>
          <Link to="/about#delivery">Доставка</Link>
          <Link to="/about#payment">Оплата</Link>
          <Link to="/about#contacts">Контакти</Link>
          <Link className="main-nav-cta" to={catalogPath()}>
            Почати покупки <Icon name="arrow" size={16} />
          </Link>
        </nav>
        <form className="mobile-search-box" onSubmit={submitSearch} role="search">
          <label className="visually-hidden" htmlFor="mobile-header-search">
            Пошук товарів
          </label>
          <Icon name="search" size={18} />
          <input
            id="mobile-header-search"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Пошук товарів"
            type="search"
            autoComplete="off"
          />
        </form>
      </header>
      {menuOpen && (
        <div className="catalog-menu-layer" onMouseDown={() => closeMenu(false)}>
          <div
            className="catalog-menu"
            id="catalog-menu"
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label="Каталог товарів"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="catalog-menu-heading">
              <h2>Каталог</h2>
              <button onClick={() => closeMenu()} aria-label="Закрити каталог">
                <Icon name="close" size={20} />
              </button>
            </div>
            {catalogLoading ? (
              <p className="menu-status">Завантаження категорій…</p>
            ) : catalogError ? (
              <p className="menu-status" role="alert">
                Не вдалося завантажити категорії.
              </p>
            ) : (
              <nav className="catalog-menu-links" aria-label="Категорії">
                <Link onClick={() => closeMenu(false)} to={catalogPath()}>
                  Усі товари
                </Link>
                {realCategories.map((category) => (
                  <Link
                    onClick={() => closeMenu(false)}
                    to={catalogPath(category.slug)}
                    key={category.slug}
                  >
                    {category.name}
                  </Link>
                ))}
                <Link onClick={() => closeMenu(false)} to="/account">
                  Кабінет
                </Link>
                <Link onClick={() => closeMenu(false)} to="/about">
                  Інформація про магазин
                </Link>
              </nav>
            )}
          </div>
        </div>
      )}
    </>
  )
}


export function CategoryRail({ categories, activeSlug }) {
  return (
    <nav className="category-rail" aria-label="Категорії товарів">
      {categories.map((category) => (
        <Link
          className={activeSlug === category.slug ? 'active' : ''}
          to={catalogPath(category.slug)}
          key={category.slug ?? 'all'}
          aria-current={activeSlug === category.slug ? 'page' : undefined}
        >
          <span>{category.name}</span>
        </Link>
      ))}
    </nav>
  )
}

export function Summary({
  subtotal,
  delivery = 0,
  button,
  onClick = undefined,
  children = null,
  submit = false,
  disabled = false,
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
        <button
          className="button-dark full"
          type={submit ? 'submit' : 'button'}
          onClick={onClick}
          disabled={disabled}
        >
          {button} <Icon name="arrow" size={17} />
        </button>
      )}
    </aside>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top main-content">
        <div className="footer-brand-block">
          <Brand footer />
          <p>Онлайн-магазин товарів для дому, догляду та особистого стилю.</p>
        </div>
        <nav className="footer-group" aria-label="Магазин">
          <h3>Магазин</h3>
          <Link to={catalogPath()}>Усі товари</Link>
          <Link to={catalogPath('podarunky')}>Подарункові набори</Link>
        </nav>
        <nav className="footer-group" aria-label="Покупцю">
          <h3>Покупцю</h3>
          <Link to="/wishlist">Обране</Link>
          <Link to="/cart">Кошик</Link>
          <Link to="/account">Особистий кабінет</Link>
        </nav>
        <nav className="footer-group" aria-label="Інформація">
          <h3>Інформація</h3>
          <Link to="/about">Про магазин</Link>
          <Link to="/about#delivery">Доставка</Link>
          <Link to="/about#payment">Оплата</Link>
          <Link to="/about#contacts">Контакти</Link>
        </nav>
      </div>
      <div className="footer-bottom main-content">
        <span>© 2026 Velora. Усі права захищені.</span>
        <span>Замовлення онлайн</span>
      </div>
    </footer>
  )
}
