import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Download, Minus, Plus, Printer, Share2, X } from 'lucide-react'
import { compartirPdf, descargarArchivo, puedeCompartirPdf, type PdfListo } from '../lib/pdf'
import { aviso } from './ui'

// Vista previa de un PDF generado por la app (reportes, libreta de clientes, etiquetas QR), sin salir de la página ni
// descargarlo antes. Muestra las páginas como SVG (pdf.ts las dibuja igual que el PDF), así se ve también en Android e
// iPhone, donde el navegador no muestra PDFs dentro de la página. Desde aquí se descarga, se imprime o se comparte.
//
// Se abre desde cualquier pantalla con `mostrarPdf(pdf, nombre)`; <VisorPdf /> va montado una vez en App.tsx.

interface Abierto { pdf: PdfListo; nombre: string }
let abierto: Abierto | null = null
const oyentes = new Set<() => void>()
const fijar = (a: Abierto | null) => { abierto = a; oyentes.forEach((f) => f()) }

export const mostrarPdf = (pdf: PdfListo, nombre: string) => fijar({ pdf, nombre })

const ZOOM = { min: 0.5, max: 3, paso: 0.25 }

// Imprime las mismas páginas en un marco oculto, cada una del tamaño real del documento (carta o la etiqueta del imán).
function imprimir(pdf: PdfListo) {
  const { ancho, alto } = pdf.paginas[0]
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  marco.srcdoc =
    `<!doctype html><html><head><meta charset="utf-8"><title>${pdf.titulo.replace(/</g, '')}</title><style>` +
    `@page{size:${ancho}mm ${alto}mm;margin:0}html,body{margin:0;padding:0}` +
    `svg{display:block;width:${ancho}mm;height:${alto}mm;break-after:page}svg:last-child{break-after:auto}` +
    `</style></head><body>${pdf.paginas.map((p) => p.svg).join('')}</body></html>`
  marco.onload = () => {
    const ventana = marco.contentWindow
    if (!ventana) return
    ventana.onafterprint = () => setTimeout(() => marco.remove(), 0)
    ventana.focus()
    ventana.print()
    setTimeout(() => marco.remove(), 60_000) // por si el navegador no avisa al terminar
  }
  document.body.appendChild(marco)
}

export function VisorPdf() {
  const actual = useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => abierto)
  if (!actual) return null
  return <Visor key={actual.nombre + actual.pdf.paginas.length} {...actual} onCerrar={() => fijar(null)} />
}

function Visor({ pdf, nombre, onCerrar }: Abierto & { onCerrar: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [compartiendo, setCompartiendo] = useState(false)
  const cerrar = useRef<HTMLButtonElement>(null)
  const compartible = useMemo(puedeCompartirPdf, [])
  // Una dirección temporal por página para mostrarla como imagen (sin meter el SVG en la página). Se crean y se sueltan
  // en el mismo efecto: React puede montar dos veces y una dirección soltada ya no carga.
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const nuevas = pdf.paginas.map((p) => URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' })))
    setUrls(nuevas)
    return () => nuevas.forEach((u) => URL.revokeObjectURL(u))
  }, [pdf])

  useEffect(() => {
    cerrar.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', tecla)
    const desplazar = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = desplazar }
  }, [onCerrar])

  const { ancho, alto } = pdf.paginas[0]
  // Ancho en pantalla: a escala 1, unos 4 px por mm (una hoja carta ≈ 860 px); lo pequeño, como la etiqueta de un
  // imán, se agranda hasta 360 px para leerse. Nunca más ancho que la pantalla, salvo que se acerque con el zoom.
  const base = Math.max(ancho * 4, 360)
  const n = pdf.paginas.length

  async function compartir() {
    setCompartiendo(true)
    try { await compartirPdf(pdf.bytes, nombre) } finally { setCompartiendo(false) }
  }

  const boton = 'flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-40'
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="visor-pdf-titulo">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-linea bg-papel px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="visor-pdf-titulo" className="truncate text-base font-semibold">Vista previa · {pdf.titulo}</h2>
          <p className="text-xs text-apagado">{n} {n === 1 ? 'página' : 'páginas'} · {Math.round(ancho)} × {Math.round(alto)} mm</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-niebla p-1" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(ZOOM.min, z - ZOOM.paso))} disabled={zoom <= ZOOM.min} aria-label="Alejar" className="grid h-8 w-8 place-items-center rounded-full hover:bg-papel disabled:opacity-40"><Minus size={16} /></button>
          <button type="button" onClick={() => setZoom(1)} className="min-w-12 rounded-full px-1 text-xs font-semibold tabular-nums hover:bg-papel" title="Tamaño normal">{Math.round(zoom * 100)} %</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(ZOOM.max, z + ZOOM.paso))} disabled={zoom >= ZOOM.max} aria-label="Acercar" className="grid h-8 w-8 place-items-center rounded-full hover:bg-papel disabled:opacity-40"><Plus size={16} /></button>
        </div>
        <button ref={cerrar} type="button" onClick={onCerrar} aria-label="Cerrar vista previa" className="grid h-10 w-10 place-items-center rounded-full bg-niebla transition-colors hover:bg-linea"><X size={18} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-niebla/95 px-3 py-5 sm:px-6" aria-label="Páginas del documento">
        {/* Hasta 100 % las páginas caben en la pantalla; al acercar miden lo que pida el zoom y se desplazan. */}
        <div className={`mx-auto flex flex-col items-center gap-5 ${zoom > 1 ? 'w-max' : 'w-full'}`}>
          {urls.map((u, i) => (
            <figure key={u} className={`m-0 flex flex-col items-center ${zoom > 1 ? '' : 'w-full'}`}>
              <img
                src={u}
                alt={`Página ${i + 1} de ${n}`}
                draggable={false}
                style={{ width: zoom > 1 ? `${base * zoom}px` : `min(${base * zoom}px, 100%)`, aspectRatio: `${ancho} / ${alto}` }}
                // Blanco fijo: es papel, también en el modo oscuro del panel (que cambia `bg-white` por el color de tarjeta).
                className="block max-w-none bg-[#fff] shadow-[0_6px_24px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
              />
              {n > 1 && <figcaption className="mt-1.5 text-center text-xs text-apagado">Página {i + 1} de {n}</figcaption>}
            </figure>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-linea bg-papel px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        <span className="mr-auto hidden truncate text-xs text-apagado sm:block">{nombre}</span>
        {compartible && (
          <button type="button" onClick={() => void compartir()} disabled={compartiendo} className={`${boton} bg-niebla hover:bg-linea`}><Share2 size={17} /> Compartir</button>
        )}
        <button type="button" onClick={() => imprimir(pdf)} className={`${boton} bg-niebla hover:bg-linea`}><Printer size={17} /> Imprimir</button>
        <button
          type="button"
          onClick={() => { descargarArchivo(pdf.bytes, nombre); aviso(`Se descargó ${nombre}`) }}
          className={`${boton} bg-tinta text-white hover:bg-neutral-700`}
        >
          <Download size={17} /> Descargar PDF
        </button>
      </div>
    </div>
  )
}
