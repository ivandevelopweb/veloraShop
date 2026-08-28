import type { StorefrontProduct } from '../../api'

const categoryIcons = new Map([
  ['Парфумерія', 'bottle'],
  ['Догляд', 'flower'],
  ['Дім', 'home'],
  ['Аксесуари', 'gem'],
  ['Wellness', 'sun'],
  ['Техніка', 'bolt'],
  ['Подарунки', 'gift'],
])

export type DisplayProduct = StorefrontProduct & {
  category: string
  subtitle: string
  reviews: number
  tones: [string, string]
}

export type DisplayCategory = [string, string]

export function toDisplayProducts(products: StorefrontProduct[]): DisplayProduct[] {
  return products.map((product, index) => ({
    ...product,
    category: product.category ?? 'Інше',
    subtitle: product.shortDescription,
    reviews: product.reviewCount,
    tones: index % 2 ? ['#d9c09a', '#2f2b27'] : ['#e8dfd1', '#b89062'],
  }))
}

export function toDisplayCategories(categories: Array<{ name: string }>): DisplayCategory[] {
  return [
    ['Усе', 'sparkles'],
    ...categories.map(
      (category) => [category.name, categoryIcons.get(category.name) ?? 'sparkles'] as DisplayCategory,
    ),
  ]
}
