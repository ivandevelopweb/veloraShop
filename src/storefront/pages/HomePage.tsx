import { Icon } from '../../shared/ui/Icon'
import { Link } from 'react-router-dom'
import { ProductCard } from '../components/StorefrontComponents'
import { catalogPath } from '../routing/paths'

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`

export function Home({ products, categories, cart, wishlist, onAdd, onWish }) {
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Нова колекція · Осінь 2026</p>
          <h1>
            Речі, що роблять
            <br />
            <i>щоденність особливою.</i>
          </h1>
          <p>
            Зібрали предмети для дому, турботи про себе й тих моментів, які хочеться проживати
            повільніше.
          </p>
          <div className="hero-buttons">
            <Link className="button-dark" to={catalogPath()}>
              Переглянути колекцію <Icon name="arrow" size={17} />
            </Link>
            <Link className="text-button" to={catalogPath('podarunky')}>
              Ідеї для подарунків
            </Link>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-photo hero-photo-one">
            <img src={image('photo-1610701596007-11502861dcfa')} alt="Колекція Velora" />
          </div>
          <div className="hero-photo hero-photo-two">
            <img src={image('photo-1603006905003-be475563bc59')} alt="Ароматична свічка" />
          </div>
          <span className="hero-note">
            Обирайте
            <br />
            красу щодня
          </span>
        </div>
      </section>
      <section className="main-content home-content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Вибране для вас</p>
            <h2>Маленькі речі з великим настроєм</h2>
          </div>
          <Link className="text-link" to={catalogPath()}>
            Усі товари <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="featured-grid">
          {products.slice(0, 4).map((item) => (
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
      <section className="ritual-banner">
        <div>
          <p className="eyebrow">Velora journal</p>
          <h2>
            Дім — це не місце.
            <br />
            Це відчуття.
          </h2>
          <Link className="text-link light" to={catalogPath('dim')}>
            Створити свій простір <Icon name="arrow" size={16} />
          </Link>
        </div>
        <img src={image('photo-1616486338812-3dadae4b4ace')} alt="Теплий інтер’єр" />
      </section>
      <section className="main-content home-content categories-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Знайдіть своє</p>
            <h2>Оберіть настрій</h2>
          </div>
        </div>
        <div className="category-tiles">
          {categories.slice(1).map((category, index) => (
            <Link key={category.slug} to={catalogPath(category.slug)}>
              <span className={`tile-icon tile-${index}`}>
                <Icon name={category.icon} size={26} />
              </span>
              <span>{category.name}</span>
              <Icon name="arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
