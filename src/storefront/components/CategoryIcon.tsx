import {
  IconArmchair,
  IconBasket,
  IconGift,
  IconHandSanitizer,
  IconHeadphones,
  IconLayoutGrid,
  IconLeaf,
  IconPerfume,
  IconShoppingBag,
} from '@tabler/icons-react'

const categoryIcons = {
  leaf: IconLeaf,
  bag: IconShoppingBag,
  care: IconHandSanitizer,
  armchair: IconArmchair,
  perfume: IconPerfume,
  gift: IconGift,
  headphones: IconHeadphones,
  basket: IconBasket,
}

export function CategoryIcon({ name, size = 26 }: { name: string; size?: number }) {
  // Tabler has no knitted hat; use the same 24px grid and stroke treatment.
  if (name === 'beanie') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="4" r="2" />
        <path d="M5 16v-3a7 7 0 0 1 14 0v3" />
        <rect x="4" y="16" width="16" height="5" rx="1" />
        <path d="M8 17v3m4-3v3m4-3v3" />
      </svg>
    )
  }

  const Glyph = categoryIcons[name as keyof typeof categoryIcons] ?? IconLayoutGrid
  return <Glyph size={size} stroke={1.7} aria-hidden="true" />
}
