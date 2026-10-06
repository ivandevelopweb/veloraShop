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
  brand: string
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
  brand: string
  shortDescription: string
  description: string
  priceUah: number
  oldPriceUah: number | null
  stock: number
  reservedStock: number
  status: 'draft' | 'active' | 'archived'
  isAvailable: boolean
  rating: number
  reviewCount: number
  baseRating: number
  baseCount: number
  baseSum: string
  ratingEpoch: string
  ratingRevision: string
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
  brand: string
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

export type ProductFieldsInput = Omit<ProductInput, 'rating' | 'reviewCount'>

export type ProductUpdateInput = Partial<ProductFieldsInput>

export type InitialAdminComment = {
  nickname: string
  message: string
  clientRequestId: string
}

export type ProductCreateInput = ProductInput & {
  initialComments?: InitialAdminComment[]
}

export type PublicCommunityComment = {
  id: string
  nickname: string
  message: string
  createdAt: string
}

export type AdminCommunityComment = PublicCommunityComment & {
  source: 'customer' | 'admin'
  updatedAt: string
  deletedAt: string | null
}

export type CommunityPage<T> = {
  page: number
  pageSize: number
  total: number
  items: T[]
}

export type ProductCommunity = {
  summary: { rating: number; reviewCount: number; commentCount: number }
  comments: CommunityPage<PublicCommunityComment>
}

export type PublicProductRating = {
  displayName: string
  stars: number
  createdAt: string
}

export type CustomerCommunityState = {
  canReview: boolean
  reason: 'purchase_required' | null
  ratingEpoch: string
  rating: { stars: number; updatedAt: string } | null
  comment: PublicCommunityComment & { updatedAt: string } | null
}

export type RatingSummary = {
  rating: number
  reviewCount: number
}

export type RatingResetInput = {
  rating: number
  count: number
  expectedEpoch: string
  expectedRevision: string
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

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'reconciliation_required'

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

export type AssistantHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
  productIds?: number[]
}

export type AssistantProduct = {
  id: number
  slug: string
  name: string
  shortDescription: string
  price: number
  oldPrice: number | null
  badge: string
  rating: number
  reviewCount: number
  stock: number
  category: string | null
  image: string | null
}

export type AssistantMessageResponse = {
  interactionId: string
  answer: string
  products: AssistantProduct[]
  remainingRequests: number
  mode: 'model' | 'social' | 'catalogue' | 'clarification'
}
