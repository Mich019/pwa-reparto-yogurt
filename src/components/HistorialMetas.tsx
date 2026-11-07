import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

// «Historial de metas»: los últimos 12 meses cerrados de un vendedor con su meta, lo vendido y el %, desplegable.
// Viene en `historial` de GET /usuarios/:id/metas (ficha en Vendedores) y de GET /mi-meta/trofeos (Cuenta del vendedor).
export interface MesDeMeta { mes: string; ventas: number; meta: number | null; cumplimientoPct: number | null }

const mesCorto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`

export function HistorialMetas({ historial, titulo = 'Historial de metas', className = '' }: { historial: MesDeMeta[]; titulo?: string; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  if (!historial.length) return null
  return (
    <div className={`rounded-lg bg-niebla ${className}`}>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm font-semibold">
        {titulo}
        <ChevronRight size={16} aria-hidden="true" className={`text-apagado transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
      </button>
      {abierto && (
        <ul className="desplegar space-y-2.5 px-4 pb-4 text-sm">
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
