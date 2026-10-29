import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDownUp, ArrowLeft, Building2, Check, ChevronRight, Copy, LayoutDashboard, LogOut, Plus, RefreshCw, Search, ShieldCheck, UserCog } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { dinero } from '../../lib/fechas'
import { cerrarSesion, llamarAutenticado, useSesion } from '../../lib/sesion'
import { aviso, claseInput } from '../../components/ui'
import { FormPassword } from '../pwa/Cuenta'
import { DosPasos } from '../pwa/DosPasos'
import { BarraSegmentada, BarrasPeriodo } from './graficas'
import { LogoDelisy } from './marca'

// Panel de la plataforma (/plataforma, api/_lib/plataforma.ts): para quienes administran Delisy. Un tablero con menú
// lateral: el resumen de la plataforma, las empresas con su detalle y sus ajustes, el alta de empresas, las cuentas de
// la plataforma y la cuenta propia. Todo en páginas, sin ventanas encima.
//
// Gráficos de graficas.tsx (skill dataviz) con los colores de Delisy: la serie en su azul marino y el periodo en curso
// en su coral (bajo 3:1: lleva su valor escrito, tooltip y tabla). Los estados usan una paleta categórica validada con
// el script de la skill (azul, naranja, aqua, amarillo, magenta) y siempre van con su nombre, nunca sólo el color.

type Estado = 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'exenta' | 'suspendida'
interface Empresa {
  id: string
  nombre: string
  alta: string
  contacto: string | null
  estado: Estado
  pruebaHasta: string
  usuarios: number
  clientes: number
  pedidos30: number
  ultimoPedido: string | null
}
interface Cuenta { nombre: string; correo: string; activo: boolean; dosPasos: boolean }
interface Datos {
  cuentas: Cuenta[]
  series: { altasPorMes: { mes: string; n: number }[]; pedidosPorDia: { dia: string; n: number }[] }
  resumen: { total: number; prueba: number; activas: number; vencidas: number; canceladas: number; exentas: number; suspendidas: number; porVencer: number; ingresoMensual: number; moneda: string }
  empresas: Empresa[]
}
interface Detalle {
  id: string
  nombre: string
  alta: string
  zonaHoraria: string
  giros: string[]
  color: string | null
  logo: string | null
  estado: Estado
  exenta: boolean
  pruebaHasta: string
  suscripcion: string | null
  equipo: { nombre: string; correo: string; rol: string; activo: boolean; ultimoAcceso: string | null; alta: string; dosPasos: boolean }[]
  invitaciones: { correo: string; rol: string; vence: string }[]
  conteos: { clientes: number; productos: number; entregados: number; pendientes: number; ultimoPedido: string | null }
  pedidosPorDia: { dia: string; n: number }[]
}

const ESTADOS: Record<Estado, { texto: string; color: string }> = {
  activa: { texto: 'Pagando', color: '#2a78d6' },
  prueba: { texto: 'En prueba', color: '#eb6834' },
  exenta: { texto: 'Exenta', color: '#1baf7a' },
  vencida: { texto: 'Vencida', color: '#eda100' },
  cancelada: { texto: 'Cancelada', color: '#eda100' },
  suspendida: { texto: 'Suspendida', color: '#e87ba4' },
}
// La paleta de la plataforma sobre los colores del panel: el azul de Delisy (más claro en el modo oscuro, donde el marino
// se pierde), la serie de los gráficos y el periodo en curso.
const COLORES = '[--plat:#113250] [--plat-hover:#0b2238] [--plat-texto:#113250] [--color-serie:#113250] [--color-oro:#F06E4B] [.oscuro_&]:[--plat:#2a6299] [.oscuro_&]:[--plat-hover:#327ab8] [.oscuro_&]:[--plat-texto:#9cc3ea] [.oscuro_&]:[--color-serie:#5b9bd5]'
const ZONAS = ['America/Mexico_City', 'America/Monterrey', 'America/Merida', 'America/Cancun', 'America/Chihuahua', 'America/Mazatlan', 'America/Hermosillo', 'America/Tijuana']

const fecha = (s: string | null, conAnio = true) =>
  s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}) }) : '—'
const diasHasta = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400_000)
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

type Vista = { de: 'resumen' } | { de: 'empresas' } | { de: 'empresa'; id: string } | { de: 'nueva' } | { de: 'cuentas' } | { de: 'cuenta' }

export function Plataforma() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState<Vista>({ de: 'resumen' })

  async function cargar() {
    setError('')
    try {
      setDatos(await llamarAutenticado<Datos>('/plataforma/empresas'))
    } catch (e) {
      setError(mensaje(e))
    }
  }
  useEffect(() => { void cargar() }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [vista])

  const ir = (v: Vista) => setVista(v)
  const menu: { de: Vista['de']; texto: string; icono: typeof Building2 }[] = [
    { de: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
    { de: 'empresas', texto: 'Empresas', icono: Building2 },
    { de: 'nueva', texto: 'Nueva empresa', icono: Plus },
    { de: 'cuentas', texto: 'Cuentas de la plataforma', icono: ShieldCheck },
    { de: 'cuenta', texto: 'Mi cuenta y seguridad', icono: UserCog },
  ]
  const activo = vista.de === 'empresa' ? 'empresas' : vista.de

  return (
    <div className={`min-h-dvh text-tinta lg:grid lg:grid-cols-[264px_minmax(0,1fr)] ${COLORES}`}>
      {/* Menú: lateral en la computadora, una fila que se desliza en el teléfono */}
      <aside className="bg-papel lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 lg:pb-6">
          <LogoDelisy className="h-8" />
          <span className="flex items-center gap-1">
            <span className="rounded-full bg-[var(--plat)] px-2.5 py-1 text-[11px] font-semibold text-white">Plataforma</span>
            <button type="button" onClick={() => void cerrarSesion()} aria-label="Cerrar sesión" className={`grid h-10 w-10 place-items-center rounded-full text-apagado hover:text-rojo lg:hidden ${anillo}`}><LogOut size={18} aria-hidden="true" /></button>
          </span>
        </div>
        <nav aria-label="Secciones de la plataforma" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {menu.map(({ de, texto, icono: Icono }) => (
            <button
              key={de}
              type="button"
              onClick={() => ir({ de } as Vista)}
              aria-current={activo === de ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${anillo} ${activo === de ? 'bg-[var(--plat)] text-white' : 'text-tinta hover:bg-niebla'}`}
            >
              <Icono size={18} aria-hidden="true" /> {texto}
            </button>
          ))}
        </nav>
        <PiePropio />
      </aside>

      <main className="min-w-0 px-4 pt-6 pb-20 sm:px-8 lg:px-10 lg:pt-8">
        {error && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rojo/10 px-5 py-4 text-sm font-medium text-rojo">
            {error}
            <button type="button" onClick={() => void cargar()} className="rounded-full bg-papel px-4 py-2 font-semibold text-tinta">Reintentar</button>
          </div>
        )}
        {vista.de === 'cuenta' ? <MiCuenta />
          : !datos ? !error && <p className="py-20 text-center text-apagado">Cargando la plataforma…</p>
          : vista.de === 'resumen' ? <Resumen d={datos} ir={ir} recargar={cargar} />
          : vista.de === 'empresas' ? <Empresas d={datos} ir={ir} />
          : vista.de === 'empresa' ? <DetalleEmpresa id={vista.id} ir={ir} alCambiar={cargar} />
          : vista.de === 'nueva' ? <NuevaEmpresa ir={ir} alCrear={cargar} />
          : <Cuentas cuentas={datos.cuentas} alCrear={cargar} />}
      </main>
    </div>
  )
}

function PiePropio() {
  const u = useSesion()?.usuario
  return (
    <div className="hidden px-5 pb-6 lg:mt-auto lg:block">
      <div className="text-sm font-semibold">{u?.nombre}</div>
      <div className="truncate text-xs text-apagado">{u?.correo}</div>
      <button type="button" onClick={() => void cerrarSesion()} className={`mt-3 flex items-center gap-2 rounded-lg text-sm font-semibold text-apagado hover:text-rojo ${anillo}`}>
        <LogOut size={16} aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- piezas

function Encabezado({ titulo, detalle, children }: { titulo: ReactNode; detalle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[2.25rem] font-semibold leading-none tracking-tight lg:text-[2.75rem]">{titulo}</h1>
        {detalle && <p className="mt-2 text-sm text-apagado">{detalle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  )
}

function Panel({ titulo, detalle, children, className = '' }: { titulo: string; detalle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[22px] bg-papel p-5 sm:p-6 ${className}`}>
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {detalle && <p className="mt-0.5 text-sm text-apagado">{detalle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

// La franja de cifras: una sola pieza, cada cifra con su nota. Sin tarjetas sueltas.
function Cifras({ cifras }: { cifras: { valor: string; etiqueta: string; nota?: string; acento?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 rounded-[22px] bg-papel px-6 py-6 sm:grid-cols-3 xl:grid-cols-5">
      {cifras.map((c) => (
        <div key={c.etiqueta} className="min-w-0">
          <dt className="text-xs font-medium text-apagado">{c.etiqueta}</dt>
          <dd className={`mt-1.5 text-[1.9rem] font-semibold leading-none tracking-tight tabular-nums ${c.acento ? 'text-[var(--plat-texto)]' : ''}`}>{c.valor}</dd>
          {c.nota && <dd className="mt-1.5 text-xs text-apagado">{c.nota}</dd>}
        </div>
      ))}
    </dl>
  )
}

function ChipEstado({ estado }: { estado: Estado }) {
  const e = ESTADOS[estado]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-niebla px-2.5 py-1 text-xs font-semibold">
      <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden="true" />{e.texto}
    </span>
  )
}

const boton = `inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
const botonPrimario = `${boton} bg-[var(--plat)] text-white hover:bg-[var(--plat-hover)]`
const botonSuave = `${boton} bg-niebla text-tinta hover:bg-linea`

// Pedidos por día (30) y altas por mes (12) como barras: el último periodo es el que va en curso.
const barrasDias = (serie: { dia: string; n: number }[]) =>
  serie.map((d, i) => ({ clave: d.dia, eje: String(Number(d.dia.slice(8))), nombre: fecha(d.dia, false), valor: d.n, actual: i === serie.length - 1 }))

// ---------------------------------------------------------------------------------------------------------- resumen

function Resumen({ d, ir, recargar }: { d: Datos; ir: (v: Vista) => void; recargar: () => Promise<void> }) {
  const r = d.resumen
  const pedidos30 = d.series.pedidosPorDia.reduce((s, x) => s + x.n, 0)
  const sinAcceso = r.vencidas + r.canceladas
  const segmentos = [
    { nombre: 'Pagando', n: r.activas, color: ESTADOS.activa.color },
    { nombre: 'En prueba', n: r.prueba, color: ESTADOS.prueba.color },
    { nombre: 'Exentas', n: r.exentas, color: ESTADOS.exenta.color },
    { nombre: 'Sin acceso', n: sinAcceso, color: ESTADOS.vencida.color },
    { nombre: 'Suspendidas', n: r.suspendidas, color: ESTADOS.suspendida.color },
  ]
  const porVencer = d.empresas.filter((e) => e.estado === 'prueba').sort((a, b) => a.pruebaHasta.localeCompare(b.pruebaHasta)).slice(0, 6)
  const activas = [...d.empresas].sort((a, b) => b.pedidos30 - a.pedidos30).filter((e) => e.pedidos30 > 0).slice(0, 6)
  const meses = d.series.altasPorMes.map((m, i) => {
    const f = new Date(`${m.mes}-15T12:00:00`)
    return { clave: m.mes, eje: f.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''), nombre: f.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }), valor: m.n, actual: i === d.series.altasPorMes.length - 1 }
  })

  return (
    <>
      <Encabezado titulo="Resumen" detalle={`${r.total} empresas en Delisy · ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
        <button type="button" onClick={() => void recargar()} className={botonSuave}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
        <button type="button" onClick={() => ir({ de: 'nueva' })} className={botonPrimario}><Plus size={16} aria-hidden="true" /> Nueva empresa</button>
      </Encabezado>

      <Cifras cifras={[
        { valor: dinero(r.ingresoMensual), etiqueta: `Ingreso mensual (${r.moneda})`, nota: `${r.activas} ${r.activas === 1 ? 'empresa pagando' : 'empresas pagando'}`, acento: true },
        { valor: String(r.prueba), etiqueta: 'En prueba gratis', nota: r.porVencer ? `${r.porVencer} vencen en 7 días` : 'Ninguna vence esta semana' },
        { valor: String(sinAcceso), etiqueta: 'Sin acceso', nota: `${r.vencidas} vencidas · ${r.canceladas} canceladas` },
        { valor: String(pedidos30), etiqueta: 'Pedidos entregados', nota: 'Últimos 30 días, todas las empresas' },
        { valor: String(r.total), etiqueta: 'Empresas', nota: `${r.exentas} exentas · ${r.suspendidas} suspendidas` },
      ]} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Pedidos entregados por día" detalle="Todas las empresas, últimos 30 días">
          <BarrasPeriodo datos={barrasDias(d.series.pedidosPorDia)} formato={(n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`} descripcion="Pedidos entregados por día en toda la plataforma" leyenda={['Días anteriores', 'Hoy']} alto={180} ejeEn={5} />
        </Panel>
        <Panel titulo="Estado de las empresas" detalle={`${r.total} en total`}>
          <BarraSegmentada segmentos={segmentos} descripcion={segmentos.map((s) => `${s.nombre}: ${s.n}`).join(', ')} />
          <ul className="mt-5 space-y-3">
            {segmentos.map((s) => (
              <li key={s.nombre} className="flex items-center gap-3 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                <span className="flex-1">{s.nombre}</span>
                <span className="font-semibold tabular-nums">{s.n}</span>
                <span className="w-12 text-right text-apagado tabular-nums">{r.total ? Math.round((s.n / r.total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel titulo="Altas de empresas" detalle="Por mes, últimos 12 meses">
          <BarrasPeriodo datos={meses} formato={(n) => `${n} ${n === 1 ? 'empresa' : 'empresas'}`} descripcion="Empresas que se dieron de alta cada mes" leyenda={['Meses anteriores', 'Este mes']} alto={140} ejeEn={2} />
        </Panel>
        <Panel titulo="Pruebas por terminar" detalle="Las que vencen primero">
          <ListaEmpresas empresas={porVencer} vacia="No hay empresas en prueba." ir={ir} dato={(e) => {
            const dias = diasHasta(e.pruebaHasta)
            return dias <= 0 ? 'Vence hoy' : `${dias} ${dias === 1 ? 'día' : 'días'}`
          }} />
        </Panel>
        <Panel titulo="Más activas" detalle="Pedidos entregados, últimos 30 días">
          <ListaEmpresas empresas={activas} vacia="Todavía no hay pedidos entregados." ir={ir} dato={(e) => `${e.pedidos30} pedidos`} />
        </Panel>
      </div>
    </>
  )
}

function ListaEmpresas({ empresas, vacia, ir, dato }: { empresas: Empresa[]; vacia: string; ir: (v: Vista) => void; dato: (e: Empresa) => string }) {
  if (!empresas.length) return <p className="text-sm text-apagado">{vacia}</p>
  return (
    <ul className="-mx-2">
      {empresas.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => ir({ de: 'empresa', id: e.id })} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-niebla ${anillo}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-niebla text-sm font-bold">{e.nombre.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{e.nombre}</span>
              <span className="block truncate text-xs text-apagado">{e.contacto ?? 'Sin administrador'}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{dato(e)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------------------- empresas

const FILTROS: { clave: 'todas' | Estado | 'sin-acceso'; texto: string; cumple: (e: Empresa) => boolean }[] = [
  { clave: 'todas', texto: 'Todas', cumple: () => true },
  { clave: 'activa', texto: 'Pagando', cumple: (e) => e.estado === 'activa' },
  { clave: 'prueba', texto: 'En prueba', cumple: (e) => e.estado === 'prueba' },
  { clave: 'sin-acceso', texto: 'Sin acceso', cumple: (e) => e.estado === 'vencida' || e.estado === 'cancelada' },
  { clave: 'exenta', texto: 'Exentas', cumple: (e) => e.estado === 'exenta' },
  { clave: 'suspendida', texto: 'Suspendidas', cumple: (e) => e.estado === 'suspendida' },
]
type Orden = 'alta' | 'nombre' | 'pedidos' | 'clientes'

function Empresas({ d, ir }: { d: Datos; ir: (v: Vista) => void }) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['clave']>('todas')
  const [orden, setOrden] = useState<Orden>('alta')
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const f = FILTROS.find((x) => x.clave === filtro)!
    return d.empresas
      .filter((e) => f.cumple(e) && (!q || e.nombre.toLowerCase().includes(q) || (e.contacto ?? '').toLowerCase().includes(q)))
      .sort((a, b) => orden === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es') : orden === 'pedidos' ? b.pedidos30 - a.pedidos30 : orden === 'clientes' ? b.clientes - a.clientes : b.alta.localeCompare(a.alta))
  }, [d.empresas, busca, filtro, orden])
  const columna = (clave: Orden, texto: string, der = false) => (
    <th scope="col" className={`px-4 py-3 font-medium ${der ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setOrden(clave)} className={`inline-flex items-center gap-1 ${orden === clave ? 'text-tinta' : ''} ${anillo}`}>
        {texto} {orden === clave && <ArrowDownUp size={12} aria-hidden="true" />}
      </button>
    </th>
  )

  return (
    <>
      <Encabezado titulo="Empresas" detalle={`${lista.length} de ${d.empresas.length}`}>
        <button type="button" onClick={() => ir({ de: 'nueva' })} className={botonPrimario}><Plus size={16} aria-hidden="true" /> Nueva empresa</button>
      </Encabezado>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[16rem] flex-1">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-apagado" aria-hidden="true" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar empresa" className={`${claseInput} bg-papel pl-11`} />
        </label>
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const n = d.empresas.filter(f.cumple).length
            return (
              <button key={f.clave} type="button" onClick={() => setFiltro(f.clave)} aria-pressed={filtro === f.clave}
                className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${anillo} ${filtro === f.clave ? 'bg-[var(--plat)] text-white' : 'bg-papel hover:bg-niebla'}`}>
                {f.texto} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[22px] bg-papel">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-xs text-apagado">
            <tr>
              {columna('nombre', 'Empresa')}
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              {columna('alta', 'Alta')}
              <th scope="col" className="px-4 py-3 font-medium">Prueba</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Usuarios</th>
              {columna('clientes', 'Clientes', true)}
              {columna('pedidos', 'Pedidos 30 d', true)}
              <th scope="col" className="px-4 py-3 font-medium">Última entrega</th>
              <th scope="col" className="w-8"><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => (
              <tr key={e.id} onClick={() => ir({ de: 'empresa', id: e.id })} className="cursor-pointer odd:bg-lienzo/50 hover:bg-niebla">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => ir({ de: 'empresa', id: e.id })} className={`block text-left ${anillo}`}>
                    <span className="block font-semibold">{e.nombre}</span>
                    <span className="block text-xs text-apagado">{e.contacto ?? 'Sin administrador'}</span>
                  </button>
                </td>
                <td className="px-4 py-3"><ChipEstado estado={e.estado} /></td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fecha(e.alta)}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums text-apagado">{e.estado === 'prueba' ? `Hasta ${fecha(e.pruebaHasta, false)}` : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.usuarios}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.clientes}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{e.pedidos30}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fecha(e.ultimoPedido)}</td>
                <td className="pr-4 text-apagado"><ChevronRight size={16} aria-hidden="true" /></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-apagado">Ninguna empresa con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------- detalle

function DetalleEmpresa({ id, ir, alCambiar }: { id: string; ir: (v: Vista) => void; alCambiar: () => Promise<void> }) {
  const [e, setE] = useState<Detalle | null>(null)
  const [error, setError] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  async function cargar() {
    try {
      setE(await llamarAutenticado<Detalle>(`/plataforma/empresas/${id}`))
    } catch (x) {
      setError(mensaje(x))
    }
  }
  useEffect(() => { void cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiarActiva(activa: boolean) {
    setTrabajando(true)
    try {
      await llamarAutenticado(`/plataforma/empresas/${id}/activa`, { metodo: 'POST', cuerpo: { activa } })
      aviso(activa ? 'Empresa reactivada' : 'Empresa suspendida')
      setConfirmar(false)
      await Promise.all([cargar(), alCambiar()])
    } catch (x) {
      aviso(mensaje(x))
    } finally {
      setTrabajando(false)
    }
  }

  const volver = <button type="button" onClick={() => ir({ de: 'empresas' })} className={`mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-apagado hover:text-tinta ${anillo}`}><ArrowLeft size={16} aria-hidden="true" /> Empresas</button>
  if (error) return <>{volver}<p role="alert" className="rounded-2xl bg-rojo/10 p-5 text-rojo">{error}</p></>
  if (!e) return <>{volver}<p className="py-20 text-center text-apagado">Cargando la empresa…</p></>
  const suspendida = e.estado === 'suspendida'

  return (
    <>
      {volver}
      <header className="mb-8 flex flex-wrap items-center gap-5">
        {e.logo
          ? <img src={e.logo} alt="" className="h-16 w-16 rounded-2xl bg-papel object-contain p-2" />
          : <span className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-bold text-white" style={{ background: e.color ?? 'var(--plat)' }}>{e.nombre.charAt(0).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[2.25rem] font-semibold leading-none tracking-tight">{e.nombre}</h1>
            <ChipEstado estado={e.estado} />
          </div>
          <p className="mt-2 text-sm text-apagado">
            Alta el {fecha(e.alta)} · {e.zonaHoraria.replace('America/', '').replace('_', ' ')}
            {e.estado === 'prueba' && ` · prueba hasta el ${fecha(e.pruebaHasta)}`}
          </p>
        </div>
        {confirmar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-papel px-4 py-3">
            <span className="text-sm">Nadie de {e.nombre} podrá entrar. No se borra nada.</span>
            <button type="button" onClick={() => void cambiarActiva(false)} disabled={trabajando} className={`${boton} bg-rojo text-white`}>Sí, suspender</button>
            <button type="button" onClick={() => setConfirmar(false)} className={botonSuave}>Cancelar</button>
          </div>
        ) : suspendida ? (
          <button type="button" onClick={() => void cambiarActiva(true)} disabled={trabajando} className={botonPrimario}>Reactivar</button>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} className={`${boton} bg-papel text-rojo hover:bg-rojo/10`}>Suspender</button>
        )}
      </header>

      <Cifras cifras={[
        { valor: String(e.conteos.clientes), etiqueta: 'Clientes activos' },
        { valor: String(e.conteos.productos), etiqueta: 'Productos a la venta' },
        { valor: String(e.conteos.entregados), etiqueta: 'Pedidos entregados', nota: 'Desde que se dio de alta' },
        { valor: String(e.conteos.pendientes), etiqueta: 'Pedidos por entregar' },
        { valor: fecha(e.conteos.ultimoPedido), etiqueta: 'Última entrega' },
      ]} />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Actividad" detalle="Pedidos entregados por día, últimos 30 días">
          {e.pedidosPorDia.every((x) => !x.n) ? <p className="py-16 text-center text-sm text-apagado">Sin pedidos entregados en los últimos 30 días.</p> : <BarrasPeriodo datos={barrasDias(e.pedidosPorDia)} formato={(n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`} descripcion={`Pedidos entregados por día de ${e.nombre}`} leyenda={['Días anteriores', 'Hoy']} alto={160} ejeEn={5} />}
        </Panel>
        <Panel titulo="Ajustes" detalle="Sólo para la plataforma: la empresa no los ve.">
          <Ajustes e={e} alGuardar={async () => { await Promise.all([cargar(), alCambiar()]) }} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Equipo" detalle={`${e.equipo.length} ${e.equipo.length === 1 ? 'cuenta' : 'cuentas'}`}>
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-apagado">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium sm:px-6">Nombre</th>
                  <th scope="col" className="px-3 py-2 font-medium">Rol</th>
                  <th scope="col" className="px-3 py-2 font-medium">Dos pasos</th>
                  <th scope="col" className="px-5 py-2 font-medium sm:px-6">Último acceso</th>
                </tr>
              </thead>
              <tbody>
                {e.equipo.map((u) => (
                  <tr key={u.correo} className={`odd:bg-lienzo/50 ${u.activo ? '' : 'opacity-50'}`}>
                    <td className="px-5 py-2.5 sm:px-6"><span className="block font-semibold">{u.nombre}</span><span className="block text-xs text-apagado">{u.correo}</span></td>
                    <td className="px-3 py-2.5">{u.rol === 'administrador' ? 'Administrador' : 'Vendedor'}{!u.activo && ' · de baja'}</td>
                    <td className="px-3 py-2.5">{u.dosPasos ? <span className="inline-flex items-center gap-1 font-semibold text-verde"><Check size={14} aria-hidden="true" /> Sí</span> : <span className="text-apagado">No</span>}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap tabular-nums sm:px-6">{fecha(u.ultimoAcceso)}</td>
                  </tr>
                ))}
                {!e.equipo.length && <tr><td colSpan={4} className="px-6 py-6 text-center text-apagado">Nadie ha entrado todavía.</td></tr>}
              </tbody>
            </table>
          </div>
          {e.invitaciones.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Invitaciones sin aceptar</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {e.invitaciones.map((i) => <li key={i.correo} className="text-apagado"><span className="font-medium text-tinta">{i.correo}</span> · {i.rol === 'administrador' ? 'administrador' : 'vendedor'} · vence el {fecha(i.vence, false)}</li>)}
              </ul>
            </div>
          )}
        </Panel>
        <Panel titulo="Datos">
          <dl className="space-y-3 text-sm">
            <Dato t="Giros" v={e.giros.length ? e.giros.join(', ') : '—'} />
            <Dato t="Zona horaria" v={e.zonaHoraria} />
            <Dato t="Suscripción en Mercado Pago" v={({ pending: 'Pago en proceso', authorized: 'Autorizada', paused: 'Pausada', cancelled: 'Cancelada' } as Record<string, string>)[e.suscripcion ?? ''] ?? 'Sin suscripción'} />
            <Dato t="Color de marca" v={e.color ? <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: e.color }} />{e.color}</span> : 'Sin marca propia'} />
            <Dato t="Identificador" v={<span className="break-all font-mono text-xs">{e.id}</span>} />
          </dl>
        </Panel>
      </div>
    </>
  )
}

function Dato({ t, v }: { t: string; v: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-apagado">{t}</dt>
      <dd className="mt-0.5 font-medium">{v}</dd>
    </div>
  )
}

function Ajustes({ e, alGuardar }: { e: Detalle; alGuardar: () => Promise<void> }) {
  const hoy = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: e.zonaHoraria })
  const [nombre, setNombre] = useState(e.nombre)
  const [prueba, setPrueba] = useState(hoy(e.pruebaHasta))
  const [exenta, setExenta] = useState(e.exenta)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const cambios = {
    ...(nombre.trim() !== e.nombre ? { nombre: nombre.trim() } : {}),
    ...(prueba !== hoy(e.pruebaHasta) ? { pruebaHasta: prueba } : {}),
    ...(exenta !== e.exenta ? { exenta } : {}),
  }
  const hay = Object.keys(cambios).length > 0
  const sumar = (dias: number) => {
    const base = new Date(`${prueba}T12:00:00`)
    base.setDate(base.getDate() + dias)
    setPrueba(base.toISOString().slice(0, 10))
  }

  async function guardar() {
    setGuardando(true)
    setError('')
    try {
      await llamarAutenticado(`/plataforma/empresas/${e.id}`, { metodo: 'PATCH', cuerpo: cambios })
      aviso('Ajustes guardados')
      await alGuardar()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-apagado">Nombre</span>
        <input value={nombre} onChange={(x) => setNombre(x.target.value)} className={claseInput} maxLength={120} />
      </label>
      <div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-apagado">Prueba gratis hasta</span>
          <input type="date" value={prueba} onChange={(x) => setPrueba(x.target.value)} className={claseInput} disabled={exenta} />
        </label>
        {!exenta && (
          <div className="mt-2 flex gap-1.5">
            {[7, 14, 30].map((n) => <button key={n} type="button" onClick={() => sumar(n)} className="rounded-full bg-niebla px-3 py-1.5 text-xs font-semibold hover:bg-linea">+{n} días</button>)}
          </div>
        )}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-niebla px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">Exenta</span>
          <span className="block text-xs text-apagado">No paga y nunca pierde el acceso.</span>
        </span>
        <input type="checkbox" checked={exenta} onChange={(x) => setExenta(x.target.checked)} className="h-5 w-5 accent-[var(--plat)]" />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
      <button type="button" onClick={() => void guardar()} disabled={!hay || guardando} className={`${botonPrimario} w-full`}>{guardando ? 'Guardando…' : 'Guardar ajustes'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- nueva

function NuevaEmpresa({ ir, alCrear }: { ir: (v: Vista) => void; alCrear: () => Promise<void> }) {
  const [f, setF] = useState({ nombre: '', zona: 'America/Mexico_City', adminNombre: '', adminCorreo: '', plan: 'prueba' as 'prueba' | 'exenta', dias: '14' })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [hecha, setHecha] = useState<{ id: string; enlace: string; dias: number } | null>(null)
  const poner = (c: Partial<typeof f>) => setF({ ...f, ...c })

  async function crear() {
    setEnviando(true)
    setError('')
    try {
      const r = await llamarAutenticado<{ id: string; enlace: string; dias: number }>('/plataforma/empresas', {
        metodo: 'POST',
        cuerpo: {
          nombre: f.nombre.trim(), zonaHoraria: f.zona, exenta: f.plan === 'exenta',
          ...(f.plan === 'prueba' ? { pruebaDias: Number(f.dias) || 0 } : {}),
          administrador: { nombre: f.adminNombre.trim(), correo: f.adminCorreo.trim() },
        },
      })
      setHecha(r)
      await alCrear()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setEnviando(false)
    }
  }

  if (hecha) {
    return (
      <>
        <Encabezado titulo={`${f.nombre.trim()} ya está en Delisy`} detalle="Su administrador recibió un correo para crear su contraseña." />
        <section className="max-w-2xl rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">Enlace de la invitación</h2>
          <p className="mt-1 text-sm text-apagado">Si no le llega el correo, mándale este enlace por WhatsApp. Vence en {hecha.dias} días y sirve una sola vez.</p>
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-niebla p-3">
            <code className="min-w-0 flex-1 truncate text-sm">{hecha.enlace}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(hecha.enlace).then(() => aviso('Enlace copiado'))} className={botonSuave}><Copy size={15} aria-hidden="true" /> Copiar</button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => ir({ de: 'empresa', id: hecha.id })} className={botonPrimario}>Ver la empresa</button>
            <button type="button" onClick={() => { setHecha(null); setF({ ...f, nombre: '', adminNombre: '', adminCorreo: '' }) }} className={botonSuave}>Dar de alta otra</button>
          </div>
        </section>
      </>
    )
  }

  const listo = f.nombre.trim().length >= 2 && f.adminNombre.trim().length >= 2 && f.adminCorreo.includes('@')
  return (
    <>
      <Encabezado titulo="Nueva empresa" detalle="Para dar de alta a un negocio sin que pase por el registro. Su catálogo y su marca los pone su administrador al entrar." />
      <form onSubmit={(x) => { x.preventDefault(); if (listo) void crear() }} className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <section className="rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">El negocio</h2>
          <div className="mt-5 space-y-4">
            <Campo t="Nombre"><input value={f.nombre} onChange={(x) => poner({ nombre: x.target.value })} className={claseInput} placeholder="Ej. Agua La Fuente" maxLength={120} /></Campo>
            <Campo t="Zona horaria (define qué es «hoy» para sus rutas)">
              <select value={f.zona} onChange={(x) => poner({ zona: x.target.value })} className={claseInput}>
                {ZONAS.map((z) => <option key={z} value={z}>{z.replace('America/', '').replace('_', ' ')}</option>)}
              </select>
            </Campo>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-apagado">Plan</span>
              <div className="grid grid-cols-2 gap-2">
                {(['prueba', 'exenta'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => poner({ plan: p })} aria-pressed={f.plan === p}
                    className={`rounded-2xl px-4 py-3 text-left transition-colors ${anillo} ${f.plan === p ? 'bg-[var(--plat)] text-white' : 'bg-niebla hover:bg-linea'}`}>
                    <span className="block text-sm font-semibold">{p === 'prueba' ? 'Prueba gratis' : 'Exenta'}</span>
                    <span className={`block text-xs ${f.plan === p ? 'text-white/70' : 'text-apagado'}`}>{p === 'prueba' ? 'Luego se suscribe' : 'No paga nunca'}</span>
                  </button>
                ))}
              </div>
            </div>
            {f.plan === 'prueba' && (
              <Campo t="Días de prueba"><input inputMode="numeric" value={f.dias} onChange={(x) => poner({ dias: x.target.value.replace(/\D/g, '').slice(0, 3) })} className={claseInput} /></Campo>
            )}
          </div>
        </section>
        <section className="flex flex-col rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">Su administrador</h2>
          <p className="mt-1 text-sm text-apagado">Le llega un enlace para crear su contraseña. Nadie más la ve.</p>
          <div className="mt-5 space-y-4">
            <Campo t="Nombre"><input value={f.adminNombre} onChange={(x) => poner({ adminNombre: x.target.value })} className={claseInput} placeholder="Nombre y apellido" maxLength={100} /></Campo>
            <Campo t="Correo"><input type="email" value={f.adminCorreo} onChange={(x) => poner({ adminCorreo: x.target.value })} className={claseInput} placeholder="correo@ejemplo.com" maxLength={150} /></Campo>
          </div>
          {error && <p role="alert" className="mt-4 text-sm font-medium text-rojo">{error}</p>}
          <button type="submit" disabled={!listo || enviando} className={`${botonPrimario} mt-6 w-full lg:mt-auto`}>{enviando ? 'Creando…' : 'Crear empresa e invitar'}</button>
        </section>
      </form>
    </>
  )
}

function Campo({ t, children }: { t: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-apagado">{t}</span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------------------------------------------------- cuentas

function Cuentas({ cuentas, alCrear }: { cuentas: Cuenta[]; alCrear: () => Promise<void> }) {
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [creada, setCreada] = useState<{ correo: string; passwordTemporal: string } | null>(null)

  async function crear() {
    setEnviando(true)
    setError('')
    try {
      setCreada(await llamarAutenticado<{ correo: string; passwordTemporal: string }>('/plataforma/cuentas', { metodo: 'POST', cuerpo: { nombre: nombre.trim(), correo: correo.trim() } }))
      setNombre('')
      setCorreo('')
      await alCrear()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <Encabezado titulo="Cuentas de la plataforma" detalle="Quienes administran Delisy. Ven todas las empresas y no administran ningún negocio." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="overflow-x-auto rounded-[22px] bg-papel">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs text-apagado">
              <tr>
                <th scope="col" className="px-6 py-3 font-medium">Nombre</th>
                <th scope="col" className="px-3 py-3 font-medium">Dos pasos</th>
                <th scope="col" className="px-6 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => (
                <tr key={c.correo} className="odd:bg-lienzo/50">
                  <td className="px-6 py-3"><span className="block font-semibold">{c.nombre}</span><span className="block text-xs text-apagado">{c.correo}</span></td>
                  <td className="px-3 py-3">{c.dosPasos ? <span className="inline-flex items-center gap-1 font-semibold text-verde"><Check size={14} aria-hidden="true" /> Activa</span> : <span className="font-medium text-rojo">Falta activarla</span>}</td>
                  <td className="px-6 py-3">{c.activo ? 'Activa' : 'De baja'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">Nueva cuenta</h2>
          {creada ? (
            <div className="mt-4 space-y-3 text-sm">
              <p>Compártele estos datos por un medio seguro. Al entrar se le pide cambiar la contraseña y activar la verificación en dos pasos.</p>
              <div className="space-y-2 rounded-2xl bg-niebla p-4">
                <div><span className="text-apagado">Correo:</span> <b>{creada.correo}</b></div>
                <div className="flex items-center gap-2">
                  <span className="text-apagado">Contraseña temporal:</span> <b className="font-mono">{creada.passwordTemporal}</b>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(creada.passwordTemporal).then(() => aviso('Copiada'))} aria-label="Copiar contraseña" className="grid h-8 w-8 place-items-center rounded-full hover:bg-linea"><Copy size={15} /></button>
                </div>
              </div>
              <p className="text-xs text-apagado">No se vuelve a mostrar.</p>
              <button type="button" onClick={() => setCreada(null)} className={botonSuave}>Crear otra</button>
            </div>
          ) : (
            <form onSubmit={(x) => { x.preventDefault(); void crear() }} className="mt-5 space-y-4">
              <Campo t="Nombre"><input value={nombre} onChange={(x) => setNombre(x.target.value)} className={claseInput} autoComplete="off" /></Campo>
              <Campo t="Correo"><input type="email" value={correo} onChange={(x) => setCorreo(x.target.value)} className={claseInput} autoComplete="off" placeholder="correo@ejemplo.com" /></Campo>
              {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
              <button type="submit" disabled={enviando || nombre.trim().length < 2 || !correo.trim()} className={`${botonPrimario} w-full`}>{enviando ? 'Creando…' : 'Crear cuenta'}</button>
            </form>
          )}
        </section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------- mi cuenta

function MiCuenta() {
  const u = useSesion()?.usuario
  return (
    <>
      <Encabezado titulo="Mi cuenta y seguridad" detalle={u ? `${u.nombre} · ${u.correo}` : undefined} />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">Contraseña</h2>
          <div className="mt-4"><FormPassword /></div>
        </section>
        <section className="rounded-[22px] bg-papel p-6">
          <h2 className="text-lg font-semibold">Verificación en dos pasos</h2>
          <p className="mt-1 text-sm text-apagado">El panel de la plataforma la pide.</p>
          <div className="mt-2"><DosPasos /></div>
        </section>
      </div>
    </>
  )
}
