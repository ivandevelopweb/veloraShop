import type { StorefrontProduct } from '../../api'

const categoryIcons = new Map([
  ['Парфумерія', 'perfume'],
  ['Догляд', 'care'],
  ['Дім', 'armchair'],
  ['Аксесуари', 'bag'],
  ['Wellness', 'leaf'],
  ['Техніка', 'headphones'],
  ['Подарунки', 'gift'],
  ['Товари для дому', 'basket'],
  ['Шапки', 'beanie'],
])

export type DisplayProduct = StorefrontProduct & {
  category: string
  subtitle: string
  reviews: number
}

export type DisplayCategory = {
  name: string
  slug: string | null
  icon: string
}

export function toDisplayProducts(products: StorefrontProduct[]): DisplayProduct[] {
  return products.map((product) => ({
    ...product,
    category: product.category ?? 'Інше',
    subtitle: product.shortDescription,
    reviews: product.reviewCount,
  }))
}

export function toDisplayCategories(categories: Array<{ name: string; slug: string }>): DisplayCategory[] {
  return [
    { name: 'Усе', slug: null, icon: 'sparkles' },
    ...categories.map(
      (category) => ({
        name: category.name,
        slug: category.slug,
        icon: categoryIcons.get(category.name) ?? 'sparkles',
      }),
    ),
  ]
}
