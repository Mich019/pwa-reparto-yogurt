import { useEffect, useId, useRef, useState } from 'react'
import { Pencil, Trophy, X } from 'lucide-react'
import { aviso } from '../../components/ui'
import { litrosTxt, ultimosMeses, type VentaSabor } from '../../lib/admin-datos'
import { db, guardar, type Producto } from '../../lib/db'
import { dinero } from '../../lib/fechas'
import { cambio } from '../../lib/reportes'
import { FormSabor } from '../pwa/Ajustes'
import { BarrasPeriodo } from './graficas'
import { Frasco } from './marca'
import { presentacionDe, unidadDe } from '../../lib/unidades'
import { Delta } from './piezas'

interface Foto { producto: Producto; venta: VentaSabor; posicion: number }

// La ficha de un sabor y su formulario de edición, para las pantallas que muestran los sabores como tarjetas.
// `abrir(id)` muestra la ficha; `editar()` sin sabor abre el formulario de uno nuevo.
export function useFichaSabor(ordenados: Foto[]) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<{ producto?: Producto; tieneVentas: boolean } | null>(null)
  const actual = ordenados.find((x) => x.producto.id === abierto) ?? null

  // Un sabor con ventas no se puede borrar: se averigua antes de abrir el formulario.
  async function editar(producto?: Producto) {
    const tieneVentas = producto ? (await db.pedidos.filter((p) => p.items.some((i) => i.productoId === producto.id)).count()) > 0 : false
    setEdicion({ producto, tieneVentas })
  }

  const panel = (
    <>
      <PanelSabor foto={actual} onCerrar={() => setAbierto(null)} onEditar={(p) => { setAbierto(null); void editar(p) }} />
      {edicion && <FormSabor producto={edicion.producto} tieneVentas={edicion.tieneVentas} onCerrar={() => setEdicion(null)} />}
    </>
  )
  return { abrir: setAbierto, editar, panel }
}

// Ficha de un sabor: hoja de vidrio esmerilado que se desliza sobre el panel (abajo, en el teléfono). El resto de la
// pantalla sigue a la vista y tocarlo la cierra. Con `foto` nula se cierra.
function PanelSabor({ foto, onCerrar, onEditar }: { foto: Foto | null; onCerrar: () => void; onEditar: (p: Producto) => void }) {
  const [montado, setMontado] = useState(false)
  const [visible, setVisible] = useState(false)
  const ultima = useRef<Foto | null>(null)
  const panel = useRef<HTMLElement>(null)
  const cerrar = useRef<HTMLButtonElement>(null)
  const previo = useRef<HTMLElement | null>(null)
  const titulo = useId()
  const alCerrar = useRef(onCerrar)
  alCerrar.current = onCerrar
  if (foto) ultima.current = foto
  const abierto = foto !== null

  useEffect(() => {
    if (abierto) {
      previo.current = document.activeElement as HTMLElement | null
      setMontado(true)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => { setVisible(true); cerrar.current?.focus() }))
      return () => cancelAnimationFrame(r)
    }
    setVisible(false)
    previo.current?.focus?.()
    const t = setTimeout(() => setMontado(false), 300)
    return () => clearTimeout(t)
  }, [abierto])

  // Escape cierra; Tab no se sale de la hoja mientras está abierta.
  useEffect(() => {
    if (!abierto) return
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') return alCerrar.current()
      if (e.key !== 'Tab' || !panel.current) return
      const foco = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'))
      if (!foco.length) return
      const primero = foco[0], ultimo = foco[foco.length - 1]
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [abierto])

  const f = ultima.current
  if (!montado || !f) return null
  const { producto: p, venta, posicion } = f
  const margen = p.precio_litro > 0 ? Math.round(((p.precio_litro - p.costo_litro) / p.precio_litro) * 100) : null
  const meses = ultimosMeses(12).map((m, i) => ({ clave: m.clave, eje: m.inicial, nombre: m.nombre, valor: venta.meses[i], actual: i === 11 }))
  const primero = posicion === 1 && venta.litros > 0
  const dif = cambio(venta.litros, venta.litrosAntes)

  async function alternarDisponible() {
    await guardar('productos', { ...p, disponible: !p.disponible })
    aviso(p.disponible ? `${p.sabor} quedó sin stock` : `${p.sabor} vuelve a estar a la venta`)
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0" onClick={onCerrar} aria-hidden="true" />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        className={`absolute inset-x-2 bottom-2 flex max-h-[90dvh] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-papel shadow-[0_24px_80px_rgba(0,32,20,0.22)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] supports-[backdrop-filter]:bg-[rgba(253,253,248,0.8)] supports-[backdrop-filter]:backdrop-blur-2xl supports-[backdrop-filter]:backdrop-saturate-150 sm:inset-x-auto sm:bottom-3 sm:left-3 sm:top-3 sm:max-h-none sm:w-[26rem] ${visible ? 'translate-y-0 sm:translate-x-0' : 'translate-y-[110%] sm:translate-y-0 sm:-translate-x-[110%]'}`}
      >
        <button
          ref={cerrar}
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-papel/80 text-tinta transition-colors hover:bg-papel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
        >
          <X size={18} />
        </button>

        <div className="flex-1 overflow-y-auto px-6 pb-4 pt-8">
          <div className="grid place-items-center pb-2 pt-1">
            <Frasco color={p.color_hex} apagado={!p.disponible} className="h-48" />
          </div>

          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${primero ? 'bg-limon text-tinta' : p.disponible ? 'bg-(--chip-ok-fondo) text-(--chip-ok-texto)' : 'bg-niebla text-apagado'}`}>
            {primero && <Trophy size={13} aria-hidden="true" />}
            {primero ? 'El que más se vendió' : p.disponible ? 'A la venta' : 'Sin stock'}
          </span>
          <h2 id={titulo} className="mt-3 text-[1.75rem] font-semibold leading-tight">{p.sabor}</h2>
          <p className="mt-1 text-sm text-apagado tabular-nums">
            {dinero(p.precio_litro)}/{unidadDe(p)} · costo {dinero(p.costo_litro)}/{unidadDe(p)}{presentacionDe(p) && ` · ${presentacionDe(p)}`}
          </p>
          {p.descripcion && <p className="mt-2 text-sm leading-relaxed text-tinta/80">{p.descripcion}</p>}

          <dl className="mt-5 grid grid-cols-4 divide-x divide-linea rounded-2xl bg-papel/85 py-3 text-center">
            <Dato valor={venta.litros ? litrosTxt(venta.litros) : '0 L'} etiqueta="Litros, 30 días" />
            <Dato valor={dinero(venta.ingreso)} etiqueta="Ingresos, 30 días" />
            <Dato valor={margen === null ? '—' : `${margen}%`} etiqueta="Margen por litro" />
            <Dato valor={dif === null ? '—' : <Delta valor={dif} className="text-base" />} etiqueta="Contra los 30 días antes" />
          </dl>

          <h3 className="mt-6 mb-3 text-sm font-semibold">Litros vendidos, últimos 12 meses</h3>
          <BarrasPeriodo
            datos={meses}
            formato={litrosTxt}
            descripcion={`Litros de ${p.sabor} vendidos cada mes, últimos 12 meses`}
            leyenda={['Meses cerrados', 'Mes en curso']}
            alto={96}
          />
        </div>

        <div className="flex gap-2.5 px-6 pb-6 pt-3">
          <button
            type="button"
            onClick={() => onEditar(p)}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-tinta px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
          >
            <Pencil size={16} aria-hidden="true" /> Editar sabor
          </button>
          <button
            type="button"
            onClick={() => void alternarDisponible()}
            className="flex-1 rounded-full border border-tinta/25 bg-papel/60 px-4 py-3.5 text-sm font-semibold transition-colors hover:bg-papel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
          >
            {p.disponible ? 'Marcar sin stock' : 'Poner a la venta'}
          </button>
        </div>
      </aside>
    </div>
  )
}

function Dato({ valor, etiqueta }: { valor: React.ReactNode; etiqueta: string }) {
  return (
    <div className="flex flex-col-reverse items-center px-1">
      <dt className="mt-1 text-[11px] leading-tight text-balance text-apagado">{etiqueta}</dt>
      <dd className="cifra text-base">{valor}</dd>
    </div>
  )
}
