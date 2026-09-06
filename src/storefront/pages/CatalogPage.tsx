import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatPrice } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import { CategoryRail, ProductCard } from '../components/StorefrontComponents'

const price = formatPrice

export function Catalog({
  products,
  categories,
  activeCategory,
  activeCategorySlug,
  search,
  sort,
  maxPrice,
  ratingOnly,
  onSearchChange,
  onSortChange,
  onMaxPriceChange,
  onRatingOnlyChange,
  onResetFilters,
  cart,
  wishlist,
  onAdd,
  onWish,
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products
      .filter(
        (item) =>
          (activeCategory === 'Усе' || item.category === activeCategory) &&
          item.price <= maxPrice &&
          (!ratingOnly || item.rating >= 4.8) &&
          (!query ||
            `${item.name} ${item.subtitle} ${item.category}`.toLowerCase().includes(query)),
      )
      .sort((a, b) =>
        sort === 'low'
          ? a.price - b.price
          : sort === 'high'
            ? b.price - a.price
            : sort === 'rating'
              ? b.rating - a.rating
              : b.reviews - a.reviews,
      )
  }, [activeCategory, maxPrice, products, ratingOnly, search, sort])
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
          <p className="eyebrow">Колекція Velora</p>
          <h1>{activeCategory === 'Усе' ? 'Усі товари' : activeCategory}</h1>
          <p>{filtered.length} товарів, відібраних для вашого простору й ритму.</p>
        </div>
        <label className="catalog-search">
          <Icon name="search" size={18} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Шукати товари"
          />
        </label>
      </div>
      <CategoryRail categories={categories} activeSlug={activeCategorySlug} />
      <div className="catalog-layout">
        <aside className="filters">
          <div className="filter-heading">
            <span>Фільтри</span>
            <button
              onClick={() => {
                onResetFilters()
              }}
            >
              Скинути
            </button>
          </div>
          <div className="filter-group">
            <label>
              Ціна до <b>{price(maxPrice)} ₴</b>
            </label>
            <input
              type="range"
              min="300"
              max="4000"
              step="100"
              value={maxPrice}
              onChange={(event) => onMaxPriceChange(Number(event.target.value))}
            />
            <div className="range-labels">
              <span>300 ₴</span>
              <span>4 000 ₴</span>
            </div>
          </div>
          <label className="check-filter">
            <input
              type="checkbox"
              checked={ratingOnly}
              onChange={(event) => onRatingOnlyChange(event.target.checked)}
            />
            <span>Рейтинг 4.8 і вище</span>
          </label>
          <div className="filter-quote">
            «Ми обираємо не більше — ми обираємо краще»<small>— філософія Velora</small>
          </div>
        </aside>
        <section className="catalog-results">
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
              <Icon name="search" size={34} />
              <h2>Нічого не знайшли</h2>
              <p>Спробуйте змінити запит або скинути фільтри.</p>
              <button
                className="button-dark"
                onClick={() => {
                  onResetFilters()
                }}
              >
                Показати все
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
