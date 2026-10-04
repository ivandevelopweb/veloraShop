import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StorefrontIcon as Icon } from '../components/StorefrontIcon'

type InfoPageSection = {
  number: string
  title: string
  content: ReactNode
}

type InfoPageProps = {
  eyebrow: string
  title: string
  introduction: string
  sections: InfoPageSection[]
  action?: { label: string; to: string }
}

export function InfoPage({ eyebrow, title, introduction, sections, action }: InfoPageProps) {
  return (
    <main className="main-content about-page">
      <div className="crumbs">
        <Link to="/">Головна</Link>
        <Icon name="chevron" size={14} />
        <span>{title}</span>
      </div>

      <section className="about-intro">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{introduction}</p>
        {action && (
          <Link className="button-dark" to={action.to}>
            {action.label} <Icon name="arrow" size={17} />
          </Link>
        )}
      </section>

      <div className="about-sections">
        {sections.map((section) => (
          <section className="about-section" key={section.number}>
            <p className="eyebrow">{section.number}</p>
            <h2>{section.title}</h2>
            {section.content}
          </section>
        ))}
      </div>
    </main>
  )
}
