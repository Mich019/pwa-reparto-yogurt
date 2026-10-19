import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell, Box, CheckCircle2, ChevronUp, CircleSlash, Clock, Copy, Map as MapIcon, MessageCircle, Navigation,
  Pencil, Phone, PlusCircle, RefreshCw, Sparkles, WifiOff, X,
} from 'lucide-react'
import { db, guardar, uid, type Cliente, type Pedido } from '../lib/db'
import { dinero, hoy, iso, textoFecha } from '../lib/fechas'
import { calcularRuta, distancia, enlaceNavegar, ubicacionActual, type Punto, type Ruta as RutaCalc } from '../lib/ruteo'
import { cargarDemo } from '../lib/demo'
import { Mapa, type Pin } from './Mapa'
import { EditorPedido } from './EditorPedido'
import { aCantidades, type Cantidades } from './SelectorSabores'
import { Boton, Hoja, aviso, telLimpio } from './ui'

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
  const [editor, setEditor] = useState<{ cliente: Cliente; pedido?: Pedido; base?: Cantidades } | null>(null)
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

  return (
    <div className="relative h-full overflow-hidden">
      <Mapa pines={pines} linea={orden.length ? (ruta?.linea ?? []) : []} yo={yo} enfoque={puntoActivo} modo3D={modo3D} onSeleccionar={seleccionar} />

      {/* Barra superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 px-3 pt-safe">
        <div className="pointer-events-auto mt-1 flex-1 rounded-2xl bg-slate-900/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <div className="text-xs font-medium text-slate-400">Hoy · {dinero(totalDia)} cobrado</div>
          <div className="text-base font-bold">
            {entregados.length} de {totalPedidos} entregados
            {!enLinea && <WifiOff size={14} className="ml-2 inline text-amber-400" />}
          </div>
        </div>
        <div className="pointer-events-auto mt-1 flex gap-2">
          <BotonMapa onClick={() => setVerRecordatorios(true)} etiqueta="Recordatorios">
            <Bell size={20} />
            {recordatorios.length > 0 && (
              <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-pink-500 px-1 text-[11px] font-bold">{recordatorios.length}</span>
            )}
          </BotonMapa>
          <BotonMapa onClick={() => setModo3D(!modo3D)} etiqueta="Vista 2D/3D">
            {modo3D ? <MapIcon size={20} /> : <Box size={20} />}
          </BotonMapa>
          <BotonMapa onClick={() => recalcular(true)} etiqueta="Recalcular ruta">
            <RefreshCw size={20} className={calculando ? 'animate-spin' : ''} />
          </BotonMapa>
        </div>
      </div>

      {ruta && !ruta.porCalles && orden.length > 0 && (
        <div className="absolute inset-x-3 top-24 z-10 rounded-xl bg-amber-500/95 px-3 py-2 text-xs font-medium text-slate-950">
          Sin conexión al ruteador: orden aproximado en línea recta. Toca ↻ al tener señal.
        </div>
      )}

      {/* Hoja inferior con la parada activa */}
      <div className="absolute inset-x-0 bottom-0 z-20">
        <div className="mx-auto max-w-xl rounded-t-3xl bg-slate-900 px-4 pt-2 pb-3 shadow-[0_-8px_30px_rgba(0,0,0,.45)]">
          <button onClick={() => setExpandida(!expandida)} className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-slate-700" aria-label="Expandir" />
          {cargando ? (
            <div className="py-6 text-center text-slate-400">Cargando…</div>
          ) : activo && clienteActivo ? (
            <>
              <button className="flex w-full items-start gap-3 text-left" onClick={() => setExpandida(!expandida)}>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-pink-500 text-lg font-black">{orden.indexOf(activo.id) + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xl font-bold">{clienteActivo.nombre}</div>
                  <div className="truncate text-sm text-slate-400">
                    {clienteActivo.direccion}
                    {yo && <> · {(distancia(yo, puntoActivo!) / 1000).toFixed(1)} km</>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold tabular-nums">{dinero(activo.total)}</div>
                  <div className="text-xs text-slate-400">{clienteActivo.ventana === 'MAÑANA' ? '☀️ Mañana' : '🌙 Tarde'}</div>
                </div>
              </button>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {activo.items.map((i) => {
                  const p = prodPorId.get(i.productoId)
                  return (
                    <span key={i.productoId} className="flex items-center gap-1.5 rounded-full bg-slate-800 py-1 pr-3 pl-1 text-sm font-semibold">
                      <span className="h-5 w-5 rounded-full border border-white/30" style={{ background: p?.color_hex ?? '#888' }} />
                      {i.litros} L {p?.sabor ?? '¿?'}
                    </span>
                  )
                })}
              </div>

              <div className={`grid transition-all duration-300 ${expandida ? 'mt-3 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="grid grid-cols-4 gap-2">
                    <Accion href={enlaceNavegar(puntoActivo!)} icono={<Navigation size={20} />} texto="Navegar" />
                    <Accion href={`tel:${clienteActivo.telefono}`} icono={<Phone size={20} />} texto="Llamar" />
                    <Accion href={`https://wa.me/${telLimpio(clienteActivo.telefono)}`} icono={<MessageCircle size={20} />} texto="WhatsApp" />
                    <Accion onClick={() => setEditor({ cliente: clienteActivo, pedido: activo })} icono={<Pencil size={20} />} texto="Editar" />
                  </div>
                  <div className="mt-3 text-sm font-medium text-slate-400">Pago</div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {(['EFECTIVO', 'TRANSFERENCIA'] as const).map((m) => (
                      <button key={m} onClick={() => setPago(m)} className={`rounded-xl py-2.5 text-sm font-semibold ${pago === m ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
                        {m === 'EFECTIVO' ? '💵 Efectivo' : '📲 Transferencia'}
                      </button>
                    ))}
                  </div>
                  {clienteActivo.notas && <div className="mt-3 rounded-xl bg-slate-800/60 p-3 text-sm text-slate-300">📝 {clienteActivo.notas}</div>}
                  <button onClick={() => setOmitir(activo)} className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold text-slate-400">
                    <CircleSlash size={16} /> No estaba / no quiso (omitir)
                  </button>
                  {orden.length > 1 && (
                    <div className="mt-1 border-t border-slate-800 pt-2">
                      <div className="mb-1 text-xs font-medium text-slate-500">Siguientes paradas</div>
                      {orden.slice(0, 6).filter((id) => id !== activo.id).map((id) => {
                        const p = pendientes.find((x) => x.id === id)!
                        const c = porId.get(p.clienteId)!
                        return (
                          <button key={id} onClick={() => seleccionar(id)} className="flex w-full items-center gap-3 py-1.5 text-left text-sm">
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-700 text-xs font-bold">{orden.indexOf(id) + 1}</span>
                            <span className="flex-1 truncate">{c.nombre}</span>
                            <span className="text-slate-400 tabular-nums">{dinero(p.total)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <Boton onClick={() => setExpandida(!expandida)} variante="secundario" className="!px-3.5" >
                  <ChevronUp size={22} className={`transition-transform ${expandida ? 'rotate-180' : ''}`} />
                </Boton>
                <Boton onClick={pedidoRealizado} className="flex-1 py-4 text-lg">
                  <CheckCircle2 size={22} /> Pedido Realizado
                </Boton>
              </div>
            </>
          ) : totalPedidos > 0 ? (
            <div className="py-3 text-center">
              <Sparkles className="mx-auto text-pink-400" size={32} />
              <div className="mt-2 text-xl font-bold">¡Ruta terminada!</div>
              <div className="mt-1 text-slate-400">
                {entregados.length} entregas · {entregados.reduce((s, p) => s + p.items.reduce((a, i) => a + i.litros, 0), 0)} L · {dinero(totalDia)}
              </div>
            </div>
          ) : (
            <div className="py-3 text-center">
              <div className="text-lg font-bold">No hay entregas para hoy</div>
              <div className="mt-1 text-sm text-slate-400">Agenda pedidos desde Clientes, o prueba la app con datos de ejemplo.</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Boton variante="secundario" onClick={irAClientes}>
                  <PlusCircle size={18} /> Clientes
                </Boton>
                <Boton
                  variante="rosa"
                  onClick={async () => {
                    const centro = yo ?? (await ubicacionActual()) ?? [-99.1332, 19.4326]
                    await cargarDemo(centro)
                    aviso('Datos de ejemplo cargados')
                  }}
                >
                  <Sparkles size={18} /> Ejemplo
                </Boton>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal post-entrega */}
      <Hoja
        abierta={!!postEntrega}
        onCerrar={() => siguiente()}
        titulo={paso === 'opciones' ? <span className="text-emerald-400">✓ Entregado · {dinero(postEntrega?.total ?? 0)}</span> : 'Nuevo pedido'}
      >
        {clientePost && paso === 'opciones' && (
          <div className="space-y-3 pb-3">
            <div className="text-slate-400">¿Qué sigue con <b className="text-slate-100">{clientePost.nombre}</b>?</div>
            <OpcionGrande color="bg-pink-500" icono={<PlusCircle size={26} />} titulo="Realizar nuevo pedido" sub="Agendar su siguiente visita" onClick={() => setPaso('nuevo')} />
            <OpcionGrande color="bg-amber-500" icono={<Clock size={26} />} titulo="Recordar más tarde" sub="Te aviso para escribirle o llamarle" onClick={recordarMasTarde} />
            <OpcionGrande color="bg-slate-700" icono={<X size={26} />} titulo="Cerrar" sub="Ir a la siguiente parada" onClick={() => siguiente()} />
          </div>
        )}
        {clientePost && paso === 'nuevo' && (
          <div className="space-y-3 pb-3">
            <OpcionGrande
              color="bg-pink-500"
              icono={<Copy size={26} />}
              titulo="Igual que el anterior"
              sub={postEntrega!.items.map((i) => `${i.litros} L ${prodPorId.get(i.productoId)?.sabor ?? ''}`).join(' · ')}
              onClick={() => { setEditor({ cliente: clientePost, base: baseAnterior }); setPostEntrega(null) }}
            />
            <OpcionGrande color="bg-slate-700" icono={<PlusCircle size={26} />} titulo="Desde cero" sub="Todos los sabores en 0" onClick={() => { setEditor({ cliente: clientePost, base: {} }); setPostEntrega(null) }} />
            <button onClick={() => setPaso('opciones')} className="w-full py-2 text-sm font-semibold text-slate-400">← Volver</button>
          </div>
        )}
      </Hoja>

      {editor && (
        <EditorPedido abierto onCerrar={() => setEditor(null)} cliente={editor.cliente} pedido={editor.pedido} base={editor.base} />
      )}

      {/* Omitir visita (RF-026) */}
      <Hoja abierta={!!omitir} onCerrar={() => setOmitir(null)} titulo="Omitir visita">
        <div className="space-y-3 pb-3">
          <div className="text-slate-400">Se marcará como no entregado. ¿Quieres reprogramarlo?</div>
          <Boton variante="rosa" className="w-full" onClick={() => confirmarOmitir(true)}>Omitir y reprogramar</Boton>
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
      {lista.length === 0 && <div className="py-8 text-center text-slate-400">Nada pendiente 👌</div>}
      <div className="space-y-2 pb-3">
        {lista.map((r) => {
          const c = porId.get(r.clienteId)
          if (!c) return null
          const msg = encodeURIComponent(`Hola ${c.nombre}, ¿qué sabores de yogurt te llevo en la próxima visita? 🍓`)
          return (
            <div key={r.id} className="rounded-2xl bg-slate-800 p-3">
              <div className="font-bold">{c.nombre}</div>
              <div className="text-xs text-slate-400">Desde {textoFecha(iso(new Date(r.creado))).toLowerCase()}</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <a href={`https://wa.me/${telLimpio(c.telefono)}?text=${msg}`} target="_blank" className="rounded-xl bg-emerald-600 py-2 text-center text-sm font-semibold">WhatsApp</a>
                <button onClick={() => onPedido(c)} className="rounded-xl bg-pink-500 py-2 text-sm font-semibold">Pedido</button>
                <button onClick={() => guardar('recordatorios', { ...r, hecho: true })} className="rounded-xl bg-slate-700 py-2 text-sm font-semibold">Listo</button>
              </div>
            </div>
          )
        })}
      </div>
    </Hoja>
  )
}

function BotonMapa({ children, onClick, etiqueta }: { children: ReactNode; onClick: () => void; etiqueta: string }) {
  return (
    <button onClick={onClick} aria-label={etiqueta} className="relative grid h-12 w-12 place-items-center rounded-2xl bg-slate-900/95 shadow-lg backdrop-blur active:bg-slate-800">
      {children}
    </button>
  )
}

function Accion({ icono, texto, href, onClick }: { icono: ReactNode; texto: string; href?: string; onClick?: () => void }) {
  const clase = 'flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-2.5 text-xs font-semibold active:bg-slate-700'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={clase}>{icono}{texto}</a>
  ) : (
    <button onClick={onClick} className={clase}>{icono}{texto}</button>
  )
}

function OpcionGrande({ icono, titulo, sub, color, onClick }: { icono: ReactNode; titulo: string; sub: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-2xl bg-slate-800 p-4 text-left active:bg-slate-700">
      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${color}`}>{icono}</div>
      <div className="min-w-0">
        <div className="text-lg font-bold">{titulo}</div>
        <div className="truncate text-sm text-slate-400">{sub}</div>
      </div>
    </button>
  )
}
