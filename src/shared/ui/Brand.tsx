import veloraLogo from '../../assets/velora-logo.png'
import { Link } from 'react-router-dom'

export function Brand({ footer = false }) {
  return (
    <Link className={`brand ${footer ? 'footer-brand' : ''}`} to="/" aria-label="Velora — головна">
      <img className="brand-logo" src={veloraLogo} alt="Velora" />
    </Link>
  )
}
