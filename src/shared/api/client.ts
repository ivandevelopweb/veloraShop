import type {
  AdminOrder,
  AdminOrderDetails,
  AdminProduct,
  CartItem,
  Category,
  CheckoutDetails,
  LiqpayCheckout,
  PaymentStatus,
  Order,
  ProductInput,
  StorefrontProduct,
  User,
} from './types'

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

let csrfToken = ''
const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim().replace(/\/+$/, '')

function apiUrl(path: string) {
  return apiOrigin ? `${apiOrigin}${path}` : path
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new ApiClientError(response.status, payload.error ?? 'Не вдалося виконати запит')
  }
  return payload as T
}

export async function bootstrapCsrf() {
  const response = await fetch(apiUrl('/api/auth/csrf'), { credentials: 'include' })
  const payload = await readResponse<{ csrfToken: string }>(response)
  csrfToken = payload.csrfToken
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isMutation = !['GET', 'HEAD'].includes(method)
  if (isMutation && !csrfToken) await bootstrapCsrf()
  const isFormData = body instanceof FormData

  const send = () =>
    fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: {
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(isMutation ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    })

  let response = await send()
  if (isMutation && response.status === 403) {
    await bootstrapCsrf()
    response = await send()
  }

  if (response.status === 204) return undefined as T
  return readResponse<T>(response)
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  register: (payload: { name: string; email: string; password: string }) =>
    request<{ user: User }>('POST', '/api/auth/register', payload),
  login: (payload: { email: string; password: string }) =>
    request<{ user: User }>('POST', '/api/auth/login', payload),
  logout: () => request<void>('POST', '/api/auth/logout'),
  getCart: () => request<{ items: CartItem[] }>('GET', '/api/cart'),
  addToCart: (productId: number) =>
    request<{ items: CartItem[] }>('POST', '/api/cart', { productId }),
  updateCart: (productId: number, quantity: number) =>
    request<{ items: CartItem[] }>('PATCH', `/api/cart/${productId}`, { quantity }),
  removeFromCart: (productId: number) =>
    request<{ items: CartItem[] }>('DELETE', `/api/cart/${productId}`),
  getOrders: () => request<{ orders: Order[] }>('GET', '/api/orders'),
  createLiqpayCheckout: (details: CheckoutDetails) =>
    request<{ order: { code: string; total: number }; checkout: LiqpayCheckout }>(
      'POST',
      '/api/payments/liqpay/checkout',
      details,
    ),
  getLiqpayPayment: (code: string) =>
    request<{ order: { code: string; total: number; paymentStatus: PaymentStatus } }>(
      'GET',
      `/api/payments/liqpay/orders/${encodeURIComponent(code)}`,
    ),
  cancelLiqpayPayment: (code: string) =>
    request<{ order: { code: string; total: number; paymentStatus: PaymentStatus } }>(
      'POST',
      `/api/payments/liqpay/orders/${encodeURIComponent(code)}/cancel`,
    ),
  getProducts: (
    params: {
      page?: number
      pageSize?: number
      search?: string
      category?: string
      minPrice?: number
      maxPrice?: number
      sort?: 'popular' | 'price_asc' | 'price_desc' | 'newest'
    } = {},
  ) => {
    const query = new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) =>
        value === undefined || value === '' ? [] : [[key, String(value)]],
      ),
    )
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<{
      products: StorefrontProduct[]
      page: number
      pageSize: number
      total: number
    }>('GET', `/api/products${suffix}`)
  },
  getCategories: () => request<{ categories: Category[] }>('GET', '/api/categories'),
  admin: {
    dashboard: () =>
      request<{
        catalog: {
          totalProducts: number
          activeProducts: number
          draftProducts: number
          archivedProducts: number
          totalStock: number
        }
        orders: { totalOrders: number; openOrders: number; revenueUah: number }
        lowStock: Array<{ id: number; name: string; stock: number }>
        recentOrders: Array<{
          code: string
          customerName: string
          total: number
          status: string
          createdAt: string
        }>
      }>('GET', '/api/admin/dashboard'),
    getProducts: (
      params: {
        page?: number
        pageSize?: number
        search?: string
        status?: 'draft' | 'active' | 'archived' | 'all'
        categoryId?: string
      } = {},
    ) => {
      const query = new URLSearchParams(
        Object.entries(params).flatMap(([key, value]) =>
          value === undefined || value === '' ? [] : [[key, String(value)]],
        ),
      )
      const suffix = query.size ? `?${query.toString()}` : ''
      return request<{ products: AdminProduct[]; page: number; pageSize: number; total: number }>(
        'GET',
        `/api/admin/products${suffix}`,
      )
    },
    getProduct: (id: number) =>
      request<{ product: AdminProduct }>('GET', `/api/admin/products/${id}`),
    createProduct: (payload: ProductInput) =>
      request<{ product: AdminProduct }>('POST', '/api/admin/products', payload),
    updateProduct: (id: number, payload: Partial<ProductInput>) =>
      request<{ product: AdminProduct }>('PATCH', `/api/admin/products/${id}`, payload),
    deleteProduct: (id: number) => request<void>('DELETE', `/api/admin/products/${id}`),
    uploadProductImages: (id: number, files: File[]) => {
      const formData = new FormData()
      files.forEach((file) => formData.append('images', file))
      return request<{ product: AdminProduct }>(
        'POST',
        `/api/admin/products/${id}/images`,
        formData,
      )
    },
    updateProductImages: (
      id: number,
      images: Array<{ id: string; altText: string; sortOrder: number }>,
    ) =>
      request<{ product: AdminProduct }>('PATCH', `/api/admin/products/${id}/images`, { images }),
    deleteProductImage: (productId: number, imageId: string) =>
      request<{ product: AdminProduct }>(
        'DELETE',
        `/api/admin/products/${productId}/images/${imageId}`,
      ),
    getCategories: () => request<{ categories: Category[] }>('GET', '/api/admin/categories'),
    createCategory: (payload: Omit<Category, 'id' | 'productCount'>) =>
      request<{ id: string }>('POST', '/api/admin/categories', payload),
    updateCategory: (id: string, payload: Partial<Omit<Category, 'id' | 'productCount'>>) =>
      request<void>('PATCH', `/api/admin/categories/${id}`, payload),
    deleteCategory: (id: string) => request<void>('DELETE', `/api/admin/categories/${id}`),
    getOrders: (params: { page?: number; pageSize?: number; status?: string } = {}) => {
      const query = new URLSearchParams(
        Object.entries(params).flatMap(([key, value]) =>
          value === undefined || value === '' ? [] : [[key, String(value)]],
        ),
      )
      const suffix = query.size ? `?${query.toString()}` : ''
      return request<{ orders: AdminOrder[]; page: number; pageSize: number; total: number }>(
        'GET',
        `/api/admin/orders${suffix}`,
      )
    },
    getOrder: (code: string) =>
      request<{ order: AdminOrderDetails }>('GET', `/api/admin/orders/${encodeURIComponent(code)}`),
    updateOrderStatus: (code: string, status: AdminOrder['status']) =>
      request<{ code: string; previousStatus: string; status: string }>(
        'PATCH',
        `/api/admin/orders/${encodeURIComponent(code)}/status`,
        { status },
      ),
  },
}
