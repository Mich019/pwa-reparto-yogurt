import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { Boton, Hoja } from './ui'

// Para dibujar una firma con el dedo o el mouse (Preferencias → Firma de los informes). Entrega un PNG transparente
// recortado a lo dibujado, en tinta oscura: así se ve igual sobre la hoja blanca del PDF.
export function PadFirma({ abierta, onCerrar, onUsar }: { abierta: boolean; onCerrar: () => void; onUsar: (dataUrl: string) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null)
  const ultimo = useRef<{ x: number; y: number } | null>(null)
  const [vacio, setVacio] = useState(true)

  // Al abrir, un lienzo limpio del ancho que tenga la hoja (al doble de resolución para que el trazo no se vea en escalones).
  useEffect(() => {
    if (!abierta) return
    const id = requestAnimationFrame(() => {
      const c = lienzo.current
      if (!c) return
      c.width = c.clientWidth * 2
      c.height = c.clientHeight * 2
      setVacio(true)
    })
    return () => cancelAnimationFrame(id)
  }, [abierta])

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height }
  }
  function trazar(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx || !ultimo.current) return
    const p = punto(e)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(ultimo.current.x, ultimo.current.y)
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
    ultimo.current = p
    setVacio(false)
  }
  function borrar() {
    const c = lienzo.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setVacio(true)
  }
  // Recorta los márgenes vacíos y la entrega como PNG.
  function usar() {
    const c = lienzo.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] < 10) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 < 0) return
    const m = 8
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m)
    const recorte = document.createElement('canvas')
    recorte.width = x1 - x0 + 1
    recorte.height = y1 - y0 + 1
    recorte.getContext('2d')!.drawImage(c, x0, y0, recorte.width, recorte.height, 0, 0, recorte.width, recorte.height)
    onUsar(recorte.toDataURL('image/png'))
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Dibuja la firma"
      pie={<div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={borrar} disabled={vacio}><Eraser size={18} aria-hidden="true" /> Borrar</Boton>
        <Boton className="flex-1" onClick={usar} disabled={vacio}>Usar esta firma</Boton>
      </div>}>
      <p className="text-sm text-apagado">Con el dedo o el mouse, como la harías en papel. Se imprime sobre la línea de firma de los informes.</p>
      {/* Blanco a propósito: es la hoja del PDF, y la tinta oscura no se vería en el modo oscuro. */}
      <canvas ref={lienzo} aria-label="Espacio para dibujar la firma" className="mt-3 h-48 w-full touch-none rounded-md border border-linea bg-[#fff] cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); ultimo.current = punto(e); trazar(e) }}
        onPointerMove={(e) => { if (ultimo.current) trazar(e) }}
        onPointerUp={() => { ultimo.current = null }}
        onPointerCancel={() => { ultimo.current = null }} />
    </Hoja>
  )
}
