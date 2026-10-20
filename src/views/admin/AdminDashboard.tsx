import { useEffect, useState } from 'react'
import { ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react'
import { desdeIso, dinero } from '../../lib/fechas'
import { llamarAutenticado } from '../../lib/sesion'

export interface DashboardStats {
  fecha: string
  vendedores: {
    total: number
    activos: number
  }
  clientes: {
    total: number
    activos: number
    sinVendedor: number
  }
  productos: {
    total: number
    disponibles: number
  }
  pedidosHoy: {
    total: number
    pendientes: number
    enCamino: number
    entregados: number
    omitidos: number
    cancelados: number
    totalCobrado: number
    totalEsperado: number
    litrosHoy: number
  }
  saboresTop: Array<{
    sabor: string
    color: string
    litros: number
  }>
}

type Seccion = 'equipo' | 'clientes' | 'produccion' | 'sabores'

const litros = (n: number) => `${n.toLocaleString('es-MX', { maximumFractionDigits: 1 })} L`
const pct = (parte: number, total: number) => (total ? (parte / total) * 100 : 0)

export function AdminDashboard({ onNavegar }: { onNavegar: (seccion: Seccion) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [actualizando, setActualizando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ultima, setUltima] = useState<Date | null>(null)

  async function cargar() {
    setActualizando(true)
    try {
      setStats(await llamarAutenticado<DashboardStats>('/admin/stats'))
      setUltima(new Date())
      setError(null)
    } catch {
      setError('No se pudo traer el resumen. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setActualizando(false)
    }
  }

  // Se refresca cada minuto mientras la pestaña está a la vista, y al volver a ella.
  useEffect(() => {
    void cargar()
    const reloj = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  const p = stats?.pedidosHoy
  // Los cancelados no cuentan para el avance: ya no hay que entregarlos.
  const porAtender = p ? p.total - p.cancelados : 0
  const atendidos = p ? p.entregados + p.omitidos : 0
  const fechaTexto = stats ? desdeIso(stats.fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  const valor = (texto: string | number) => (stats ? texto : '—')

  const segmentos = p
    ? [
        { nombre: 'Entregados', n: p.entregados, clase: 'bg-verde' },
        { nombre: 'En camino', n: p.enCamino, clase: 'bg-azul' },
        { nombre: 'Pendientes', n: p.pendientes, clase: 'bg-neutral-300' },
        { nombre: 'Sin venta', n: p.omitidos, clase: 'bg-neutral-500' },
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Hoy</h1>
          <p className="mt-1 text-sm text-apagado first-letter:uppercase">{fechaTexto || 'Cargando…'}</p>
        </div>
        <button
          onClick={() => void cargar()}
          disabled={actualizando}
          title="Actualizar"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-niebla px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-linea focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta disabled:opacity-60"
        >
          <RefreshCw size={16} className={actualizando ? 'animate-spin' : ''} aria-hidden />
          <span className="max-sm:sr-only">{actualizando ? 'Actualizando…' : ultima ? `Actualizado ${ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Actualizar'}</span>
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-rojo/10 p-4 text-sm font-medium text-rojo">
          <span>{error}{stats && ' Los números de abajo son de la última vez.'}</span>
          <button onClick={() => void cargar()} className="shrink-0 font-semibold underline underline-offset-2">Reintentar</button>
        </div>
      )}

      {!!stats?.clientes.sinVendedor && (
        <button
          onClick={() => onNavegar('clientes')}
          className="flex w-full items-center gap-3 rounded-2xl bg-ambar/25 p-4 text-left text-sm transition-colors hover:bg-ambar/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
        >
          <TriangleAlert size={20} className="shrink-0" />
          <span className="flex-1">
            <strong className="font-semibold">
              {stats.clientes.sinVendedor === 1 ? 'Un cliente no tiene vendedor' : `${stats.clientes.sinVendedor} clientes no tienen vendedor`}
            </strong>{' '}
            y no aparece en ninguna ruta.
          </span>
          <span className="flex items-center font-semibold">Asignar <ChevronRight size={16} /></span>
        </button>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Entregas y dinero del día */}
        <section className="rounded-3xl border border-linea p-5 sm:p-6 lg:col-span-2" aria-labelledby="titulo-entregas">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="titulo-entregas" className="text-lg font-semibold">Entregas</h2>
            <span className="text-sm text-apagado tabular-nums">{valor(`${atendidos} de ${porAtender} atendidos`)}</span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-apagado">Cobrado</dt>
              <dd className="mt-0.5 text-3xl font-bold tracking-tight text-verde tabular-nums">{valor(dinero(p?.totalCobrado ?? 0))}</dd>
            </div>
            <div>
              <dt className="text-sm text-apagado">Esperado del día</dt>
              <dd className="mt-0.5 text-3xl font-bold tracking-tight tabular-nums">{valor(dinero(p?.totalEsperado ?? 0))}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-sm text-apagado">Litros del día</dt>
              <dd className="mt-0.5 text-3xl font-bold tracking-tight tabular-nums">{valor(litros(p?.litrosHoy ?? 0))}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-niebla" role="img" aria-label={segmentos.map((s) => `${s.nombre}: ${s.n}`).join(', ')}>
              {segmentos.map((s) => (
                <div key={s.nombre} className={`${s.clase} transition-[width] duration-500 ease-out`} style={{ width: `${pct(s.n, porAtender)}%` }} />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {segmentos.map((s) => (
                <li key={s.nombre} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${s.clase}`} />
                  <span className="text-apagado">{s.nombre}</span>
                  <span className="font-semibold tabular-nums">{s.n}</span>
                </li>
              ))}
              {!!p?.cancelados && (
                <li className="text-apagado">
                  Cancelados <span className="font-semibold text-tinta tabular-nums">{p.cancelados}</span>
                </li>
              )}
            </ul>
            {stats && porAtender === 0 && <p className="mt-4 text-sm text-apagado">No hay pedidos agendados para hoy.</p>}
          </div>
        </section>

        {/* Litros por sabor: lo que hay que tener listo */}
        <section className="rounded-3xl border border-linea p-5 sm:p-6" aria-labelledby="titulo-sabores">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="titulo-sabores" className="text-lg font-semibold">Litros por sabor</h2>
            <button onClick={() => onNavegar('produccion')} className="flex items-center text-sm font-semibold hover:underline underline-offset-2">
              Producción <ChevronRight size={16} />
            </button>
          </div>
          {!stats?.saboresTop.length ? (
            <p className="mt-5 text-sm text-apagado">{stats ? 'Todavía no hay pedidos para hoy.' : '—'}</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {stats.saboresTop.map((s) => (
                <li key={s.sabor}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{s.sabor}</span>
                    <span className="tabular-nums text-apagado">{litros(s.litros)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-niebla">
                    <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ backgroundColor: s.color || '#f472b6', width: `${pct(s.litros, stats.saboresTop[0].litros)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* El negocio en una línea: cada dato abre su sección */}
      <nav aria-label="Secciones" className="grid divide-y divide-linea overflow-hidden rounded-3xl border border-linea sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { seccion: 'equipo' as const, titulo: 'Vendedores activos', dato: stats ? `${stats.vendedores.activos} de ${stats.vendedores.total}` : '—' },
          { seccion: 'clientes' as const, titulo: 'Clientes activos', dato: stats ? String(stats.clientes.activos) : '—' },
          { seccion: 'sabores' as const, titulo: 'Sabores a la venta', dato: stats ? `${stats.productos.disponibles} de ${stats.productos.total}` : '—' },
        ].map((x) => (
          <button
            key={x.seccion}
            onClick={() => onNavegar(x.seccion)}
            className="flex items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-niebla focus-visible:bg-niebla focus-visible:outline-none"
          >
            <span>
              <span className="block text-sm text-apagado">{x.titulo}</span>
              <span className="mt-0.5 block text-2xl font-bold tracking-tight tabular-nums">{x.dato}</span>
            </span>
            <ChevronRight size={20} className="text-apagado" />
          </button>
        ))}
      </nav>
    </div>
  )
}
