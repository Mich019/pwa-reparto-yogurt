import type { ReactNode } from 'react'

// Íconos de fruta para cada sabor. Se eligen solos según el nombre del sabor ("Fresa", "Mango con chile"…);
// si el nombre no coincide con ninguna fruta se usa un vasito de yogurt.
const HOJA = '#58B05F'
const TALLO = '#7A5A3A'

interface Fruta {
  id: string
  claves: string[] // palabras (sin acentos y en minúsculas) que activan este ícono
  dibujo: () => ReactNode
}

const grano = (cx: number, cy: number, r: number, fill: string, brillo = '#fff') => (
  <g key={`${cx}-${cy}`}>
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.28} fill={brillo} opacity=".55" />
  </g>
)

export const FRUTAS: Fruta[] = [
  {
    id: 'fresa',
    claves: ['fresa'],
    dibujo: () => (
      <>
        <path d="M16 28.5C8.5 24 5 17.5 6.3 12.8 7.5 8.8 11.8 8 16 9.8c4.2-1.8 8.5-1 9.7 3 1.3 4.7-2.2 11.2-9.7 15.7z" fill="#E8394D" />
        <g fill="#FFD9A8">
          {[[11.5, 14.5], [16, 13.8], [20.5, 14.5], [13.5, 19], [18.5, 19], [16, 23.5]].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx=".75" ry="1.15" />
          ))}
        </g>
        <path d="M16 10.5c-2.7.2-5.2-1-6.4-3 2.4-.6 4.6 0 6.4 1.4 1.8-1.4 4-2 6.4-1.4-1.2 2-3.7 3.2-6.4 3z" fill="#4DAA57" />
        <path d="M16 9V5.6" stroke="#3E8E49" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'durazno',
    claves: ['durazno', 'melocoton'],
    dibujo: () => (
      <>
        <path d="M16 28.2c-7 0-10.3-5.4-9.4-11.2.8-5.4 5-8.2 9.4-6.6 4.4-1.6 8.6 1.2 9.4 6.6.9 5.8-2.4 11.2-9.4 11.2z" fill="#FFA36C" />
        <path d="M16 10.4c-2.2 4-2.3 9.8.6 15.2" fill="none" stroke="#EE7A4C" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M9.8 15c.5-2 1.9-3.3 3.6-3.8" fill="none" stroke="#FFD2B4" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16 10.4c-.4-3 1.8-5.2 5.5-5.2.2 3-2.2 5.3-5.5 5.2z" fill={HOJA} />
        <path d="M16 10.4V7.6" stroke={TALLO} strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'mango',
    claves: ['mango'],
    dibujo: () => (
      <>
        <linearGradient id="degradado-mango" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FAD24A" />
          <stop offset=".55" stopColor="#F7A92B" />
          <stop offset="1" stopColor="#EC6B3A" />
        </linearGradient>
        <g transform="rotate(38 16 16)">
          <path d="M16 4.6c3.6 0 9.6 4.4 9.8 12 .2 6.8-4.2 11.2-9.8 11.2S6 23.4 6.2 16.6C6.4 9 12.4 4.6 16 4.6z" fill="url(#degradado-mango)" />
          <path d="M10.2 12.4c.8-2.6 2.6-4.4 5-5" fill="none" stroke="#FFF0A8" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16.2 5c.2-2.4 2-3.8 4.6-3.4.2 2.4-1.6 4-4.6 3.4z" fill="#4DAA57" />
        </g>
      </>
    ),
  },
  {
    id: 'nuez',
    claves: ['nuez', 'nueces'],
    dibujo: () => (
      <>
        <path d="M16 6.5C10.2 4.9 5.2 9.1 5.4 15.5c.2 6.4 5.2 10.8 10.6 10.8s10.4-4.4 10.6-10.8C26.8 9.1 21.8 4.9 16 6.5z" fill="#C8955A" />
        <path d="M16 6.5c-1.6 4.5 1.8 8.5.2 12.5-.7 1.8-.6 4.5-.2 7.3" fill="none" stroke="#8C5E2E" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9.5 12c1.5 1 2 2.5 1.5 4.5M22.5 12c-1.5 1-2 2.5-1.5 4.5M10.5 20.5c1.8-.2 3 .6 3.6 2M21.5 20.5c-1.8-.2-3 .6-3.6 2" fill="none" stroke="#A8773F" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M9 11c1.2-2.2 3.2-3.4 5.4-3.6" fill="none" stroke="#E6C092" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'zarzamora',
    claves: ['zarzamora', 'mora'],
    dibujo: () => (
      <>
        {[[13.2, 12.2], [18.8, 12.2], [10.4, 16.9], [16, 16.9], [21.6, 16.9], [10.4, 21.6], [16, 21.6], [21.6, 21.6], [13.2, 26.2], [18.8, 26.2]].map(([x, y]) =>
          grano(x, y, 3.2, '#3E2160', '#B58CE8'),
        )}
        <path d="M16 12.4c-3.2-.2-5.4-1.8-6-4.4 2.8-.4 5 .6 6 2.6 1-2 3.2-3 6-2.6-.6 2.6-2.8 4.2-6 4.4z" fill="#4DAA57" />
        <path d="M16 11V8.4" stroke="#3E8E49" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'platano',
    claves: ['platano', 'banana'],
    dibujo: () => (
      <>
        <path d="M6.4 8.6c-1.4 9.4 5.4 18.2 18.8 17.4 1.4-.1 1.8-1.8.5-2.4C17 19.6 13.6 15 13.6 9.8c0-1.6-6.9-2.2-7.2-1.2z" fill="#F6D04D" />
        <path d="M13.6 9.8c0 5.2 3.4 9.8 12.1 13.8" fill="none" stroke="#E2B52E" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M6.4 8.6c.3-1 7.2-.4 7.2 1.2-2.2-.8-4.8-.8-7.2-1.2z" fill={TALLO} />
        <path d="M24.8 24.1c.8.1 1.6-.3 1.8-1l-1.8-.3z" fill={TALLO} />
      </>
    ),
  },
  {
    id: 'manzana',
    claves: ['manzana'],
    dibujo: () => (
      <>
        <path d="M16 10.6c-2-1.8-5.2-2.2-7.6-.2-3 2.5-2.9 8.2-.4 12.4 1.8 3 4.2 5 6 5 1 0 1.2-.5 2-.5s1 .5 2 .5c1.8 0 4.2-2 6-5 2.5-4.2 2.6-9.9-.4-12.4-2.4-2-5.6-1.6-7.6.2z" fill="#E5484D" />
        <path d="M9.6 13.4c.6-1.6 1.8-2.6 3.4-2.8" fill="none" stroke="#F7A3A5" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16 10.6c0-2 .6-3.8 2-5" fill="none" stroke={TALLO} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17.6 7.6c.8-2.2 3-3 5-2.4-.4 2.4-2.6 3.6-5 2.4z" fill={HOJA} />
      </>
    ),
  },
  {
    id: 'pina',
    claves: ['pina', 'ananá', 'anana'],
    dibujo: () => (
      <>
        <clipPath id="recorte-pina"><ellipse cx="16" cy="19.6" rx="7.4" ry="9" /></clipPath>
        <ellipse cx="16" cy="19.6" rx="7.4" ry="9" fill="#F2B232" />
        <g clipPath="url(#recorte-pina)" stroke="#D68E18" strokeWidth="1" opacity=".85">
          <path d="M8 13l16 16M8 19l11 11M12 10l14 14M24 13L8 29M24 19L13 30M20 10L6 24" fill="none" />
        </g>
        <path d="M16 10.8c-2.2-1.4-3.4-4-3-6.6 1.6.6 2.6 1.8 3 3.2.4-1.4 1.4-2.6 3-3.2.4 2.6-.8 5.2-3 6.6z" fill="#4DAA57" />
        <path d="M16 10.8c-3.4-.4-6-2.2-7-4.8 2.6-.4 5.2.8 7 4.8zM16 10.8c3.4-.4 6-2.2 7-4.8-2.6-.4-5.2.8-7 4.8z" fill="#3E8E49" />
      </>
    ),
  },
  {
    id: 'limon',
    claves: ['limon', 'lima'],
    dibujo: () => (
      <>
        <path d="M3.8 16.6c.4-1 1.2-1.4 2-1.2C8 9.6 11.6 7.8 16 7.8s8 1.8 10.2 7.6c.8-.2 1.6.2 2 1.2.3.8-.4 1.6-1.2 1.8-.2.1-.5.2-.8.2-2 5.4-5.6 7.4-10.2 7.4s-8.2-2-10.2-7.4c-.3 0-.6-.1-.8-.2-.8-.2-1.5-1-1.2-1.8z" fill="#F4DE4A" />
        <path d="M8.6 13.4c1.4-2.2 3.6-3.4 6.2-3.6" fill="none" stroke="#FFF6A8" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 7.8c0-2.4 1.8-4 4.4-4 .2 2.4-1.6 4.2-4.4 4z" fill={HOJA} />
      </>
    ),
  },
  {
    id: 'naranja',
    claves: ['naranja', 'mandarina'],
    dibujo: () => (
      <>
        <circle cx="16" cy="18" r="10" fill="#F79A2B" />
        <path d="M9.6 14.2c1.2-2.4 3.4-3.8 6-4" fill="none" stroke="#FFD08A" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="16" cy="9" r="1.2" fill="#C86F14" />
        <path d="M16 8.6c.4-2.6 2.6-4.2 5.6-3.8-.2 2.6-2.6 4.2-5.6 3.8z" fill={HOJA} />
      </>
    ),
  },
  {
    id: 'uva',
    claves: ['uva'],
    dibujo: () => (
      <>
        {[[10.4, 14.6], [16, 14.6], [21.6, 14.6], [13.2, 20.2], [18.8, 20.2], [16, 25.8]].map(([x, y]) => grano(x, y, 3.2, '#7B4DB5', '#D3B8F5'))}
        <path d="M16 11.4V7.6" stroke={TALLO} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16.4 8c1-2.8 4-3.8 6.6-2.8-.8 2.8-3.6 4-6.6 2.8z" fill={HOJA} />
      </>
    ),
  },
  {
    id: 'cereza',
    claves: ['cereza', 'cherry'],
    dibujo: () => (
      <>
        <path d="M10.6 21c0-6 2.4-11.2 7.4-13.8M21.6 22c-.4-6.4-1.6-11.2-3.6-14.8" fill="none" stroke="#5E8B3A" strokeWidth="1.6" strokeLinecap="round" />
        {grano(10.6, 23, 5.4, '#D6283F')}
        {grano(21.6, 24, 5.4, '#E23A4E')}
        <path d="M18 7.4c2.4-1.8 5.8-1.6 7.8.6-2.4 2-5.8 1.8-7.8-.6z" fill={HOJA} />
      </>
    ),
  },
  {
    id: 'arandano',
    claves: ['arandano', 'blueberry'],
    dibujo: () => (
      <>
        <circle cx="16" cy="17.4" r="10.2" fill="#4C6EDB" />
        <path d="M16 11.6l1.2 2.3 2.6.5-1.9 1.8.4 2.6-2.3-1.2-2.3 1.2.4-2.6-1.9-1.8 2.6-.5z" fill="#2F4DB0" />
        <path d="M9.6 13.6c1-2.2 2.8-3.6 5-4" fill="none" stroke="#9DB2F5" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'coco',
    claves: ['coco'],
    dibujo: () => (
      <>
        <circle cx="16" cy="16.4" r="11.4" fill="#7A5230" />
        <circle cx="16" cy="16.4" r="8.6" fill="#FFFDF7" />
        <circle cx="16" cy="16.4" r="4.4" fill="#EDE6D6" />
        <path d="M9.4 9.6c1.4-1.4 3.2-2.2 5-2.4" fill="none" stroke="#A67A52" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'kiwi',
    claves: ['kiwi'],
    dibujo: () => (
      <>
        <circle cx="16" cy="16" r="11.6" fill="#8A6A3C" />
        <circle cx="16" cy="16" r="9.8" fill="#8DC63F" />
        <ellipse cx="16" cy="16" rx="3.2" ry="3.6" fill="#F4F8D8" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2
          return <ellipse key={i} cx={16 + Math.cos(a) * 6} cy={16 + Math.sin(a) * 6} rx=".7" ry="1.2" fill="#2E3B12" transform={`rotate(${(a * 180) / Math.PI + 90} ${16 + Math.cos(a) * 6} ${16 + Math.sin(a) * 6})`} />
        })}
      </>
    ),
  },
  {
    id: 'pera',
    claves: ['pera'],
    dibujo: () => (
      <>
        <path d="M16 7.8c-2.2 0-3.4 1.6-3.8 3.4-.4 2-1.8 3.2-3.2 4.8-2 2.4-2.6 6-.8 8.8 1.8 2.8 4.8 3.8 7.8 3.8s6-1 7.8-3.8c1.8-2.8 1.2-6.4-.8-8.8-1.4-1.6-2.8-3-3.2-4.8-.4-1.8-1.6-3.4-3.8-3.4z" fill="#BFD655" />
        <path d="M10.4 18.6c.4-1.6 1.4-2.8 2.6-3.6" fill="none" stroke="#E4F0A0" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16 7.8c0-1.4.4-2.6 1.4-3.6" fill="none" stroke={TALLO} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17.6 6.6c.8-1.8 2.8-2.4 4.6-1.8-.4 2-2.6 3-4.6 1.8z" fill={HOJA} />
      </>
    ),
  },
]

// Vasito de yogurt: sabor "Natural" y respaldo para cualquier sabor sin fruta conocida.
const VASITO: Fruta = {
  id: 'natural',
  claves: ['natural'],
  dibujo: () => (
    <>
      <path d="M7.6 12h16.8l-1.8 14.2a2 2 0 0 1-2 1.8h-9.2a2 2 0 0 1-2-1.8z" fill="#FFFFFF" stroke="#D5CFC1" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8.5 18h15l-.6 5.6H9.2z" fill="#9CC5F0" />
      <rect x="6" y="9" width="20" height="3.6" rx="1.8" fill="#E9E4D8" />
      <path d="M20.6 9l4.6-5.4" stroke="#C9C2B2" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
}

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Gana la fruta que aparece primero en el nombre ("Fresa con plátano" → fresa).
export function frutaDe(sabor: string): Fruta {
  const nombre = sinAcentos(sabor)
  let mejor: Fruta | null = null
  let pos = Infinity
  for (const f of [...FRUTAS, VASITO]) {
    for (const k of f.claves) {
      const i = nombre.indexOf(k)
      if (i !== -1 && i < pos) {
        pos = i
        mejor = f
      }
    }
  }
  return mejor ?? VASITO
}

export function IconoSabor({ sabor, size = 24, className }: { sabor: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      {frutaDe(sabor).dibujo()}
    </svg>
  )
}

// El ícono sobre un círculo gris con un toque del color que el vendedor eligió para el sabor.
export function Insignia({ sabor, color, size = 44 }: { sabor: string; color?: string; size?: number }) {
  const tinte = color && /^#[0-9a-f]{6}$/i.test(color) ? `linear-gradient(${color}38, ${color}38)` : undefined
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-niebla" style={{ width: size, height: size, backgroundImage: tinte }}>
      <IconoSabor sabor={sabor} size={Math.round(size * 0.62)} />
    </span>
  )
}
