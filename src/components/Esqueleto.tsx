import type { ReactNode } from 'react'

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
// derecha una cifra. `inicio`: un círculo (avatar, como el de Avatar.tsx) o un punto (sabor) antes. `columnas`: las clases de la rejilla de
// la lista de verdad, si va en columnas.
export function FilasHueso({ filas = 6, inicio, columnas = '', derecha = true }: { filas?: number; inicio?: 'avatar' | 'punto'; columnas?: string; derecha?: boolean }) {
  const anchos = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5', 'w-2/5', 'w-1/2', 'w-1/3', 'w-2/5'] // como nombres de verdad
  return (
    <div className={columnas}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-linea px-1 py-3.5">
          {inicio === 'avatar' && <Hueso className="h-10 w-10 shrink-0 rounded-md" />}
          {inicio === 'punto' && <Hueso className="h-5 w-5 shrink-0 rounded-full" />}
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
