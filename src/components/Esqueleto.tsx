import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'

// Carga con forma: cuando ya se sabe cómo se verá lo que llega (una lista, unas cifras, una gráfica), se dibuja su
// silueta en gris en lugar de un círculo que gira, para que nada salte al llegar los datos. Aparece hasta los 300 ms
// (`.esqueleto` en index.css: antes ocupa su lugar sin verse, así lo rápido no parpadea) y late suave; con «menos
// movimiento» no late. Nunca lleva un círculo encima. Para acciones (guardar, generar, enviar) va `Ocupado` dentro
// del botón deshabilitado, no esto.

// Un hueso: un bloque gris redondeado. `className` le da el tamaño (h-*, w-*).
export function Hueso({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`hueso block bg-linea ${/rounded/.test(className) ? '' : 'rounded-md'} ${className}`} />
}

// El contenedor: anuncia «Cargando» una sola vez al lector de pantalla y aplica la espera de 300 ms. Dentro van los
// huesos y las piezas de abajo (que no traen contenedor propio, para armar con ellas la forma de cada pantalla).
export function Esqueleto({ children, className = '', etiqueta = 'Cargando' }: { children: ReactNode; className?: string; etiqueta?: string }) {
  return <div role="status" aria-label={etiqueta} aria-busy="true" className={`esqueleto ${className}`}>{children}</div>
}

// Un texto que todavía no llega, en línea (el detalle bajo un título, una fecha): del alto de la letra.
export function TextoCargando({ ancho = '12rem' }: { ancho?: string }) {
  return (
    <span role="status" aria-label="Cargando" className="esqueleto inline-block max-w-full align-middle">
      <span aria-hidden="true" className="hueso block h-[0.9em] max-w-full rounded bg-linea" style={{ width: ancho }} />
    </span>
  )
}

// Renglones separados por líneas, como las listas de la app: a la izquierda dos líneas (nombre y detalle), a la
// derecha una cifra. `inicio`: lo que va antes: `avatar` (cuadrito, como Avatar.tsx), `circulo` (la inicial del
// cliente), `punto` (sabor chico) o `sabor` (sabor grande, como en Sabores y datos). `columnas`: las clases de la rejilla de
// la lista de verdad, si va en columnas.
const INICIO = { avatar: 'h-10 w-10 rounded-md', circulo: 'h-12 w-12 rounded-full', punto: 'h-5 w-5 rounded-full', sabor: 'h-11 w-11 rounded-full' }

export function FilasHueso({ filas = 6, inicio, columnas = '', derecha = true }: { filas?: number; inicio?: keyof typeof INICIO; columnas?: string; derecha?: boolean }) {
  const anchos = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5', 'w-2/5', 'w-1/2', 'w-1/3', 'w-2/5'] // como nombres de verdad
  return (
    <div className={columnas}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-linea px-1 py-3.5">
          {inicio && <Hueso className={`shrink-0 ${INICIO[inicio]}`} />}
          <span className="min-w-0 flex-1 space-y-2">
            <Hueso className={`h-4 ${anchos[i % anchos.length]}`} />
            <Hueso className="h-3 w-1/4" />
          </span>
          {derecha && <Hueso className="h-5 w-16 shrink-0" />}
        </div>
      ))}
    </div>
  )
}

// La lista sola, con la línea del total arriba si la pantalla la tiene (`resumen`).
export function EsqueletoLista({ resumen = false, className = '', etiqueta, ...filas }: Parameters<typeof FilasHueso>[0] & { resumen?: boolean; className?: string; etiqueta?: string }) {
  return (
    <Esqueleto className={className} etiqueta={etiqueta}>
      {resumen && <div className="flex items-baseline gap-2 pb-3"><Hueso className="h-4 w-28" /><Hueso className="h-6 w-24" /></div>}
      <FilasHueso {...filas} />
    </Esqueleto>
  )
}

// Cifras en fila (Finanzas, Reportes, Stock del día): etiqueta, número grande y su pie.
export function CifrasHueso({ n = 4, className = '' }: { n?: number; className?: string }) {
  return (
    <div className={`grid gap-x-6 gap-y-5 ${n === 3 ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'} ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="min-w-0 space-y-2">
          <Hueso className="h-3.5 w-24 max-w-full" />
          <Hueso className="h-7 w-28 max-w-full" />
          <Hueso className="h-3 w-20 max-w-full" />
        </span>
      ))}
    </div>
  )
}

// Las tarjetas de sabor (Sabores del panel): el frasco y dos líneas abajo.
export function TarjetasSaborHueso({ n = 12, frasco = 'h-32 sm:h-36' }: { n?: number; frasco?: string }) {
  return (
    <Esqueleto etiqueta="Cargando los sabores">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="flex flex-col items-center rounded-[22px] bg-papel px-3 pb-3.5 pt-4">
            <Hueso className={`w-20 rounded-[18px] ${frasco}`} />
            <span className="mt-3 w-full space-y-1.5"><Hueso className="h-3.5 w-2/3" /><Hueso className="h-3 w-1/2" /></span>
          </li>
        ))}
      </ul>
    </Esqueleto>
  )
}

// Una gráfica de barras: barras de alturas distintas sobre su línea base.
export function BarrasHueso({ barras = 14, className = 'h-56' }: { barras?: number; className?: string }) {
  const altos = [45, 60, 35, 70, 55, 80, 50, 65, 40, 75, 58, 68, 48, 72]
  return (
    <div className={`flex items-end gap-1.5 border-b border-linea ${className}`}>
      {Array.from({ length: barras }, (_, i) => (
        <span key={i} aria-hidden="true" className="hueso flex-1 rounded-t-[4px] bg-linea" style={{ height: `${altos[i % altos.length]}%` }} />
      ))}
    </div>
  )
}

// Lo que va dentro de un botón mientras hace su acción: un circulito que gira y el texto («Guardando…»). El botón
// debe quedar deshabilitado para que no se toque dos veces.
export function Ocupado({ texto }: { texto: ReactNode }) {
  return <span className="inline-flex items-center gap-2"><Girando />{texto}</span>
}

export function Girando({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`girando inline-block h-[1.05em] w-[1.05em] shrink-0 rounded-full border-2 border-current border-r-transparent ${className}`} />
}

// Después de guardar, el botón dice «Guardado ✓» un momento (además del aviso de abajo) y luego vuelve a su texto; si
// falló, «No se pudo» con una cruz roja, un poco más de tiempo. También junto al título de los apartados que guardan
// solos (Preferencias). Sólo donde lo guardado se queda en pantalla; las hojas que se cierran no lo necesitan.
export type EstadoListo = 'ok' | 'error' | null
export function useListo(ms = 1600): [EstadoListo, (ok?: boolean) => void] {
  const [listo, setListo] = useState<EstadoListo>(null)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  const marcar = useCallback((ok = true) => {
    clearTimeout(t.current)
    setListo(ok ? 'ok' : 'error')
    t.current = setTimeout(() => setListo(null), ok ? ms : ms * 1.6)
  }, [ms])
  return [listo, marcar]
}

export function Listo({ estado = 'ok', texto }: { estado?: EstadoListo; texto?: string }) {
  if (estado === 'error') {
    return (
      <span className="listo inline-flex items-center gap-1.5" role="status">
        <span className="grid h-[1.15em] w-[1.15em] place-items-center rounded-full bg-rojo text-white"><X size={12} strokeWidth={3} aria-hidden="true" /></span>
        {texto ?? 'No se pudo'}
      </span>
    )
  }
  return <span className="listo inline-flex items-center gap-1.5" role="status"><Check size={16} strokeWidth={2.6} aria-hidden="true" />{texto ?? 'Guardado'}</span>
}

// Junto al título de un apartado que guarda solo: «Guardado ✓» en verde o «No se pudo guardar» en rojo, en letra chica.
export function MarcaGuardado({ estado }: { estado: EstadoListo }) {
  if (!estado) return null
  return <span className={`text-sm font-semibold ${estado === 'ok' ? 'text-verde' : 'text-rojo'}`}><Listo estado={estado} texto={estado === 'ok' ? 'Guardado' : 'No se pudo guardar'} /></span>
}
