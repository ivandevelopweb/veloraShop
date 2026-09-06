import { Link } from 'react-router-dom'
import { Icon } from '../../shared/ui/Icon'
import { catalogPath } from './paths'

export function RouteLoading({ label = 'Відкриваємо сторінку…' }) {
  return (
    <main className="main-content confirmation route-state">
      <div className="confirmation-mark">
        <Icon name="sparkles" size={31} />
      </div>
      <p className="eyebrow">Velora</p>
      <h1>{label}</h1>
      <p>Зачекайте мить.</p>
    </main>
  )
}

export function RouteError({ onRetry }) {
  return (
    <main className="main-content confirmation route-state">
      <div className="confirmation-mark">
        <Icon name="close" size={31} />
      </div>
      <p className="eyebrow">Velora</p>
      <h1>Не вдалося завантажити сторінку</h1>
      <p>Перевірте з’єднання та спробуйте ще раз.</p>
      <div className="route-actions">
        <button className="button-dark" onClick={onRetry}>
          Спробувати ще раз <Icon name="arrow" size={17} />
        </button>
        <Link className="text-link" to={catalogPath()}>
          До магазину
        </Link>
      </div>
    </main>
  )
}
