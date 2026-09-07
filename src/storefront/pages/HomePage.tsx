import { Link } from 'react-router-dom'
import { formatPriceWithCurrency } from '../../shared/lib/format'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { ProductCard } from '../components/StorefrontComponents'
import type { DisplayProduct } from '../model/displayProduct'
import { catalogPath, productPath } from '../routing/paths'

const price = formatPriceWithCurrency

function imageFor(item: DisplayProduct | undefined) {
  return item.image ?? item.images?.[0]?.url ?? null
}

function altFor(item: DisplayProduct) {
  return item.images?.[0]?.altText || item.name
}

function byId(a: DisplayProduct, b: DisplayProduct) {
  return a.id - b.id
}

function uniqueProducts(items: DisplayProduct[]): DisplayProduct[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function HomeLoading() {
  return (
    <main className="home-page" aria-busy="true">
      <section className="home-spotlight home-skeleton main-content" aria-hidden="true">
        <div className="skeleton-copy">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="skeleton-media" />
      </section>
      <section className="home-section main-content">
        <div className="section-heading">
          <span className="skeleton-heading" />
        </div>
        <div className="home-product-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="product-card product-card-skeleton" key={index} aria-hidden="true">
              <div className="skeleton-image" />
              <div className="skeleton-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export function Home({
  products,
  categories,
  cart,
  wishlist,
  onAdd,
  onWish,
  catalogLoading,
  catalogError,
  refreshCatalog,
}) {
  if (catalogLoading) return <HomeLoading />

  if (catalogError) {
    return (
      <main className="home-page main-content">
        <div className="page-error" role="alert">
          <Icon name="alert" size={28} />
          <h1>Не вдалося завантажити каталог</h1>
          <p>Перевірте з’єднання та спробуйте ще раз.</p>
          <button className="button-dark" onClick={() => void refreshCatalog()}>
            Спробувати ще раз <Icon name="arrow" size={17} />
          </button>
        </div>
      </main>
    )
  }

  const orderedProducts = [...products].sort(byId)
  const featuredProduct = orderedProducts.find((item) => item.stock > 0) ?? orderedProducts[0]
  const featuredProducts = orderedProducts.slice(0, 8)
  const categoryTiles = categories
    .filter((category) => category.slug)
    .map((category) => {
      const categoryProducts = orderedProducts.filter(
        (item) => item.categorySlug === category.slug,
      )
      return {
        category,
        product: categoryProducts.find((item) => imageFor(item)) ?? categoryProducts[0] ?? null,
      }
    })
  const datedProducts = orderedProducts
    .filter((item) => item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime()))
    .sort((a, b) => {
      const dateDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return dateDifference || byId(a, b)
    })
  const discountedProducts = orderedProducts.filter(
    (item) => item.oldPrice !== null && item.oldPrice > item.price,
  )

  return (
    <main className="home-page">
      {featuredProduct && (
        <section className="home-spotlight main-content">
          <div className="spotlight-copy">
            <p className="eyebrow">Товар у каталозі</p>
            <h1>{featuredProduct.name}</h1>
            <p>{featuredProduct.shortDescription}</p>
            <strong>{price(featuredProduct.price)}</strong>
            <Link className="button-dark" to={productPath(featuredProduct.slug)}>
              Переглянути товар <Icon name="arrow" size={17} />
            </Link>
          </div>
          <Link
            className="spotlight-media"
            to={productPath(featuredProduct.slug)}
            aria-label={`Відкрити ${featuredProduct.name}`}
          >
            {imageFor(featuredProduct) ? (
              <img src={imageFor(featuredProduct)} alt={altFor(featuredProduct)} />
            ) : (
              <span>Фото відсутнє</span>
            )}
          </Link>
        </section>
      )}

      <section className="home-section main-content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Каталог</p>
            <h2>Категорії</h2>
          </div>
          <Link className="text-link" to={catalogPath()}>
            Усі товари <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="home-category-grid">
          {categoryTiles.map(({ category, product }) => (
            <Link className="home-category-tile" key={category.slug} to={catalogPath(category.slug)}>
              <span className="home-category-image">
                {product && imageFor(product) ? (
                  <img src={imageFor(product)} alt="" loading="lazy" />
                ) : (
                  <span>Фото відсутнє</span>
                )}
              </span>
              <span className="home-category-name">{category.name}</span>
              <Icon name="arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section main-content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Каталог Velora</p>
            <h2>Добірка товарів</h2>
          </div>
          <Link className="text-link" to={catalogPath()}>
            Усі товари <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="home-product-grid">
          {featuredProducts.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              cart={cart}
              isWishlisted={wishlist.includes(item.id)}
              onAdd={onAdd}
              onWish={onWish}
            />
          ))}
        </div>
      </section>

      {datedProducts.length > 0 && (
        <section className="home-section main-content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">За датою в каталозі</p>
              <h2>Нові в каталозі</h2>
            </div>
          </div>
          <div className="home-product-grid">
            {uniqueProducts(datedProducts.slice(0, 8)).map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                cart={cart}
                isWishlisted={wishlist.includes(item.id)}
                onAdd={onAdd}
                onWish={onWish}
              />
            ))}
          </div>
        </section>
      )}

      {discountedProducts.length > 0 && (
        <section className="home-section main-content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ціна в каталозі</p>
              <h2>Знижки</h2>
            </div>
          </div>
          <div className="home-product-grid">
            {uniqueProducts(discountedProducts.slice(0, 8)).map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                cart={cart}
                isWishlisted={wishlist.includes(item.id)}
                onAdd={onAdd}
                onWish={onWish}
              />
            ))}
          </div>
        </section>
      )}

      <section className="home-service-line main-content" aria-label="Інформація">
        <Link to="/about#delivery">Доставка</Link>
        <Link to="/about#payment">Оплата</Link>
        <Link to="/about#contacts">Контакти</Link>
      </section>
    </main>
  )
}
