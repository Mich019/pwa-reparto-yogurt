import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Listas largas por páginas (clientes, equipo, etiquetas QR, empresas): con cientos de renglones la lista entera se
// volvía un scroll interminable. `reinicio` es lo que define la lista (búsqueda, filtro): si cambia, vuelve a la primera.
// `ancla` va en el contenedor de la lista: al cambiar de página, si su inicio quedó arriba fuera de la vista, sube ahí.
export function usePaginas<T>(items: T[], porPagina: number, reinicio: unknown = '') {
  const [pagina, setPagina] = useState(0)
  const [clave, setClave] = useState(reinicio)
  if (clave !== reinicio) {
    setClave(reinicio)
    setPagina(0)
  }
  const ancla = useRef<HTMLDivElement & HTMLTableElement & HTMLUListElement>(null)
  const paginas = Math.max(1, Math.ceil(items.length / porPagina))
  const actual = Math.min(pagina, paginas - 1)
  const ir = (n: number) => {
    setPagina(n)
    requestAnimationFrame(() => ancla.current?.scrollIntoView({ block: 'nearest' }))
  }
  return {
    visibles: items.slice(actual * porPagina, (actual + 1) * porPagina),
    ancla,
    control: paginas > 1 && <Paginacion actual={actual} paginas={paginas} total={items.length} porPagina={porPagina} ir={ir} />,
  }
}

const boton = 'grid h-10 min-w-10 place-items-center rounded-md px-2 text-sm font-semibold tabular-nums transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

// Números alrededor de la página actual, con la primera y la última siempre a la mano.
function numeros(actual: number, paginas: number): (number | null)[] {
  const fijos = new Set([0, paginas - 1, actual - 1, actual, actual + 1].filter((n) => n >= 0 && n < paginas))
  const orden = [...fijos].sort((a, b) => a - b)
  return orden.flatMap((n, i) => (i && n - orden[i - 1] > 1 ? [null, n] : [n]))
}

function Paginacion({ actual, paginas, total, porPagina, ir }: { actual: number; paginas: number; total: number; porPagina: number; ir: (n: number) => void }) {
  const desde = actual * porPagina + 1
  const hasta = Math.min(total, desde + porPagina - 1)
  return (
    <nav aria-label="Páginas" className="col-span-full mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-apagado tabular-nums">{desde}–{hasta} de {total}</p>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Página anterior" disabled={actual === 0} onClick={() => ir(actual - 1)} className={`${boton} bg-niebla hover:bg-linea`}>
          <ChevronLeft size={18} />
        </button>
        {/* En el teléfono sólo «3 de 12»; desde 640 px, los números. */}
        <span className="px-2 text-sm font-semibold tabular-nums sm:hidden">{actual + 1} de {paginas}</span>
        {numeros(actual, paginas).map((n, i) => n === null
          ? <span key={`h${i}`} className="hidden w-6 text-center text-apagado sm:inline" aria-hidden="true">…</span>
          : (
            <button key={n} type="button" onClick={() => ir(n)} aria-current={n === actual ? 'page' : undefined} aria-label={`Página ${n + 1}`}
              className={`${boton} hidden sm:grid ${n === actual ? 'bg-tinta text-white' : 'hover:bg-niebla'}`}>
              {n + 1}
            </button>
          ))}
        <button type="button" aria-label="Página siguiente" disabled={actual === paginas - 1} onClick={() => ir(actual + 1)} className={`${boton} bg-niebla hover:bg-linea`}>
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  )
}
