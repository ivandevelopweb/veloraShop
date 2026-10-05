import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatPriceWithCurrency } from '../../shared/lib/format'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { CategoryRail, ProductCard } from '../components/StorefrontComponents'
import type { DisplayCartItem } from '../model/cart'
import type { DisplayCategory, DisplayProduct } from '../model/displayProduct'
import type { CatalogFilters, CatalogPriceBounds } from '../routing/paths'

const price = formatPriceWithCurrency

type CatalogProps = {
  products: DisplayProduct[]
  categories: DisplayCategory[]
  activeCategory: string
  activeCategorySlug: string | null
  filters: CatalogFilters
  priceBounds: CatalogPriceBounds
  availableBrands: string[]
  onSortChange: (sort: CatalogFilters['sort']) => void
  onApplyFilters: (changes: Partial<CatalogFilters>) => void
  onResetFilters: () => void
  cart: DisplayCartItem[]
  wishlist: number[]
  onAdd: (item: DisplayProduct) => void | Promise<void>
  onWish: (id: number) => void
}

type PriceInputValues = { from: string; to: string }
type DraftFiltersState = { source: CatalogFilters; value: CatalogFilters }
type DraftPriceInputState = { source: CatalogFilters; value: PriceInputValues }

export function Catalog({
  products,
  categories,
  activeCategory,
  activeCategorySlug,
  filters,
  priceBounds,
  availableBrands,
  onSortChange,
  onApplyFilters,
  onResetFilters,
  cart,
  wishlist,
  onAdd,
  onWish,
}: CatalogProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftState, setDraftState] = useState<DraftFiltersState>(() => ({
    source: filters,
    value: filters,
  }))
  const [priceInputState, setPriceInputState] = useState<DraftPriceInputState>(() => ({
    source: filters,
    value: { from: String(filters.minPrice), to: String(filters.maxPrice) },
  }))
  const [brandSearch, setBrandSearch] = useState('')
  const filterOpenButtonRef = useRef<HTMLButtonElement>(null)
  const filterCloseRef = useRef<HTMLButtonElement>(null)
  const draftFilters = draftState.source === filters ? draftState.value : filters
  const priceInputs =
    priceInputState.source === filters
      ? priceInputState.value
      : { from: String(filters.minPrice), to: String(filters.maxPrice) }
  const activeFilters = filtersOpen ? draftFilters : filters
  const query = filters.search.trim().toLocaleLowerCase('uk-UA')
  const matchingBrands = availableBrands.filter((brand) =>
    brand.toLocaleLowerCase('uk-UA').includes(brandSearch.trim().toLocaleLowerCase('uk-UA')),
  )
  const priceDistance = priceBounds.max - priceBounds.min
  const selectedMinPercent =
    priceDistance > 0 ? ((activeFilters.minPrice - priceBounds.min) / priceDistance) * 100 : 0
  const selectedMaxPercent =
    priceDistance > 0 ? ((activeFilters.maxPrice - priceBounds.min) / priceDistance) * 100 : 100
  const filtered = useMemo(
    () =>
      products
        .filter(
          (item) =>
            (activeCategory === 'Усе' || item.category === activeCategory) &&
            item.price >= activeFilters.minPrice &&
            item.price <= activeFilters.maxPrice &&
            (!activeFilters.brands.length || activeFilters.brands.includes(item.brand)) &&
            (!activeFilters.inStockOnly || item.stock > 0) &&
            (!activeFilters.promotionsOnly ||
              (item.oldPrice !== null && item.oldPrice > item.price)) &&
            (activeFilters.minRating <= 1 || item.rating >= activeFilters.minRating) &&
            (!query ||
              `${item.name} ${item.brand} ${item.shortDescription} ${item.category}`
                .toLocaleLowerCase('uk-UA')
                .includes(query)),
        )
        .sort((a, b) =>
          filters.sort === 'low'
            ? a.price - b.price
            : filters.sort === 'high'
              ? b.price - a.price
              : filters.sort === 'rating'
                ? b.rating - a.rating || a.id - b.id
                : b.reviewCount - a.reviewCount || a.id - b.id,
        ),
    [activeCategory, activeFilters, filters.sort, products, query],
  )

  const updateDraftFilters = (
    update: CatalogFilters | ((current: CatalogFilters) => CatalogFilters),
  ) => {
    setDraftState((current) => {
      const currentValue = current.source === filters ? current.value : filters
      return {
        source: filters,
        value: typeof update === 'function' ? update(currentValue) : update,
      }
    })
  }

  const updatePriceInputs = (
    update: PriceInputValues | ((current: PriceInputValues) => PriceInputValues),
  ) => {
    setPriceInputState((current) => {
      const currentValue =
        current.source === filters
          ? current.value
          : { from: String(filters.minPrice), to: String(filters.maxPrice) }
      return {
        source: filters,
        value: typeof update === 'function' ? update(currentValue) : update,
      }
    })
  }

  const openFilters = () => {
    setDraftState({ source: filters, value: { ...filters, brands: [...filters.brands] } })
    setPriceInputState({
      source: filters,
      value: { from: String(filters.minPrice), to: String(filters.maxPrice) },
    })
    setBrandSearch('')
    setFiltersOpen(true)
  }

  const closeFilters = useCallback(() => {
    const dialog = document.getElementById('catalog-filters')
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && dialog?.contains(activeElement))
      activeElement.blur()
    setFiltersOpen(false)
    window.requestAnimationFrame(() => filterOpenButtonRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!filtersOpen) return undefined

    const frame = window.requestAnimationFrame(() => filterCloseRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeFilters()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeFilters, filtersOpen])

  const updateFilter = <Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) => {
    if (filtersOpen) updateDraftFilters((current) => ({ ...current, [key]: value }))
    else onApplyFilters({ [key]: value } as Partial<CatalogFilters>)
  }

  const updatePriceRange = (minPrice: number, maxPrice: number) => {
    updatePriceInputs({ from: String(minPrice), to: String(maxPrice) })
    if (filtersOpen) {
      updateDraftFilters((current) => ({ ...current, minPrice, maxPrice }))
    } else {
      onApplyFilters({ minPrice, maxPrice })
    }
  }

  const handlePriceInputChange = (edge: 'minPrice' | 'maxPrice', rawValue: string) => {
    updatePriceInputs((current) => ({
      ...current,
      [edge === 'minPrice' ? 'from' : 'to']: rawValue,
    }))
    if (!/^\d+$/.test(rawValue)) return
    const value = Number(rawValue)
    if (!Number.isSafeInteger(value) || value < priceBounds.min || value > priceBounds.max) return
    const current = activeFilters
    if (edge === 'minPrice' && value > current.maxPrice) return
    if (edge === 'maxPrice' && value < current.minPrice) return
    updatePriceRange(
      edge === 'minPrice' ? value : current.minPrice,
      edge === 'maxPrice' ? value : current.maxPrice,
    )
  }

  const normalizePriceInput = (edge: 'minPrice' | 'maxPrice') => {
    const field = edge === 'minPrice' ? 'from' : 'to'
    const rawValue = priceInputs[field]
    const current = activeFilters
    const fallback = current[edge]
    const parsed = /^\d+$/.test(rawValue) ? Number(rawValue) : fallback
    const value = Math.max(
      priceBounds.min,
      Math.min(priceBounds.max, Number.isSafeInteger(parsed) ? parsed : fallback),
    )
    const nextMin = edge === 'minPrice' ? Math.min(value, current.maxPrice) : current.minPrice
    const nextMax = edge === 'maxPrice' ? Math.max(value, current.minPrice) : current.maxPrice
    updatePriceRange(nextMin, nextMax)
  }

  const toggleBrand = (brand: string, checked: boolean) => {
    const brands = checked
      ? [...new Set([...activeFilters.brands, brand])]
      : activeFilters.brands.filter((selected) => selected !== brand)
    updateFilter('brands', brands)
  }

  const applyFilters = () => {
    onApplyFilters(draftFilters)
    closeFilters()
  }

  const resetFilters = () => {
    const reset = {
      search: '',
      sort: 'popular' as const,
      minPrice: priceBounds.min,
      maxPrice: priceBounds.max,
      minRating: 1,
      brands: [],
      inStockOnly: false,
      promotionsOnly: false,
    }
    if (filtersOpen) {
      updateDraftFilters(reset)
      updatePriceInputs({ from: String(reset.minPrice), to: String(reset.maxPrice) })
      setBrandSearch('')
    } else {
      onResetFilters()
    }
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
          {filters.search && <p className="catalog-query">Результати для «{filters.search}»</p>}
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
          role={filtersOpen ? 'dialog' : undefined}
          aria-modal={filtersOpen || undefined}
        >
          <div className="filter-sheet-card">
            <div className="filter-heading">
              <h2>Фільтри</h2>
              <button onClick={resetFilters}>Скинути</button>
              <button
                className="filter-close"
                ref={filterCloseRef}
                onClick={closeFilters}
                aria-label="Закрити фільтри"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="filter-sheet-content">
              <section className="filter-group" aria-labelledby="catalog-price-title">
                <div className="filter-group-title">
                  <h3 id="catalog-price-title">Ціна</h3>
                  <output aria-live="polite">
                    {price(activeFilters.minPrice)} — {price(activeFilters.maxPrice)}
                  </output>
                </div>
                <div className="price-inputs">
                  <label htmlFor="catalog-min-price">
                    <span>Від</span>
                    <span className="price-input-wrap">
                      <input
                        id="catalog-min-price"
                        type="number"
                        inputMode="numeric"
                        min={priceBounds.min}
                        max={activeFilters.maxPrice}
                        step="1"
                        value={priceInputs.from}
                        aria-label="Ціна від"
                        onChange={(event) =>
                          handlePriceInputChange('minPrice', event.currentTarget.value)
                        }
                        onBlur={() => normalizePriceInput('minPrice')}
                      />
                      <span aria-hidden="true">₴</span>
                    </span>
                  </label>
                  <label htmlFor="catalog-max-price">
                    <span>До</span>
                    <span className="price-input-wrap">
                      <input
                        id="catalog-max-price"
                        type="number"
                        inputMode="numeric"
                        min={activeFilters.minPrice}
                        max={priceBounds.max}
                        step="1"
                        value={priceInputs.to}
                        aria-label="Ціна до"
                        onChange={(event) =>
                          handlePriceInputChange('maxPrice', event.currentTarget.value)
                        }
                        onBlur={() => normalizePriceInput('maxPrice')}
                      />
                      <span aria-hidden="true">₴</span>
                    </span>
                  </label>
                </div>
                <div className="dual-range-control">
                  <div
                    className="dual-range-track"
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(90deg, var(--velora-line) ${selectedMinPercent}%, var(--velora-primary) ${selectedMinPercent}%, var(--velora-primary) ${selectedMaxPercent}%, var(--velora-line) ${selectedMaxPercent}%)`,
                    }}
                  />
                  <input
                    className="dual-range-min"
                    id="catalog-min-price-range"
                    type="range"
                    min={priceBounds.min}
                    max={activeFilters.maxPrice}
                    step="1"
                    value={activeFilters.minPrice}
                    disabled={priceDistance === 0}
                    aria-label="Мінімальна ціна"
                    aria-valuetext={price(activeFilters.minPrice)}
                    onChange={(event) =>
                      updatePriceRange(Number(event.currentTarget.value), activeFilters.maxPrice)
                    }
                  />
                  <input
                    className="dual-range-max"
                    id="catalog-max-price-range"
                    type="range"
                    min={activeFilters.minPrice}
                    max={priceBounds.max}
                    step="1"
                    value={activeFilters.maxPrice}
                    disabled={priceDistance === 0}
                    aria-label="Максимальна ціна"
                    aria-valuetext={price(activeFilters.maxPrice)}
                    onChange={(event) =>
                      updatePriceRange(activeFilters.minPrice, Number(event.currentTarget.value))
                    }
                  />
                </div>
                <div className="range-labels">
                  <span>{price(priceBounds.min)}</span>
                  <span>{price(priceBounds.max)}</span>
                </div>
              </section>

              <section className="filter-group" aria-labelledby="catalog-brand-title">
                <h3 id="catalog-brand-title">Бренд</h3>
                {availableBrands.length > 8 && (
                  <input
                    className="brand-search"
                    type="search"
                    value={brandSearch}
                    onChange={(event) => setBrandSearch(event.currentTarget.value)}
                    placeholder="Пошук бренду"
                    aria-label="Пошук бренду"
                  />
                )}
                {availableBrands.length ? (
                  <div className="brand-option-list">
                    {matchingBrands.length ? (
                      matchingBrands.map((brand) => (
                        <label className="check-filter" key={brand}>
                          <input
                            type="checkbox"
                            checked={activeFilters.brands.includes(brand)}
                            onChange={(event) => toggleBrand(brand, event.currentTarget.checked)}
                          />
                          <span>{brand}</span>
                        </label>
                      ))
                    ) : (
                      <p className="filter-empty">Бренди не знайдено.</p>
                    )}
                  </div>
                ) : (
                  <p className="filter-empty">У каталозі ще не вказано брендів.</p>
                )}
              </section>

              <section className="filter-group" aria-labelledby="catalog-availability-title">
                <h3 id="catalog-availability-title">Наявність</h3>
                <label className="check-filter">
                  <input
                    type="checkbox"
                    checked={activeFilters.inStockOnly}
                    onChange={(event) => updateFilter('inStockOnly', event.currentTarget.checked)}
                  />
                  <span>Тільки в наявності</span>
                </label>
              </section>

              <section className="filter-group" aria-labelledby="catalog-rating-title">
                <div className="filter-group-title">
                  <h3 id="catalog-rating-title">
                    Рейтинг від {activeFilters.minRating.toFixed(1)}
                  </h3>
                </div>
                <input
                  className="rating-range"
                  id="catalog-min-rating"
                  type="range"
                  min="1"
                  max="5"
                  step="0.1"
                  value={activeFilters.minRating}
                  aria-label="Мінімальний рейтинг"
                  aria-valuetext={`Рейтинг від ${activeFilters.minRating.toFixed(1)}`}
                  onChange={(event) => updateFilter('minRating', Number(event.currentTarget.value))}
                />
                <div className="range-labels">
                  <span>1,0</span>
                  <span>5,0</span>
                </div>
              </section>

              <section className="filter-group" aria-labelledby="catalog-promotion-title">
                <h3 id="catalog-promotion-title">Акції</h3>
                <label className="check-filter">
                  <input
                    type="checkbox"
                    checked={activeFilters.promotionsOnly}
                    onChange={(event) =>
                      updateFilter('promotionsOnly', event.currentTarget.checked)
                    }
                  />
                  <span>Акційні товари</span>
                </label>
              </section>
            </div>
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
              <select
                value={filters.sort}
                onChange={(event) => onSortChange(event.target.value as CatalogFilters['sort'])}
              >
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
              <button className="button-dark" onClick={onResetFilters}>
                Показати всі товари
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
