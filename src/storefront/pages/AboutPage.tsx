import { Icon } from '../../shared/ui/Icon'

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`

export function About({ onNavigate }) {
  return (
    <main className="main-content about-page">
      <section>
        <p className="eyebrow">Про Velora</p>
        <h1>
          Для тих, хто обирає <i>відчувати.</i>
        </h1>
        <p>
          Velora — це уважно зібраний простір красивих речей. Ми віримо, що незначні, на перший
          погляд, деталі здатні змінити ритм дня і зробити дім ближчим.
        </p>
        <button className="button-dark" onClick={() => onNavigate('catalog')}>
          Відкрити магазин <Icon name="arrow" size={17} />
        </button>
      </section>
      <div className="about-visual">
        <img src={image('photo-1519710887729-027a1c370c30')} alt="Естетичний простір Velora" />
        <span>
          Less, but
          <br />
          <i>better.</i>
        </span>
      </div>
    </main>
  )
}
