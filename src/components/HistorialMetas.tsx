import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

// «Historial de metas»: los últimos 12 meses cerrados de un vendedor con su meta, lo vendido y el %, desplegable.
// Viene en `historial` de GET /usuarios/:id/metas (ficha en Vendedores) y de GET /mi-meta/trofeos (Cuenta del vendedor).
export interface MesDeMeta { mes: string; ventas: number; meta: number | null; cumplimientoPct: number | null }

const mesCorto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`

// Lo vendido mes a mes (el más viejo a la izquierda): verde los meses que llegó a su meta, y la meta de cada mes como una
// raya encima. Sin librerías; colores del tema.
function Tendencia({ historial }: { historial: MesDeMeta[] }) {
  const meses = [...historial].reverse()
  const tope = Math.max(1, ...meses.map((h) => Math.max(h.ventas, h.meta ?? 0)))
  const ancho = 22
  const alto = 56
  const y = (v: number) => alto - (v / tope) * (alto - 4)
  return (
    <figure className="desplegar px-4 pb-3">
      <svg viewBox={`0 0 ${meses.length * ancho} ${alto}`} className="h-16 w-full" preserveAspectRatio="none" role="img"
        aria-label={`Lo vendido en los últimos ${meses.length} meses cerrados`}>
        {meses.map((h, i) => {
          const llego = !!h.meta && (h.cumplimientoPct ?? 0) >= 100
          return (
            <g key={h.mes}>
              <title>{`${mesCorto(h.mes)}: ${pesos(h.ventas)}${h.meta ? ` de ${pesos(h.meta)}` : ''}`}</title>
              <rect x={i * ancho + 4} y={y(h.ventas)} width={ancho - 8} height={Math.max(1, alto - y(h.ventas))} rx={3}
                className={llego ? 'fill-verde' : 'fill-marca'} opacity={llego ? 1 : 0.55} />
              {h.meta ? <rect x={i * ancho + 2} y={y(h.meta) - 1} width={ancho - 4} height={2} rx={1} className="fill-tinta" opacity={0.5} /> : null}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] capitalize text-apagado">
        <span>{mesCorto(meses[0].mes)}</span><span>{mesCorto(meses[meses.length - 1].mes)}</span>
      </figcaption>
    </figure>
  )
}

export function HistorialMetas({ historial, titulo = 'Historial de metas', className = '' }: { historial: MesDeMeta[]; titulo?: string; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  if (!historial.length) return null
  return (
    <div className={`border-y border-linea ${className}`}>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 py-4 text-left text-sm font-semibold">
        {titulo}
        <ChevronRight size={16} aria-hidden="true" className={`text-apagado transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
      </button>
      {abierto && historial.length >= 2 && <Tendencia historial={historial} />}
      {abierto && (
        <ul className="desplegar space-y-2.5 pb-4 text-sm">
          {historial.map((h) => {
            const pct = h.meta ? Math.round(h.cumplimientoPct ?? 0) : null
            return (
              <li key={h.mes}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="capitalize">{mesCorto(h.mes)}</span>
                  <span className="tabular-nums text-apagado">
                    {pesos(h.ventas)}{pct !== null ? <> de {pesos(h.meta!)} · <span className={pct >= 100 ? 'font-semibold text-verde' : ''}>{pct}%</span></> : ' · sin meta'}
                  </span>
                </div>
                {pct !== null && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-linea" role="progressbar" aria-label={`${mesCorto(h.mes)}: ${pct}% de la meta`} aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`h-full rounded-full ${pct >= 100 ? 'bg-verde' : 'bg-marca'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
