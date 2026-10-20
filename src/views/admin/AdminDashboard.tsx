import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  IceCreamBowl,
  MapPin,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users
} from 'lucide-react'
import { dinero } from '../../lib/fechas'
import { llamarAutenticado, useSesion } from '../../lib/sesion'

export interface DashboardStats {
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

export function AdminDashboard({
  onNavegar,
}: {
  onNavegar: (seccion: 'equipo' | 'clientes' | 'produccion' | 'sabores') => void
}) {
  const sesion = useSesion()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date>(new Date())

  async function cargarStats(mostrarSpinner = false) {
    if (mostrarSpinner) setActualizando(true)
    setError(null)
    try {
      const data = await llamarAutenticado<DashboardStats>('/admin/stats')
      setStats(data)
      setUltimaActualizacion(new Date())
    } catch {
      setError('No se pudieron obtener las métricas del servidor')
    } finally {
      setCargando(false)
      setActualizando(false)
    }
  }

  useEffect(() => {
    void cargarStats()
    // Refrescar cada 60 segundos automáticamente mientras está en pantalla
    const timer = setInterval(() => void cargarStats(), 60_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto space-y-8 animate-fadeIn">
      {/* Cabecera con saludo, estado en vivo y botón de recarga */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-linea pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-tinta text-white px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
              <ShieldCheck size={12} /> Panel Central
            </span>
            <span className="text-xs text-apagado">
              Actualizado {ultimaActualizacion.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-tinta">
            Bienvenido, {sesion?.usuario.nombre.split(' ')[0] ?? 'Administrador'}
          </h1>
          <p className="mt-1 text-sm text-apagado">
            Métricas operativas en tiempo real conectadas a PostgreSQL Supabase.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void cargarStats(true)}
            disabled={actualizando}
            className="flex items-center gap-2 rounded-xl border border-linea bg-papel px-3.5 py-2 text-xs font-semibold text-tinta shadow-sm transition-all hover:border-tinta active:scale-95 disabled:opacity-50"
            title="Recargar datos de la base de datos"
          >
            <RefreshCw size={14} className={actualizando ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>

          <div className="flex items-center gap-2 rounded-xl bg-verde/10 px-3.5 py-2 text-xs font-semibold text-verde">
            <CheckCircle2 size={15} />
            <span>PostgreSQL Conectado</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rojo/10 border border-rojo/20 p-4 text-sm text-rojo font-medium flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => void cargarStats(true)}
            className="text-xs font-bold underline hover:opacity-80"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Tarjetas de métricas principales (100% dinámicas desde PostgreSQL) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Vendedores */}
        <div
          onClick={() => onNavegar('equipo')}
          className="group cursor-pointer rounded-3xl border border-linea bg-papel p-5 shadow-sm transition-all hover:border-tinta hover:shadow-tarjeta"
        >
          <div className="flex items-center justify-between text-apagado group-hover:text-tinta">
            <span className="text-xs font-bold uppercase tracking-wider">Vendedores</span>
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {cargando ? '—' : stats?.vendedores.activos ?? 0}
            </span>
            <span className="text-xs text-apagado">
              activos {stats ? `de ${stats.vendedores.total}` : ''}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-apagado">
            <Users size={14} className="text-azul" />
            <span>Gestión de carteras y accesos</span>
          </div>
        </div>

        {/* Cartera de Clientes */}
        <div
          onClick={() => onNavegar('clientes')}
          className="group cursor-pointer rounded-3xl border border-linea bg-papel p-5 shadow-sm transition-all hover:border-tinta hover:shadow-tarjeta"
        >
          <div className="flex items-center justify-between text-apagado group-hover:text-tinta">
            <span className="text-xs font-bold uppercase tracking-wider">Clientes Activos</span>
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {cargando ? '—' : stats?.clientes.activos ?? 0}
            </span>
            <span className="text-xs text-apagado">
              {stats?.clientes.sinVendedor ? `${stats.clientes.sinVendedor} sin asignar` : 'cartera total'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-apagado">
            <MapPin size={14} className="text-verde" />
            <span>Clientes registrados en sistema</span>
          </div>
        </div>

        {/* Pedidos del día */}
        <div
          onClick={() => onNavegar('produccion')}
          className="group cursor-pointer rounded-3xl border border-linea bg-papel p-5 shadow-sm transition-all hover:border-tinta hover:shadow-tarjeta"
        >
          <div className="flex items-center justify-between text-apagado group-hover:text-tinta">
            <span className="text-xs font-bold uppercase tracking-wider">Pedidos Hoy</span>
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {cargando ? '—' : stats?.pedidosHoy.total ?? 0}
            </span>
            <span className="text-xs text-apagado">
              {stats?.pedidosHoy.entregados ? `${stats.pedidosHoy.entregados} entregados` : 'en ruta'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-apagado">
            <Truck size={14} className="text-azul" />
            <span>
              {stats?.pedidosHoy.pendientes ? `${stats.pedidosHoy.pendientes} pendientes` : 'Entregas del día'}
            </span>
          </div>
        </div>

        {/* Sabores y Catálogo */}
        <div
          onClick={() => onNavegar('sabores')}
          className="group cursor-pointer rounded-3xl border border-linea bg-papel p-5 shadow-sm transition-all hover:border-tinta hover:shadow-tarjeta"
        >
          <div className="flex items-center justify-between text-apagado group-hover:text-tinta">
            <span className="text-xs font-bold uppercase tracking-wider">Sabores</span>
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {cargando ? '—' : stats?.productos.disponibles ?? 0}
            </span>
            <span className="text-xs text-apagado">
              {stats?.pedidosHoy.litrosHoy ? `${stats.pedidosHoy.litrosHoy} L hoy` : 'disponibles'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-apagado">
            <IceCreamBowl size={14} className="text-ambar" />
            <span>Catálogo y costos por litro</span>
          </div>
        </div>
      </div>

      {/* Resumen de Producción y Finanzas del Día */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Desglose de Pedidos y Cobranza */}
        <div className="rounded-3xl border border-linea bg-papel p-6 shadow-sm space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-tinta">Balance Operativo de Hoy</h2>
              <p className="text-xs text-apagado">Corte de entregas y recaudación financiera del día</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-niebla text-tinta">
              <DollarSign size={20} />
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="rounded-2xl bg-niebla/60 p-4">
              <div className="text-xs font-medium text-apagado">Total Esperado</div>
              <div className="mt-1 text-xl font-extrabold text-tinta">
                {dinero(stats?.pedidosHoy.totalEsperado ?? 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-verde/10 p-4">
              <div className="text-xs font-medium text-verde">Cobrado Real</div>
              <div className="mt-1 text-xl font-extrabold text-verde">
                {dinero(stats?.pedidosHoy.totalCobrado ?? 0)}
              </div>
            </div>

            <div className="rounded-2xl bg-niebla/60 p-4">
              <div className="text-xs font-medium text-apagado">Litros del Día</div>
              <div className="mt-1 text-xl font-extrabold text-tinta">
                {stats?.pedidosHoy.litrosHoy ?? 0} L
              </div>
            </div>

            <div className="rounded-2xl bg-niebla/60 p-4">
              <div className="text-xs font-medium text-apagado">Completados</div>
              <div className="mt-1 text-xl font-extrabold text-tinta">
                {stats?.pedidosHoy.total
                  ? `${Math.round(((stats.pedidosHoy.entregados) / stats.pedidosHoy.total) * 100)}%`
                  : '0%'}
              </div>
            </div>
          </div>

          {/* Barra de progreso de entregas */}
          <div className="pt-2">
            <div className="flex justify-between text-xs font-semibold mb-2 text-apagado">
              <span>Progreso de ruta</span>
              <span>
                {stats?.pedidosHoy.entregados ?? 0} de {stats?.pedidosHoy.total ?? 0} entregados
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-niebla overflow-hidden flex">
              <div
                style={{
                  width: `${stats?.pedidosHoy.total ? (stats.pedidosHoy.entregados / stats.pedidosHoy.total) * 100 : 0}%`,
                }}
                className="bg-verde transition-all duration-500"
              />
              <div
                style={{
                  width: `${stats?.pedidosHoy.total ? (stats.pedidosHoy.enCamino / stats.pedidosHoy.total) * 100 : 0}%`,
                }}
                className="bg-azul transition-all duration-500"
              />
              <div
                style={{
                  width: `${stats?.pedidosHoy.total ? (stats.pedidosHoy.pendientes / stats.pedidosHoy.total) * 100 : 0}%`,
                }}
                className="bg-neutral-300 transition-all duration-500"
              />
            </div>
            <div className="flex items-center gap-4 text-[11px] text-apagado mt-2 font-medium">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-verde" /> Entregados</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-azul" /> En camino</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-neutral-300" /> Pendientes</span>
            </div>
          </div>
        </div>

        {/* Sabores más pedidos hoy */}
        <div className="rounded-3xl border border-linea bg-papel p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-tinta">Demanda por Sabor</h2>
              <p className="text-xs text-apagado">Producción necesaria hoy</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-niebla text-tinta">
              <IceCreamBowl size={20} />
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {!stats?.saboresTop.length ? (
              <div className="py-8 text-center text-xs text-apagado">
                No hay pedidos registrados para la fecha de hoy.
              </div>
            ) : (
              stats.saboresTop.map((sabor) => (
                <div key={sabor.sabor} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: sabor.color || '#f472b6' }}
                      />
                      {sabor.sabor}
                    </span>
                    <span className="text-apagado">{sabor.litros} L</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-niebla overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        backgroundColor: sabor.color || '#f472b6',
                        width: `${stats.pedidosHoy.litrosHoy ? (sabor.litros / stats.pedidosHoy.litrosHoy) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Accesos directos a módulos administrativos */}
      <div className="rounded-3xl border border-linea bg-niebla/40 p-6 sm:p-8 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-tinta">Módulos Administrativos</h2>
          <p className="text-xs text-apagado">
            Gestiona de forma centralizada el personal, las rutas de clientes y el catálogo de producción.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-2">
          <button
            onClick={() => onNavegar('equipo')}
            className="flex items-center justify-between rounded-2xl bg-papel border border-linea p-4 text-left font-semibold shadow-sm transition-all hover:border-tinta active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta">
                <Users size={20} />
              </span>
              <div>
                <div className="text-sm">Vendedores</div>
                <div className="text-[11px] text-apagado font-normal">Altas, bajas y cartera</div>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-apagado" />
          </button>

          <button
            onClick={() => onNavegar('clientes')}
            className="flex items-center justify-between rounded-2xl bg-papel border border-linea p-4 text-left font-semibold shadow-sm transition-all hover:border-tinta active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta">
                <MapPin size={20} />
              </span>
              <div>
                <div className="text-sm">Clientes</div>
                <div className="text-[11px] text-apagado font-normal">Directorio y reasignación</div>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-apagado" />
          </button>

          <button
            onClick={() => onNavegar('produccion')}
            className="flex items-center justify-between rounded-2xl bg-papel border border-linea p-4 text-left font-semibold shadow-sm transition-all hover:border-tinta active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta">
                <BarChart3 size={20} />
              </span>
              <div>
                <div className="text-sm">Producción</div>
                <div className="text-[11px] text-apagado font-normal">Litros por fabricar</div>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-apagado" />
          </button>

          <button
            onClick={() => onNavegar('sabores')}
            className="flex items-center justify-between rounded-2xl bg-papel border border-linea p-4 text-left font-semibold shadow-sm transition-all hover:border-tinta active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta">
                <IceCreamBowl size={20} />
              </span>
              <div>
                <div className="text-sm">Sabores y Precios</div>
                <div className="text-[11px] text-apagado font-normal">Costos y márgenes</div>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-apagado" />
          </button>
        </div>
      </div>
    </div>
  )
}
