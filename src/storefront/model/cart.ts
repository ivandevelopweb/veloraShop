import type { CartItem } from '../../api'
import type { DisplayProduct } from './displayProduct'

export type DisplayCartItem = DisplayProduct & { quantity: number }

export function hydrateCartItems(
  products: DisplayProduct[],
  cartItems: CartItem[],
): DisplayCartItem[] {
  return cartItems.flatMap((cartItem) => {
    const product = products.find((candidate) => candidate.id === cartItem.productId)
    return product ? [{ ...product, stock: cartItem.stock, quantity: cartItem.quantity }] : []
  })
}
