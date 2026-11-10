import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Volume2, VolumeX } from 'lucide-react'
import type { PasoGuia } from '../lib/guiaInicio'

// El recorrido de la primera vez (lib/guiaInicio.ts): oscurece la pantalla, deja a la vista el botón real de la sección
// (el visible que lleva data-seccion) con un anillo amarillo que late, y a su lado una tarjeta con una flecha, el
// título y una frase. Sólo pide cambiar de paso: quien abre la sección es la pantalla principal. Es un diálogo modal:
// el foco no sale de la tarjeta, Escape la cierra y al cambiar de paso el foco pasa al título. Se avanza con
// «Siguiente», tocando el botón resaltado o deslizando. Con «menos movimiento» no hay animaciones.

interface Caja { x: number; y: number; w: number; h: number }
const HOLGURA = 6, ORILLA = 4, SEPARA = 16

function botonDe(seccion: string | null): HTMLElement | null {
  if (!seccion) return null
  // Puede haber dos (menú de arriba y barra del teléfono): vale el que se ve.
  return [...document.querySelectorAll<HTMLElement>(`[data-seccion="${seccion}"]`)].find((e) => e.getClientRects().length > 0 && e.offsetWidth > 0) ?? null
}

export function GuiaInicio({ pasos, paso, onPaso, onTerminar }: { pasos: PasoGuia[]; paso: number; onPaso: (n: number) => void; onTerminar: () => void }) {
  const p = pasos[Math.min(paso, pasos.length - 1)]
  const ultimo = paso >= pasos.length - 1
  const [caja, setCaja] = useState<Caja | null>(null)
  const [vista, setVista] = useState({ w: innerWidth, h: innerHeight })
  const [hablando, setHablando] = useState(false)
  const tarjeta = useRef<HTMLDivElement>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const idTitulo = useId(), idTexto = useId()
  const conVoz = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'

  const medir = useCallback(() => {
    setVista({ w: innerWidth, h: innerHeight })
    const r = botonDe(p.seccion)?.getBoundingClientRect()
    if (!r) return setCaja(null)
    // Unos píxeles de holgura, sin salirse de la pantalla: en una orilla se recorta hacia adentro.
    const x = Math.max(ORILLA, r.left - HOLGURA), y = Math.max(ORILLA, r.top - HOLGURA)
    setCaja({ x, y, w: Math.min(innerWidth - ORILLA, r.right + HOLGURA) - x, h: Math.min(innerHeight - ORILLA, r.bottom + HOLGURA) - y })
  }, [p.seccion])

  // Se mide al cambiar de paso (la sección tarda un instante en abrir y el botón elegido cambia de ancho) y al cambiar
  // el tamaño o la orientación de la pantalla.
  useLayoutEffect(() => {
    medir()
    const r = requestAnimationFrame(medir), t = setTimeout(medir, 350)
    addEventListener('resize', medir)
    addEventListener('orientationchange', medir)
    return () => { cancelAnimationFrame(r); clearTimeout(t); removeEventListener('resize', medir); removeEventListener('orientationchange', medir) }
  }, [medir, paso])

  const callar = useCallback(() => { if (conVoz) speechSynthesis.cancel(); setHablando(false) }, [conVoz])
  useEffect(() => { callar(); titulo.current?.focus() }, [paso, callar])
  useEffect(() => callar, [callar])

  const ir = (n: number) => (n >= pasos.length ? onTerminar() : n >= 0 && onPaso(n))

  function alTeclear(e: React.KeyboardEvent) {
    e.stopPropagation() // los atajos del panel no corren con la guía abierta
    if (e.key === 'Escape') return onTerminar()
    if (e.key !== 'Tab' || !tarjeta.current) return
    const foco = [...tarjeta.current.querySelectorAll<HTMLElement>('button')]
    const primero = foco[0], final = foco[foco.length - 1]
    const en = document.activeElement
    if (e.shiftKey && (en === primero || en === titulo.current)) { e.preventDefault(); final.focus() }
    else if (!e.shiftKey && en === final) { e.preventDefault(); primero.focus() }
  }

  // Deslizar: a la izquierda avanza, a la derecha regresa.
  const toque = useRef<{ x: number; y: number } | null>(null)
  const alTocar = (e: React.TouchEvent) => { toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const alSoltar = (e: React.TouchEvent) => {
    const t = toque.current
    toque.current = null
    if (!t) return
    const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) ir(paso + (dx < 0 ? 1 : -1))
  }

  function escuchar() {
    if (hablando) return callar()
    const u = new SpeechSynthesisUtterance(`${p.titulo}. ${p.texto}`)
    u.lang = 'es-MX'
    u.onend = u.onerror = () => setHablando(false)
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
    setHablando(true)
  }

  // La tarjeta: arriba del botón si la navegación está abajo, debajo si está arriba; siempre dentro de la pantalla.
  const ancho = Math.min(380, vista.w - 24)
  const centro = caja ? caja.x + caja.w / 2 : vista.w / 2
  const izq = Math.max(12, Math.min(vista.w - ancho - 12, centro - ancho / 2))
  const abajo = !!caja && caja.y + caja.h / 2 > vista.h / 2
  const lugar: React.CSSProperties = !caja
    ? { left: izq, top: '50%', transform: 'translateY(-50%)' }
    : abajo ? { left: izq, bottom: vista.h - caja.y + SEPARA } : { left: izq, top: caja.y + caja.h + SEPARA }
  const flecha = Math.max(22, Math.min(ancho - 22, centro - izq))
  const primeroConBoton = pasos.findIndex((x) => x.seccion) === paso
  const Icono = p.icono
  const boton = 'flex h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:transition-none'

  return (
    <div className="fixed inset-0 z-[70]" onTouchStart={alTocar} onTouchEnd={alSoltar}>
      {/* Tapa los toques a todo lo demás. Sin botón que resaltar (la bienvenida), también oscurece. */}
      <div aria-hidden="true" className={`absolute inset-0 ${caja ? '' : 'bg-black/60'}`} />
      {caja && (
        <>
          {/* El anillo: su sombra enorme oscurece todo menos el hueco del botón. Se desliza de un botón al siguiente. */}
          <div aria-hidden="true" className="pointer-events-none absolute rounded-2xl border-[3px] border-limon shadow-[0_0_0_100vmax_rgba(0,0,0,0.62)] transition-all duration-300 ease-out motion-reduce:transition-none"
            style={{ left: caja.x, top: caja.y, width: caja.w, height: caja.h }}>
            <span className="absolute -inset-1 rounded-2xl border-2 border-limon motion-safe:animate-ping motion-reduce:hidden" />
          </div>
          {/* El hueco se puede tocar: avanza igual que «Siguiente». Para el lector de pantalla, se avanza con los botones. */}
          <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => ir(paso + 1)} className="absolute cursor-pointer rounded-2xl"
            style={{ left: caja.x, top: caja.y, width: caja.w, height: caja.h }} />
        </>
      )}

      <div ref={tarjeta} role="dialog" aria-modal="true" aria-labelledby={idTitulo} aria-describedby={idTexto} onKeyDown={alTeclear}
        className="absolute rounded-[26px] bg-papel p-5 text-tinta shadow-[0_24px_70px_rgba(0,0,0,0.38)] transition-[left,top,bottom] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: ancho, ...lugar }}>
        {caja && <span aria-hidden="true" className={`absolute h-4 w-4 -translate-x-1/2 rotate-45 bg-papel ${abajo ? '-bottom-2' : '-top-2'}`} style={{ left: flecha }} />}

        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-apagado tabular-nums">Paso {paso + 1} de {pasos.length}</p>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-linea" role="progressbar" aria-valuemin={1} aria-valuemax={pasos.length} aria-valuenow={paso + 1} aria-label="Avance de la guía">
            <div className="h-full rounded-full bg-limon transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${((paso + 1) / pasos.length) * 100}%` }} />
          </div>
          {!ultimo && <button type="button" onClick={onTerminar} className="-my-2 -mr-2 h-11 rounded-full px-3 text-xs font-semibold text-apagado hover:text-tinta focus-visible:outline-2 focus-visible:outline-marca">Saltar</button>}
        </div>

        {/* La llave vuelve a montar el contenido en cada paso: así entra con su animación. */}
        <div key={paso} className="motion-safe:animate-[paso-entrar_.3s_ease-out]">
          <div className="mt-4 flex items-center gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-marca text-white shadow-[0_8px_20px_rgba(0,32,20,0.22)] motion-safe:animate-[medalla-nueva_.5s_ease-out]"><Icono size={28} aria-hidden="true" /></span>
            <h2 ref={titulo} id={idTitulo} tabIndex={-1} className="min-w-0 flex-1 text-2xl font-semibold leading-tight outline-none">{p.titulo}</h2>
            {conVoz && (
              <button type="button" onClick={escuchar} aria-pressed={hablando} aria-label={hablando ? 'Dejar de escuchar' : 'Escuchar este paso'} title={hablando ? 'Dejar de escuchar' : 'Escuchar este paso'}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-niebla hover:bg-linea focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
                {hablando ? <VolumeX size={19} aria-hidden="true" /> : <Volume2 size={19} aria-hidden="true" />}
              </button>
            )}
          </div>
          <p id={idTexto} className="mt-3 text-base leading-relaxed">{p.texto}</p>
          {primeroConBoton && caja && <p className="mt-2 text-sm text-apagado">Toca el botón resaltado o «Siguiente».</p>}
        </div>

        <div className="mt-5 flex gap-2">
          {paso > 0 && <button type="button" onClick={() => ir(paso - 1)} className={`${boton} bg-niebla hover:bg-linea`}><ArrowLeft size={18} aria-hidden="true" /> Anterior</button>}
          <button type="button" onClick={() => ir(paso + 1)} className={`${boton} flex-1 bg-tinta text-white hover:bg-marca-oscuro`}>
            {ultimo ? <><Check size={18} aria-hidden="true" /> Listo</> : paso === 0 ? <>Empezar <ArrowRight size={18} aria-hidden="true" /></> : <>Siguiente <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
