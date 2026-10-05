export type CatalogFilters = {
  search: string
  sort: 'popular' | 'low' | 'high' | 'rating'
  minPrice: number
  maxPrice: number
  minRating: number
  brands: string[]
  inStockOnly: boolean
  promotionsOnly: boolean
}

export type CatalogPriceBounds = {
  min: number
  max: number
}

const validSorts = new Set<CatalogFilters['sort']>(['popular', 'low', 'high', 'rating'])

export function catalogPriceBounds(products: readonly { price: number }[]): CatalogPriceBounds {
  const prices = products.map((product) => product.price).filter((value) => Number.isFinite(value) && value >= 0)
  if (!prices.length) return { min: 0, max: 0 }
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export function defaultCatalogFilters(bounds: CatalogPriceBounds = { min: 0, max: 0 }): CatalogFilters {
  return {
    search: '',
    sort: 'popular',
    minPrice: bounds.min,
    maxPrice: bounds.max,
    minRating: 1,
    brands: [],
    inStockOnly: false,
    promotionsOnly: false,
  }
}

export function catalogPath(
  categorySlug: string | null = null,
  filters?: CatalogFilters,
  bounds: CatalogPriceBounds = { min: 0, max: 0 },
) {
  const selected = filters ?? defaultCatalogFilters(bounds)
  const defaults = defaultCatalogFilters(bounds)
  const query = new URLSearchParams()
  const search = selected.search.trim()
  if (search) query.set('search', search)
  if (selected.sort !== defaults.sort) query.set('sort', selected.sort)
  if (selected.minPrice !== defaults.minPrice) query.set('minPrice', String(selected.minPrice))
  if (selected.maxPrice !== defaults.maxPrice) query.set('maxPrice', String(selected.maxPrice))
  if (selected.minRating > defaults.minRating) query.set('rating', selected.minRating.toFixed(1))
  for (const brand of selected.brands) query.append('brand', brand)
  if (selected.inStockOnly) query.set('inStock', '1')
  if (selected.promotionsOnly) query.set('promotion', '1')
  const suffix = query.size ? `?${query.toString()}` : ''
  return `${categorySlug ? `/catalog/${encodeURIComponent(categorySlug)}` : '/catalog'}${suffix}`
}

export function productPath(productSlug: string) {
  return `/product/${encodeURIComponent(productSlug)}`
}

export function accountPath({
  mode = 'login',
  next,
}: {
  mode?: 'login' | 'register'
  next?: string
} = {}) {
  const query = new URLSearchParams()
  if (mode === 'register') query.set('mode', 'register')
  if (next) query.set('next', next)
  const suffix = query.size ? `?${query.toString()}` : ''
  return `/account${suffix}`
}

export function paymentResultPath(order: string) {
  return `/payment/result?order=${encodeURIComponent(order)}`
}

function priceFromQuery(value: string | null, fallback: number, bounds: CatalogPriceBounds) {
  if (value === null || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= bounds.min && parsed <= bounds.max
    ? parsed
    : fallback
}

function ratingFromQuery(value: string | null) {
  if (value === null || !/^[1-5](?:\.\d)?$/.test(value)) return 1
  const parsed = Number(value)
  return parsed >= 1 && parsed <= 5 ? parsed : 1
}

export function catalogFiltersFromSearch(
  search: string,
  bounds: CatalogPriceBounds = { min: 0, max: 0 },
  availableBrands: readonly string[] = [],
): CatalogFilters {
  const query = new URLSearchParams(search)
  const sortValue = query.get('sort')
  const defaults = defaultCatalogFilters(bounds)
  let minPrice = priceFromQuery(query.get('minPrice'), defaults.minPrice, bounds)
  let maxPrice = priceFromQuery(query.get('maxPrice'), defaults.maxPrice, bounds)
  if (minPrice > maxPrice) {
    minPrice = defaults.minPrice
    maxPrice = defaults.maxPrice
  }
  const knownBrands = new Set(availableBrands)

  return {
    search: (query.get('search') ?? '').trim().slice(0, 100),
    sort: validSorts.has(sortValue as CatalogFilters['sort'])
      ? (sortValue as CatalogFilters['sort'])
      : defaults.sort,
    minPrice,
    maxPrice,
    minRating: ratingFromQuery(query.get('rating')),
    brands: [...new Set(query.getAll('brand').filter((brand) => knownBrands.has(brand)))],
    inStockOnly: query.get('inStock') === '1',
    promotionsOnly: query.get('promotion') === '1',
  }
}

export function accountModeFromSearch(search: string): 'login' | 'register' {
  return new URLSearchParams(search).get('mode') === 'register' ? 'register' : 'login'
}

export function safeInternalPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const target = new URL(value, window.location.origin)
    if (target.origin !== window.location.origin) return null
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return null
  }
}
