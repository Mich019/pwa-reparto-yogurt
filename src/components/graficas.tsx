import { useState } from 'react'

export interface Barra {
  clave: string
  eje: string // texto corto bajo la barra
  nombre: string // texto largo al tocarla
  valor: number
}

// Número redondo sobre el máximo, para que el techo del gráfico no sea 1,237.5.
function techo(max: number) {
  if (max <= 0) return 1
  const e = 10 ** Math.floor(Math.log10(max))
  const m = max / e
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e
}

// Columnas de una sola serie. Tocar (o pasar el cursor sobre) una barra muestra su valor arriba; sin elegir, muestra el total.
export function Columnas({ titulo, barras, color, formato, formatoEje, total }: {
  titulo: string
  barras: Barra[]
  color: string // clase de Tailwind del relleno, p. ej. 'bg-azul'
  formato: (n: number) => string // valor exacto, al tocar una barra
  formatoEje: (n: number) => string // compacto, para los números del eje
  total: string
}) {
  const [elegida, setElegida] = useState<string | null>(null)
  const alto = techo(Math.max(0, ...barras.map((b) => b.valor)))
  const paso = Math.ceil(barras.length / 6)
  const actual = barras.find((b) => b.clave === elegida)

  return (
    <figure className="rounded-2xl bg-niebla p-3 pb-2" onMouseLeave={() => setElegida(null)}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{titulo}</span>
        <span className="min-w-0 truncate text-xs text-apagado tabular-nums" aria-live="polite">
          {actual ? <><span className="font-semibold text-tinta">{formato(actual.valor)}</span> · {actual.nombre}</> : `Total ${total}`}
        </span>
      </figcaption>
      <div className="mt-2 flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-[10px] leading-none text-apagado tabular-nums" aria-hidden>
          <span className="absolute top-0 right-0 -translate-y-1/2">{formatoEje(alto)}</span>
          <span className="absolute top-1/2 right-0 -translate-y-1/2">{formatoEje(alto / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>
        <div className="relative h-32 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 border-t border-linea" />
          <div className="absolute inset-x-0 top-1/2 border-t border-linea" />
          <div className="absolute inset-x-0 bottom-0 border-t border-apagado/40" />
          <div className="absolute inset-0 flex" role="group" aria-label={titulo}>
            {barras.map((b) => (
              <button
                key={b.clave}
                type="button"
                aria-label={`${b.nombre}: ${formato(b.valor)}`}
                onMouseEnter={() => setElegida(b.clave)}
                onFocus={() => setElegida(b.clave)}
                onBlur={() => setElegida(null)}
                onClick={() => setElegida(elegida === b.clave ? null : b.clave)}
                className={`group flex min-w-0 flex-1 items-end justify-center px-px outline-none ${elegida === b.clave ? 'bg-tinta/5' : ''}`}
              >
                <span
                  className={`block w-full max-w-6 rounded-t-[4px] ${color} transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-tinta ${elegida && elegida !== b.clave ? 'opacity-40' : ''}`}
                  style={{ height: b.valor > 0 ? `max(2px, ${(b.valor / alto) * 100}%)` : 0 }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex gap-2" aria-hidden>
        <div className="w-10 shrink-0" />
        <div className="flex min-w-0 flex-1">
          {barras.map((b, i) => (
            <div key={b.clave} className="flex min-w-0 flex-1 justify-center text-[10px] text-apagado">
              {i % paso === 0 && <span className="whitespace-nowrap">{b.eje}</span>}
            </div>
          ))}
        </div>
      </div>
    </figure>
  )
}
