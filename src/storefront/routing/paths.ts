export type CatalogFilters = {
  search: string
  sort: 'popular' | 'low' | 'high' | 'rating'
  maxPrice: number
  ratingOnly: boolean
}

const maxCatalogPrice = 4000
const minCatalogPrice = 300
const validSorts = new Set<CatalogFilters['sort']>(['popular', 'low', 'high', 'rating'])

export const defaultCatalogFilters: CatalogFilters = {
  search: '',
  sort: 'popular',
  maxPrice: maxCatalogPrice,
  ratingOnly: false,
}

export function catalogPath(categorySlug: string | null = null, filters = defaultCatalogFilters) {
  const query = new URLSearchParams()
  const search = filters.search.trim()
  if (search) query.set('search', search)
  if (filters.sort !== defaultCatalogFilters.sort) query.set('sort', filters.sort)
  if (filters.maxPrice !== defaultCatalogFilters.maxPrice) query.set('maxPrice', String(filters.maxPrice))
  if (filters.ratingOnly) query.set('rating', '4.8')
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

export function catalogFiltersFromSearch(search: string): CatalogFilters {
  const query = new URLSearchParams(search)
  const sortValue = query.get('sort')
  const rawMaxPrice = Number(query.get('maxPrice'))
  const maxPrice =
    Number.isInteger(rawMaxPrice) && rawMaxPrice >= minCatalogPrice && rawMaxPrice <= maxCatalogPrice
      ? rawMaxPrice
      : defaultCatalogFilters.maxPrice

  return {
    search: (query.get('search') ?? '').trim().slice(0, 100),
    sort: validSorts.has(sortValue as CatalogFilters['sort'])
      ? (sortValue as CatalogFilters['sort'])
      : defaultCatalogFilters.sort,
    maxPrice,
    ratingOnly: query.get('rating') === '4.8',
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
