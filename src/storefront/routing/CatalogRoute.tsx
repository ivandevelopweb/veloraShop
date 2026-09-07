import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Catalog } from '../pages'
import { NotFound } from '../pages/NotFoundPage'
import { catalogFiltersFromSearch, catalogPath, defaultCatalogFilters } from './paths'
import { RouteError, RouteLoading } from './RouteStates'

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
}) {
  const { categorySlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const filters = catalogFiltersFromSearch(location.search)

  if (catalogLoading) return <RouteLoading label="Збираємо колекцію…" />
  if (catalogError) return <RouteError onRetry={() => void refreshCatalog()} />

  const activeCategory = categorySlug
    ? categories.find((category) => category.slug === categorySlug)
    : categories[0]
  if (!activeCategory) return <NotFound />

  const updateFilters = (changes) =>
    navigate(catalogPath(activeCategory.slug, { ...filters, ...changes }))

  return (
    <Catalog
      products={products}
      categories={categories}
      activeCategory={activeCategory.name}
      activeCategorySlug={activeCategory.slug}
      search={filters.search}
      sort={filters.sort}
      maxPrice={filters.maxPrice}
      ratingOnly={filters.ratingOnly}
      onSortChange={(sort) => updateFilters({ sort })}
      onApplyFilters={(changes) => updateFilters(changes)}
      onResetFilters={() => navigate(catalogPath(activeCategory.slug, defaultCatalogFilters))}
      cart={cart}
      wishlist={wishlist}
      onAdd={onAdd}
      onWish={onWish}
    />
  )
}
