export type User = {
  id: string
  name: string
  email: string
  role: 'customer' | 'admin'
  createdAt: string
}

export type StorefrontImage = {
  id: string
  url: string
  altText: string
  sortOrder: number
}

export type StorefrontProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  price: number
  oldPrice: number | null
  rating: number
  reviewCount: number
  badge: string
  stock: number
  category: string | null
  categorySlug: string | null
  image: string | null
  images: StorefrontImage[]
  createdAt: string
}

export type Category = {
  id: string
  name: string
  slug: string
  description: string
  productCount?: number
  isArchived?: boolean
}

export type AdminImage = StorefrontImage & {
  provider: 'cloudinary' | 'external'
  publicId: string | null
  width: number | null
  height: number | null
}

export type AdminProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  description: string
  priceUah: number
  oldPriceUah: number | null
  stock: number
  status: 'draft' | 'active' | 'archived'
  isAvailable: boolean
  rating: number
  reviewCount: number
  badge: string
  createdAt: string
  updatedAt: string
  categoryId: string | null
  categoryName: string | null
  images: AdminImage[]
}

export type AdminOrder = {
  code: string
  status: 'new' | 'processing' | 'shipped' | 'completed' | 'cancelled'
  paymentStatus: PaymentStatus
  paymentProvider: string | null
  providerPaymentId: string | null
  total: number
  customerName: string
  customerEmail: string
  createdAt: string
}

export type AdminOrderDetails = AdminOrder & {
  id: string
  deliveryMethod: string
  deliveryCity: string
  deliveryBranch: string
  customerPhone: string
  updatedAt: string
  items: Array<{ productId: number; name: string; price: number; quantity: number }>
  events: Array<{
    previousStatus: string | null
    nextStatus: string
    createdAt: string
    changedBy: string | null
  }>
}

export type ProductInput = {
  name: string
  slug: string
  categoryId: string | null
  shortDescription: string
  description: string
  priceUah: number
  oldPriceUah: number | null
  stock: number
  status: 'draft' | 'active' | 'archived'
  rating: number
  reviewCount: number
  badge: string
}

export type CartItem = {
  productId: number
  quantity: number
  name: string
  price: number
  stock: number
}

export type Order = {
  code: string
  status: string
  paymentStatus: PaymentStatus
  total: number
  createdAt: string
  deliveryMethod: string
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type LiqpayCheckout = {
  data: string
  signature: string
}

export type CheckoutDetails = {
  firstName: string
  lastName: string
  phone: string
  email: string
  city: string
  branch: string
  deliveryMethod: 'nova_poshta' | 'velora_courier'
}
