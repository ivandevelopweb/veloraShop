import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiClientError } from '../../api'
import { toDisplayProducts } from '../model/displayProduct'
import { NotFound, ProductView } from '../pages'
import { RouteError, RouteLoading } from './RouteStates'

export function ProductRoute({ products, cart, wishlist, onAdd, onWish }) {
  const { productSlug } = useParams()
  if (!productSlug) return <NotFound />
  return (
    <ProductRouteContent
      key={productSlug}
      productSlug={productSlug}
      products={products}
      cart={cart}
      wishlist={wishlist}
      onAdd={onAdd}
      onWish={onWish}
    />
  )
}

function ProductRouteContent({ productSlug, products, cart, wishlist, onAdd, onWish }) {
  const [state, setState] = useState({ status: 'loading', product: null, error: '' })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let isCurrent = true
    void api
      .getProduct(productSlug)
      .then((response) => {
        if (isCurrent)
          setState({ status: 'ready', product: toDisplayProducts([response.product])[0], error: '' })
      })
      .catch((error) => {
        if (!isCurrent) return
        setState({
          status: error instanceof ApiClientError && error.status === 404 ? 'not-found' : 'error',
          product: null,
          error: error instanceof Error ? error.message : 'Не вдалося завантажити товар.',
        })
      })
    return () => {
      isCurrent = false
    }
  }, [productSlug, retry])

  if (state.status === 'not-found') return <NotFound />
  if (state.status === 'loading') return <RouteLoading label="Відкриваємо товар…" />
  if (state.status === 'error' || !state.product)
    return <RouteError onRetry={() => setRetry((current) => current + 1)} />

  return (
    <ProductView
      products={products}
      item={state.product}
      cart={cart}
      wishlist={wishlist}
      onAdd={onAdd}
      onWish={onWish}
    />
  )
}
