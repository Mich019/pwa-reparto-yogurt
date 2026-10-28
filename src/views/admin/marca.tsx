import { useId } from 'react'
import { esDanelle, useMarca } from '../../lib/marca'
import logo from '../../assets/danelle-logo.png'
import ave from '../../assets/danelle-ave.png'

// Logo y ave de Danelle. Los SVG originales eran un mapa de bits dentro de un SVG de 380 KB; aquí van recortados y
// reducidos a los tres colores de la marca (verde #035d38, amarillo #f9dc07, negro) con la transparencia como suavizado.
export function LogoDanelle({ className = 'h-12' }: { className?: string }) {
  return <img src={logo} alt="Danelle, yogurt 100% natural" className={`logo-danelle w-auto select-none ${className}`} draggable={false} />
}

export function AveDanelle({ className = 'h-10' }: { className?: string }) {
  return <img src={ave} alt="" aria-hidden="true" className={`w-auto select-none ${className}`} draggable={false} />
}

// Marca por empresa (src/lib/marca.ts): su logo; sin logo, su nombre con la inicial en su color; sin marca propia, Danelle.
export function LogoEmpresa({ className = 'h-12' }: { className?: string }) {
  const m = useMarca()
  if (!m || esDanelle(m)) return <LogoDanelle className={className} />
  if (m.logo) return <img src={m.logo} alt={m.nombre} className={`w-auto max-w-[16rem] select-none object-contain ${className}`} draggable={false} />
  return (
    <span className={`inline-flex max-w-[16rem] items-center gap-2.5 ${className}`}>
      <span aria-hidden="true" className="grid aspect-square h-full max-h-14 place-items-center rounded-2xl bg-marca text-xl font-bold text-white">{m.nombre.trim().charAt(0).toUpperCase()}</span>
      <span className="max-w-[11rem] truncate font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-tinta">{m.nombre}</span>
    </span>
  )
}

// El adorno de las pantallas vacías: el ave de Danelle, o el logo de la empresa apagado.
export function AveEmpresa({ className = 'h-10' }: { className?: string }) {
  const m = useMarca()
  if (!m || esDanelle(m)) return <AveDanelle className={className} />
  if (m.logo) return <img src={m.logo} alt="" aria-hidden="true" className={`w-auto select-none object-contain opacity-60 grayscale ${className}`} draggable={false} />
  return null
}

const HEX = /^#[0-9a-f]{6}$/i

// Un envase de Danelle del color del sabor: tapa verde con la franja amarilla del logo y etiqueta crema con el logo.
// Hace de «foto del producto» en las tarjetas del panel; los sabores no traen imagen, sólo su color.
export function Frasco({ color, className = 'h-28', apagado = false }: { color?: string; className?: string; apagado?: boolean }) {
  const id = useId().replace(/:/g, '')
  const m = useMarca()
  const danelle = !m || esDanelle(m)
  const etiqueta = danelle ? logo : m.logo
  const c = color && HEX.test(color) ? color : '#d4d4d4'
  const cuerpo = 'M23 34 H97 L93 116 Q92.4 125 83 125 H37 Q27.6 125 27 116 Z'
  return (
    <svg
      viewBox="0 0 120 140"
      aria-hidden="true"
      className={`w-auto shrink-0 ${className}`}
      style={{ '--c': c, ...(apagado ? { filter: 'grayscale(1)', opacity: 0.5 } : {}) } as React.CSSProperties}
    >
      <defs>
        <clipPath id={`cuerpo-${id}`}><path d={cuerpo} /></clipPath>
        <clipPath id={`tapa-${id}`}><rect x="19" y="14" width="82" height="22" rx="7" /></clipPath>
      </defs>
      <ellipse cx="60" cy="131" rx="33" ry="4.5" fill="#002014" opacity="0.1" />
      <path d={cuerpo} style={{ fill: 'var(--c)' }} />
      <g clipPath={`url(#cuerpo-${id})`}>
        <rect x="0" y="60" width="120" height="46" fill="#fbf8ee" />
        <path d="M88 40 L86 120" stroke="#002014" strokeOpacity="0.1" strokeWidth="9" />
        <path d="M33.5 42 Q35 80 34.5 114" stroke="#fff" strokeOpacity="0.38" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      </g>
      <path d={cuerpo} fill="none" strokeWidth="1.5" style={{ stroke: 'color-mix(in oklab, var(--c) 62%, #002014)' }} />
      {etiqueta && <image href={etiqueta} x="33" y="64.5" width="54" height="37" preserveAspectRatio="xMidYMid meet" />}
      <rect x="19" y="14" width="82" height="22" rx="7" style={{ fill: danelle ? '#035d38' : 'var(--color-marca)' }} />
      <g clipPath={`url(#tapa-${id})`}>
        <rect x="19" y="16.5" width="82" height="3" fill="#fff" opacity="0.2" />
        {danelle && <rect x="19" y="30.5" width="82" height="3.5" fill="#f9dc07" />}
      </g>
    </svg>
  )
}
