import { useState } from 'react'
import { formatPrice, formatStock } from '../../shared/lib/format'
import { Icon } from '../../shared/ui/Icon'
import { ProductCard } from '../components/StorefrontComponents'

const price = formatPrice
const stockLabel = formatStock

export function ProductView({ products, item, cart, wishlist, onAdd, onWish, onCatalog, onOpen }) {
  const [tab, setTab] = useState('Опис')
  const [tone, setTone] = useState(0)
  const inCart = cart.find((product) => product.id === item.id)?.quantity || 0
  const atStockLimit = inCart >= item.stock
  const recommendations = products
    .filter((product) => product.category === item.category && product.id !== item.id)
    .slice(0, 4)
  return (
    <main className="main-content product-page">
      <div className="crumbs">
        <button onClick={() => onCatalog(item.category)}>Магазин</button>
        <Icon name="chevron" size={14} />
        <button onClick={() => onCatalog(item.category)}>{item.category}</button>
        <Icon name="chevron" size={14} />
        <span>{item.name}</span>
      </div>
      <section className="product-layout">
        <div className="product-gallery">
          <div className="gallery-image" style={{ background: item.tones[tone] }}>
            {item.badge && <span>{item.badge}</span>}
            <img src={item.image} alt={item.name} />
          </div>
          <div className="gallery-thumbs">
            <button className="active">
              <img src={item.image} alt="" />
            </button>
            <button onClick={() => setTone(0)}>
              <span style={{ background: item.tones[0] }} />
            </button>
            <button onClick={() => setTone(1)}>
              <span style={{ background: item.tones[1] }} />
            </button>
          </div>
        </div>
        <div className="product-detail">
          <p className="eyebrow">{item.category}</p>
          <div className="product-title-row">
            <h1>{item.name}</h1>
            <button
              className={`wish-button standalone ${wishlist.includes(item.id) ? 'active' : ''}`}
              onClick={() => onWish(item.id)}
            >
              <Icon name="heart" size={21} />
            </button>
          </div>
          <p className="detail-subtitle">{item.subtitle}</p>
          <div className="detail-rating">
            <span>★ {item.rating.toFixed(1)}</span>
            <span>{item.reviews} відгуків</span>
          </div>
          <div className="detail-price">
            {item.oldPrice && <s>{price(item.oldPrice)} ₴</s>}
            <strong>{price(item.price)} ₴</strong>
          </div>
          <p className={`detail-stock ${item.stock <= 5 ? 'low-stock' : ''}`}>
            {stockLabel(item.stock)}
          </p>
          <div className="tone-picker">
            <span>
              Відтінок: <b>{tone ? 'Темний' : 'Світлий'}</b>
            </span>
            <div>
              <button
                className={!tone ? 'selected' : ''}
                onClick={() => setTone(0)}
                style={{ background: item.tones[0] }}
              />
              <button
                className={tone ? 'selected' : ''}
                onClick={() => setTone(1)}
                style={{ background: item.tones[1] }}
              />
            </div>
          </div>
          <button
            className="add-large"
            onClick={() => onAdd(item)}
            disabled={atStockLimit}
            title={atStockLimit ? 'У кошику вже весь доступний залишок' : 'Додати до кошика'}
          >
            {inCart ? (
              <>
                <Icon name="check" />
                {atStockLimit ? ` У кошику: ${inCart} — увесь залишок` : ` У кошику: ${inCart}`}
              </>
            ) : (
              <>
                <Icon name="bag" /> Додати до кошика
              </>
            )}
          </button>
          <div className="detail-perks">
            <div>
              <Icon name="truck" />
              <span>
                <b>Безкоштовна доставка</b> від 1 500 ₴
              </span>
            </div>
            <div>
              <Icon name="shield" />
              <span>
                <b>Легке повернення</b> протягом 14 днів
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="product-tabs">
        <div>
          {['Опис', 'Деталі', 'Доставка'].map((label) => (
            <button
              className={tab === label ? 'active' : ''}
              key={label}
              onClick={() => setTab(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          {tab === 'Опис'
            ? `${item.name} — уважно відібраний предмет для тихої, красивої повсякденності. Продумана фактура, стриманий силует і деталі, до яких хочеться повертатися.`
            : tab === 'Деталі'
              ? 'Склад і характеристики зазначені для демонстрації. Перед запуском магазину вони будуть заповнюватися з каталогу.'
              : 'Відправляємо замовлення Новою поштою по Україні. Термін та вартість доставки будуть показані на етапі оформлення.'}
        </p>
      </section>
      <section className="recommendations">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Може сподобатися</p>
            <h2>Доповніть свій вибір</h2>
          </div>
        </div>
        <div className="featured-grid">
          {recommendations.map((product) => (
            <ProductCard
              key={product.id}
              item={product}
              cart={cart}
              isWishlisted={wishlist.includes(product.id)}
              onAdd={onAdd}
              onOpen={onOpen}
              onWish={onWish}
            />
          ))}
        </div>
      </section>
    </main>
  )
}
