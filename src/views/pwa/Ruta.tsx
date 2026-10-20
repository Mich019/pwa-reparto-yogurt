import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Banknote, Bell, Box, Check, CheckCircle2, ChevronRight, ChevronUp, CircleSlash, Clock, Copy, Map as MapIcon, MessageCircle, Moon,
  Navigation, Pencil, Phone, PlusCircle, RefreshCw, ScanLine, Smartphone, Sparkles, StickyNote, Sun, WifiOff, X, ArrowRight,
} from 'lucide-react'
import { db, guardar, uid, type Cliente, type Pedido } from '../../lib/db'
import { dinero, hoy, iso, textoFecha } from '../../lib/fechas'
import { calcularRuta, distancia, enlaceNavegar, ubicacionActual, type Punto, type Ruta as RutaCalc } from '../../lib/ruteo'
import { cargarDemo } from '../../lib/demo'
import { baseDelUltimoPedido } from '../../lib/codigos'
import { Mapa, type Pin } from './Mapa'
import { IconoSabor } from '../../components/Fruta'
import { EditorPedido } from './EditorPedido'
import { aCantidades, type Cantidades } from './SelectorSabores'
import { Accion, Boton, Hoja, Segmentado, aviso, telLimpio } from '../../components/ui'

const Escaner = lazy(() => import('./Escaner'))

const CLAVE_RUTA = 'ruta-del-dia'
interface RutaGuardada extends RutaCalc { fecha: string; claves: string }

function leerRuta(): RutaGuardada | null {
  try {
    const r = JSON.parse(localStorage.getItem(CLAVE_RUTA) ?? 'null') as RutaGuardada | null
    return r?.fecha === hoy() ? r : null
  } catch {
    return null
  }
}

function useEnLinea() {
  const [en, setEn] = useState(navigator.onLine)
  useEffect(() => {
    const a = () => setEn(true), b = () => setEn(false)
    addEventListener('online', a)
    addEventListener('offline', b)
    return () => { removeEventListener('online', a); removeEventListener('offline', b) }
  }, [])
  return en
}

function useUbicacion() {
  const [yo, setYo] = useState<Punto | null>(null)
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => setYo([p.coords.longitude, p.coords.latitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return yo
}

export function Ruta({ irAClientes }: { irAClientes: () => void }) {
  const fecha = hoy()
  const pedidosHoy = useLiveQuery(() => db.pedidos.where('fecha').equals(fecha).toArray(), [fecha])
  const clientes = useLiveQuery(() => db.clientes.toArray(), [])
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const recordatorios = useLiveQuery(() => db.recordatorios.filter((r) => !r.hecho).toArray(), []) ?? []
  const enLinea = useEnLinea()
  const yo = useUbicacion()
  const yoRef = useRef(yo)
  yoRef.current = yo

  const [ruta, setRuta] = useState<RutaGuardada | null>(leerRuta)
  const [calculando, setCalculando] = useState(false)
  const [elegido, setElegido] = useState<string | null>(null)
  const [expandida, setExpandida] = useState(false)
  const [modo3D, setModo3D] = useState(true)
  const [pago, setPago] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO')
  const [postEntrega, setPostEntrega] = useState<Pedido | null>(null)
  const [paso, setPaso] = useState<'opciones' | 'nuevo'>('opciones')
  const [editor, setEditor] = useState<{ cliente: Cliente; pedido?: Pedido; base?: Cantidades; paraHoy?: boolean } | null>(null)
  const [escaner, setEscaner] = useState(false)
  const [verRecordatorios, setVerRecordatorios] = useState(false)
  const [omitir, setOmitir] = useState<Pedido | null>(null)

  const porId = useMemo(() => new Map((clientes ?? []).map((c) => [c.id, c])), [clientes])
  const prodPorId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const pendientes = useMemo(
    () => (pedidosHoy ?? []).filter((p) => p.estado === 'PENDIENTE' && porId.get(p.clienteId)?.activo),
    [pedidosHoy, porId],
  )
  const claves = useMemo(() => pendientes.map((p) => p.id).sort().join(','), [pendientes])

  // Calcula (o recalcula) la ruta cuando cambia el conjunto de pedidos pendientes (RF-030, RF-031).
  const recalcular = useCallback(async (forzar = false) => {
    if (!clientes) return
    const actual = leerRuta()
    if (!forzar && actual?.claves === claves) return setRuta(actual)
    if (!pendientes.length) {
      setRuta(null)
      return localStorage.removeItem(CLAVE_RUTA)
    }
    // Sin red: conserva el orden ya calculado (con sus calles) y sólo quita lo ya atendido.
    if (!navigator.onLine && actual && !forzar) {
      const ids = new Set(pendientes.map((p) => p.id))
      if (pendientes.every((p) => actual.orden.includes(p.id))) {
        const r = { ...actual, orden: actual.orden.filter((id) => ids.has(id)), claves }
        localStorage.setItem(CLAVE_RUTA, JSON.stringify(r))
        return setRuta(r)
      }
    }
    setCalculando(true)
    const paradas = pendientes.map((p) => {
      const c = porId.get(p.clienteId)!
      return { id: p.id, punto: [c.longitud, c.latitud] as Punto, ventana: c.ventana }
    })
    const inicio = yoRef.current ?? (await ubicacionActual()) ?? paradas[0].punto
    const r: RutaGuardada = { ...(await calcularRuta(inicio, paradas)), fecha, claves }
    localStorage.setItem(CLAVE_RUTA, JSON.stringify(r))
    setRuta(r)
    setCalculando(false)
  }, [claves, pendientes, porId, clientes, fecha])

  useEffect(() => { recalcular() }, [recalcular])

  const orden = useMemo(() => {
    const ids = new Set(pendientes.map((p) => p.id))
    const o = (ruta?.orden ?? []).filter((id) => ids.has(id))
    pendientes.forEach((p) => !o.includes(p.id) && o.push(p.id))
    return o
  }, [ruta, pendientes])

  const activoId = elegido && orden.includes(elegido) ? elegido : orden[0]
  const activo = pendientes.find((p) => p.id === activoId) ?? null
  const clienteActivo = activo ? porId.get(activo.clienteId) ?? null : null
  const puntoActivo: Punto | null = clienteActivo ? [clienteActivo.longitud, clienteActivo.latitud] : null

  const pines: Pin[] = useMemo(
    () =>
      (pedidosHoy ?? []).flatMap((p) => {
        const c = porId.get(p.clienteId)
        if (!c?.activo) return []
        const i = orden.indexOf(p.id)
        return [{ id: p.id, punto: [c.longitud, c.latitud] as Punto, numero: i + 1, estado: p.estado, activo: p.id === activoId }]
      }),
    [pedidosHoy, porId, orden, activoId],
  )
  const seleccionar = useCallback((id: string) => {
    setElegido(id)
    setExpandida(false)
  }, [])

  const entregados = (pedidosHoy ?? []).filter((p) => p.estado === 'ENTREGADO')
  const totalDia = entregados.reduce((s, p) => s + p.total, 0)
  const totalPedidos = (pedidosHoy ?? []).filter((p) => p.estado !== 'RECORDAR_MAS_TARDE').length

  async function pedidoRealizado() {
    if (!activo) return
    const entregado: Pedido = { ...activo, estado: 'ENTREGADO', metodo_pago: pago, fecha_entregado_real: Date.now() }
    await guardar('pedidos', entregado)
    setElegido(null)
    setExpandida(false)
    setPaso('opciones')
    setPostEntrega(entregado)
  }

  // RF-022: tras leer el QR o la tarjeta, si el cliente tiene entrega hoy se va directo a su parada; si no,
  // se abre un pedido para hoy con lo que pidió la vez anterior.
  async function abrirEscaneado(c: Cliente) {
    setEscaner(false)
    const deHoy = pendientes.find((p) => p.clienteId === c.id)
    if (deHoy) {
      seleccionar(deHoy.id)
      setExpandida(true)
      return aviso(`${c.nombre}: entrega de hoy`)
    }
    setEditor({ cliente: c, base: await baseDelUltimoPedido(c.id), paraHoy: true })
  }

  function siguiente(texto?: string) {
    setPostEntrega(null)
    if (texto) aviso(texto)
  }

  async function recordarMasTarde() {
    if (!postEntrega) return
    await guardar('recordatorios', { id: uid(), clienteId: postEntrega.clienteId, creado: Date.now(), hecho: false })
    siguiente('Te lo recuerdo en la campana 🔔')
  }

  async function confirmarOmitir(reprogramar: boolean) {
    if (!omitir) return
    await guardar('pedidos', { ...omitir, estado: 'OMITIDO' })
    const c = porId.get(omitir.clienteId)
    const base = aCantidades(omitir.items)
    setOmitir(null)
    setElegido(null)
    setExpandida(false)
    if (reprogramar && c) setEditor({ cliente: c, base })
    else aviso('Visita marcada como omitida')
  }

  const cargando = pedidosHoy === undefined || clientes === undefined
  const clientePost = postEntrega ? porId.get(postEntrega.clienteId) : undefined
  const baseAnterior = useMemo(() => (postEntrega ? aCantidades(postEntrega.items) : undefined), [postEntrega])

  const litrosActivo = activo ? activo.items.reduce((s, i) => s + i.litros, 0) : 0
  const litrosEntregados = entregados.reduce((s, p) => s + p.items.reduce((a, i) => a + i.litros, 0), 0)
  const avance = totalPedidos ? Math.round((entregados.length / totalPedidos) * 100) : 0
  const minutosRuta = ruta && orden.length ? Math.max(1, Math.round(ruta.duracion_s / 60)) : null

  return (
    <div className="relative h-full overflow-hidden">
      <Mapa pines={pines} linea={orden.length ? (ruta?.linea ?? []) : []} yo={yo} enfoque={puntoActivo} modo3D={modo3D} onSeleccionar={seleccionar} />

      {/* Arriba: campana, lo cobrado hoy y la parada actual */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-safe">
        <div className="relative mt-2 flex h-11 items-center">
          <div className="pointer-events-auto">
            <BotonRedondo onClick={() => setVerRecordatorios(true)} etiqueta="Recordatorios">
              <Bell size={20} />
              {recordatorios.length > 0 && (
                <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-tinta px-1 text-[11px] font-bold text-white ring-2 ring-papel">{recordatorios.length}</span>
              )}
            </BotonRedondo>
          </div>
          <div className="pointer-events-auto absolute right-0">
            <BotonRedondo onClick={() => setEscaner(true)} etiqueta="Escanear QR o tarjeta">
              <ScanLine size={20} />
            </BotonRedondo>
          </div>
          <div className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-papel px-5 py-2.5 shadow-tarjeta">
            <span className="text-lg leading-none font-semibold tabular-nums">{dinero(totalDia)}</span>
            {enLinea ? (
              <span className="text-xs font-medium text-apagado">cobrado hoy</span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><WifiOff size={14} /> sin red</span>
            )}
          </div>
        </div>

        {activo && clienteActivo && (
          <div className="pointer-events-auto mt-3 flex items-center gap-3 rounded-2xl bg-papel p-3 shadow-tarjeta">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-niebla"><span className="h-3.5 w-3.5 bg-tinta" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-apagado">Parada {orden.indexOf(activo.id) + 1} de {orden.length}</div>
              <div className="truncate text-base leading-tight font-semibold">{clienteActivo.direccion || clienteActivo.nombre}</div>
            </div>
          </div>
        )}

        {ruta && !ruta.porCalles && orden.length > 0 && (
          <div className="pointer-events-auto mt-2 rounded-xl bg-ambar px-3 py-2 text-xs font-semibold text-tinta">
            Sin conexión al ruteador: orden aproximado en línea recta. Toca ↻ al tener señal.
          </div>
        )}

        <div className={`mt-3 flex flex-col items-end gap-2 transition-opacity duration-200 ${expandida ? 'pointer-events-none opacity-0' : 'pointer-events-auto'}`}>
          <BotonRedondo onClick={() => setModo3D(!modo3D)} etiqueta="Vista 2D/3D">
            {modo3D ? <MapIcon size={20} /> : <Box size={20} />}
          </BotonRedondo>
          <BotonRedondo onClick={() => recalcular(true)} etiqueta="Recalcular ruta">
            <RefreshCw size={20} className={calculando ? 'animate-spin' : ''} />
          </BotonRedondo>
        </div>
      </div>

      {/* Hoja inferior: parada activa y, abajo, el avance del día */}
      <div className="absolute inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-xl overflow-hidden rounded-t-[28px] bg-papel shadow-hoja">
          <button onClick={() => setExpandida(!expandida)} className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-linea" aria-label="Expandir" />
          {cargando ? (
            <div className="py-8 text-center text-apagado">Cargando…</div>
          ) : activo && clienteActivo ? (
            <>
              <div className={`px-5 pt-3 ${expandida ? 'max-h-[44dvh] overflow-y-auto' : ''}`}>
                <button className="flex w-full items-start gap-3 text-left" onClick={() => setExpandida(!expandida)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-2xl leading-8 font-bold tracking-tight">{clienteActivo.nombre}</div>
                    <div className="mt-1 flex items-center gap-1.5 truncate text-sm text-apagado">
                      {clienteActivo.ventana === 'MAÑANA' ? <Sun size={14} /> : <Moon size={14} />}
                      {clienteActivo.ventana === 'MAÑANA' ? 'Mañana' : 'Tarde'}
                      {yo && <> · {(distancia(yo, puntoActivo!) / 1000).toFixed(1)} km</>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl leading-8 font-semibold tracking-tight tabular-nums">{dinero(activo.total)}</div>
                    <div className="mt-1 text-sm text-apagado">{litrosActivo} L</div>
                  </div>
                </button>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activo.items.map((i) => {
                    const p = prodPorId.get(i.productoId)
                    return (
                      <span key={i.productoId} className="flex items-center gap-2 rounded-full bg-niebla py-1.5 pr-3.5 pl-2 text-sm font-medium">
                        <IconoSabor sabor={p?.sabor ?? ''} size={22} />
                        {i.litros} L {p?.sabor ?? '¿?'}
                      </span>
                    )
                  })}
                </div>

                <div className={`grid transition-all duration-300 ${expandida ? 'mt-4 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="grid grid-cols-4 gap-2">
                      <Accion href={enlaceNavegar(puntoActivo!)} icono={<Navigation size={22} />} texto="Navegar" />
                      <Accion href={`tel:${clienteActivo.telefono}`} icono={<Phone size={22} />} texto="Llamar" />
                      <Accion href={`https://wa.me/${telLimpio(clienteActivo.telefono)}`} icono={<MessageCircle size={22} />} texto="WhatsApp" />
                      <Accion onClick={() => setEditor({ cliente: clienteActivo, pedido: activo })} icono={<Pencil size={22} />} texto="Editar" />
                    </div>
                    <div className="mt-5 text-sm font-semibold text-apagado">Forma de pago</div>
                    <Segmentado
                      className="mt-2"
                      valor={pago}
                      onChange={setPago}
                      opciones={[
                        { valor: 'EFECTIVO', texto: <><Banknote size={16} /> Efectivo</> },
                        { valor: 'TRANSFERENCIA', texto: <><Smartphone size={16} /> Transfer</> },
                      ]}
                    />
                    {clienteActivo.notas && (
                      <div className="mt-4 flex gap-2.5 rounded-xl bg-niebla p-3 text-sm">
                        <StickyNote size={18} className="mt-0.5 shrink-0 text-apagado" />
                        {clienteActivo.notas}
                      </div>
                    )}
                    {orden.length > 1 && (
                      <div className="mt-5">
                        <div className="mb-1 text-sm font-semibold text-apagado">Siguientes paradas</div>
                        <div className="relative">
                          <div className="absolute top-5 bottom-5 left-3 w-0.5 bg-linea" />
                          {orden.slice(0, 6).filter((id) => id !== activo.id).map((id) => {
                            const p = pendientes.find((x) => x.id === id)!
                            const c = porId.get(p.clienteId)!
                            return (
                              <button key={id} onClick={() => seleccionar(id)} className="relative flex w-full items-center gap-4 py-2 text-left">
                                <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-niebla text-xs font-semibold ring-4 ring-papel">{orden.indexOf(id) + 1}</span>
                                <span className="min-w-0 flex-1 truncate font-medium">{c.nombre}</span>
                                <span className="text-apagado tabular-nums">{dinero(p.total)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <button onClick={() => setOmitir(activo)} className="mt-3 mb-1 flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold text-rojo">
                      <CircleSlash size={16} /> No estaba / no quiso (omitir)
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 px-5 pt-4 pb-4">
                <button
                  onClick={() => setExpandida(!expandida)}
                  aria-label={expandida ? 'Ver menos' : 'Ver más'}
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-niebla active:bg-linea"
                >
                  <ChevronUp size={24} className={`transition-transform ${expandida ? 'rotate-180' : ''}`} />
                </button>
                <Boton onClick={pedidoRealizado} className="h-14 flex-1 !py-0 text-lg">
                  <CheckCircle2 size={22} /> Pedido Realizado
                </Boton>
              </div>
            </>
          ) : totalPedidos > 0 ? (
            <div className="px-5 pt-4 pb-5">
              <Sparkles size={28} />
              <div className="mt-2 text-2xl leading-8 font-bold tracking-tight">¡Ruta terminada!</div>
              <div className="mt-1 text-apagado">
                {entregados.length} entregas · {litrosEntregados} L · {dinero(totalDia)}
              </div>
            </div>
          ) : (
            <div className="px-5 pt-3 pb-5">
              <div className="text-2xl leading-8 font-bold tracking-tight">Hoy no hay entregas</div>
              <div className="mt-1 text-sm text-apagado">Agenda pedidos desde Clientes, o prueba la app con datos de ejemplo.</div>
              <button onClick={irAClientes} className="mt-4 flex w-full items-center gap-3 rounded-xl bg-niebla px-4 py-4 text-left text-lg font-semibold text-apagado active:bg-linea">
                <ArrowRight size={20} className="text-tinta" /> ¿A quién le llevamos?
              </button>
              <Boton
                variante="secundario"
                className="mt-2 w-full"
                onClick={async () => {
                  const centro = yo ?? (await ubicacionActual()) ?? [-99.1332, 19.4326]
                  await cargarDemo(centro)
                  aviso('Datos de ejemplo cargados')
                }}
              >
                <Sparkles size={18} /> Cargar datos de ejemplo
              </Boton>
            </div>
          )}

          {totalPedidos > 0 && (
            <div className="border-t border-linea px-5 pt-3.5 pb-3.5">
              <div className="h-1 overflow-hidden rounded-full bg-linea">
                <div className="h-full rounded-full bg-tinta transition-all duration-500" style={{ width: `${avance}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Dato valor={`${entregados.length} de ${totalPedidos}`} etiqueta="entregas" />
                <Dato valor={`${litrosEntregados} L`} etiqueta="repartidos" />
                <Dato valor={minutosRuta ? `${minutosRuta} min` : '—'} etiqueta="de ruta" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal post-entrega */}
      <Hoja
        abierta={!!postEntrega}
        onCerrar={() => siguiente()}
        titulo={
          paso === 'opciones' ? (
            <span className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-verde text-white"><Check size={20} strokeWidth={3} /></span>
              Entregado · {dinero(postEntrega?.total ?? 0)}
            </span>
          ) : 'Nuevo pedido'
        }
      >
        {clientePost && paso === 'opciones' && (
          <div className="space-y-2.5 pb-3">
            <div className="pb-1 text-apagado">¿Qué sigue con <b className="text-tinta">{clientePost.nombre}</b>?</div>
            <OpcionGrande destacada icono={<PlusCircle size={26} />} titulo="Realizar nuevo pedido" sub="Agendar su siguiente visita" onClick={() => setPaso('nuevo')} />
            <OpcionGrande icono={<Clock size={26} />} titulo="Recordar más tarde" sub="Te aviso para escribirle o llamarle" onClick={recordarMasTarde} />
            <OpcionGrande icono={<X size={26} />} titulo="Cerrar" sub="Ir a la siguiente parada" onClick={() => siguiente()} />
          </div>
        )}
        {clientePost && paso === 'nuevo' && (
          <div className="space-y-2.5 pb-3">
            <OpcionGrande
              destacada
              icono={<Copy size={26} />}
              titulo="Igual que el anterior"
              sub={postEntrega!.items.map((i) => `${i.litros} L ${prodPorId.get(i.productoId)?.sabor ?? ''}`).join(' · ')}
              onClick={() => { setEditor({ cliente: clientePost, base: baseAnterior }); setPostEntrega(null) }}
            />
            <OpcionGrande icono={<PlusCircle size={26} />} titulo="Desde cero" sub="Todos los sabores en 0" onClick={() => { setEditor({ cliente: clientePost, base: {} }); setPostEntrega(null) }} />
            <button onClick={() => setPaso('opciones')} className="w-full py-3 text-sm font-semibold text-apagado">← Volver</button>
          </div>
        )}
      </Hoja>

      {editor && (
        <EditorPedido
          abierto
          onCerrar={() => setEditor(null)}
          cliente={editor.cliente}
          pedido={editor.pedido}
          base={editor.base}
          fechaInicial={editor.paraHoy ? fecha : undefined}
          onGuardado={editor.paraHoy ? (p) => seleccionar(p.id) : undefined}
        />
      )}

      {escaner && (
        <Suspense fallback={null}>
          <Escaner onCliente={abrirEscaneado} onCerrar={() => setEscaner(false)} />
        </Suspense>
      )}

      {/* Omitir visita (RF-026) */}
      <Hoja abierta={!!omitir} onCerrar={() => setOmitir(null)} titulo="Omitir visita">
        <div className="space-y-3 pb-3">
          <div className="text-apagado">Se marcará como no entregado. ¿Quieres reprogramarlo?</div>
          <Boton className="w-full" onClick={() => confirmarOmitir(true)}>Omitir y reprogramar</Boton>
          <Boton variante="secundario" className="w-full" onClick={() => confirmarOmitir(false)}>Sólo omitir</Boton>
        </div>
      </Hoja>

      <Recordatorios abierta={verRecordatorios} onCerrar={() => setVerRecordatorios(false)} porId={porId} onPedido={(c) => { setVerRecordatorios(false); setEditor({ cliente: c, base: {} }) }} />
    </div>
  )
}

function Recordatorios({ abierta, onCerrar, porId, onPedido }: {
  abierta: boolean
  onCerrar: () => void
  porId: Map<string, Cliente>
  onPedido: (c: Cliente) => void
}) {
  const lista = useLiveQuery(() => db.recordatorios.filter((r) => !r.hecho).toArray(), []) ?? []
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Por confirmar">
      {lista.length === 0 && <div className="py-10 text-center text-apagado">Nada pendiente</div>}
      <div className="space-y-2.5 pb-3">
        {lista.map((r) => {
          const c = porId.get(r.clienteId)
          if (!c) return null
          const msg = encodeURIComponent(`Hola ${c.nombre}, ¿qué sabores de yogurt te llevo en la próxima visita? 🍓`)
          return (
            <div key={r.id} className="rounded-2xl bg-niebla p-4">
              <div className="text-lg font-semibold">{c.nombre}</div>
              <div className="text-sm text-apagado">Desde {textoFecha(iso(new Date(r.creado))).toLowerCase()}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <a href={`https://wa.me/${telLimpio(c.telefono)}?text=${msg}`} target="_blank" className="rounded-xl bg-verde py-3 text-center text-sm font-semibold text-white">WhatsApp</a>
                <button onClick={() => onPedido(c)} className="rounded-xl bg-tinta py-3 text-sm font-semibold text-white">Pedido</button>
                <button onClick={() => guardar('recordatorios', { ...r, hecho: true })} className="rounded-xl bg-linea py-3 text-sm font-semibold">Listo</button>
              </div>
            </div>
          )
        })}
      </div>
    </Hoja>
  )
}

function BotonRedondo({ children, onClick, etiqueta }: { children: ReactNode; onClick: () => void; etiqueta: string }) {
  return (
    <button onClick={onClick} aria-label={etiqueta} className="relative grid h-11 w-11 place-items-center rounded-full bg-papel shadow-tarjeta active:bg-niebla">
      {children}
    </button>
  )
}

function Dato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div>
      <div className="text-lg leading-6 font-semibold tabular-nums">{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}

function OpcionGrande({ icono, titulo, sub, destacada, onClick }: { icono: ReactNode; titulo: string; sub: string; destacada?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl bg-niebla p-4 text-left transition-colors active:bg-linea">
      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${destacada ? 'bg-tinta text-white' : 'bg-papel'}`}>{icono}</div>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold">{titulo}</div>
        <div className="truncate text-sm text-apagado">{sub}</div>
      </div>
      <ChevronRight size={20} className="shrink-0 opacity-40" />
    </button>
  )
}
