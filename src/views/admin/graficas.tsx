import { useState } from 'react'
import { ChartColumn, Table2 } from 'lucide-react'
import { techo } from '../../components/graficas'
import { compacto } from '../../lib/admin-datos'

// Gráficos del panel, hechos con la skill dataviz: una sola serie (verde #1b8d5a) y el periodo en curso en dorado
// (#d2a408, bajo 3:1 sobre el beige: por eso lleva su valor escrito encima, tooltip y tabla). Barras de 24 px como
// máximo con la punta redonda, línea base y rejilla finas, y una tabla equivalente para quien prefiere los números.

export interface BarraDato {
  clave: string
  eje: string // texto corto bajo la barra
  nombre: string // texto largo para el tooltip y la tabla
  valor: number
  actual?: boolean // el periodo que todavía no termina
}

export function BarrasPeriodo({ datos, formato, descripcion, leyenda, alto = 112, ejeEn = 1 }: {
  datos: BarraDato[]
  formato: (n: number) => string // valor exacto
  descripcion: string // lo que mide, para lectores de pantalla y encabezado de la tabla
  leyenda: [string, string] // [barras normales, periodo en curso]
  alto?: number
  ejeEn?: number // cada cuántas barras se escribe su nombre en el eje
}) {
  const [tabla, setTabla] = useState(false)
  const [activa, setActiva] = useState<string | null>(null)
  const maximo = techo(Math.max(0, ...datos.map((d) => d.valor)))
  const hayActual = datos.some((d) => d.actual)

  return (
    <figure>
      {tabla ? (
        <div className="max-h-56 overflow-y-auto rounded-2xl bg-papel">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{descripcion}</caption>
            <thead>
              <tr className="text-xs text-apagado">
                <th scope="col" className="px-3 py-2 font-medium">Periodo</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {datos.map((d) => (
                <tr key={d.clave}>
                  <th scope="row" className="px-3 py-1.5 font-normal first-letter:uppercase">{d.nombre}{d.actual && <span className="text-apagado"> (en curso)</span>}</th>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formato(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="group" aria-label={descripcion} onMouseLeave={() => setActiva(null)}>
          <div className="flex gap-2">
            <div className="relative w-9 shrink-0 text-right text-[11px] leading-none text-apagado tabular-nums" style={{ height: alto }} aria-hidden="true">
              <span className="absolute right-0 top-0 -translate-y-1/2">{compacto(maximo)}</span>
              {Number.isInteger(maximo / 2) && <span className="absolute right-0 top-1/2 -translate-y-1/2">{compacto(maximo / 2)}</span>}
              <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
            </div>
            <div className="relative min-w-0 flex-1" style={{ height: alto }}>
              <div className="absolute inset-x-0 top-0 border-t border-linea" />
              <div className="absolute inset-x-0 top-1/2 border-t border-linea" />
              <div className="absolute inset-x-0 bottom-0 border-t border-apagado/40" />
              <div className="absolute inset-0 flex">
                {datos.map((d, i) => {
                  const pct = (d.valor / maximo) * 100
                  const lado = i < 2 ? 'left-0' : i > datos.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  return (
                    <button
                      key={d.clave}
                      type="button"
                      aria-label={`${d.nombre}${d.actual ? ' (en curso)' : ''}: ${formato(d.valor)}`}
                      onMouseEnter={() => setActiva(d.clave)}
                      onFocus={() => setActiva(d.clave)}
                      onBlur={() => setActiva(null)}
                      className="group relative flex min-w-0 flex-1 items-end justify-center outline-none"
                    >
                      <span
                        className={`block w-full max-w-5 rounded-t-[4px] transition-[filter] group-focus-visible:ring-2 group-focus-visible:ring-tinta ${d.actual ? 'bg-oro' : 'bg-serie'} ${activa === d.clave ? 'brightness-110' : ''}`}
                        style={{ height: d.valor > 0 ? `max(3px, ${pct}%)` : 0 }}
                      />
                      {d.actual && d.valor > 0 && activa !== d.clave && (
                        <span aria-hidden="true" className="pointer-events-none absolute z-10 -translate-x-1/2 left-1/2 whitespace-nowrap text-[11px] font-semibold leading-none tabular-nums" style={{ bottom: `calc(${pct}% + 6px)` }}>
                          {compacto(d.valor)}
                        </span>
                      )}
                      {activa === d.clave && (
                        <span aria-hidden="true" className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-(--globo-fondo) px-2.5 py-1.5 text-left text-xs leading-tight text-(--globo-texto) shadow-lg ${lado}`} style={{ bottom: `calc(${pct}% + 8px)` }}>
                          <span className="block text-sm font-semibold tabular-nums">{formato(d.valor)}</span>
                          <span className="block opacity-75 first-letter:uppercase">{d.nombre}{d.actual && ' · en curso'}</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex gap-2" aria-hidden="true">
            <div className="w-9 shrink-0" />
            <div className="flex min-w-0 flex-1">
              {datos.map((d, i) => (
                <div key={d.clave} className={`flex min-w-0 flex-1 justify-center text-[11px] ${d.actual ? 'font-semibold text-tinta' : 'text-apagado'}`}>
                  {(i % ejeEn === 0 || d.actual) && <span className="whitespace-nowrap">{d.eje}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 whitespace-nowrap text-xs text-apagado">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-serie" aria-hidden="true" />{leyenda[0]}</span>
          {hayActual && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-oro" aria-hidden="true" />{leyenda[1]}</span>}
        </span>
        <button
          type="button"
          onClick={() => setTabla(!tabla)}
          title={tabla ? 'Volver al gráfico' : 'Ver los números en una tabla'}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-tinta hover:bg-linea/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta"
        >
          {tabla ? <ChartColumn size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}
          {tabla ? 'Gráfico' : 'Tabla'}
        </button>
      </figcaption>
    </figure>
  )
}

// Reparto de un total entre estados: segmentos separados por 2 px de superficie, sin bordes.
export function BarraSegmentada({ segmentos, descripcion }: { segmentos: { nombre: string; n: number; color: string }[]; descripcion: string }) {
  const total = segmentos.reduce((s, x) => s + x.n, 0)
  return (
    <div role="img" aria-label={descripcion} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-linea/70">
      {total > 0 && segmentos.filter((s) => s.n > 0).map((s) => (
        <div key={s.nombre} className="h-full transition-[flex-grow] duration-500 ease-out first:rounded-l-full last:rounded-r-full" style={{ flexGrow: s.n, flexBasis: 0, backgroundColor: s.color }} />
      ))}
    </div>
  )
}
