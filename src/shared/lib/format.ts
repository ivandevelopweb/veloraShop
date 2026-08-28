export const formatPrice = (value: number) => new Intl.NumberFormat('uk-UA').format(value)

export const formatPriceWithCurrency = (value: number) => `${formatPrice(value)} ₴`

export const formatStock = (stock: number) => `В наявності: ${stock} шт.`

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
