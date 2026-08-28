import veloraLogo from '../../assets/velora-logo.png'

export function Brand({ onClick, footer = false }) {
  return (
    <button className={`brand ${footer ? 'footer-brand' : ''}`} onClick={onClick}>
      <span className="brand-logo-crop">
        <img src={veloraLogo} alt="" />
      </span>
      <span>VELORA</span>
    </button>
  )
}
