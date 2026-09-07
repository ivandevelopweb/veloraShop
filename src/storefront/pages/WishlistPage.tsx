import { Link } from 'react-router-dom'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'
import { CategoryRail, ProductCard } from '../components/StorefrontComponents'
import { catalogPath } from '../routing/paths'

export function Wishlist({
  products,
  categories,
  wishlist,
  catalogLoading,
  catalogError,
  refreshCatalog,
  cart,
  onAdd,
  onWish,
}) {
  if (catalogLoading) {
    return (
      <main className="main-content wishlist-page">
        <div className="wishlist-state" role="status">
          <Icon name="heart" size={30} />
          <h1>Обране</h1>
          <p>Завантажуємо збережені товари…</p>
        </div>
      </main>
    )
  }

  if (catalogError) {
    return (
      <main className="main-content wishlist-page">
        <div className="wishlist-state" role="alert">
          <Icon name="alert" size={30} />
          <h1>Обране тимчасово недоступне</h1>
          <p>Не вдалося завантажити каталог товарів.</p>
          <button className="button-dark" onClick={() => void refreshCatalog()}>
            Повторити
          </button>
        </div>
      </main>
    )
  }

  const savedProducts = products.filter((product) => wishlist.includes(product.id))

  return (
    <main className="main-content wishlist-page">
      <div className="crumbs">
        <Link to="/">Головна</Link>
        <Icon name="chevron" size={14} />
        <span>Обране</span>
      </div>
      <div className="wishlist-heading">
        <div>
          <p className="eyebrow">Збережені товари</p>
          <h1>Обране</h1>
        </div>
        <span>{savedProducts.length} товарів</span>
      </div>
      {categories.length > 0 && <CategoryRail categories={categories} activeSlug={undefined} />}
      {savedProducts.length ? (
        <div className="wishlist-grid">
          {savedProducts.map((item) => (
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
      ) : (
        <div className="empty-state wishlist-empty">
          <Icon name="heart" size={30} />
          <h2>В обраному поки що порожньо</h2>
          <p>Збережіть товар сердечком, щоб повернутися до нього пізніше.</p>
          <Link className="button-dark" to={catalogPath()}>
            Перейти до каталогу
          </Link>
        </div>
      )}
    </main>
  )
}
