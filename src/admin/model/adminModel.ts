import type { AdminOrder, AdminProduct, ProductInput } from '../../api'
import { formatDateTime, formatPriceWithCurrency } from '../../shared/lib/format'

export type AdminView =
  | 'dashboard'
  | 'products'
  | 'product-editor'
  | 'orders'
  | 'order-detail'
  | 'categories'

export type RouteState = {
  view: AdminView
  id?: number
  code?: string
}

export const formatPrice = formatPriceWithCurrency
export const formatDate = formatDateTime

export const statusLabel: Record<AdminOrder['status'], string> = {
  new: 'Нове',
  processing: 'В обробці',
  shipped: 'Відправлено',
  completed: 'Завершено',
  cancelled: 'Скасовано',
}

export const paymentStatusLabel: Record<AdminOrder['paymentStatus'], string> = {
  pending: 'Очікується',
  paid: 'Оплачено',
  failed: 'Відхилено',
  cancelled: 'Скасовано',
}

export const productStatusLabel: Record<AdminProduct['status'], string> = {
  draft: 'Чернетка',
  active: 'Активний',
  archived: 'Архів',
}

export function routeFromLocation(): RouteState {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'admin') return { view: 'dashboard' }
  if (parts[1] === 'products' && parts[2] === 'new') return { view: 'product-editor' }
  if (parts[1] === 'products' && parts[3] === 'edit') {
    const id = Number(parts[2])
    return Number.isInteger(id) && id > 0 ? { view: 'product-editor', id } : { view: 'products' }
  }
  if (parts[1] === 'products') return { view: 'products' }
  if (parts[1] === 'orders' && parts[2]) return { view: 'order-detail', code: parts[2] }
  if (parts[1] === 'orders') return { view: 'orders' }
  if (parts[1] === 'categories') return { view: 'categories' }
  return { view: 'dashboard' }
}

export function pathForRoute(route: RouteState) {
  if (route.view === 'products') return '/admin/products'
  if (route.view === 'product-editor')
    return route.id ? `/admin/products/${route.id}/edit` : '/admin/products/new'
  if (route.view === 'orders') return '/admin/orders'
  if (route.view === 'order-detail' && route.code)
    return `/admin/orders/${encodeURIComponent(route.code)}`
  if (route.view === 'categories') return '/admin/categories'
  return '/admin'
}

export function toSlug(value: string) {
  const transliteration: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'h',
    ґ: 'g',
    д: 'd',
    е: 'e',
    є: 'ye',
    ж: 'zh',
    з: 'z',
    и: 'y',
    і: 'i',
    ї: 'yi',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ю: 'yu',
    я: 'ya',
    ь: '',
    '’': '',
    "'": '',
  }
  return Array.from(value.toLowerCase())
    .map((character) => transliteration[character] ?? character)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function emptyProduct(): ProductInput {
  return {
    name: '',
    slug: '',
    categoryId: null,
    shortDescription: '',
    description: '',
    priceUah: 0,
    oldPriceUah: null,
    stock: 0,
    status: 'draft',
    rating: 4.8,
    reviewCount: 0,
    badge: '',
  }
}

export function productToInput(product: AdminProduct): ProductInput {
  return {
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    shortDescription: product.shortDescription,
    description: product.description,
    priceUah: product.priceUah,
    oldPriceUah: product.oldPriceUah,
    stock: product.stock,
    status: product.status,
    rating: product.rating,
    reviewCount: product.reviewCount,
    badge: product.badge,
  }
}

