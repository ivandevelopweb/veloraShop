import { Link } from 'react-router-dom'
import { catalogPath } from '../routing/paths'
import { Icon } from '../../shared/ui/Icon'

export function NotFound() {
  return (
    <main className="main-content confirmation route-not-found">
      <p className="eyebrow">Velora</p>
      <h1>Сторінку не знайдено</h1>
      <p>Можливо, посилання застаріло або товар більше недоступний.</p>
      <div className="route-actions">
        <Link className="button-dark" to="/">
          На головну <Icon name="arrow" size={17} />
        </Link>
        <Link className="text-link" to={catalogPath()}>
          Відкрити магазин
        </Link>
      </div>
    </main>
  )
}
