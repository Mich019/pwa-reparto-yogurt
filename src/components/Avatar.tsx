import { useRef, useState, type PointerEvent } from 'react'
import { Ocupado } from './Esqueleto'
import { Camera, ZoomIn, ZoomOut } from 'lucide-react'
import { ErrorApi } from '../lib/api'
import { leerImagen, recortarFoto } from '../lib/imagen'
import { guardarPerfil, useSesion } from '../lib/sesion'
import { Boton, Hoja, aviso } from './ui'

// La foto de perfil de una persona, o la inicial de su nombre si no tiene. El tamaño y el color de la inicial los pone
// quien la usa (`className`).
export function Avatar({ nombre, foto, className = 'h-10 w-10 text-sm bg-tinta text-white' }: { nombre: string; foto?: string | null; className?: string }) {
  if (foto) return <img src={foto} alt="" className={`shrink-0 rounded-md object-cover ${className}`} />
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-md font-semibold ${className}`}>{nombre.trim().charAt(0).toUpperCase() || '?'}</span>
}

// La foto propia con sus botones: elegir una (se encuadra en una hoja y se guarda al aceptar) o quitarla. `compacto`: sólo la foto,
// que se toca para cambiarla (la tarjeta de Mi cuenta en el teléfono).
export function FotoPerfil({ tamano = 'h-20 w-20 text-3xl', compacto = false }: { tamano?: string; compacto?: boolean }) {
  const u = useSesion()?.usuario
  const entrada = useRef<HTMLInputElement>(null)
  const [guardando, setGuardando] = useState(false)
  const [elegida, setElegida] = useState<HTMLImageElement | null>(null)
  if (!u) return null

  async function guardar(foto: string | null) {
    setGuardando(true)
    try {
      await guardarPerfil({ foto })
      aviso(foto ? 'Foto actualizada' : 'Foto quitada')
    } catch (e) {
      aviso(e instanceof ErrorApi || e instanceof Error ? e.message : 'No se pudo guardar la foto')
    } finally {
      setGuardando(false)
    }
  }
  async function elegir(f: File | undefined) {
    if (!f) return
    try {
      setElegida(await leerImagen(f))
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo leer esa imagen')
    }
  }
  function cerrarEncuadre() {
    if (elegida) URL.revokeObjectURL(elegida.src)
    setElegida(null)
  }

  return (
    <div className="flex shrink-0 items-center gap-4">
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        disabled={guardando}
        aria-label={u.foto ? 'Cambiar foto de perfil' : 'Poner foto de perfil'}
        className="group relative shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-60"
      >
        <Avatar nombre={u.nombre} foto={u.foto} className={`${tamano} bg-tinta text-white`} />
        <span className={`absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border-2 border-lienzo bg-papel text-tinta shadow-sm transition-colors group-hover:bg-niebla ${compacto ? 'h-6 w-6' : 'h-8 w-8'}`}>
          <Camera size={compacto ? 12 : 15} aria-hidden="true" />
        </span>
      </button>
      {!compacto && <div className="flex flex-col items-start gap-1 text-sm">
        <button type="button" onClick={() => entrada.current?.click()} disabled={guardando} className="font-semibold text-azul hover:underline disabled:opacity-40">
          {guardando ? <Ocupado texto="Guardando…" /> : u.foto ? 'Cambiar foto' : 'Poner foto'}
        </button>
        {u.foto && !guardando && <button type="button" onClick={() => void guardar(null)} className="font-semibold text-apagado hover:text-rojo">Quitar foto</button>}
        <span className="text-xs text-apagado">JPG, PNG o WEBP. Tú eliges el encuadre.</span>
      </div>}
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = '' }} />
      <Hoja abierta={!!elegida} onCerrar={cerrarEncuadre} titulo="Encuadra tu foto">
        {elegida && <EncuadreFoto key={elegida.src} img={elegida} onCancelar={cerrarEncuadre}
          onAceptar={async (foto) => { cerrarEncuadre(); await guardar(foto) }} />}
      </Hoja>
    </div>
  )
}

const VISOR = 264 // lado del cuadro de encuadre, en px de pantalla (cabe en un teléfono de 320)
const ZOOM_MAX = 4

// Arrastrar mueve la foto, el control (o la rueda) acerca. La foto siempre cubre el cuadro: el desplazamiento se
// limita para que no queden bordes vacíos. Se guarda lo que se ve dentro del cuadro.
function EncuadreFoto({ img, onAceptar, onCancelar }: { img: HTMLImageElement; onAceptar: (foto: string) => void; onCancelar: () => void }) {
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // centro de la foto respecto al centro del cuadro
  const arrastre = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const escala = (VISOR / Math.min(w, h)) * zoom

  const limitar = (p: { x: number; y: number }, e = escala) => {
    const mx = (w * e - VISOR) / 2
    const my = (h * e - VISOR) / 2
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) }
  }
  function cambiarZoom(z: number) {
    const nuevo = Math.max(1, Math.min(ZOOM_MAX, z))
    const e = (VISOR / Math.min(w, h)) * nuevo
    setZoom(nuevo)
    setPos((p) => limitar({ x: (p.x * nuevo) / zoom, y: (p.y * nuevo) / zoom }, e)) // acerca hacia el centro del cuadro
  }
  function bajar(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    arrastre.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  function mover(e: PointerEvent<HTMLDivElement>) {
    const a = arrastre.current
    if (a) setPos(limitar({ x: a.px + e.clientX - a.x, y: a.py + e.clientY - a.y }))
  }
  function aceptar() {
    const lado = VISOR / escala
    onAceptar(recortarFoto(img, { x: w / 2 - (VISOR / 2 + pos.x) / escala, y: h / 2 - (VISOR / 2 + pos.y) / escala, lado }))
  }

  return (
    <div className="flex flex-col items-center gap-5 pb-4">
      <div
        className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-niebla select-none active:cursor-grabbing"
        style={{ width: VISOR, height: VISOR }}
        onPointerDown={bajar}
        onPointerMove={mover}
        onPointerUp={() => { arrastre.current = null }}
        onPointerCancel={() => { arrastre.current = null }}
        onWheel={(e) => cambiarZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
      >
        <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
          style={{ width: w * escala, height: h * escala, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }} />
        {/* Fuera del círculo se oscurece: así se ve cómo quedará en el avatar redondo. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md shadow-[0_0_0_200px_rgb(0_0_0/0.45)] ring-2 ring-white/80" />
      </div>
      <label className="flex w-full max-w-[264px] items-center gap-3 text-apagado">
        <ZoomOut size={18} aria-hidden="true" />
        <input type="range" min={1} max={ZOOM_MAX} step={0.01} value={zoom} onChange={(e) => cambiarZoom(Number(e.target.value))}
          aria-label="Acercar" className="flex-1 accent-[var(--color-marca,currentColor)]" />
        <ZoomIn size={18} aria-hidden="true" />
      </label>
      <p className="-mt-2 text-center text-xs text-apagado">Arrastra la foto para moverla.</p>
      <div className="grid w-full grid-cols-2 gap-3">
        <Boton variante="secundario" onClick={onCancelar}>Cancelar</Boton>
        <Boton onClick={aceptar}>Guardar foto</Boton>
      </div>
    </div>
  )
}
