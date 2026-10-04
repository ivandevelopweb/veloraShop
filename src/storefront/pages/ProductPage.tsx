import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from '../../api'
import { formatPriceWithCurrency, formatStock } from '../../shared/lib/format'
import { ProductReviews } from '../components/ProductReviews'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { ProductCard } from '../components/StorefrontComponents'
import type { DisplayCartItem } from '../model/cart'
import type { DisplayProduct } from '../model/displayProduct'
import { catalogPath } from '../routing/paths'

const price = formatPriceWithCurrency
const stockLabel = formatStock

function galleryFor(item) {
  const images = [...(item.images ?? [])]
    .filter((image) => image.url)
    .sort((first, second) => first.sortOrder - second.sortOrder)

  if (images.length) return images
  return item.image
    ? [{ id: 'product-image', url: item.image, altText: item.name, sortOrder: 0 }]
    : []
}

export function ProductView({
  products,
  item,
  cart,
  wishlist,
  user,
  sessionLoading,
  refreshCatalog,
  onRequireLogin,
  onAdd,
  onWish,
}: {
  products: DisplayProduct[]
  item: DisplayProduct
  cart: DisplayCartItem[]
  wishlist: number[]
  user: User | null
  sessionLoading: boolean
  refreshCatalog: () => Promise<boolean>
  onRequireLogin: () => void
  onAdd: (item: DisplayProduct) => void | Promise<void>
  onWish: (id: number) => void
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [ratingSummary, setRatingSummary] = useState({ rating: item.rating, reviewCount: item.reviewCount, commentCount: 0 })
  const galleryImages = galleryFor(item)
  const activeImage = galleryImages[activeImageIndex] ?? galleryImages[0]
  const inCart = cart.find((product) => product.id === item.id)?.quantity || 0
  const atStockLimit = inCart >= item.stock
  const recommendations = products
    .filter((product) => product.category === item.category && product.id !== item.id)
    .slice(0, 4)

  return (
    <main className="main-content product-page">
      <div className="crumbs">
        <Link to={catalogPath()}>Магазин</Link>
        <Icon name="chevron" size={14} />
        {item.categorySlug && (
          <>
            <Link to={catalogPath(item.categorySlug)}>{item.category}</Link>
            <Icon name="chevron" size={14} />
          </>
        )}
        <span>{item.name}</span>
      </div>

      <section className="product-layout">
        <div className="product-detail">
          <p className="eyebrow">{item.category}</p>
          <div className="product-title-row">
            <h1>{item.name}</h1>
            <button
              className={`wish-button standalone ${wishlist.includes(item.id) ? 'active' : ''}`}
              onClick={() => onWish(item.id)}
              aria-label={
                wishlist.includes(item.id)
                  ? `Прибрати ${item.name} з обраного`
                  : `Додати ${item.name} до обраного`
              }
              aria-pressed={wishlist.includes(item.id)}
            >
              <Icon name={wishlist.includes(item.id) ? 'heart-filled' : 'heart'} size={20} />
            </button>
          </div>
          <p className="detail-subtitle">{item.shortDescription}</p>
          <p className="product-code">Код товару: {item.id}</p>
          <a
            className="detail-rating"
            href="#product-reviews-title"
            aria-label={ratingSummary.reviewCount > 0
              ? `Рейтинг ${ratingSummary.rating.toFixed(1)} з 5, ${ratingSummary.reviewCount} оцінок`
              : 'Ще немає оцінок'}
          >
            {ratingSummary.reviewCount > 0 ? (
              <>
                <span><Icon name="star" size={16} /> {ratingSummary.rating.toFixed(1)}</span>
                <span>· {ratingSummary.reviewCount} оцінок</span>
              </>
            ) : (
              <span>Ще немає оцінок</span>
            )}
          </a>
          <div className="detail-price">
            {item.oldPrice !== null && item.oldPrice > item.price && <s>{price(item.oldPrice)}</s>}
            <strong>{price(item.price)}</strong>
          </div>
          <p className={`detail-stock ${item.stock <= 5 ? 'low-stock' : ''}`}>
            {stockLabel(item.stock)}
          </p>
          <button
            className="add-large"
            onClick={() => onAdd(item)}
            disabled={atStockLimit}
            title={atStockLimit ? 'У кошику вже весь доступний залишок' : 'Додати до кошика'}
          >
            {inCart ? (
              <>
                <Icon name="check" />
                {atStockLimit ? `У кошику: ${inCart} — увесь залишок` : `У кошику: ${inCart}`}
              </>
            ) : (
              <>
                <Icon name="bag" /> Додати до кошика
              </>
            )}
          </button>
        </div>

        <div className="product-gallery">
          <div className="gallery-image">
            {item.badge && <span className="product-badge">{item.badge}</span>}
            {activeImage ? (
              <img src={activeImage.url} alt={activeImage.altText || item.name} />
            ) : (
              <span className="product-image-placeholder">Фото відсутнє</span>
            )}
          </div>
          {galleryImages.length > 1 && (
            <div className="gallery-thumbs" aria-label="Фотографії товару">
              {galleryImages.map((image, index) => (
                <button
                  className={index === activeImageIndex ? 'active' : ''}
                  key={image.id}
                  onClick={() => setActiveImageIndex(index)}
                  aria-label={`Показати фото ${index + 1}`}
                  aria-pressed={index === activeImageIndex}
                >
                  <img src={image.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="product-description" aria-labelledby="product-description-title">
        <h2 id="product-description-title">Опис товару</h2>
        <p>{item.description || item.shortDescription}</p>
      </section>

      <ProductReviews
        productId={item.id}
        user={user}
        sessionLoading={sessionLoading}
        onRequireLogin={onRequireLogin}
        onSummaryChange={setRatingSummary}
        refreshCatalog={refreshCatalog}
      />

      {recommendations.length > 0 && (
        <section className="recommendations">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Із цієї категорії</p>
              <h2>Вам також може сподобатися</h2>
            </div>
            <Link className="text-link" to={catalogPath(item.categorySlug)}>
              Усі товари
            </Link>
          </div>
          <div className="featured-grid">
            {recommendations.map((product) => (
              <ProductCard
                key={product.id}
                item={product}
                cart={cart}
                isWishlisted={wishlist.includes(product.id)}
                onAdd={onAdd}
                onWish={onWish}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
