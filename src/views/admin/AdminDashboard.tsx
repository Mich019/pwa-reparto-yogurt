import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Brilla } from '../../components/Brillo'
import { BarrasHueso, Esqueleto, EsqueletoLista, Hueso, TextoCargando } from '../../components/Esqueleto'
import { abrirCliente, verSinComprar } from '../pwa/Clientes'
import { BuscarPedidos } from './BuscarPedidos'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, CalendarHeart, ChevronRight, Crown, Flame, RefreshCw, TriangleAlert } from 'lucide-react'
import { Medallas } from '../../components/Medallas'
import type { Rachas } from '../../lib/equipo'
import { abrirFicha } from '../pwa/Equipo'
import { BotonAyuda } from '../ayuda/AyudaRapida'
import { litrosTxt, ordenarPorVentas, saludo, usePedidosRecientes, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DIAS_CORTOS, desdeIso, dinero, hoy, sumarDias } from '../../lib/fechas'
import { cambio, useReporte } from '../../lib/reportes'
import { llamarAutenticado, useSesion } from '../../lib/sesion'
import { enVivoConectado, useEnVivo, useEnVivoConectado } from '../../lib/enVivo'
import type { SeccionAdmin } from './AdminLayout'
import { BarraSegmentada, BarrasPeriodo } from './graficas'
import { useFichaSabor } from './PanelSabor'
import { textoPorUnidad } from '../../lib/unidades'
import { useServidor, type CifrasMes, type Deudor, type FilaCorte } from '../../lib/cobranza'
import { useProducido } from '../../lib/stock'
import { unidadDe } from '../../lib/unidades'
import { ChipEstado, Delta, Subrayado, TarjetaSabor, Vacio } from './piezas'

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
    cantidadesHoy?: Record<string, number> // por unidad (catálogo flexible)
    unidades?: string[] // las de la empresa, L primero
  }
  saboresTop: Array<{
    sabor: string
    color: string
    litros: number
  }>
}

const SABORES_POR_PAGINA = 6
const botonRedondo = 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-niebla text-tinta transition-colors hover:bg-linea focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-40 disabled:hover:bg-niebla'

// Una sección del resumen, sin caja (sin tarjetas): una línea fina arriba, el título y su acción a la derecha.
function Tarjeta({ id, titulo, subtitulo, accion, className = '', children }: { id: string; titulo: string; subtitulo?: ReactNode; accion?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`min-w-0 border-t border-linea pt-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold leading-tight tracking-tight">{titulo}</h2>
          {subtitulo && <p className="mt-1 text-[13px] text-apagado">{subtitulo}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  )
}

// `valor` null: todavía no llega; un hueso del tamaño de la cifra.
function Cifra({ etiqueta, valor, pie }: { etiqueta: string; valor: string | null; pie?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-apagado">{etiqueta}</dt>
      <dd className="mt-1.5">
        {valor === null
          ? <span className="esqueleto block py-1" role="status" aria-label="Cargando"><Hueso className="h-8 w-28 sm:h-9" /></span>
          : <span className="cifra block whitespace-nowrap text-[2rem] sm:text-[2.25rem]"><Brilla valor={valor}>{valor}</Brilla></span>}
        <span className="mt-2 flex min-h-5 items-center gap-1.5 whitespace-nowrap text-xs text-apagado">{pie}</span>
      </dd>
    </div>
  )
}

// Lo urgente del día en dos o tres renglones, cada uno con su enlace. Sólo sale lo que de verdad hay que atender: si no
// hay nada, no se muestra. Urgentes y producción salen de los datos del teléfono (Dexie); los cortes, del servidor.
function QueHacerHoy({ sinVendedor, onNavegar }: { sinVendedor: number; onNavegar: (seccion: SeccionAdmin) => void }) {
  const dia = hoy()
  const manana = sumarDias(dia, 1)
  const urgentes = useLiveQuery(() => db.pedidos.where('fecha').belowOrEqual(dia).filter((p) => !!p.urgente && p.estado === 'PENDIENTE').count(), [dia]) ?? 0
  const porProducir = useLiveQuery(async () => {
    const pedidos = await db.pedidos.where('fecha').equals(manana).filter((p) => p.estado === 'PENDIENTE').toArray()
    const m = new Map<string, number>()
    for (const p of pedidos) for (const it of p.items) m.set(it.productoId, (m.get(it.productoId) ?? 0) + it.litros)
    return m
  }, [manana])
  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const producido = useProducido(manana, manana, true)
  const cortes = useServidor<{ filas: FilaCorte[] }>(`/cortes?fecha=${dia}`).datos
  const descuadres = useServidor<{ cortes: unknown[] }>('/cortes/descuadres').datos
  const deudores = useServidor<{ deudores: Deudor[] }>('/cobranza').datos
  // Activos que ya compraban, sin pedido pendiente y con la última entrega hace más de 30 días (lo mismo que Clientes).
  const sinComprar = useLiveQuery(async () => {
    const hace = sumarDias(dia, -30)
    const ultima = new Map<string, string>()
    const pendiente = new Set<string>()
    await db.pedidos.each((p) => {
      if (p.estado === 'PENDIENTE') pendiente.add(p.clienteId)
      else if (p.estado === 'ENTREGADO' && p.fecha > (ultima.get(p.clienteId) ?? '')) ultima.set(p.clienteId, p.fecha)
    })
    return (await db.clientes.toArray()).filter((c) => c.activo && !pendiente.has(c.id) && (ultima.get(c.id) ?? '9') < hace).length
  }, [dia]) ?? 0

  // Lo que falta producir para mañana: pedidos confirmados menos lo ya anotado en Stock del día (sin red, sin descontar).
  const faltan = [...(porProducir ?? [])]
    .map(([id, pedido]) => ({ producto: productos?.find((x) => x.id === id), falta: pedido - (producido?.get(id) ?? 0) }))
    .filter((x) => x.producto && x.falta > 0.0001)
    .sort((a, b) => b.falta - a.falta)
  const porConfirmar = (cortes?.filas ?? []).filter((c) => c.estado === 'pendiente').length
  const descuadrados = descuadres?.cortes.length ?? 0
  // Fiado vencido: lo más viejo que deben pasa de 30 días y no han abonado en ese tiempo.
  const hace30 = sumarDias(dia, -30)
  const vencidos = (deudores?.deudores ?? []).filter((d) => d.saldo > 0 && d.desde && d.desde < hace30 && (!d.ultimoAbono || d.ultimoAbono.slice(0, 10) < hace30))
  const aCobrar = () => onNavegar('cobranza') // abre en «Por cobrar»
  const aCortes = () => { history.replaceState(history.state, '', `${location.pathname}?ir=cortes${location.hash}`); onNavegar('cobranza') }

  const renglones: { clave: string; texto: string; enlace: string; ir: () => void }[] = []
  if (urgentes) renglones.push({ clave: 'urgentes', texto: urgentes === 1 ? 'Un pedido urgente sin entregar' : `${urgentes} pedidos urgentes sin entregar`, enlace: 'Ver clientes', ir: () => onNavegar('clientes') })
  if (faltan.length) {
    const lista = faltan.slice(0, 2).map((x) => `${litrosTxt(x.falta, unidadDe(x.producto))} de ${x.producto!.sabor.toLowerCase()}`).join(' y ')
    renglones.push({ clave: 'produccion', texto: `Falta producir ${lista}${faltan.length > 2 ? ` y ${faltan.length - 2} sabor${faltan.length > 3 ? 'es' : ''} más` : ''} para mañana`, enlace: 'Ver producción', ir: () => onNavegar('produccion') })
  }
  if (porConfirmar) renglones.push({ clave: 'cortes', texto: porConfirmar === 1 ? 'Un corte por confirmar' : `${porConfirmar} cortes por confirmar`, enlace: 'Ver cortes', ir: aCortes })
  if (descuadrados) renglones.push({ clave: 'descuadres', texto: descuadrados === 1 ? 'Un corte confirmado ya no cuadra' : `${descuadrados} cortes confirmados ya no cuadran`, enlace: 'Ver cortes', ir: aCortes })
  if (vencidos.length) {
    const debe = vencidos.reduce((s, d) => s + d.saldo, 0)
    renglones.push({ clave: 'fiado', texto: `${vencidos.length === 1 ? 'Un cliente debe' : `${vencidos.length} clientes deben`} ${dinero(debe)} de fiado sin abonar en más de 30 días`, enlace: 'Ver por cobrar', ir: aCobrar })
  }
  if (sinComprar) renglones.push({ clave: 'sincomprar', texto: sinComprar === 1 ? 'Un cliente dejó de comprar (más de un mes sin pedido)' : `${sinComprar} clientes dejaron de comprar (más de un mes sin pedido)`, enlace: 'Ver quiénes', ir: () => { verSinComprar(); onNavegar('clientes') } })
  if (sinVendedor) renglones.push({ clave: 'sinvendedor', texto: sinVendedor === 1 ? 'Un cliente sin vendedor (no sale en ninguna ruta)' : `${sinVendedor} clientes sin vendedor (no salen en ninguna ruta)`, enlace: 'Asignar', ir: () => onNavegar('clientes') })
  if (!renglones.length) return null

  return (
    <section aria-labelledby="t-hoy" className="mb-10">
      <h2 id="t-hoy" className="flex items-center gap-2 text-sm font-semibold"><TriangleAlert size={16} className="text-ambar" aria-hidden="true" /> Qué hacer hoy</h2>
      <ul className="mt-2 divide-y divide-linea border-y border-linea">
        {renglones.map((x) => (
          <li key={x.clave}>
            <button type="button" onClick={x.ir} className="group flex w-full items-center gap-3 py-3 text-left text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
              <span className="min-w-0 flex-1">{x.texto}</span>
              <span className="flex shrink-0 items-center text-sm font-semibold group-hover:underline">{x.enlace} <ChevronRight size={16} aria-hidden="true" /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const esperando = <Esqueleto className="mt-4"><BarrasHueso className="h-28" /></Esqueleto>

export function AdminDashboard({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const sesion = useSesion()
  const dia = hoy()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [girando, setGirando] = useState(false) // sólo al tocar «Actualizar»: lo automático no se anuncia
  const enVivo = useEnVivoConectado()
  const [error, setError] = useState<string | null>(null)
  const [ultima, setUltima] = useState<Date | null>(null)
  const [pagina, setPagina] = useState(0)

  // Los últimos 30 días del servidor (los mismos números que Reportes) para las cifras y el gráfico de la semana.
  const rango = useMemo(() => ({ desde: sumarDias(dia, -29), hasta: dia }), [dia])
  const ventas = useReporte(rango, 'dia')
  // Los mismos 14 días hace un año (364 días antes: el mismo día de la semana), como línea gris en «Ventas por día».
  const rangoAnio = useMemo(() => ({ desde: sumarDias(dia, -364 - 13), hasta: sumarDias(dia, -364) }), [dia])
  const anioPasado = useReporte(rangoAnio, 'dia').reporte
  const recargarVentas = ventas.recargar

  // Lo que ya se ve se queda mientras llega lo nuevo: nada parpadea ni dice «actualizando».
  async function cargar() {
    try {
      setStats(await llamarAutenticado<DashboardStats>('/admin/stats'))
      setUltima(new Date())
      setError(null)
    } catch {
      setError('No se pudo traer el resumen. Revisa tu conexión e intenta de nuevo.')
    }
  }
  async function aMano() {
    setGirando(true)
    recargarVentas()
    await cargar()
    setGirando(false)
  }

  // En vivo: cuando cambia un pedido, un cliente o un sabor en la empresa (lib/enVivo.ts). Las ventas (useReporte) se piden solas.
  useEnVivo('datos', () => void cargar())

  // Sin la conexión en vivo (sin señal, o el servidor no la da) se refresca cada minuto mientras se ve. Al volver a la
  // pestaña la conexión en vivo ya avisa de todo.
  useEffect(() => {
    void cargar()
    const reloj = setInterval(() => { if (document.visibilityState === 'visible' && !enVivoConectado()) { void cargar(); recargarVentas() } }, 60_000)
    return () => clearInterval(reloj)
  }, [recargarVentas])

  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const ventasSabor = useVentasPorSabor()
  const ordenados = ordenarPorVentas(productos ?? [], ventasSabor)
  const ficha = useFichaSabor(ordenados)
  const recientes = usePedidosRecientes(5)

  const p = stats?.pedidosHoy
  // Los cancelados no cuentan para el avance: ya no hay que entregarlos.
  const porAtender = p ? p.total - p.cancelados : 0
  const atendidos = p ? p.entregados + p.omitidos : 0
  const avance = porAtender ? Math.round((atendidos / porAtender) * 100) : 0
  const nombre = sesion?.usuario.nombre.split(' ')[0] ?? ''
  const fechaTexto = stats ? desdeIso(stats.fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  const valor = (texto: string) => (stats ? texto : null)

  const reporte = ventas.reporte
  const crecimiento = reporte ? cambio(reporte.resumen.ingreso, reporte.anterior?.resumen.ingreso) : null
  const porDia = new Map((reporte?.periodos ?? []).map((x) => [x.periodo, x]))
  const semana = Array.from({ length: 14 }, (_, i) => {
    const f = sumarDias(dia, i - 13)
    const d = desdeIso(f)
    return {
      clave: f,
      eje: f === dia ? 'Hoy' : `${DIAS_CORTOS[d.getDay()]} ${d.getDate()}`,
      nombre: d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
      valor: porDia.get(f)?.ingreso ?? 0,
      actual: f === dia,
    }
  })
  const totalSemana = semana.reduce((s, x) => s + x.valor, 0)
  const porDiaAntes = new Map((anioPasado?.periodos ?? []).map((x) => [x.periodo, x]))
  const valoresAntes = semana.map((x) => porDiaAntes.get(sumarDias(x.clave, -364))?.ingreso ?? 0)
  const totalAntes = valoresAntes.reduce((s, v) => s + v, 0)
  // Sólo si hace un año hubo ventas (una empresa nueva no tiene con qué comparar).
  const previoSemana = anioPasado && totalAntes > 0 ? {
    valores: valoresAntes,
    nombres: semana.map((x) => desdeIso(sumarDias(x.clave, -364)).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
    leyenda: 'Hace un año',
  } : undefined

  const segmentos = [
    { nombre: 'Entregados', n: p?.entregados ?? 0, color: 'var(--color-serie)' },
    { nombre: 'En camino', n: p?.enCamino ?? 0, color: 'var(--color-oro)' },
    { nombre: 'Pendientes', n: p?.pendientes ?? 0, color: '#c3c1a8' },
    { nombre: 'Sin venta', n: p?.omitidos ?? 0, color: '#8a9186' },
  ]

  const vendidos = ordenados.filter((x) => x.venta.litros > 0)
  const sinVenta = ventasSabor ? ordenados.filter((x) => x.venta.litros <= 0) : []
  const paginas = Math.max(1, Math.ceil(vendidos.length / SABORES_POR_PAGINA))
  const paginaActual = Math.min(pagina, paginas - 1)
  const visibles = vendidos.slice(paginaActual * SABORES_POR_PAGINA, (paginaActual + 1) * SABORES_POR_PAGINA)
  const corto = (f: string) => (f === dia ? 'Hoy' : f === sumarDias(dia, -1) ? 'Ayer' : desdeIso(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', ''))
  const pedidosRecientes = <PedidosRecientes recientes={recientes} corto={corto} onNavegar={onNavegar} />

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <section className="flex flex-col gap-x-12 gap-y-7 pb-8 pt-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.02em] lg:text-[2.25rem]">
            {saludo()},
            <br />
            <Subrayado>{nombre || 'equipo'}</Subrayado>
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-apagado">
            <span className="first-letter:uppercase">{fechaTexto || <TextoCargando ancho="10rem" />}</span>
            <BotonAyuda seccion="resumen" className="-my-2 h-8 w-8" />
            {!enVivo && <button
              type="button"
              onClick={() => void aMano()}
              disabled={girando}
              className="flex items-center gap-1.5 rounded-md py-1 font-medium text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-60"
            >
              <RefreshCw size={14} className={girando ? 'animate-spin' : ''} aria-hidden="true" />
              {ultima ? `Actualizado ${ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Actualizar'}
            </button>}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:flex sm:flex-wrap sm:gap-x-10">
          <Cifra etiqueta="Cobrado hoy" valor={valor(dinero(p?.totalCobrado ?? 0))} pie={stats && p!.totalEsperado > p!.totalCobrado ? `de ${dinero(p!.totalEsperado)} esperados` : undefined} />
          <Cifra
            etiqueta="Ventas, 30 días"
            valor={reporte ? dinero(reporte.resumen.ingreso) : null}
            pie={reporte && crecimiento !== null ? <><Delta valor={crecimiento} /> <span>vs. 30 días antes</span></> : undefined}
          />
          <Cifra etiqueta="Pedidos de hoy" valor={valor(String(porAtender))} />
          <Cifra etiqueta={(p?.unidades ?? ['L']).some((u) => u !== 'L') ? 'Cantidad de hoy' : 'Litros de hoy'} valor={valor(p?.cantidadesHoy ? textoPorUnidad(p.cantidadesHoy, p.unidades) : litrosTxt(p?.litrosHoy ?? 0))} />
        </dl>
      </section>

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-rojo/10 p-4 text-sm font-medium text-rojo">
          <span>{error}{stats && ' Los números de abajo son de la última vez.'}</span>
          <button onClick={() => void cargar()} className="shrink-0 font-semibold underline underline-offset-2">Reintentar</button>
        </div>
      )}

      <QueHacerHoy sinVendedor={stats?.clientes.sinVendedor ?? 0} onNavegar={onNavegar} />

      {/* Filas que llenan el ancho, de lo más importante a lo menos: las ventas (grande) con el avance de hoy, los sabores
          en una sola fila, y los pedidos recientes junto a los vendedores del mes. Sin cajas: secciones con una línea arriba. */}
      <div className="space-y-12 pb-14">
        <div className="grid gap-x-12 gap-y-12 lg:grid-cols-3">
          <Tarjeta id="t-semana" titulo="Ventas por día" className="lg:col-span-2"
            subtitulo={reporte ? `${dinero(totalSemana)} en los últimos 14 días${previoSemana ? ` · ${totalSemana >= totalAntes ? '+' : '−'}${Math.round(Math.abs((totalSemana - totalAntes) / totalAntes) * 100)}% contra hace un año` : ''}` : 'Últimos 14 días'}
            accion={<button type="button" onClick={() => onNavegar('reportes')} className="whitespace-nowrap rounded-md py-1 text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">Ver reportes</button>}>
            <div className="mt-6">
              {ventas.error && !reporte ? (
                <p className="rounded-2xl bg-rojo/10 p-3 text-sm font-medium text-rojo">
                  No se pudieron traer las ventas. <button className="font-semibold underline underline-offset-2" onClick={recargarVentas}>Reintentar</button>
                </p>
              ) : !reporte ? esperando : (
                <BarrasPeriodo previo={previoSemana} datos={semana} formato={dinero} alto={190} descripcion="Ventas entregadas de cada uno de los últimos 14 días" leyenda={['Días previos', 'Hoy']} />
              )}
            </div>
          </Tarjeta>

          <Tarjeta
            id="t-avance"
            titulo="Avance de hoy"
            subtitulo="Pedidos atendidos"
            accion={<button type="button" aria-label="Abrir los reportes" title="Reportes" onClick={() => onNavegar('reportes')} className={botonRedondo}><ArrowUpRight size={18} /></button>}
          >
            {stats ? <p className="cifra mt-5 text-[3.5rem] leading-none"><Brilla valor={avance}>{avance}%</Brilla></p> : <span className="esqueleto mt-5 block" aria-hidden="true"><Hueso className="h-14 w-32" /></span>}
            <p className="mt-3 text-[13px] text-apagado">{stats ? (porAtender ? `${atendidos} de ${porAtender} pedidos` : 'No hay pedidos agendados para hoy') : <TextoCargando ancho="8rem" />}</p>
            <div className="mt-6">
              <BarraSegmentada segmentos={segmentos} descripcion={segmentos.map((s) => `${s.nombre}: ${s.n}`).join(', ')} />
            </div>
            <ul className="mt-5 divide-y divide-linea text-sm">
              {segmentos.map((s) => (
                <li key={s.nombre} className="flex items-center gap-2.5 py-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                  <span className="text-apagado">{s.nombre}</span>
                  <span className="ml-auto font-semibold tabular-nums">{stats ? s.n : <TextoCargando ancho="1.5rem" />}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>

        {/* Los sabores son los productos: se ordenan por los litros que vendieron en 30 días */}
        <Tarjeta
          id="t-sabores"
          titulo="Sabores más vendidos"
          subtitulo={(p?.unidades ?? ['L']).some((u) => u !== 'L') ? 'Lo entregado en los últimos 30 días' : 'Litros entregados en los últimos 30 días'}
          accion={paginas > 1 && (
            <div className="flex gap-2">
              <button type="button" aria-label="Sabores anteriores" disabled={paginaActual === 0} onClick={() => setPagina(paginaActual - 1)} className={botonRedondo}><ArrowLeft size={18} /></button>
              <button type="button" aria-label="Más sabores" disabled={paginaActual === paginas - 1} onClick={() => setPagina(paginaActual + 1)} className={botonRedondo}><ArrowRight size={18} /></button>
            </div>
          )}
        >
          {productos && !ordenados.length ? (
            <Vacio>Todavía no hay sabores. Agrégalos en la sección Sabores.</Vacio>
          ) : (
            <>
              {vendidos.length ? (
                <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {visibles.map((x) => (
                    <li key={x.producto.id}>
                      <TarjetaSabor producto={x.producto} venta={x.venta} posicion={x.posicion} frasco="h-24 xl:h-28" onAbrir={() => ficha.abrir(x.producto.id)} />
                    </li>
                  ))}
                </ul>
              ) : ventasSabor && <p className="mt-6 text-sm text-apagado">Ningún sabor se entregó en los últimos 30 días.</p>}
              {/* Para decidir si se dejan de producir: los que nadie pidió en 30 días, en su propio renglón */}
              {sinVenta.length > 0 && vendidos.length > 0 && (
                <div className="mt-6 border-t border-linea pt-4">
                  <p className="text-sm">
                    <span className="font-semibold">Sin ventas en 30 días</span>
                    <span className="text-apagado"> · si siguen así, puedes dejar de producirlos</span>
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {sinVenta.map((x) => (
                      <li key={x.producto.id}>
                        <button type="button" onClick={() => ficha.abrir(x.producto.id)}
                          className="flex items-center gap-2 rounded-full bg-niebla py-1.5 pl-2.5 pr-3.5 text-sm transition-colors hover:bg-linea focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: x.producto.color_hex }} aria-hidden="true" />
                          {x.producto.sabor}
                          {x.venta.litrosAntes > 0 && <span className="text-xs text-apagado">vendía {litrosTxt(x.venta.litrosAntes, unidadDe(x.producto))} antes</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Tarjeta>

        <div className="grid items-start gap-x-12 gap-y-12 lg:grid-cols-2">
          {/* Dos columnas parejas: pedidos y clientes a la izquierda, vendedores a la derecha. */}
          <div className="space-y-12">
            {pedidosRecientes}
            <MejoresClientes onNavegar={onNavegar} />
          </div>
          <div className="space-y-12">
            <RankingMes onNavegar={onNavegar} />
            <MedallasDelMes onNavegar={onNavegar} />
          </div>
        </div>

        <ResumenDelAnio onNavegar={onNavegar} />
      </div>

      {ficha.panel}
    </div>
  )
}

// Los 5 clientes que más compraron en el mes (lo entregado, con los datos del dispositivo) y cómo van contra el mismo
// tramo del mes pasado. Tocar uno abre su ficha en Clientes.
function MejoresClientes({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const dia = hoy()
  const inicio = `${dia.slice(0, 8)}01`
  const antes = desdeIso(inicio)
  antes.setMonth(antes.getMonth() - 1)
  const inicioAntes = `${antes.getFullYear()}-${String(antes.getMonth() + 1).padStart(2, '0')}-01`
  const hastaAntes = sumarDias(inicioAntes, Number(dia.slice(8)) - 1)
  const datos = useLiveQuery(async () => {
    const [pedidos, clientes] = await Promise.all([
      db.pedidos.where('fecha').between(inicioAntes, dia, true, true).filter((p) => p.estado === 'ENTREGADO').toArray(),
      db.clientes.toArray(),
    ])
    const suma = new Map<string, { ahora: number; antes: number; pedidos: number }>()
    for (const p of pedidos) {
      const s = suma.get(p.clienteId) ?? { ahora: 0, antes: 0, pedidos: 0 }
      if (p.fecha >= inicio) { s.ahora += p.total; s.pedidos++ } else if (p.fecha <= hastaAntes) s.antes += p.total
      suma.set(p.clienteId, s)
    }
    const nombre = new Map(clientes.map((c) => [c.id, c.nombre]))
    return [...suma.entries()].filter(([, s]) => s.ahora > 0).sort((a, b) => b[1].ahora - a[1].ahora).slice(0, 5)
      .map(([id, s]) => ({ id, nombre: nombre.get(id) ?? 'Cliente', ...s }))
  }, [dia, inicio, inicioAntes, hastaAntes])
  if (!datos?.length) return null
  return (
    <Tarjeta id="t-mejores" titulo="Mejores clientes del mes" subtitulo="Lo entregado este mes, contra lo mismo del mes pasado">
      <ol className="mt-4 divide-y divide-linea border-y border-linea">
        {datos.map((c, i) => (
          <li key={c.id}>
            <button type="button" onClick={() => { abrirCliente(c.id); onNavegar('clientes') }}
              className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-niebla/60 focus-visible:outline-2 focus-visible:outline-marca">
              <span className="w-5 shrink-0 text-sm font-semibold text-apagado tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.nombre}</span>
                <span className="block text-xs text-apagado">{c.pedidos} {c.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold tabular-nums">{dinero(c.ahora)}</span>
                {c.antes > 0 && <span className="block text-xs"><Delta valor={cambio(c.ahora, c.antes)} /></span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Tarjeta>
  )
}

function PedidosRecientes({ recientes, corto, onNavegar }: { recientes: ReturnType<typeof usePedidosRecientes>; corto: (f: string) => string; onNavegar: (seccion: SeccionAdmin) => void }) {
  const [buscar, setBuscar] = useState(false)
  const enlace = 'rounded-md py-1 text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
  return (
        <Tarjeta
          id="t-pedidos"
          titulo="Pedidos recientes"
          accion={<span className="flex gap-4">
            <button type="button" onClick={() => setBuscar(true)} className={enlace}>Buscar pedidos</button>
            <button type="button" onClick={() => onNavegar('reportes')} className={enlace}>Ver reportes</button>
          </span>}
        >
          {buscar && <BuscarPedidos onCerrar={() => setBuscar(false)} onCliente={(id) => { setBuscar(false); abrirCliente(id); onNavegar('clientes') }} />}
          {recientes && !recientes.length ? (
            <Vacio>Cuando haya pedidos aparecen aquí.</Vacio>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-apagado">
                <tr>
                  <th scope="col" className="w-full pb-2 text-left font-medium">Cliente</th>
                  <th scope="col" className="pb-2 pl-3 text-right font-medium">Total</th>
                  <th scope="col" className="pb-2 pl-4 text-left font-medium">Estado</th>
                  <th scope="col" className="hidden pb-2 pl-4 text-right font-medium sm:table-cell">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {(recientes ?? []).map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="max-w-0 py-3 text-left font-semibold">
                      <span className="block truncate">{r.cliente}</span>
                      <span className="block text-xs font-normal text-apagado sm:hidden">{corto(r.fecha)}</span>
                    </th>
                    <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold tabular-nums">{dinero(r.total)}</td>
                    <td className="py-3 pl-4"><ChipEstado estado={r.estado} /></td>
                    <td className="hidden whitespace-nowrap py-3 pl-4 text-right text-apagado tabular-nums sm:table-cell">{corto(r.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
  )
}

// Vendedores del mes, de quien más vendió a quien menos, con su avance contra la meta. Sólo el administrador ve esta
// pantalla; las cifras son las del cierre de mes en vivo (GET /cierres/:mes).
// En diciembre (el año en curso) y en enero (el que acaba de terminar): el año en números (AnioEnNumeros, también en
// Cobranza → Meses para cualquier año).
function ResumenDelAnio({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const [a, m] = hoy().slice(0, 7).split('-').map(Number)
  const anio = m === 12 ? a : m === 1 ? a - 1 : null
  const r = useServidor<ResumenAnio>(anio ? `/cierres/anio/${anio}` : null, 'cobranza').datos
  if (!anio || !r || !r.meses.length) return null
  return (
    <Tarjeta id="t-anio" titulo={`Tu ${anio} en números`} subtitulo={`Con ${r.meses.length} ${r.meses.length === 1 ? 'mes cerrado' : 'meses cerrados'}${m === 12 ? '; diciembre se suma al cerrarlo' : ''}`}
      accion={<CalendarHeart size={20} className="text-marca" aria-hidden="true" />}>
      <AnioEnNumeros r={r} onFicha={(id) => { abrirFicha(id); onNavegar('equipo') }} />
    </Tarjeta>
  )
}

// Las cifras del año (GET /cierres/anio/:anio): lo vendido mes a mes, el mes más vendido, el vendedor del año y la mejor
// racha. Tocar a una persona abre su ficha.
export interface ResumenAnio {
  anio: number
  meses: { mes: string; ventas: number }[]
  total: number
  mesMasVendido: { mes: string; ventas: number } | null
  vendedorDelAnio: { id: string; nombre: string; ventas: number } | null
  mejorRacha: { id: string; nombre: string; meses: number } | null
  anterior: { anio: number; meses: number; total: number; actual: number } | null
}
export function AnioEnNumeros({ r, onFicha }: { r: ResumenAnio; onFicha: (id: string) => void }) {
  const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'long' })
  const tope = Math.max(1, ...r.meses.map((x) => x.ventas))
  const ficha = onFicha
  const dato = 'desplegar-opcion rounded-md border-l-2 border-linea py-1 pl-3'
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div className={dato}>
          <p className="text-xs text-apagado">Vendido en el año</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{dinero(r.total)}</p>
          {r.anterior && r.anterior.total > 0 && (() => {
            const pct = Math.round(((r.anterior.actual - r.anterior.total) / r.anterior.total) * 100)
            return (
              <p className="mt-0.5 text-xs" title={`${dinero(r.anterior.actual)} contra ${dinero(r.anterior.total)} en los mismos ${r.anterior.meses} meses de ${r.anterior.anio}`}>
                <span className={`font-semibold ${pct > 0 ? 'text-verde' : pct < 0 ? 'text-rojo' : ''}`}>{pct > 0 ? '+' : ''}{pct}%</span>
                <span className="text-apagado"> contra {r.anterior.anio}</span>
              </p>
            )
          })()}
        </div>
        {r.mesMasVendido && (
          <div className={dato} style={{ animationDelay: '40ms' }}>
            <p className="text-xs text-apagado">Mes más vendido</p>
            <p className="mt-1 font-semibold capitalize">{nombreMes(r.mesMasVendido.mes)}</p>
            <p className="text-sm tabular-nums text-apagado">{dinero(r.mesMasVendido.ventas)}</p>
          </div>
        )}
        {r.vendedorDelAnio && (
          <button type="button" onClick={() => ficha(r.vendedorDelAnio!.id)} style={{ animationDelay: '80ms' }}
            className={`${dato} text-left transition-[transform,background-color] duration-150 hover:bg-niebla active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100`}>
            <p className="flex items-center gap-1 text-xs text-apagado"><Crown size={13} aria-hidden="true" className="text-marca" /> Vendedor del año</p>
            <p className="mt-1 truncate font-semibold">{r.vendedorDelAnio.nombre}</p>
            <p className="text-sm tabular-nums text-apagado">{dinero(r.vendedorDelAnio.ventas)}</p>
          </button>
        )}
        {r.mejorRacha && (
          <button type="button" onClick={() => ficha(r.mejorRacha!.id)} style={{ animationDelay: '120ms' }}
            className={`${dato} text-left transition-[transform,background-color] duration-150 hover:bg-niebla active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100`}>
            <p className="flex items-center gap-1 text-xs text-apagado"><Flame size={13} aria-hidden="true" className="text-marca" /> Mejor racha</p>
            <p className="mt-1 truncate font-semibold">{r.mejorRacha.nombre}</p>
            <p className="text-sm text-apagado">{r.mejorRacha.meses} {r.mejorRacha.meses === 1 ? 'mes' : 'meses seguidos'} en su meta</p>
          </button>
        )}
      </div>
      <ol className="mt-10 flex h-20 items-end gap-1" aria-label="Lo vendido en cada mes cerrado">
        {r.meses.map((x) => (
          // Al pasar el mouse (o al enfocarla con el teclado o tocarla) sale un globito con el mes y la cifra.
          <li key={x.mes} tabIndex={0} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-marca">
            <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 translate-y-1 whitespace-nowrap rounded-lg bg-tinta px-2.5 py-1.5 text-center text-xs text-papel opacity-0 shadow-tarjeta transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100 motion-reduce:transition-none"
              style={{ bottom: `${Math.max(3, (x.ventas / tope) * 100)}%` }}>
              <span className="block capitalize">{nombreMes(x.mes)}</span>
              <span className="block font-semibold tabular-nums">{dinero(x.ventas)}</span>
            </span>
            <span className={`w-full max-w-8 rounded-t-md transition-[filter] duration-150 group-hover:brightness-110 ${x.mes === r.mesMasVendido?.mes ? 'bg-marca' : 'bg-marca/40'}`} style={{ height: `${Math.max(3, (x.ventas / tope) * 100)}%` }} />
            <span className="text-[10px] capitalize text-apagado">{nombreMes(x.mes).slice(0, 3)}</span>
            <span className="sr-only">{dinero(x.ventas)}</span>
          </li>
        ))}
      </ol>
    </>
  )
}

// Quién ganó una medalla con el mes pasado (3, 6 o 12 meses seguidos en su meta): sólo aparece si alguien la ganó, es
// decir, una vez cerrado ese mes. Tocar a alguien abre su ficha, desde donde se le puede felicitar.
function MedallasDelMes({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const rachas = useServidor<Rachas>('/usuarios/rachas', 'cobranza').datos
  const pasado = moverMes(hoy().slice(0, 7), -1)
  const ganadas = Object.entries(rachas ?? {}).flatMap(([id, r]) => r.medallas.filter((m) => m.mes === pasado).map((m) => ({ id, nombre: r.nombre, medalla: m.medalla })))
  if (!ganadas.length) return null
  const nombreMes = new Date(`${pasado}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'long' })
  return (
    <Tarjeta id="t-medallas" titulo={`Medallas de ${nombreMes}`} subtitulo="Llegaron a su meta varios meses seguidos. Un buen momento para felicitarlos.">
      <ul className="mt-3 flex flex-wrap gap-2">
        {ganadas.map((g, i) => (
          <li key={`${g.id}-${g.medalla}`} className="medalla-nueva" style={{ animationDelay: `${i * 60}ms` }}>
            <button type="button" onClick={() => { abrirFicha(g.id); onNavegar('equipo') }}
              className="flex items-center gap-2 rounded-full bg-niebla py-1.5 pl-1.5 pr-3.5 text-sm transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100">
              <Medallas mejorRacha={g.medalla} soloMejor />
              <span className="font-semibold">{g.nombre}</span>
              <span className="text-apagado">{g.medalla === 12 ? '1 año' : `${g.medalla} meses`}</span>
            </button>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

// Con las flechas se ven los meses anteriores (hasta dos años): los cerrados con la foto de su cierre.
const MESES_ATRAS = 24
const moverMes = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const f = new Date(a, m - 1 + n, 1)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
}
const TOP_RANKING = 5

// ▲2 en verde si subió dos lugares contra el mes anterior, ▼1 en rojo si bajó; igual o nuevo, nada.
function CambioDeLugar({ antes, ahora }: { antes?: number; ahora: number }) {
  if (antes === undefined || antes === ahora) return null
  const subio = antes > ahora, n = Math.abs(antes - ahora)
  const texto = `${subio ? 'Subió' : 'Bajó'} ${n} ${n === 1 ? 'lugar' : 'lugares'} contra el mes anterior`
  return (
    <span title={texto} className={`flex items-center text-xs font-semibold tabular-nums ${subio ? 'text-verde' : 'text-rojo'}`}>
      {subio ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}<span aria-hidden="true">{n}</span><span className="sr-only"> {texto}</span>
    </span>
  )
}

function RankingMes({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const yo = useSesion()?.usuario.id
  const actual = hoy().slice(0, 7)
  const [atras, setAtras] = useState(0)
  const [todos, setTodos] = useState(false)
  const mes = moverMes(actual, -atras)
  const r = useServidor<{ cifras: CifrasMes }>(`/cierres/${mes}`, ['datos', 'cobranza', 'equipo'])
  // La racha de hoy (meses seguidos en la meta hasta el mes pasado) y la mejor medalla de cada quien.
  const rachas = useServidor<Rachas>('/usuarios/rachas', 'cobranza').datos ?? {}
  const ordenar = (c?: CifrasMes) => (c?.vendedores ?? []).filter((v) => v.activo || v.ventas > 0).sort((a, b) => b.ventas - a.ventas)
  const filas = ordenar(r.datos?.cifras.mes === mes ? r.datos.cifras : undefined)
  // El lugar de cada quien el mes anterior, para la flechita (sube o baja de lugar). Quien no vendió ese mes no lleva.
  const mesAntes = moverMes(mes, -1)
  const previo = useServidor<{ cifras: CifrasMes }>(`/cierres/${mesAntes}`, ['datos', 'cobranza']).datos?.cifras
  const lugarAntes = new Map(previo?.mes === mesAntes ? ordenar(previo).filter((v) => v.ventas > 0).map((v, i) => [v.id, i] as const) : [])
  const nombreMes = new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', atras ? { month: 'long', year: 'numeric' } : { month: 'long' })
  const flecha = `grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-niebla disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca`
  return (
    <Tarjeta
      id="t-ranking"
      titulo={atras ? 'Vendedores de ese mes' : 'Vendedores del mes'}
      subtitulo={`Lo vendido en ${nombreMes} y cómo le fue a cada quien con su meta`}
      accion={
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAtras(atras + 1)} disabled={atras >= MESES_ATRAS} aria-label="Mes anterior" title="Mes anterior" className={flecha}><ArrowLeft size={16} /></button>
          <button type="button" onClick={() => setAtras(atras - 1)} disabled={atras === 0} aria-label="Mes siguiente" title="Mes siguiente" className={flecha}><ArrowRight size={16} /></button>
          <button type="button" onClick={() => onNavegar('equipo')} className="ml-2 whitespace-nowrap rounded-md py-1 text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">Ver vendedores</button>
        </div>
      }
    >
      {r.error && !r.datos ? (
        <p className="mt-3 rounded-2xl bg-rojo/10 p-3 text-sm font-medium text-rojo">No se pudo traer el mes. <button className="font-semibold underline underline-offset-2" onClick={r.recargar}>Reintentar</button></p>
      ) : !r.datos || r.datos.cifras.mes !== mes ? (
        <EsqueletoLista filas={4} inicio="avatar" className="mt-3" />
      ) : !filas.length ? (
        <Vacio>{atras ? 'Ese mes no hubo ventas de vendedores.' : 'Cuando tus vendedores entreguen pedidos este mes aparecen aquí.'}</Vacio>
      ) : (
        // Los primeros 5; con más vendedores, el resto se despliega aquí mismo (si no, empuja todo lo de abajo).
        <>
        <ol className="mt-2 divide-y divide-linea">
          {filas.map((v, i) => {
            // Cerrado: los primeros 5 y, si quien mira vende y quedó más abajo, su renglón tras unos puntos.
            const mio = v.id === yo
            if (!todos && i >= TOP_RANKING && !mio) return null
            const pct = v.meta ? Math.round(v.cumplimientoPct ?? 0) : null
            return (
              <Fragment key={v.id}>
              {!todos && mio && i > TOP_RANKING && <li aria-hidden="true" className="py-1 pl-3 text-apagado">⋮</li>}
              <li className={`flex items-center gap-3 py-2.5 ${mio ? '-mx-2 rounded-md bg-marca/8 px-2' : ''}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ${i === 0 && v.ventas > 0 ? 'bg-marca text-white' : 'bg-niebla text-apagado'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold">{v.nombre}</span>
                      {mio && <span className="shrink-0 rounded-full bg-marca px-1.5 text-[0.6875rem] font-bold text-white">Tú</span>}
                      {(rachas[v.id]?.racha ?? 0) >= 2 && (
                        <span title={`${rachas[v.id].racha} meses seguidos en su meta`} className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-marca">
                          <Flame size={13} aria-hidden="true" />{rachas[v.id].racha}<span className="sr-only"> meses seguidos en su meta</span>
                        </span>
                      )}
                      <Medallas mejorRacha={rachas[v.id]?.mejorRacha ?? 0} soloMejor />
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <CambioDeLugar antes={lugarAntes.get(v.id)} ahora={i} />
                      <span className="font-semibold tabular-nums">{dinero(v.ventas)}</span>
                    </span>
                  </div>
                  {pct !== null ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-niebla" role="progressbar" aria-label={`${v.nombre}: ${pct}% de su meta`} aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-verde' : 'bg-marca'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-right text-xs text-apagado tabular-nums">{pct}% de {dinero(v.meta!)}</span>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-apagado">{v.pedidos} {v.pedidos === 1 ? 'pedido' : 'pedidos'} · sin meta</p>
                  )}
                </div>
              </li>
              </Fragment>
            )
          })}
        </ol>
        {filas.length > TOP_RANKING && (
          <button type="button" onClick={() => setTodos(!todos)} aria-expanded={todos}
            className="mt-1 rounded-md py-1.5 text-sm font-semibold text-apagado hover:text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
            {todos ? 'Ver sólo los primeros 5' : `Ver a los ${filas.length} vendedores`}
          </button>
        )}
        </>
      )}
    </Tarjeta>
  )
}
