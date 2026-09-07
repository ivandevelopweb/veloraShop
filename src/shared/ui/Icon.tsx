export function Icon({ name, size = 20 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.7',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  const icons = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    bag: (
      <>
        <path d="M5 8.5h14l-1 11H6l-1-11Z" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.5 20c.7-3.3 3-5.1 6.5-5.1s5.8 1.8 6.5 5.1" />
      </>
    ),
    heart: (
      <path d="M20.8 8.7c0 5.2-8.8 10.4-8.8 10.4S3.2 13.9 3.2 8.7A4.5 4.5 0 0 1 12 7.2a4.5 4.5 0 0 1 8.8 1.5Z" />
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    check: <path d="m5 12 4.2 4L19 7" />,
    alert: (
      <>
        <path d="M12 4 3.8 19h16.4L12 4Z" />
        <path d="M12 9v4M12 16.5h.01" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v10H3zM14 10h3l3 3v3h-6z" />
        <circle cx="7" cy="18" r="1.5" />
        <circle cx="17" cy="18" r="1.5" />
      </>
    ),
    shield: <path d="M12 3 5.5 5.8v5.6c0 4.1 2.7 7.6 6.5 9.6 3.8-2 6.5-5.5 6.5-9.6V5.8L12 3Z" />,
    bottle: (
      <>
        <path d="M9 4h6M10 4v4l-3.5 3.2V20h11v-8.8L14 8V4" />
        <path d="M6.5 14h11" />
      </>
    ),
    flower: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M12 10c-1-6-6-5-5 0 0 2 2 2 3 2-6-1-7 4-2 5 2 0 2-2 2-3-1 6 4 7 5 2 0-2-2-2-3-2 6 1 7-4 2-5-2 0-2 2-2 3Z" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-7 9 7v9H3z" />
        <path d="M9 20v-5h6v5" />
      </>
    ),
    gem: <path d="m4 9 4-5h8l4 5-8 11L4 9Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    bolt: <path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z" />,
    gift: (
      <>
        <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" />
        <path d="M12 7H8.5C5 7 5 3 8.3 3 10.7 3 12 7 12 7Zm0 0h3.5c3.5 0 3.5-4 0.2-4C13.3 3 12 7 12 7Z" />
      </>
    ),
    sparkles: (
      <path d="m12 3 1.4 4.5L18 9l-4.6 1.5L12 15l-1.4-4.5L6 9l4.6-1.5L12 3ZM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L3 18l2.3-.7L5 15Z" />
    ),
  }
  return <svg {...props}>{icons[name] || icons.sparkles}</svg>
}
