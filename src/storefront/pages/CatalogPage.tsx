import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatPriceWithCurrency } from '../../shared/lib/format'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { CategoryRail, ProductCard } from '../components/StorefrontComponents'

const price = formatPriceWithCurrency

export function Catalog({
  products,
  categories,
  activeCategory,
  activeCategorySlug,
  search,
  sort,
  maxPrice,
  ratingOnly,
  onSortChange,
  onApplyFilters,
  onResetFilters,
  cart,
  wishlist,
  onAdd,
  onWish,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftMaxPrice, setDraftMaxPrice] = useState(maxPrice)
  const [draftRatingOnly, setDraftRatingOnly] = useState(ratingOnly)
  const filterOpenButtonRef = useRef<HTMLButtonElement>(null)
  const filterCloseRef = useRef<HTMLButtonElement>(null)
  const query = search.trim().toLocaleLowerCase('uk-UA')
  const filtered = useMemo(
    () =>
      products
        .filter(
          (item) =>
            (activeCategory === 'Усе' || item.category === activeCategory) &&
            item.price <= maxPrice &&
            (!ratingOnly || item.rating >= 4.8) &&
            (!query ||
              `${item.name} ${item.shortDescription} ${item.category}`
                .toLocaleLowerCase('uk-UA')
                .includes(query)),
        )
        .sort((a, b) =>
          sort === 'low'
            ? a.price - b.price
            : sort === 'high'
              ? b.price - a.price
              : sort === 'rating'
                ? b.rating - a.rating || a.id - b.id
                : b.reviewCount - a.reviewCount || a.id - b.id,
        ),
    [activeCategory, maxPrice, products, query, ratingOnly, sort],
  )

  const openFilters = () => {
    setDraftMaxPrice(maxPrice)
    setDraftRatingOnly(ratingOnly)
    setFiltersOpen(true)
  }

  useEffect(() => {
    if (!filtersOpen) return undefined

    const frame = window.requestAnimationFrame(() => filterCloseRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFiltersOpen(false)
      window.requestAnimationFrame(() => filterOpenButtonRef.current?.focus())
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [filtersOpen])

  const closeFilters = () => {
    setFiltersOpen(false)
    window.requestAnimationFrame(() => filterOpenButtonRef.current?.focus())
  }

  const handleMaxPriceChange = (value) => {
    if (filtersOpen) setDraftMaxPrice(value)
    else onApplyFilters({ maxPrice: value })
  }

  const handleRatingChange = (value) => {
    if (filtersOpen) setDraftRatingOnly(value)
    else onApplyFilters({ ratingOnly: value })
  }

  const applyFilters = () => {
    onApplyFilters({ maxPrice: draftMaxPrice, ratingOnly: draftRatingOnly })
    closeFilters()
  }

  return (
    <main className="catalog-page main-content">
      <div className="crumbs">
        <Link to="/">Головна</Link>
        <Icon name="chevron" size={14} />
        <span>Магазин</span>
        {activeCategory !== 'Усе' && (
          <>
            <Icon name="chevron" size={14} />
            <span>{activeCategory}</span>
          </>
        )}
      </div>

      <div className="catalog-title">
        <div>
          <h1>{activeCategory === 'Усе' ? 'Усі товари' : activeCategory}</h1>
          <p className="catalog-count">
            {filtered.length} {filtered.length === 1 ? 'товар' : 'товарів'}
          </p>
          {search && <p className="catalog-query">Результати для «{search}»</p>}
        </div>
        <button
          className="filter-open-button"
          ref={filterOpenButtonRef}
          onClick={openFilters}
          aria-expanded={filtersOpen}
          aria-controls="catalog-filters"
        >
          <Icon name="menu" size={18} />
          Фільтри
        </button>
      </div>

      <CategoryRail categories={categories} activeSlug={activeCategorySlug} />

      <div className="catalog-layout">
        <aside
          className={`filters ${filtersOpen ? 'is-open' : ''}`}
          id="catalog-filters"
          aria-label="Фільтри каталогу"
        >
          <div className="filter-sheet-card">
            <div className="filter-heading">
              <h2>Фільтри</h2>
              <button onClick={() => onResetFilters()}>Скинути</button>
              <button
                className="filter-close"
                ref={filterCloseRef}
                onClick={closeFilters}
                aria-label="Закрити фільтри"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="filter-group">
              <label htmlFor="catalog-max-price">
                Ціна до <b>{price(filtersOpen ? draftMaxPrice : maxPrice)}</b>
              </label>
              <input
                id="catalog-max-price"
                type="range"
                min="300"
                max="4000"
                step="100"
                value={filtersOpen ? draftMaxPrice : maxPrice}
                onChange={(event) => handleMaxPriceChange(Number(event.target.value))}
              />
              <div className="range-labels">
                <span>300 ₴</span>
                <span>4 000 ₴</span>
              </div>
            </div>
            <label className="check-filter">
              <input
                type="checkbox"
                checked={filtersOpen ? draftRatingOnly : ratingOnly}
                onChange={(event) => handleRatingChange(event.target.checked)}
              />
              <span>Рейтинг 4.8 і вище</span>
            </label>
            <div className="filter-sheet-actions">
              <button className="button-dark" onClick={applyFilters}>
                Показати товари
              </button>
              <button className="text-link" onClick={closeFilters}>
                Скасувати
              </button>
            </div>
          </div>
        </aside>

        <section className="catalog-results" aria-live="polite">
          <div className="catalog-toolbar">
            <span>Показано {filtered.length} товарів</span>
            <label>
              Сортувати
              <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
                <option value="popular">За популярністю</option>
                <option value="low">Спочатку дешевші</option>
                <option value="high">Спочатку дорожчі</option>
                <option value="rating">За рейтингом</option>
              </select>
            </label>
          </div>
          {filtered.length ? (
            <div className="catalog-grid">
              {filtered.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  cart={cart}
                  isWishlisted={wishlist.includes(item.id)}
                  onAdd={onAdd}
                  onWish={onWish}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Icon name="search" size={28} />
              <h2>Нічого не знайдено</h2>
              <p>Спробуйте змінити запит або скинути фільтри.</p>
              <button className="button-dark" onClick={() => onResetFilters()}>
                Показати всі товари
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
