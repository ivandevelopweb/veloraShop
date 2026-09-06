import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { toDisplayCategories, toDisplayProducts, type DisplayCategory, type DisplayProduct } from '../model/displayProduct'

export function useCatalog() {
  const [products, setProducts] = useState<DisplayProduct[]>([])
  const [categories, setCategories] = useState<DisplayCategory[]>([
    { name: 'Усе', slug: null, icon: 'sparkles' },
  ])
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const [productResponse, categoryResponse] = await Promise.all([
        api.getProducts({ pageSize: 100 }),
        api.getCategories(),
      ])
      setProducts(toDisplayProducts(productResponse.products))
      setCategories(toDisplayCategories(categoryResponse.categories))
      setCatalogError('')
      return true
    } catch (error) {
      setProducts([])
      setCategories([{ name: 'Усе', slug: null, icon: 'sparkles' }])
      setCatalogError(error instanceof Error ? error.message : 'Не вдалося завантажити каталог.')
      return false
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refreshCatalog)
  }, [refreshCatalog])

  return { products, categories, catalogError, catalogLoading, refreshCatalog }
}
