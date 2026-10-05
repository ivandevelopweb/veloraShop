import { useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Catalog } from '../pages'
import type { DisplayCartItem } from '../model/cart'
import type { DisplayCategory, DisplayProduct } from '../model/displayProduct'
import { NotFound } from '../pages/NotFoundPage'
import {
  catalogFiltersFromSearch,
  catalogPath,
  catalogPriceBounds,
  defaultCatalogFilters,
  type CatalogFilters,
} from './paths'
import { RouteError, RouteLoading } from './RouteStates'

type CatalogRouteProps = {
  products: DisplayProduct[]
  categories: DisplayCategory[]
  catalogLoading: boolean
  catalogError: string
  refreshCatalog: () => Promise<boolean>
  cart: DisplayCartItem[]
  wishlist: number[]
  onAdd: (item: DisplayProduct) => void | Promise<void>
  onWish: (id: number) => void
}

export function CatalogRoute({
  products,
  categories,
  catalogLoading,
  catalogError,
  refreshCatalog,
  cart,
  wishlist,
  onAdd,
  onWish,
}: CatalogRouteProps) {
  const { categorySlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const priceBounds = useMemo(() => catalogPriceBounds(products), [products])
  const availableBrands = useMemo(
    () =>
      [...new Set(products.map((product) => product.brand.trim()).filter(Boolean))].sort((first, second) =>
        first.localeCompare(second, 'uk-UA'),
      ),
    [products],
  )
  const filters = useMemo(
    () => catalogFiltersFromSearch(location.search, priceBounds, availableBrands),
    [availableBrands, location.search, priceBounds],
  )

  if (catalogLoading) return <RouteLoading label="Збираємо колекцію…" />
  if (catalogError) return <RouteError onRetry={() => void refreshCatalog()} />

  const activeCategory = categorySlug
    ? categories.find((category) => category.slug === categorySlug)
    : categories[0]
  if (!activeCategory) return <NotFound />

  const updateFilters = (changes: Partial<CatalogFilters>) =>
    navigate(catalogPath(activeCategory.slug, { ...filters, ...changes }, priceBounds))

  return (
    <Catalog
      products={products}
      categories={categories}
      activeCategory={activeCategory.name}
      activeCategorySlug={activeCategory.slug}
      filters={filters}
      priceBounds={priceBounds}
      availableBrands={availableBrands}
      onSortChange={(sort) => updateFilters({ sort })}
      onApplyFilters={(changes) => updateFilters(changes)}
      onResetFilters={() =>
        navigate(catalogPath(activeCategory.slug, defaultCatalogFilters(priceBounds), priceBounds))
      }
      cart={cart}
      wishlist={wishlist}
      onAdd={onAdd}
      onWish={onWish}
    />
  )
}
