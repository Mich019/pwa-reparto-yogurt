import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Search, X } from 'lucide-react'
import { db } from '../../lib/db'
import { useSesion } from '../../lib/sesion'
import { useMarca } from '../../lib/marca'
import { useLogoEtiqueta } from '../admin/marca'
import { useSuscripcion } from '../../lib/suscripcion'
import { GUIAS, TEMAS, guiaInstalar, type Donde, type Guia, type Tema } from './guias'
import { Escena, type Valores } from './Escena'

// Ayuda: un manual corto que se adapta a quien lo abre. Muestra sólo lo que esa cuenta puede hacer (administrador o
// vendedor, panel o app de reparto), una lista «Para empezar» que se va palomeando con lo que el negocio ya tiene
// (sabores, clientes, pedidos…), la guía de instalar según el teléfono, y cada guía paso a paso con su captura de
// esqueleto. `ir` (panel) lleva a la sección de la guía.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function sistema(): 'ios' | 'android' | 'otro' {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return /Android/.test(ua) ? 'android' : 'otro'
}
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

const DESTINOS: Record<string, string> = { resumen: 'Resumen', cuenta: 'Cuenta', seguridad: 'Seguridad', suscripcion: 'Suscripción', apariencia: 'Apariencia', clientes: 'Clientes', equipo: 'Vendedores', sabores: 'Sabores', produccion: 'Producción', reportes: 'Reportes', marca: 'Marca' }

export function Ayuda({ donde, ir }: { donde: Donde; ir?: (destino: string) => void }) {
  const usuario = useSesion()?.usuario
  const rol = usuario?.rol ?? 'administrador' // sin servidor, quien usa la app es el dueño
  const suscripcion = useSuscripcion(donde === 'panel' ? usuario?.id : undefined) // null: la empresa no paga
  const [tema, setTema] = useState<Tema | null>(null)
  const marca = useMarca()
  const logo = useLogoEtiqueta()
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)

  const cuentas = useLiveQuery(async () => ({
    productos: await db.productos.count(),
    clientes: await db.clientes.count(),
    pedidos: await db.pedidos.count(),
    entregados: await db.pedidos.where('estado').equals('ENTREGADO').count(),
    cola: await db.cola.count(),
  }), [])

  const valores: Valores = {
    empresa: marca?.nombre || 'Tu negocio',
    logo,
    pendientes: !cuentas ? '' : cuentas.cola ? `${cuentas.cola} ${cuentas.cola === 1 ? 'cambio' : 'cambios'} por enviar` : 'Nada pendiente por enviar',
  }

  const guias = useMemo(() => {
    const puede = (g: Guia) => g.para === 'todos' || g.para === rol
    const todas = [...GUIAS, guiaInstalar(sistema())]
    return todas.filter((g) => puede(g) && (donde === 'panel' || g.donde === 'app') && (g.id !== 'suscripcion' || !!suscripcion))
  }, [rol, donde, suscripcion])

  // Lo que ya está hecho en este negocio; cada renglón abre su guía.
  const ya = instalada()
  const pendientes: { id: string; texto: string; hecho: boolean }[] = !cuentas ? [] : donde === 'panel' && rol === 'administrador'
    ? [
        { id: 'marca', texto: 'Pon tu logo y tu color', hecho: !!(marca?.logo || marca?.color) },
        { id: 'sabor', texto: 'Agrega tus sabores', hecho: cuentas.productos > 0 },
        { id: 'cliente-panel', texto: 'Da de alta a tus clientes', hecho: cuentas.clientes > 0 },
        { id: 'pedido', texto: 'Toma el primer pedido', hecho: cuentas.pedidos > 0 },
        { id: 'entregar', texto: 'Entrega el primer pedido', hecho: cuentas.entregados > 0 },
      ]
    : [
        { id: 'instalar', texto: 'Instala la app en tu teléfono', hecho: ya },
        { id: 'cliente-app', texto: 'Da de alta un cliente', hecho: cuentas.clientes > 0 },
        { id: 'pedido', texto: 'Toma un pedido', hecho: cuentas.pedidos > 0 },
        { id: 'entregar', texto: 'Entrega tu primer pedido', hecho: cuentas.entregados > 0 },
      ]
  const hechos = pendientes.filter((p) => p.hecho).length

  const buscadas = useMemo(() => {
    const t = sinAcentos(q.trim())
    const delTema = tema ? guias.filter((g) => g.tema === tema) : guias
    if (!t) return delTema
    return delTema.filter((g) => t.split(/\s+/).every((p) => sinAcentos([g.titulo, g.resumen, g.palabras, ...g.pasos.map((x) => x.texto)].join(' ')).includes(p)))
  }, [guias, q, tema])
  const temas = TEMAS.filter((t) => guias.some((g) => g.tema === t.id))

  const guia = guias.find((g) => g.id === abierta)
  if (guia) return <Visor guia={guia} valores={valores} donde={donde} ir={ir} onVolver={() => setAbierta(null)} resumenExtra={guia.id === 'instalar' && ya ? 'Ya la tienes instalada en este teléfono.' : undefined} />

  const grupos: { titulo: string; lista: Guia[] }[] = donde === 'panel'
    ? [{ titulo: 'En el panel', lista: buscadas.filter((g) => g.donde === 'panel') }, { titulo: 'En la app de reparto', lista: buscadas.filter((g) => g.donde === 'app') }]
    : [{ titulo: 'Guías', lista: buscadas }]

  return (
    <div className="space-y-7">
      <label className="flex h-11 items-center gap-2 rounded-md bg-niebla px-3 focus-within:outline-2 focus-within:outline-marca">
        <Search size={18} className="shrink-0 text-apagado" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué quieres hacer? Ej. cliente, reporte, sin señal" aria-label="Buscar en la ayuda"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-apagado" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Borrar búsqueda" className={`grid h-7 w-7 place-items-center rounded-full hover:bg-linea ${anillo}`}><X size={16} /></button>}
      </label>

      {/* Temas: se reparten en filas en la computadora y se desplazan de lado en el teléfono. */}
      <div role="group" aria-label="Temas" className="-mx-4 -mt-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ id: null, texto: 'Todas' }, ...temas].map((t) => (
          <button key={t.id ?? 'todas'} type="button" onClick={() => setTema(t.id)} aria-pressed={tema === t.id}
            className={`h-9 shrink-0 rounded-md px-3.5 text-sm font-semibold transition-colors ${anillo} ${tema === t.id ? 'bg-tinta text-white' : 'bg-niebla hover:bg-linea'}`}>
            {t.texto}
          </button>
        ))}
      </div>

      {!q && !tema && pendientes.length > 0 && hechos < pendientes.length && (
        <section aria-labelledby="para-empezar">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="para-empezar" className="text-base font-semibold">Para empezar</h3>
            <span className="text-sm text-apagado tabular-nums">{hechos} de {pendientes.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-niebla" role="progressbar" aria-valuemin={0} aria-valuemax={pendientes.length} aria-valuenow={hechos} aria-label="Avance">
            <div className="h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${(hechos / pendientes.length) * 100}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-linea">
            {pendientes.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setAbierta(p.id)} className={`flex w-full items-center gap-3 rounded-md py-3 text-left ${anillo}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${p.hecho ? 'bg-verde text-white' : 'border-2 border-linea'}`}>{p.hecho && <Check size={14} strokeWidth={3} aria-hidden="true" />}</span>
                  <span className={`min-w-0 flex-1 text-sm ${p.hecho ? 'text-apagado line-through' : 'font-semibold'}`}>{p.texto}<span className="sr-only">{p.hecho ? ' (hecho)' : ' (pendiente)'}</span></span>
                  <ChevronRight size={16} className="shrink-0 text-apagado" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grupos.map(({ titulo, lista }) => lista.length > 0 && (
        <section key={titulo} aria-label={titulo}>
          {grupos.length > 1 && <h3 className="mb-3 text-base font-semibold">{titulo}</h3>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {lista.map((g) => {
              const Icono = g.icono
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => setAbierta(g.id)} className={`group flex h-full w-full items-start gap-3 rounded-lg bg-niebla p-4 text-left transition-colors hover:bg-linea/70 ${anillo}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-papel"><Icono size={18} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{g.titulo}</span>
                      <span className="mt-0.5 block text-xs text-apagado">{g.resumen}</span>
                      <span className="mt-1.5 block text-xs font-semibold text-apagado">{g.pasos.length} {g.pasos.length === 1 ? 'paso' : 'pasos'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!q && tema && !buscadas.length && <p className="py-6 text-center text-sm text-apagado">No hay guías de este tema aquí.</p>}
      {q && !buscadas.length && <p className="py-6 text-center text-sm text-apagado">No hay guías sobre «{q.trim()}». Prueba con otra palabra, como «pedido» o «reporte».</p>}
    </div>
  )
}

function Visor({ guia, valores, donde, ir, onVolver, resumenExtra }: { guia: Guia; valores: Valores; donde: Donde; ir?: (d: string) => void; onVolver: () => void; resumenExtra?: string }) {
  const [paso, setPaso] = useState(0)
  const total = guia.pasos.length
  const actual = guia.pasos[paso]
  const destino = donde === 'panel' && ir && guia.ir ? guia.ir : null

  // Con las flechas del teclado también se avanza (fuera de los campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') setPaso((p) => Math.min(p + 1, total - 1))
      if (e.key === 'ArrowLeft') setPaso((p) => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [total])

  const boton = `flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
  return (
    <div>
      <button type="button" onClick={onVolver} className={`-ml-1 mb-4 flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-semibold text-apagado hover:text-tinta ${anillo}`}>
        <ArrowLeft size={16} aria-hidden="true" /> Todas las guías
      </button>
      <h3 className="text-2xl font-semibold leading-tight">{guia.titulo}</h3>
      <p className="mt-1 text-sm text-apagado">{resumenExtra ?? guia.resumen}</p>

      <div className={`mt-6 grid gap-6 ${donde === 'panel' ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start' : ''}`}>
        {/* La lista de pasos sólo en la computadora; en pantalla chica va el paso actual sobre su captura. */}
        <ol className={`min-w-0 space-y-1 ${donde === 'panel' ? 'hidden lg:order-1 lg:block' : 'hidden'}`}>
          {guia.pasos.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => setPaso(i)} aria-current={i === paso ? 'step' : undefined}
                className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${anillo} ${i === paso ? 'bg-niebla' : 'hover:bg-niebla/60'}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${i === paso ? 'bg-tinta text-white' : i < paso ? 'bg-verde text-white' : 'bg-linea'}`}>
                  {i < paso ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : i + 1}
                </span>
                <span className={`pt-0.5 text-sm ${i === paso ? 'font-semibold' : 'text-apagado'}`}>{p.texto}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className={`min-w-0 ${donde === 'panel' ? 'order-1 lg:order-2 lg:sticky lg:top-2' : 'order-1'}`}>
          <p className={`mb-4 min-h-[2.75rem] text-[15px] font-semibold leading-snug ${donde === 'panel' ? 'lg:hidden' : ''}`}>
            <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-tinta align-[1px] text-xs text-white tabular-nums">{paso + 1}</span>
            {actual.texto}
          </p>
          <div key={paso} className="ayuda-entrar">
            <Escena escena={actual.escena} valores={valores} />
          </div>
          <p className="sr-only" aria-live="polite">Paso {paso + 1} de {total}: {actual.texto}</p>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setPaso(paso - 1)} disabled={paso === 0} aria-label="Paso anterior" className={`${boton} w-10 px-0 bg-niebla hover:bg-linea`}><ArrowLeft size={18} /></button>
            <span className="flex flex-1 justify-center gap-1.5" aria-hidden="true">
              {guia.pasos.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === paso ? 'w-5 bg-tinta' : 'w-1.5 bg-linea'}`} />)}
            </span>
            {paso < total - 1 ? (
              <button type="button" onClick={() => setPaso(paso + 1)} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>Siguiente <ArrowRight size={18} aria-hidden="true" /></button>
            ) : destino ? (
              <button type="button" onClick={() => ir!(destino)} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>Ir a {DESTINOS[destino] ?? destino} <ArrowRight size={18} aria-hidden="true" /></button>
            ) : (
              <button type="button" onClick={onVolver} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}><Check size={18} aria-hidden="true" /> Entendido</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
