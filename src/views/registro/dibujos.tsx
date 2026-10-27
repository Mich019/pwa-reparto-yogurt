import { useId, type ReactNode } from 'react'

// Dibujos de los envases más comunes, del mismo estilo que el frasco de Danelle (views/admin/marca.tsx): el cuerpo
// toma el color del producto, con una etiqueta crema, brillo y sombra. Sirven de «foto» del producto mientras las
// empresas no suban las suyas. Todos usan el mismo lienzo (120 × 140) y apoyan en la misma sombra.

export type TipoEnvase =
  | 'botella' | 'garrafon' | 'frasco' | 'vaso' | 'bolsa_nylon' | 'bolsa' | 'costal' | 'caja'
  | 'charola' | 'cubeta' | 'lata' | 'carton' | 'pieza' | 'granel' | 'huevo'

const HEX = /^#[0-9a-f]{6}$/i
const CREMA = '#fbf8ee'
const TINTA = '#002014'

// Contorno y partes oscuras: el mismo color, más oscuro.
const borde = 'color-mix(in oklab, var(--c) 62%, #002014)'
const oscuro = 'color-mix(in oklab, var(--c) 55%, #002014)'
const claro = 'color-mix(in oklab, var(--c) 45%, #ffffff)'

export function DibujoEnvase({ tipo, color, className = 'h-28', etiqueta, apagado = false }: {
  tipo: string
  color?: string
  className?: string
  etiqueta?: string // una o dos letras sobre la etiqueta (la inicial del producto)
  apagado?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const c = color && HEX.test(color) ? color : '#d4d4d4'
  const dibujo = DIBUJOS[tipo as TipoEnvase] ?? DIBUJOS.pieza
  return (
    <svg
      viewBox="0 0 120 140"
      aria-hidden="true"
      className={`w-auto shrink-0 ${className}`}
      style={{ '--c': c, ...(apagado ? { filter: 'grayscale(1)', opacity: 0.5 } : {}) } as React.CSSProperties}
    >
      <ellipse cx="60" cy="131" rx="36" ry="4.5" fill={TINTA} opacity="0.1" />
      {dibujo(id, etiqueta)}
    </svg>
  )
}

// Texto corto centrado sobre una etiqueta.
function Letra({ x, y, texto, tam = 15, color = TINTA }: { x: number; y: number; texto?: string; tam?: number; color?: string }) {
  if (!texto) return null
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={tam} fontWeight="700" fill={color} style={{ fontFamily: 'var(--font-display)' }}>
      {texto.slice(0, 2)}
    </text>
  )
}

// Un cuerpo con etiqueta, brillo y contorno: lo común a botellas, frascos, vasos, cubetas…
function Cuerpo({ id, d, etiqueta, children }: { id: string; d: string; etiqueta?: { y: number; alto: number }; children?: ReactNode }) {
  return (
    <>
      <defs><clipPath id={`c-${id}`}><path d={d} /></clipPath></defs>
      <path d={d} style={{ fill: 'var(--c)' }} />
      <g clipPath={`url(#c-${id})`}>
        {etiqueta && <rect x="0" y={etiqueta.y} width="120" height={etiqueta.alto} fill={CREMA} />}
        <rect x="86" y="0" width="12" height="140" fill={TINTA} opacity="0.08" />
        {children}
      </g>
      <path d={d} fill="none" strokeWidth="1.5" style={{ stroke: borde }} />
    </>
  )
}

const brillo = (x: number, y1: number, y2: number) => (
  <path d={`M${x} ${y1} Q${x + 1.5} ${(y1 + y2) / 2} ${x + 1} ${y2}`} stroke="#fff" strokeOpacity="0.4" strokeWidth="4.5" strokeLinecap="round" fill="none" />
)

const DIBUJOS: Record<TipoEnvase, (id: string, letra?: string) => ReactNode> = {
  botella: (id, l) => {
    const d = 'M52 34 C52 42 38 46 38 56 V118 Q38 126 46 126 H74 Q82 126 82 118 V56 C82 46 68 42 68 34 Z'
    return (
      <>
        <rect x="53" y="22" width="14" height="14" fill={claro} style={{ stroke: borde }} strokeWidth="1.5" />
        <Cuerpo id={id} d={d} etiqueta={{ y: 72, alto: 32 }}>{brillo(43, 58, 116)}</Cuerpo>
        <rect x="50" y="11" width="20" height="13" rx="3" style={{ fill: oscuro }} />
        <rect x="50" y="20" width="20" height="2.5" fill="#fff" opacity="0.25" />
        <Letra x={60} y={88} texto={l} />
      </>
    )
  },
  garrafon: (id, l) => {
    const d = 'M28 44 Q28 32 42 30 H78 Q92 32 92 44 V116 Q92 127 80 127 H40 Q28 127 28 116 Z'
    return (
      <>
        <rect x="49" y="18" width="22" height="14" fill={claro} style={{ stroke: borde }} strokeWidth="1.5" />
        <defs><clipPath id={`c-${id}`}><path d={d} /></clipPath></defs>
        <path d={d} style={{ fill: claro }} opacity="0.95" />
        <g clipPath={`url(#c-${id})`}>
          <rect x="0" y="40" width="120" height="100" style={{ fill: 'var(--c)' }} opacity="0.55" />
          <rect x="0" y="70" width="120" height="24" fill={CREMA} />
          <path d="M28 58 H92 M28 106 H92" style={{ stroke: borde }} strokeOpacity="0.5" strokeWidth="2" />
          {brillo(35, 46, 118)}
        </g>
        <path d={d} fill="none" strokeWidth="1.5" style={{ stroke: borde }} />
        <rect x="45" y="9" width="30" height="11" rx="3" style={{ fill: oscuro }} />
        <Letra x={60} y={82} texto={l} />
      </>
    )
  },
  frasco: (id, l) => {
    const d = 'M23 34 H97 L93 116 Q92.4 125 83 125 H37 Q27.6 125 27 116 Z'
    return (
      <>
        <Cuerpo id={id} d={d} etiqueta={{ y: 60, alto: 46 }}>{brillo(33.5, 42, 114)}</Cuerpo>
        <rect x="19" y="14" width="82" height="22" rx="7" style={{ fill: oscuro }} />
        <rect x="19" y="17" width="82" height="3" fill="#fff" opacity="0.2" />
        <Letra x={60} y={83} texto={l} tam={20} />
      </>
    )
  },
  vaso: (id, l) => {
    const d = 'M30 42 H90 L82 123 Q81.5 127 77 127 H43 Q38.5 127 38 123 Z'
    return (
      <>
        <Cuerpo id={id} d={d} etiqueta={{ y: 66, alto: 34 }}>{brillo(37, 48, 118)}</Cuerpo>
        <path d="M26 42 Q26 30 60 28 Q94 30 94 42 Z" style={{ fill: claro, stroke: borde }} strokeWidth="1.5" />
        <rect x="24" y="40" width="72" height="6" rx="3" style={{ fill: oscuro }} />
        <Letra x={60} y={83} texto={l} tam={17} />
      </>
    )
  },
  bolsa_nylon: (id, l) => {
    const d = 'M60 32 C40 36 24 62 26 94 C28 118 42 128 60 128 C78 128 92 118 94 94 C96 62 80 36 60 32 Z'
    return (
      <>
        <path d="M60 32 L44 10 Q52 14 58 24 Z M60 32 L76 10 Q68 14 62 24 Z" style={{ fill: claro, stroke: borde }} strokeWidth="1.2" />
        <defs><clipPath id={`c-${id}`}><path d={d} /></clipPath></defs>
        <path d={d} style={{ fill: 'var(--c)' }} opacity="0.8" />
        <g clipPath={`url(#c-${id})`}>
          <path d="M34 60 Q36 90 44 118" stroke="#fff" strokeOpacity="0.5" strokeWidth="6" strokeLinecap="round" fill="none" />
          <path d="M78 52 Q84 70 84 84" stroke="#fff" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
        <path d={d} fill="none" strokeWidth="1.5" style={{ stroke: borde }} />
        <ellipse cx="60" cy="30" rx="6" ry="4" style={{ fill: oscuro }} />
        <circle cx="62" cy="88" r="15" fill={CREMA} style={{ stroke: borde }} strokeWidth="1.2" />
        <Letra x={62} y={88} texto={l} tam={13} />
      </>
    )
  },
  bolsa: (id, l) => {
    const d = 'M30 32 H90 L94 120 Q94 127 87 127 H33 Q26 127 26 120 Z'
    return (
      <>
        <Cuerpo id={id} d={d}>
          <rect x="36" y="54" width="48" height="52" rx="6" fill={CREMA} />
          <rect x="46" y="88" width="28" height="12" rx="6" style={{ fill: claro }} />
          {brillo(33, 40, 118)}
        </Cuerpo>
        <path d="M30 20 H90 V34 H30 Z" style={{ fill: oscuro }} />
        <path d="M30 20 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4" fill="none" style={{ stroke: oscuro }} strokeWidth="2" />
        <circle cx="60" cy="27" r="2.5" fill={CREMA} />
        <Letra x={60} y={73} texto={l} tam={17} />
      </>
    )
  },
  costal: (id, l) => {
    const d = 'M28 46 C24 80 25 108 31 121 Q33 127 40 127 H80 Q87 127 89 121 C95 108 96 80 92 46 Q76 38 60 40 Q44 38 28 46 Z'
    return (
      <>
        <path d="M42 44 Q48 20 60 24 Q72 20 78 44 Z" fill="#d8c08c" stroke="#9c8352" strokeWidth="1.5" />
        <defs>
          <clipPath id={`c-${id}`}><path d={d} /></clipPath>
          <pattern id={`t-${id}`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 3 H6 M3 0 V6" stroke="#9c8352" strokeOpacity="0.28" strokeWidth="1" />
          </pattern>
        </defs>
        <path d={d} fill="#e6d3a3" />
        <g clipPath={`url(#c-${id})`}>
          <rect x="0" y="0" width="120" height="140" fill={`url(#t-${id})`} />
          <rect x="0" y="64" width="120" height="7" style={{ fill: 'var(--c)' }} />
          <rect x="0" y="102" width="120" height="7" style={{ fill: 'var(--c)' }} />
          <rect x="40" y="74" width="40" height="25" rx="4" fill={CREMA} />
        </g>
        <path d={d} fill="none" stroke="#9c8352" strokeWidth="1.5" />
        <path d="M44 40 Q60 46 76 40" fill="none" style={{ stroke: oscuro }} strokeWidth="4" strokeLinecap="round" />
        <Letra x={60} y={86.5} texto={l} tam={14} />
      </>
    )
  },
  caja: (_id, l) => (
    <>
      <path d="M20 58 L76 72 V126 L20 112 Z" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M76 72 L102 58 V112 L76 126 Z" style={{ fill: oscuro, stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 58 L46 44 L102 58 L76 72 Z" style={{ fill: claro, stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M33 51 L89 65" stroke={CREMA} strokeWidth="6" opacity="0.85" />
      <path d="M30 76 L66 85 V108 L30 99 Z" fill={CREMA} />
      <Letra x={48} y={92} texto={l} tam={14} />
    </>
  ),
  charola: (_id, l) => (
    <>
      <circle cx="40" cy="84" r="15" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" />
      <circle cx="80" cy="84" r="15" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" />
      <circle cx="60" cy="78" r="17" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" />
      <path d="M50 70 Q54 66 58 68" stroke="#fff" strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M12 92 H108 L96 120 Q94 124 89 124 H31 Q26 124 24 120 Z" fill="#f2efe4" stroke="#b9b39f" strokeWidth="1.5" />
      <rect x="8" y="88" width="104" height="8" rx="4" fill="#e4dfcf" stroke="#b9b39f" strokeWidth="1.5" />
      <path d="M14 70 Q60 48 106 70" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" fill="none" />
      <rect x="44" y="100" width="32" height="16" rx="3" fill={CREMA} stroke="#b9b39f" />
      <Letra x={60} y={108} texto={l} tam={11} />
    </>
  ),
  cubeta: (id, l) => {
    const d = 'M28 52 H92 L86 122 Q85.5 127 80 127 H40 Q34.5 127 34 122 Z'
    return (
      <>
        <path d="M30 52 Q60 4 90 52" fill="none" stroke="#7d8a82" strokeWidth="3" />
        <Cuerpo id={id} d={d} etiqueta={{ y: 70, alto: 36 }}>{brillo(36, 58, 120)}</Cuerpo>
        <rect x="24" y="46" width="72" height="10" rx="4" style={{ fill: oscuro }} />
        <circle cx="30" cy="51" r="3" fill="#7d8a82" />
        <circle cx="90" cy="51" r="3" fill="#7d8a82" />
        <Letra x={60} y={88} texto={l} tam={17} />
      </>
    )
  },
  lata: (id, l) => {
    const d = 'M36 30 H84 V120 Q84 127 77 127 H43 Q36 127 36 120 Z'
    return (
      <>
        <Cuerpo id={id} d={d}>
          <rect x="0" y="58" width="120" height="34" fill={CREMA} />
          <rect x="0" y="62" width="120" height="3" style={{ fill: 'var(--c)' }} opacity="0.6" />
          {brillo(42, 36, 118)}
        </Cuerpo>
        <ellipse cx="60" cy="30" rx="24" ry="6" fill="#d9ddd9" stroke="#8d9690" strokeWidth="1.5" />
        <ellipse cx="60" cy="29" rx="18" ry="3.8" fill="#eef0ee" />
        <rect x="56" y="25" width="10" height="5" rx="2.5" fill="#8d9690" />
        <rect x="36" y="118" width="48" height="4" fill={TINTA} opacity="0.12" />
        <Letra x={60} y={77} texto={l} tam={17} />
      </>
    )
  },
  carton: (_id, l) => (
    <>
      <path d="M32 50 H72 V126 H32 Z" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M72 50 L90 42 V118 L72 126 Z" style={{ fill: oscuro, stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M32 50 L44 30 H74 L72 50 Z" style={{ fill: claro, stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M72 50 L74 30 L90 42 Z" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="44" y="22" width="30" height="9" style={{ fill: claro, stroke: borde }} strokeWidth="1.5" />
      <rect x="36" y="68" width="32" height="40" rx="3" fill={CREMA} />
      <Letra x={52} y={88} texto={l} tam={16} />
    </>
  ),
  pieza: (_id, l) => (
    <>
      <ellipse cx="60" cy="96" rx="44" ry="27" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" />
      <ellipse cx="60" cy="88" rx="36" ry="17" style={{ fill: claro }} opacity="0.55" />
      <path d="M34 86 Q60 70 86 86 M40 96 Q60 84 80 96" style={{ stroke: borde }} strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M92 60 L104 48" stroke="#7d8a82" strokeWidth="1.5" />
      <path d="M96 30 L112 30 L112 50 L104 58 L96 50 Z" fill={CREMA} stroke="#7d8a82" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="104" cy="36" r="2" fill="#7d8a82" />
      <Letra x={104} y={45} texto={l} tam={9} />
    </>
  ),
  granel: (_id, l) => (
    <>
      <path d="M26 82 Q60 30 94 82 Z" style={{ fill: 'var(--c)', stroke: borde }} strokeWidth="1.5" />
      <path d="M44 66 Q50 58 56 56" stroke="#fff" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M14 82 H106 Q102 100 60 100 Q18 100 14 82 Z" fill="#cdd4cf" stroke="#7d8a82" strokeWidth="1.5" />
      <rect x="50" y="100" width="20" height="10" fill="#7d8a82" />
      <rect x="26" y="108" width="68" height="20" rx="5" fill="#3d4a42" />
      <rect x="36" y="112" width="48" height="12" rx="2" fill="#c9f2b0" />
      <text x="60" y="118.5" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill={TINTA} style={{ fontFamily: 'ui-monospace, monospace' }}>
        {l ? l.slice(0, 2) : '1.000'}
      </text>
    </>
  ),
  huevo: (_id, l) => (
    <>
      {[30, 50, 70, 90].map((x) => (
        <ellipse key={x} cx={x} cy="74" rx="9" ry="12" fill={CREMA} stroke="#b9b39f" strokeWidth="1.2" />
      ))}
      {[30, 50, 70, 90].map((x) => (
        <ellipse key={`b${x}`} cx={x} cy="74" rx="9" ry="12" style={{ fill: 'var(--c)' }} opacity="0.35" />
      ))}
      <path d="M16 80 H104 L98 118 Q97 124 91 124 H29 Q23 124 22 118 Z" style={{ fill: claro, stroke: borde }} strokeWidth="1.5" />
      <path d="M16 80 Q30 92 40 80 Q50 92 60 80 Q70 92 80 80 Q90 92 104 80" fill="none" style={{ stroke: borde }} strokeWidth="1.5" />
      <rect x="44" y="98" width="32" height="16" rx="3" fill={CREMA} />
      <Letra x={60} y={106} texto={l} tam={11} />
    </>
  ),
}
