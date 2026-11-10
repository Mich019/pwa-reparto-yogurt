import { useEffect, useState, type ReactNode } from 'react'
import { descargar, xlsx } from '../../lib/xlsx'
import { Resaltar } from '../../components/Busqueda'
import { coincide, limpiarBusqueda } from '../../lib/busqueda'
import { BotonWhatsApp, EditorMensaje, MandarATodos, textoCobro, useMensaje } from '../../components/Mensajes'
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Lock, LockOpen, TriangleAlert } from 'lucide-react'
import {
  cerrarMes, confirmarCorte, mandarInformePorCorreo, entregarCorte, reabrirCorte, exportarInforme, reabrirMes, textoMes, useServidor,
  type Descuadre, type Deudor, type EnvasesClientes, type FilaCorte, type InformeMes, type MesCierre, pasoSuLimite } from '../../lib/cobranza'
import { dinero, hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { textoPorUnidad } from '../../lib/unidades'
import { usePaginas } from '../../components/Paginas'
import { CuentaAbierta } from '../../components/CuentaDelCliente'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'
import { BuscadorDesplegable, Delta, Encabezado, botonPanel, botonPanelIcono, botonPanelSuave, grupoPanel } from './piezas'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { cambio } from '../../lib/reportes'
import { Selector } from '../../components/Selector'
import { mostrarPdf } from '../../components/VisorPdf'
import { AnioEnNumeros, type ResumenAnio } from './AdminDashboard'
import { abrirFicha } from '../pwa/Equipo'
import type { SeccionAdmin } from './menu'
import { BarrasHueso, CifrasHueso, Esqueleto, EsqueletoLista, FilasHueso, Hueso, Ocupado } from '../../components/Esqueleto'

// Finanzas del panel (antes «Cobranza»; el id de la sección sigue siendo `cobranza`): quién debe, quién tiene envases prestados, el corte de cada día y el cierre de cada mes con su
// informe. Todo viene del servidor y necesita conexión.

type Parte = 'cobrar' | 'envases' | 'cortes' | 'meses'

// `?ir=cortes` (lo pone el aviso de un corte que ya no cuadra) abre Finanzas → Cortes del día.
// `?ir=cobrar` (el aviso de fiado de más de un mes) abre Por cobrar sólo con quienes deben desde hace más de 30 días;
// AdminLayout quita el parámetro de la dirección y deja la marca aquí.
let cobrarViejos = false
export const marcarCobrarViejos = () => { cobrarViejos = true }
export const irACortes = () => new URLSearchParams(location.search).get('ir') === 'cortes'
// `corto`: en el teléfono, para que las cuatro quepan en una fila. `detalle`: qué es cada una, bajo el título.
const PARTES: { id: Parte; texto: string; corto?: string; detalle: string }[] = [
  { id: 'cobrar', texto: 'Por cobrar', detalle: 'Quién te debe, cuánto y desde cuándo. Toca a un cliente para registrar lo que te pague.' },
  { id: 'envases', texto: 'Envases', detalle: 'Garrafones, botellas y demás envases retornables que tus clientes no han devuelto.' },
  { id: 'cortes', texto: 'Cortes del día', corto: 'Cortes', detalle: 'El efectivo que cada vendedor debe entregar al terminar el día contra el que entregó.' },
  { id: 'meses', texto: 'Cierre de mes', corto: 'Cierre', detalle: 'Ventas, utilidad, comisiones y cortes de cada mes; ciérralo para que ya no cambie y baja su informe.' },
]

// Los cortes de hoy (para la franja) y cuántos piden atención: los de hoy por confirmar más los confirmados que ya no
// cuadran. Lo usan el numerito de «Cortes del día» y el del menú del panel (AdminLayout).
// `activo` en falso (sin sesión de administrador) no pregunta nada.
export function useCortesPorAtender(activo = true) {
  const cortesHoy = useServidor<{ fecha: string; filas: FilaCorte[] }>(activo ? `/cortes?fecha=${hoy()}` : null).datos
  const descuadres = useServidor<{ cortes: Descuadre[] }>(activo ? '/cortes/descuadres' : null).datos
  return { cortesHoy, porAtender: (cortesHoy?.filas ?? []).filter((f) => f.estado === 'pendiente').length + (descuadres?.cortes.length ?? 0) }
}

export function Cobranza({ onNavegar, cortes }: { onNavegar?: (s: SeccionAdmin) => void; cortes: ReturnType<typeof useCortesPorAtender> }) {
  const [parte, setParte] = useState<Parte>(() => {
    if (!irACortes()) return 'cobrar'
    history.replaceState(history.state, '', location.pathname + location.hash) // que al recargar no vuelva a saltar
    return 'cortes'
  })
  const [q, setQ] = useState('')
  const { cortesHoy, porAtender } = cortes
  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <Encabezado titulo="Finanzas" ayuda="cobranza" detalle={PARTES.find((p) => p.id === parte)?.detalle}>
        {parte === 'cobrar' && <BuscadorDesplegable valor={q} onChange={setQ} placeholder="Buscar cliente" clave="cobranza" />}
        <div className={grupoPanel} role="group" aria-label="Apartado" data-seccion="finanzas-pestanas">
          {PARTES.map((p) => (
            <button key={p.id} onClick={() => setParte(p.id)} aria-pressed={parte === p.id} className={`${parte === p.id ? botonPanel : botonPanelSuave} max-sm:px-3`}>
              {p.corto ? <><span className="sm:hidden">{p.corto}</span><span className="max-sm:hidden">{p.texto}</span></> : p.texto}
              {p.id === 'cortes' && porAtender > 0 && (
                <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-ambar px-1.5 text-xs font-bold tabular-nums text-tinta"
                  aria-label={porAtender === 1 ? 'uno por atender' : `${porAtender} por atender`}>{porAtender}</span>
              )}
            </button>
          ))}
        </div>
      </Encabezado>
      <FranjaFinanzas cortesHoy={cortesHoy?.filas} onElegir={setParte} />
      {parte === 'cobrar' && <PorCobrar q={q} />}
      {parte === 'envases' && <Envases />}
      {parte === 'cortes' && <Cortes />}
      {parte === 'meses' && <Meses onNavegar={onNavegar} />}
    </div>
  )
}

// Cuatro cifras de un vistazo, entre dos líneas (sin tarjetas): lo que te deben, el efectivo de hoy que falta
// confirmar, los envases prestados y lo vendido en el mes. Cada una lleva a su pestaña.
function FranjaFinanzas({ cortesHoy, onElegir }: { cortesHoy?: FilaCorte[]; onElegir: (p: Parte) => void }) {
  const deben = useServidor<{ total: number; deudores: Deudor[] }>('/cobranza').datos
  const envases = useServidor<EnvasesClientes>('/envases').datos
  const mes = hoy().slice(0, 7)
  const cifras = useServidor<InformeMes>(`/cierres/${mes}`, ['datos', 'cobranza']).datos?.cifras
  const sinConfirmar = (cortesHoy ?? []).filter((f) => f.estado !== 'confirmado')
  const efectivoHoy = (cortesHoy ?? []).reduce((s, f) => s + (f.entregado ?? f.esperado), 0)
  // Entregado y por confirmar: lo que dijo el vendedor; sin entregar todavía: lo que debe traer.
  const falta = sinConfirmar.reduce((s, f) => s + (f.entregado ?? f.esperado), 0)
  const cobradoMes = cifras ? cifras.cobro.efectivo + cifras.cobro.transferencia + cifras.abonos.total : 0
  // Del 1 a hoy contra del 1 al mismo día del mes pasado (o su último día, si es más corto).
  const dia = hoy()
  const mesAntes = sumarDias(`${mes}-01`, -1).slice(0, 7)
  const hastaAntes = `${mesAntes}-${String(Math.min(Number(dia.slice(8)), Number(sumarDias(`${mes}-01`, -1).slice(8)))).padStart(2, '0')}`
  const tramo = useLiveQuery(async () => {
    let ahora = 0, antes = 0
    await db.pedidos.where('fecha').between(`${mesAntes}-01`, dia, true, true).each((p) => {
      if (p.estado !== 'ENTREGADO') return
      if (p.fecha >= `${mes}-01`) ahora += p.total
      else if (p.fecha <= hastaAntes) antes += p.total
    })
    return { ahora, antes }
  }, [mes, mesAntes, dia, hastaAntes])
  const crecimiento = tramo && tramo.antes > 0 ? cambio(tramo.ahora, tramo.antes) : null
  const nombreAntes = textoMes(mesAntes).split(' ')[0].toLowerCase()
  const items: { parte: Parte; etiqueta: string; valor: string | null; pie: ReactNode }[] = [
    { parte: 'cobrar', etiqueta: 'Te deben', valor: deben ? dinero(deben.total) : null,
      pie: !deben ? '' : deben.deudores.length ? `${deben.deudores.length} ${deben.deudores.length === 1 ? 'cliente' : 'clientes'}` : 'Nadie te debe' },
    { parte: 'cortes', etiqueta: 'Efectivo de hoy por confirmar', valor: cortesHoy ? dinero(falta) : null,
      pie: !cortesHoy ? '' : !cortesHoy.length ? 'Nadie ha vendido hoy' : falta > 0 ? `de ${dinero(efectivoHoy)} del día` : sinConfirmar.length ? 'Sin efectivo por entregar' : 'Todo confirmado' },
    { parte: 'envases', etiqueta: 'Envases prestados', valor: envases ? envases.total.toLocaleString('es-MX') : null,
      pie: !envases ? '' : envases.clientes.length ? `en ${envases.clientes.length} ${envases.clientes.length === 1 ? 'cliente' : 'clientes'}` : 'Todos devueltos' },
    { parte: 'meses', etiqueta: `Vendido en ${textoMes(mes).split(' ')[0].toLowerCase()}`, valor: cifras ? dinero(cifras.ventas.ingreso) : null,
      pie: crecimiento !== null ? <><Delta valor={crecimiento} /> <span>vs. {nombreAntes} a esta fecha</span></> : cifras ? `cobrado ${dinero(cobradoMes)}` : '' },
  ]
  return (
    <section aria-label="Finanzas de un vistazo" aria-busy={items.some((c) => c.valor === null)} className="mb-6 border-y border-linea py-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {items.map((c) => (
          <button key={c.parte} type="button" onClick={() => onElegir(c.parte)}
            className="min-w-0 rounded-md text-left transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-marca">
            <span className="block truncate text-[13px] text-apagado">{c.etiqueta}</span>
            <span className="mt-1 block">
              {c.valor === null
                ? <span className="esqueleto block py-1" aria-hidden="true"><Hueso className="h-7 w-28 max-w-full sm:h-8" /></span>
                : <span className="cifra block truncate text-2xl sm:text-[1.75rem]">{c.valor}</span>}
              <span className="mt-1 flex min-h-5 items-center gap-1 truncate whitespace-nowrap text-xs text-apagado">{c.pie}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// `esqueleto`: la forma de la pestaña mientras carga (por omisión, una lista con su total arriba).
// El cierre de mes mientras llega: (los meses en botones,) el título, sus cifras y la tabla de vendedores.
function EsqueletoMes({ chips = false }: { chips?: boolean }) {
  return (
    <Esqueleto className="space-y-6">
      {chips && <div className="flex gap-2 overflow-hidden">{[0, 1, 2, 3].map((i) => <Hueso key={i} className="h-10 w-32 shrink-0" />)}</div>}
      <span className="block space-y-2"><Hueso className="h-7 w-48" /><Hueso className="h-3.5 w-28" /></span>
      <CifrasHueso className="border-y border-linea py-5" />
      <FilasHueso filas={4} inicio="avatar" />
    </Esqueleto>
  )
}

function Estado({ cargando, error, vacio, children, esqueleto }: { cargando: boolean; error: string; vacio?: string; children: ReactNode; esqueleto?: ReactNode }) {
  if (error) return <p role="alert" className="py-12 text-center text-sm font-medium text-rojo">{error}</p>
  if (cargando) return <>{esqueleto ?? <EsqueletoLista resumen />}</>
  if (vacio) return <p className="py-12 text-center text-apagado">{vacio}</p>
  return <>{children}</>
}

const Fila = ({ onClick, children }: { onClick?: () => void; children: ReactNode }) => (
  <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 border-b border-linea px-1 py-3.5 text-left enabled:hover:bg-niebla/60">{children}</button>
)

// ---- Por cobrar
// `q`: el buscador del encabezado (cliente o vendedor); el total sigue siendo el de todos.
function PorCobrar({ q }: { q: string }) {
  const lista = useServidor<{ total: number; deudores: Deudor[] }>('/cobranza')
  const [abierto, setAbierto] = useState<string | null>(null)
  const deudores = lista.datos?.deudores ?? []
  const t = limpiarBusqueda(q)
  // `?ir=cobrar` (el aviso de fiado de más de un mes) abre con «Más de un mes» puesto.
  const [viejos, setViejos] = useState(() => cobrarViejos)
  const [pasados, setPasados] = useState(false)
  useEffect(() => { cobrarViejos = false }, []) // sólo la primera vez que se abre (no al volver a la sección)
  const limite = sumarDias(hoy(), -30)
  const [orden, setOrden] = useState<'saldo' | 'antiguo' | 'nombre'>('saldo')
  const filtrados = deudores.filter((d) => coincide(t, d.nombre, d.vendedor) && (!viejos || (!!d.desde && d.desde < limite)) && (!pasados || pasoSuLimite(d)))
  if (orden === 'antiguo') filtrados.sort((a, b) => (a.desde ?? '9').localeCompare(b.desde ?? '9'))
  else if (orden === 'nombre') filtrados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const vista = usePaginas(filtrados, 30, `${t}|${viejos}|${pasados}|${orden}`)
  const hayPasados = deudores.some(pasoSuLimite)
  // Los que se ven (con la búsqueda), en el orden de la lista; en el navegador (lib/xlsx.ts).
  function exportar() {
    descargar(xlsx({
      nombre: 'Por cobrar',
      columnas: [{ titulo: 'Cliente', ancho: 30 }, { titulo: 'Vendedor', ancho: 22 }, { titulo: 'Teléfono', ancho: 16 }, { titulo: 'Debe desde', ancho: 14 }, { titulo: 'Saldo', dinero: true, ancho: 14 }, { titulo: 'Límite de fiado', dinero: true, ancho: 14 }, { titulo: 'Pasó su límite', ancho: 12 }],
      filas: filtrados.map((d) => [d.nombre, d.vendedor ?? 'Sin vendedor', d.telefono ?? '', d.desde ?? '', d.saldo, d.limite ?? null, d.limite == null ? 'Sin límite' : pasoSuLimite(d) ? 'Sí' : 'No']),
      total: ['Total', `${filtrados.length} ${filtrados.length === 1 ? 'cliente' : 'clientes'}`, null, null, filtrados.reduce((s, d) => s + d.saldo, 0), null, `${filtrados.filter(pasoSuLimite).length} lo pasaron`],
    }), `por-cobrar-${hoy()}.xlsx`)
  }
  const cobro = useMensaje('cobro')
  const msjLimite = useMensaje('limite')
  const [editar, setEditar] = useState(false)
  const [mandados, setMandados] = useState<Set<string>>(new Set())
  return (
    <Estado cargando={lista.cargando && !lista.datos} error={lista.error} vacio={lista.datos && !deudores.length ? 'Nadie te debe nada.' : undefined}>
      {lista.datos && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
            <p className="text-sm text-apagado">Total por cobrar <span className="ml-1 text-xl font-semibold tabular-nums text-tinta">{dinero(lista.datos.total)}</span> · {deudores.length} {deudores.length === 1 ? 'cliente' : 'clientes'}</p>
            <span className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={exportar} disabled={!filtrados.length} className="py-1 text-sm font-semibold underline-offset-2 hover:underline disabled:opacity-40">Bajar a Excel</button>
              <button type="button" onClick={() => setEditar(!editar)} aria-expanded={editar} className="py-1 text-sm font-semibold underline-offset-2 hover:underline">{editar ? 'Listo' : 'Mensaje para cobrar'}</button>
            </span>
          </div>
          {editar && <div className="desplegar mb-4 max-w-xl space-y-4"><EditorMensaje tipo="cobro" />{hayPasados && <EditorMensaje tipo="limite" />}</div>}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setViejos(!viejos)} aria-pressed={viejos} className={viejos ? botonPanel : botonPanelSuave}>Más de un mes{viejos ? ` (${filtrados.length})` : ''}</button>
            {(hayPasados || pasados) && <button type="button" onClick={() => setPasados(!pasados)} aria-pressed={pasados} className={pasados ? botonPanel : botonPanelSuave}>Pasaron su límite{pasados ? ` (${filtrados.length})` : ''}</button>}
            <Selector valor={orden} onCambiar={setOrden} etiqueta="Ordenar" className={`${claseInput} w-48`}
              opciones={[{ valor: 'saldo', texto: 'Más deuda primero' }, { valor: 'antiguo', texto: 'Debe desde hace más' }, { valor: 'nombre', texto: 'Por nombre' }]} />
            <MandarATodos lista={filtrados.map((d) => ({ id: d.id, nombre: d.nombre, telefono: d.telefono, texto: textoCobro(d, cobro, msjLimite, pasoSuLimite(d), dinero) }))}
              mandados={mandados} onEnviar={(id) => setMandados((m) => new Set(m).add(id))} />
          </div>
          <div ref={vista.ancla} className="scroll-mt-4">
            {vista.visibles.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Fila onClick={() => setAbierto(d.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold"><Resaltar texto={d.nombre} t={t} /></span>
                      <span className="block truncate text-sm text-apagado">{d.vendedor ? <Resaltar texto={d.vendedor} t={t} /> : 'Sin vendedor'}{d.desde && ` · desde el ${textoFecha(d.desde).toLowerCase()}`}</span>
                      {pasoSuLimite(d) && <span className="block truncate text-sm font-semibold text-rojo">Pasó su límite de {dinero(d.limite!)}</span>}
                    </span>
                    <span className={`font-semibold tabular-nums ${pasoSuLimite(d) ? 'text-rojo' : ''}`}>{dinero(d.saldo)}</span>
                    <ChevronRight size={18} className="shrink-0 text-apagado/60" />
                  </Fila>
                </div>
                {d.telefono && <BotonWhatsApp chico telefono={d.telefono} texto={textoCobro(d, cobro, msjLimite, pasoSuLimite(d), dinero)} enviado={mandados.has(d.id)} onEnviar={() => setMandados((m) => new Set(m).add(d.id))} />}
              </div>
            ))}
            {t && !filtrados.length && <p className="py-8 text-center text-sm text-apagado">Nadie coincide con la búsqueda.</p>}
            {vista.control}
          </div>
        </>
      )}
      {abierto && <CuentaAbierta tipo="abono" clienteId={abierto} onCerrar={() => setAbierto(null)} onHecho={lista.recargar} />}
    </Estado>
  )
}

// ---- Envases
function Envases() {
  const lista = useServidor<EnvasesClientes>('/envases')
  const [abierto, setAbierto] = useState<string | null>(null)
  const clientes = lista.datos?.clientes ?? []
  const vista = usePaginas(clientes, 30)
  return (
    <Estado cargando={lista.cargando && !lista.datos} error={lista.error} vacio={lista.datos && !clientes.length ? 'Nadie tiene envases prestados.' : undefined}>
      {lista.datos && (
        <>
          <p className="pb-3 text-sm text-apagado">
            Prestados <span className="ml-1 text-xl font-semibold tabular-nums text-tinta">{lista.datos.total}</span>
            {lista.datos.productos.length > 0 && ` · ${lista.datos.productos.map((p) => `${p.prestados} de ${p.sabor}`).join(', ')}`}
          </p>
          <div ref={vista.ancla} className="scroll-mt-4">
            {vista.visibles.map((c) => (
              <Fila key={c.id} onClick={() => setAbierto(c.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.nombre}</span>
                  <span className="block truncate text-sm text-apagado">{c.envases.map((e) => `${e.prestados} de ${e.sabor}`).join(', ')}</span>
                </span>
                <span className="font-semibold tabular-nums">{c.total}</span>
                <ChevronRight size={18} className="shrink-0 text-apagado/60" />
              </Fila>
            ))}
            {vista.control}
          </div>
        </>
      )}
      {abierto && <CuentaAbierta tipo="envases" clienteId={abierto} onCerrar={() => setAbierto(null)} onHecho={lista.recargar} />}
    </Estado>
  )
}

// ---- Cortes
const ETIQUETA_CORTE = { sin_corte: 'Sin entregar', pendiente: 'Por confirmar', confirmado: 'Confirmado' } as const

function Cortes() {
  const [fecha, setFecha] = useState(hoy)
  const lista = useServidor<{ fecha: string; filas: FilaCorte[] }>(`/cortes?fecha=${fecha}`)
  const [captura, setCaptura] = useState<FilaCorte | null>(null)
  const [reabriendo, setReabriendo] = useState<FilaCorte | null>(null)
  const descuadres = useServidor<{ cortes: Descuadre[] }>('/cortes/descuadres')
  const otros = (descuadres.datos?.cortes ?? []).filter((d) => d.fecha !== fecha)
  const recargar = () => { lista.recargar(); descuadres.recargar() }
  const filas = lista.datos?.filas ?? []
  const [confirmando, setConfirmando] = useState<string | null>(null)
  // Entregados por confirmar que cuadran al centavo (y sin cambios después): se confirman uno por uno, de un toque.
  const cuadran = filas.filter((f) => f.estado === 'pendiente' && f.diferencia === 0 && f.cambioDespues === null)
  async function confirmarTodos() {
    setConfirmando('todos')
    let hechos = 0
    try {
      for (const f of cuadran) { await confirmarCorte(f.id); hechos++ }
      aviso(`${hechos} cortes confirmados`)
    } catch (e) {
      aviso(`${hechos ? `${hechos} confirmados; ` : ''}${e instanceof Error ? e.message : 'no se pudo confirmar'}`)
    } finally {
      setConfirmando(null)
      recargar()
    }
  }
  async function confirmar(f: FilaCorte) {
    setConfirmando(f.id)
    try {
      const r = await confirmarCorte(f.id)
      aviso(r.diferencia === 0 ? 'Corte confirmado' : `Corte confirmado con ${r.diferencia < 0 ? 'faltante' : 'sobrante'} de ${dinero(Math.abs(r.diferencia))}`)
      recargar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo confirmar')
    } finally {
      setConfirmando(null)
    }
  }
  return (
    <>
      {otros.length > 0 && (
        <div className="mb-4 border-b border-linea pb-4">
          <p className="flex items-start gap-2 text-sm font-medium">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-ambar" aria-hidden="true" />
            {otros.length === 1 ? 'Un corte confirmado cambió' : `${otros.length} cortes confirmados cambiaron`} después de confirmarlo (ventas que llegaron tarde o abonos anulados). Ábrelo y reábrelo para cuadrarlo.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {otros.map((d) => (
              <button key={d.id} onClick={() => setFecha(d.fecha)} className={botonPanelSuave}>
                {textoFecha(d.fecha)} · {d.vendedor} · {d.cambio > 0 ? '+' : '−'}{dinero(Math.abs(d.cambio))}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pb-3">
        <button onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior" className={botonPanelIcono}><ChevronLeft size={18} /></button>
        <span className="min-w-36 text-center font-semibold">{fecha === hoy() ? 'Hoy' : textoFecha(fecha)}</span>
        <button onClick={() => setFecha(sumarDias(fecha, 1))} disabled={fecha >= hoy()} aria-label="Día siguiente" className={botonPanelIcono}><ChevronRight size={18} /></button>
      </div>
      {cuadran.length >= 2 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linea px-1 pb-3">
          <p className="text-sm text-apagado">{cuadran.length} cortes entregaron justo lo que debían.</p>
          <button type="button" onClick={() => void confirmarTodos()} disabled={!!confirmando} className={botonPanel}>
            {confirmando === 'todos' ? <Ocupado texto="Confirmando…" /> : `Confirmar los ${cuadran.length} que cuadran`}
          </button>
        </div>
      )}
      <Estado cargando={lista.cargando && !lista.datos} error={lista.error} vacio={lista.datos && !filas.length ? 'Nadie vendió este día.' : undefined} esqueleto={<EsqueletoLista filas={4} />}>
        {filas.map((f) => (
          <div key={f.vendedorId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linea px-1 py-3.5">
            <span className="min-w-0 flex-1 basis-40">
              <span className="block truncate font-semibold">{f.vendedor}</span>
              <span className="block text-sm text-apagado">
                Debe entregar {dinero(f.esperado)}
                {f.entregado !== null && ` · entregó ${dinero(f.entregado)}`}
                {f.diferencia !== null && f.diferencia !== 0 && <span className="font-semibold text-rojo"> · {f.diferencia < 0 ? 'faltan' : 'sobran'} {dinero(Math.abs(f.diferencia))}</span>}
              </span>
              {(f.credito > 0 || f.transferencias > 0) && (
                <span className="block text-sm text-apagado">
                  Aparte del efectivo: {f.credito > 0 && <span className="font-semibold text-tinta">fiado {dinero(f.credito)}</span>}{f.credito > 0 && f.transferencias > 0 && ' · '}{f.transferencias > 0 && `transferencias ${dinero(f.transferencias)}`}
                </span>
              )}
              {f.nota && <span className="block text-sm text-apagado">“{f.nota}”</span>}
              {f.reabierto && <span className="block text-sm text-apagado">Reabierto: {f.reabierto.motivo}</span>}
              {f.cambioDespues !== null && (
                <span className="mt-0.5 flex items-start gap-1.5 text-sm font-medium">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-ambar" aria-hidden="true" />
                  Cambió después de confirmarlo: ahora debía {dinero(f.esperado + f.cambioDespues)} ({f.cambioDespues > 0 ? '+' : '−'}{dinero(Math.abs(f.cambioDespues))}). Reábrelo para cuadrarlo.
                </span>
              )}
            </span>
            <span className="text-sm text-apagado">{ETIQUETA_CORTE[f.estado]}</span>
            {f.estado === 'pendiente' && <button onClick={() => confirmar(f)} disabled={confirmando === f.id} className={botonPanel}>Confirmar</button>}
            {f.estado === 'sin_corte' && <button onClick={() => setCaptura(f)} className={botonPanelSuave}>Capturar</button>}
            {f.estado === 'confirmado' && <button onClick={() => setReabriendo(f)} className={f.cambioDespues !== null ? botonPanel : botonPanelSuave}><LockOpen size={16} aria-hidden="true" />Reabrir</button>}
          </div>
        ))}
      </Estado>
      {captura && <HojaCaptura fila={captura} onCerrar={() => setCaptura(null)} onHecho={recargar} />}
      {reabriendo && <HojaReabrirCorte fila={reabriendo} onCerrar={() => setReabriendo(null)} onHecho={recargar} />}
    </>
  )
}

// Reabrir un corte confirmado: vuelve a «Por confirmar», lo que debe entregar se recalcula y el vendedor puede corregirlo.
function HojaReabrirCorte({ fila, onCerrar, onHecho }: { fila: FilaCorte; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    setEnviando(true)
    try {
      await reabrirCorte(fila.id, motivo.trim())
      aviso('Corte reabierto')
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo reabrir')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Reabrir corte<div className="text-base font-medium text-apagado">{fila.vendedor} · {textoFecha(fila.fecha)}</div></div>}
      pie={<Boton onClick={enviar} disabled={enviando || motivo.trim().length < 5} className="w-full text-lg">Reabrir corte</Boton>}>
      <div className="space-y-4 pb-4">
        <p className="text-sm leading-relaxed text-apagado">
          Vuelve a quedar por confirmar: lo que debe entregar se calcula otra vez con las ventas y abonos de ese día, y el vendedor puede
          corregir lo que entregó. Queda registrado quién lo reabrió y por qué.
        </p>
        <Campo etiqueta="Motivo">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className={claseInput} autoFocus placeholder="Ej. llegó tarde un cobro en efectivo" />
        </Campo>
      </div>
    </Hoja>
  )
}

function HojaCaptura({ fila, onCerrar, onHecho }: { fila: FilaCorte; onCerrar: () => void; onHecho: () => void }) {
  const [monto, setMonto] = useState(String(fila.esperado))
  const [enviando, setEnviando] = useState(false)
  const valor = Number(monto)
  const valido = monto.trim() !== '' && Number.isFinite(valor) && valor >= 0
  async function guardar() {
    setEnviando(true)
    try {
      await entregarCorte({ efectivoEntregado: valor, fecha: fila.fecha, vendedorId: fila.vendedorId })
      aviso('Corte capturado')
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo capturar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Capturar corte<div className="text-base font-medium text-apagado">{fila.vendedor} · {textoFecha(fila.fecha)}</div></div>}
      pie={<Boton onClick={guardar} disabled={!valido || enviando} className="w-full text-lg">Guardar</Boton>}>
      <div className="pb-4">
        <Campo etiqueta={`Efectivo entregado (debía ${dinero(fila.esperado)})`}>
          <input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(',', '.'))} className={claseInput} autoFocus />
        </Campo>
      </div>
    </Hoja>
  )
}

// ---- Meses
const ETIQUETA_MES = { abierto: 'Abierto', cerrado: 'Cerrado', reabierto: 'Reabierto' } as const

function Meses({ onNavegar }: { onNavegar?: (s: SeccionAdmin) => void }) {
  const lista = useServidor<{ meses: MesCierre[] }>('/cierres')
  const [mes, setMes] = useState<string | null>(null)
  const meses = lista.datos?.meses ?? []
  const elegido = mes ?? meses.find((m) => !m.actual)?.mes ?? meses[0]?.mes ?? null
  return (
    <Estado cargando={lista.cargando && !lista.datos} error={lista.error} vacio={lista.datos && !meses.length ? 'Todavía no hay ventas.' : undefined} esqueleto={<EsqueletoMes chips />}>
      <div className="flex gap-2 overflow-x-auto pb-4" role="group" aria-label="Mes">
        {meses.map((m) => (
          <button key={m.mes} onClick={() => setMes(m.mes)} aria-pressed={elegido === m.mes} className={`${elegido === m.mes ? botonPanel : botonPanelSuave} shrink-0`}>
            {textoMes(m.mes)}
            {m.estado === 'cerrado' && <Lock size={14} aria-label="Cerrado" />}
          </button>
        ))}
      </div>
      {elegido && <DetalleMes key={elegido} mes={elegido} actual={!!meses.find((m) => m.mes === elegido)?.actual} onCambio={lista.recargar} />}
      <ElAnio anios={[...new Set(meses.map((m) => Number(m.mes.slice(0, 4))))]} onNavegar={onNavegar} />
    </Estado>
  )
}

// El año en números, cualquier año con ventas (en el inicio sólo sale en diciembre y enero).
function ElAnio({ anios, onNavegar }: { anios: number[]; onNavegar?: (s: SeccionAdmin) => void }) {
  const [anio, setAnio] = useState<number | null>(null)
  const elegido = anio ?? anios[0] ?? null
  const r = useServidor<ResumenAnio>(elegido ? `/cierres/anio/${elegido}` : null)
  const [generando, setGenerando] = useState(false)
  async function pdfDelAnio(datos: ResumenAnio) {
    setGenerando(true)
    try {
      const pdf = await import('../../lib/reportePdf')
      await pdf.prepararLogoPdf()
      mostrarPdf(pdf.informeAnualPdf(datos), `informe-anual-${datos.anio}.pdf`)
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo generar')
    } finally {
      setGenerando(false)
    }
  }
  if (!elegido) return null
  return (
    <section className="mt-8" aria-labelledby="el-anio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="el-anio" className="text-lg font-semibold">El año en números</h2>
        <div className="flex items-center gap-2">
          {anios.length > 1 && (
            <Selector valor={elegido} onCambiar={setAnio} etiqueta="Año" className={`${claseInput} w-32`}
              opciones={anios.map((a) => ({ valor: a, texto: String(a) }))} />
          )}
          {!!r.datos?.meses.length && (
            <button type="button" onClick={() => void pdfDelAnio(r.datos!)} disabled={generando} className={botonPanelSuave}>
              {generando ? <Ocupado texto="Generando…" /> : <><FileText size={16} aria-hidden="true" /> Descargar PDF</>}
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-apagado">Sólo cuentan los meses cerrados.</p>
      <div className="mt-3 border-t border-linea pt-4">
        {r.error && !r.datos ? <p className="text-sm text-rojo">{r.error}</p>
          : !r.datos ? <Esqueleto><BarrasHueso barras={12} className="h-40" /></Esqueleto>
          : !r.datos.meses.length ? <p className="text-sm text-apagado">Ese año todavía no tiene meses cerrados.</p>
          : <AnioEnNumeros r={r.datos} onFicha={(id) => { abrirFicha(id); onNavegar?.('equipo') }} />}
      </div>
    </section>
  )
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="border-l-2 border-linea py-1 pl-3">
      <div className="text-sm text-apagado">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      {detalle && <div className="mt-0.5 text-xs text-apagado">{detalle}</div>}
    </div>
  )
}

function DetalleMes({ mes, actual, onCambio }: { mes: string; actual: boolean; onCambio: () => void }) {
  const informe = useServidor<InformeMes>(`/cierres/${mes}`)
  const [hoja, setHoja] = useState<'cerrar' | 'reabrir' | null>(null)
  const [exportando, setExportando] = useState<'pdf' | 'xlsx' | null>(null)
  const i = informe.datos
  async function exportar(formato: 'pdf' | 'xlsx') {
    if (!i) return
    setExportando(formato)
    try { await exportarInforme(i, formato) } catch (e) { aviso(e instanceof Error ? e.message : 'No se pudo generar') } finally { setExportando(null) }
  }
  return (
    <Estado cargando={informe.cargando && !i} error={informe.error} esqueleto={<EsqueletoMes />}>
      {i && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div>
              <h2 className="text-2xl font-semibold">{textoMes(mes)}</h2>
              <p className="text-sm text-apagado">{i.estado === 'cerrado' ? `Cerrado el ${textoFecha((i.cerradoEn ?? '').slice(0, 10)).toLowerCase()}` : actual ? 'Mes en curso' : ETIQUETA_MES[i.estado]}</p>
            </div>
            <div className="flex gap-2 max-sm:w-full [&>*]:max-sm:grow">
              <button onClick={() => exportar('pdf')} disabled={!!exportando} className={botonPanelSuave}><FileText size={16} aria-hidden="true" />PDF</button>
              <button onClick={() => exportar('xlsx')} disabled={!!exportando} className={botonPanelSuave}><FileSpreadsheet size={16} aria-hidden="true" />Excel</button>
              {i.estado === 'cerrado'
                ? <button onClick={() => setHoja('reabrir')} className={botonPanelSuave}><LockOpen size={16} aria-hidden="true" />Reabrir</button>
                : !actual && <button onClick={() => setHoja('cerrar')} className={botonPanel}><Lock size={16} aria-hidden="true" />Cerrar mes</button>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Dato titulo="Ventas" valor={dinero(i.cifras.ventas.ingreso)} detalle={`${i.cifras.ventas.pedidos} pedidos${textoPorUnidad(i.cifras.ventas.porUnidad) ? ` · ${textoPorUnidad(i.cifras.ventas.porUnidad)}` : ''}`} />
            <Dato titulo="Utilidad" valor={dinero(i.cifras.ventas.utilidad)} detalle={i.cifras.ventas.margenPct === null ? undefined : `Margen ${i.cifras.ventas.margenPct.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`} />
            <Dato titulo="Por cobrar" valor={dinero(i.cifras.porCobrar.saldo)} detalle={`${i.cifras.porCobrar.clientes} ${i.cifras.porCobrar.clientes === 1 ? 'cliente' : 'clientes'}`} />
            <Dato titulo="Envases prestados" valor={String(i.cifras.envases.prestados)} detalle={`${i.cifras.envases.clientes} ${i.cifras.envases.clientes === 1 ? 'cliente' : 'clientes'}`} />
          </div>

          <section>
            <h3 className="pb-2 font-semibold">Cobrado</h3>
            <p className="text-sm text-apagado">
              Efectivo {dinero(i.cifras.cobro.efectivo)} · transferencias {dinero(i.cifras.cobro.transferencia)} · a fiado {dinero(i.cifras.cobro.credito)} · abonos {dinero(i.cifras.abonos.total)}
            </p>
          </section>

          <section>
            <h3 className="pb-1 font-semibold">Vendedores</h3>
            {i.cifras.vendedores.length === 0 && <p className="text-sm text-apagado">Sin ventas este mes.</p>}
            {i.cifras.vendedores.map((v) => (
              <div key={v.id} className="flex flex-wrap items-baseline gap-x-4 border-b border-linea px-1 py-3">
                <span className="min-w-0 flex-1 basis-40 truncate font-semibold">{v.nombre}</span>
                <span className="tabular-nums">{dinero(v.ventas)}</span>
                <span className="text-sm text-apagado">
                  {v.meta ? `${Math.round(v.cumplimientoPct ?? 0)}% de la meta` : 'Sin meta'}{v.comisionPct > 0 && ` · comisión ${dinero(v.comision)}`}
                </span>
              </div>
            ))}
          </section>

          {i.cifras.cortes.dias > 0 && (
            <section>
              <h3 className="pb-2 font-semibold">Cortes</h3>
              <p className="text-sm text-apagado">
                {i.cifras.cortes.confirmados} confirmados
                {i.cifras.cortes.pendientes + i.cifras.cortes.sinCorte > 0 && ` · ${i.cifras.cortes.pendientes + i.cifras.cortes.sinCorte} sin confirmar`}
                {i.cifras.cortes.diferencia !== 0 && ` · diferencia ${i.cifras.cortes.diferencia < 0 ? 'de' : 'a favor'} ${dinero(Math.abs(i.cifras.cortes.diferencia))}`}
              </p>
            </section>
          )}

          {i.historial.length > 0 && (
            <section>
              <h3 className="pb-2 font-semibold">Historial</h3>
              {i.historial.map((h, n) => (
                <p key={n} className="text-sm text-apagado">{textoFecha(h.en.slice(0, 10))} · {h.accion === 'cerrado' ? 'Cerrado' : `Reabierto: ${h.motivo}`}</p>
              ))}
            </section>
          )}
          {i.estado === 'cerrado' && <p className="text-sm text-apagado">Con el mes cerrado no se pueden cambiar ventas, abonos ni cortes de esos días.</p>}
        </div>
      )}
      {hoja === 'cerrar' && <HojaCierre mes={mes} reabrir={false} onCerrar={() => setHoja(null)} onHecho={() => { informe.recargar(); onCambio() }} />}
      {hoja === 'reabrir' && <HojaCierre mes={mes} reabrir onCerrar={() => setHoja(null)} onHecho={() => { informe.recargar(); onCambio() }} />}
    </Estado>
  )
}

function HojaCierre({ mes, reabrir, onCerrar, onHecho }: { mes: string; reabrir: boolean; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    setEnviando(true)
    try {
      if (reabrir) await reabrirMes(mes, motivo.trim())
      else {
        const r = await cerrarMes(mes)
        // El informe por correo sale aparte: si falla, el mes ya quedó cerrado.
        if (r.porCorreo > 0) {
          void mandarInformePorCorreo(mes)
            .then((x) => aviso(`Informe del mes enviado por correo a ${x.enviados === 1 ? '1 administrador' : `${x.enviados} administradores`}`))
            .catch((e) => aviso(`El mes se cerró, pero el informe no salió por correo: ${e instanceof Error ? e.message : 'intenta más tarde'}`))
        }
      }
      aviso(reabrir ? 'Mes reabierto' : 'Mes cerrado')
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo completar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={`${reabrir ? 'Reabrir' : 'Cerrar'} ${textoMes(mes).toLowerCase()}`}
      pie={<Boton onClick={enviar} disabled={enviando || (reabrir && motivo.trim().length < 5)} className="w-full text-lg">{reabrir ? 'Reabrir mes' : 'Cerrar mes'}</Boton>}>
      <div className="space-y-4 pb-4">
        <p className="text-sm leading-relaxed text-apagado">
          {reabrir
            ? 'Mientras esté abierto se podrán corregir ventas, abonos y cortes de ese mes. Queda registrado quién lo reabrió y por qué.'
            : 'Se guardan las cifras del mes tal como están y ya no se podrán cambiar ventas, abonos ni cortes de esos días. Puedes reabrirlo si hace falta.'}
        </p>
        {reabrir && (
          <Campo etiqueta="Motivo">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className={claseInput} autoFocus />
          </Campo>
        )}
      </div>
    </Hoja>
  )
}
