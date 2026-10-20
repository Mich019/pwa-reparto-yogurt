import { useSyncExternalStore } from 'react'
import { ErrorApi, ErrorRed, MODO_SERVIDOR } from './api'
import { aviso } from '../components/ui'
import { db, uid, type Aviso, type Cambio, type PestanaAviso, type StockDia, type Tabla, type TipoAviso } from './db'
import { hoy, sumarDias } from './fechas'
import { dispositivoId, llamarAutenticado, sesionActual } from './sesion'

// Sincronización con el servidor (RF-051 a RF-053).
//  · Cada cambio local queda en `cola` (db.ts). `enviar` manda el estado actual de cada registro tocado,
//    en orden de dependencias (sabores → clientes → pedidos), y `descargar` trae lo que cambió en el servidor.
//  · El servidor decide los conflictos (ver server/src/sync/aplicar.ts): aquí se adopta su respuesta
//    y se avisa a la persona de lo que no se aplicó.
//  · Si no hay señal, todo se queda en el teléfono y se reintenta al volver la conexión.

const TABLAS: Tabla[] = ['productos', 'clientes', 'pedidos', 'recordatorios']
const ORDEN: Record<Tabla, number> = { productos: 0, clientes: 1, pedidos: 2, recordatorios: 3 }
const LOTE = 100
const ETIQUETA: Record<Tabla, string> = { productos: 'el sabor', clientes: 'el cliente', pedidos: 'el pedido', recordatorios: 'el recordatorio' }

export interface EstadoSync {
  sincronizando: boolean
  ultimaOk?: number
  error?: string
}
let estado: EstadoSync = { sincronizando: false }
const oyentes = new Set<() => void>()
function fijarEstado(parcial: Partial<EstadoSync>) {
  estado = { ...estado, ...parcial }
  oyentes.forEach((f) => f())
}
export const useEstadoSync = () =>
  useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => estado)

interface Resultado {
  id: string
  estado: 'aplicada' | 'conflicto' | 'rechazada'
  registro?: { id: string; version: number; [k: string]: unknown }
  eliminado?: boolean
  retirado?: boolean // ya no es de tu cartera (el administrador lo pasó a otro vendedor)
  error?: string
}
interface AvisoServidor {
  id: string
  tipo: TipoAviso
  titulo: string
  cuerpo: string
  datos?: { pestana?: PestanaAviso }
  creado: number
}
interface Bajada {
  ahora: number
  cursor: number
  stock?: StockDia[] // sólo vendedores (RF-037)
  avisos?: AvisoServidor[] // RF-054
  eliminados: { tabla: Tabla; id: string }[]
  productos: Registro[]
  clientes: Registro[]
  pedidos: Registro[]
  recordatorios: Registro[]
}
type Registro = { id: string; version: number; [k: string]: unknown }

const llamar = <T>(ruta: string, cuerpo?: unknown) => llamarAutenticado<T>(ruta, { cuerpo })

// ------------------------------------------------------------------ primera vez en este teléfono
// Un teléfono que ya trabajaba sin servidor trae datos propios: se unen con los del servidor sin duplicar.

async function reconciliarSabores() {
  const todos = await db.productos.toArray()
  const delServidor = new Map(todos.filter((p) => p.version != null).map((p) => [p.sabor.trim().toLowerCase(), p]))
  for (const local of todos.filter((p) => p.version == null)) {
    const igual = delServidor.get(local.sabor.trim().toLowerCase())
    if (!igual) continue
    const afectados = await db.pedidos.filter((p) => p.items.some((i) => i.productoId === local.id)).toArray()
    await db.pedidos.bulkPut(afectados.map((p) => ({ ...p, items: p.items.map((i) => (i.productoId === local.id ? { ...i, productoId: igual.id } : i)) })))
    await db.productos.delete(local.id)
    await db.cola.where('registroId').equals(local.id).delete()
  }
}

async function encolarSinSincronizar() {
  const enCola = new Set((await db.cola.toArray()).map((c) => `${c.tabla}:${c.registroId}`))
  for (const tabla of TABLAS) {
    const pendientes = await db.table(tabla).filter((r) => r.version == null && !enCola.has(`${tabla}:${r.id}`)).toArray()
    for (const r of pendientes) await db.cola.add({ opId: uid(), tabla, registroId: r.id, op: 'put', ts: r.actualizado ?? r.creado ?? Date.now() })
  }
}

async function adoptarDatosLocales() {
  await descargar(0)
  await reconciliarSabores()
  await encolarSinSincronizar()
  await db.meta.put({ clave: 'adoptado', valor: true })
}

// ------------------------------------------------------------------ enviar
function describir(tabla: Tabla, r?: Record<string, unknown>) {
  const nombre = (r?.nombre ?? r?.sabor) as string | undefined
  return `${ETIQUETA[tabla]}${nombre ? ` «${nombre}»` : ''}`
}

async function aplicarResultado(tabla: Tabla, registroId: string, maxId: number, r: Resultado) {
  await db.transaction('rw', [db.table(tabla), db.cola, db.problemas], async () => {
    await db.cola.where('registroId').equals(registroId).and((c) => c.tabla === tabla && c.id! <= maxId).delete()
    const editadoDespues = (await db.cola.where('registroId').equals(registroId).and((c) => c.tabla === tabla).count()) > 0
    const local = await db.table(tabla).get(registroId)

    if (r.registro) {
      if (!editadoDespues) await db.table(tabla).put(r.registro) // el servidor manda: así queda tal como él lo guardó
      else if (local) await db.table(tabla).put({ ...local, version: r.registro.version })
    } else if (((r.eliminado && r.estado !== 'rechazada') || r.retirado) && !editadoDespues) {
      await db.table(tabla).delete(registroId)
    }

    if (r.estado !== 'aplicada') {
      const texto = r.estado === 'conflicto'
        ? `Tu cambio en ${describir(tabla, local ?? r.registro)} no se aplicó. ${r.error ?? ''}`
        : `No se pudo guardar ${describir(tabla, local ?? r.registro)}. ${r.error ?? ''}`
      await db.problemas.add({ id: uid(), tabla, registroId, tipo: r.estado, mensaje: texto.trim(), ts: Date.now(), visto: false })
    }
  })
}

async function enviar() {
  for (;;) {
    const cola = await db.cola.orderBy('id').toArray()
    if (!cola.length) return

    const ultimos = new Map<string, Cambio>()
    for (const c of cola) ultimos.set(`${c.tabla}:${c.registroId}`, c) // varias ediciones seguidas viajan como una

    const ops: { id: string; tabla: Tabla; registroId: string; op: 'put' | 'delete'; version: number; ts: number; datos?: unknown }[] = []
    for (const c of ultimos.values()) {
      if (c.op === 'delete') {
        ops.push({ id: c.opId, tabla: c.tabla, registroId: c.registroId, op: 'delete', version: c.version ?? 0, ts: c.ts })
        continue
      }
      const reg = await db.table(c.tabla).get(c.registroId)
      if (!reg) { await db.cola.where('registroId').equals(c.registroId).and((x) => x.tabla === c.tabla).delete(); continue }
      ops.push({ id: c.opId, tabla: c.tabla, registroId: c.registroId, op: 'put', version: reg.version ?? 0, ts: c.ts, datos: reg })
    }
    // Altas y cambios primero (sabores → clientes → pedidos); los borrados al revés.
    ops.sort((a, b) =>
      a.op !== b.op ? (a.op === 'put' ? -1 : 1) : a.op === 'put' ? ORDEN[a.tabla] - ORDEN[b.tabla] || a.ts - b.ts : ORDEN[b.tabla] - ORDEN[a.tabla] || a.ts - b.ts)
    if (!ops.length) continue

    const lote = ops.slice(0, LOTE)
    const maxPorRegistro = new Map<string, number>()
    for (const c of cola) maxPorRegistro.set(`${c.tabla}:${c.registroId}`, c.id!)

    const r = await llamar<{ resultados: Resultado[] }>('/sync/push', { dispositivo: dispositivoId(), ahoraCliente: Date.now(), operaciones: lote })
    const porOp = new Map(r.resultados.map((x) => [x.id, x]))
    let resueltos = 0
    for (const o of lote) {
      const res = porOp.get(o.id)
      if (!res) continue
      await aplicarResultado(o.tabla, o.registroId, maxPorRegistro.get(`${o.tabla}:${o.registroId}`)!, res)
      resueltos++
    }
    if (!resueltos) throw new Error('El servidor no respondió a los cambios enviados')
  }
}

// ------------------------------------------------------------------ descargar
async function descargar(desde?: number) {
  const cursor = desde ?? (((await db.meta.get('cursor'))?.valor as number | undefined) ?? 0)
  const r = await llamar<Bajada>(`/sync/pull?desde=${Math.floor(cursor)}`)
  const nuevos: Aviso[] = []
  await db.transaction('rw', [db.clientes, db.productos, db.pedidos, db.recordatorios, db.cola, db.meta, db.stock, db.avisos], async () => {
    // Lo que tiene cambios locales sin enviar no se pisa: se resuelve al enviarlo.
    const sucios = new Set((await db.cola.toArray()).map((c) => `${c.tabla}:${c.registroId}`))
    for (const tabla of TABLAS) {
      const recibidos = r[tabla]
      const locales = await db.table(tabla).bulkGet(recibidos.map((x) => x.id))
      await db.table(tabla).bulkPut(recibidos.filter((x, i) => !sucios.has(`${tabla}:${x.id}`) && (locales[i]?.version ?? -1) < x.version))
    }
    for (const e of r.eliminados) if (!sucios.has(`${e.tabla}:${e.id}`)) await db.table(e.tabla).delete(e.id)

    // El stock lo escribe el administrador: aquí sólo se adopta tal cual, y se olvida el de hace más de una semana.
    if (r.stock?.length) await db.stock.bulkPut(r.stock)
    await db.stock.where('fecha').below(sumarDias(hoy(), -7)).delete()

    // Los avisos que el servidor repite (la descarga siempre trae unos segundos de más) no se duplican ni se desmarcan.
    if (r.avisos?.length) {
      const previos = await db.avisos.bulkGet(r.avisos.map((a) => a.id))
      const altas = r.avisos.flatMap((a, i): Aviso[] =>
        previos[i] ? [] : [{ id: a.id, tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo, pestana: a.datos?.pestana, creado: a.creado, leida: false }])
      await db.avisos.bulkAdd(altas)
      nuevos.push(...altas)
    }
    await db.meta.put({ clave: 'cursor', valor: r.cursor })
  })
  // Con la app abierta el push no suena: el aviso sale aquí. Los de hace rato (otro teléfono, otro día) no.
  const recientes = nuevos.filter((a) => a.creado >= r.ahora - 5 * 60_000)
  if (recientes.length === 1) aviso(`${recientes[0].titulo}: ${recientes[0].cuerpo}`)
  else if (recientes.length > 1) aviso(`${recientes.length} avisos nuevos. Revisa Cuenta.`)
}

// ------------------------------------------------------------------ ciclo
let enCurso: Promise<void> | null = null
let otraVez = false

export function sincronizar(): Promise<void> {
  if (!MODO_SERVIDOR || !sesionActual()) return Promise.resolve()
  if (enCurso) {
    otraVez = true
    return enCurso
  }
  fijarEstado({ sincronizando: true })
  enCurso = (async () => {
    try {
      do {
        otraVez = false
        if (sesionActual()?.usuario.debeCambiarPassword) break
        if (!(await db.meta.get('adoptado'))?.valor) await adoptarDatosLocales()
        await enviar()
        await descargar()
      } while (otraVez)
      fijarEstado({ ultimaOk: Date.now(), error: undefined })
    } catch (e) {
      if (e instanceof ErrorRed) {
        fijarEstado({ error: 'Sin conexión: los cambios se enviarán cuando vuelva la señal' })
        pedirSincronizacionEnSegundoPlano()
      } else if (e instanceof ErrorApi && e.codigo === 'CAMBIAR_PASSWORD') {
        fijarEstado({ error: undefined })
      } else {
        fijarEstado({ error: e instanceof Error ? e.message : 'No se pudo sincronizar' })
      }
    } finally {
      enCurso = null
      fijarEstado({ sincronizando: false })
    }
  })()
  return enCurso
}

// RF-052: el service worker avisa a la app cuando vuelve la conexión, aun si la pestaña estaba dormida.
function pedirSincronizacionEnSegundoPlano() {
  navigator.serviceWorker?.ready
    .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('sync-cola'))
    .catch(() => {})
}

// Arranca la sincronización automática mientras haya sesión. Devuelve la función que la detiene.
export function iniciarSincronizacionAutomatica(): () => void {
  if (!MODO_SERVIDOR) return () => {}
  let t: ReturnType<typeof setTimeout> | undefined
  const pronto = (ms = 1500) => {
    clearTimeout(t)
    t = setTimeout(() => void sincronizar(), ms)
  }
  const alVolver = () => { if (document.visibilityState === 'visible') pronto(300) }
  const alMensaje = (e: MessageEvent) => { if (e.data?.tipo === 'sincronizar') pronto(0) }
  const hook = () => { pronto() }

  window.addEventListener('online', hook)
  document.addEventListener('visibilitychange', alVolver)
  navigator.serviceWorker?.addEventListener('message', alMensaje)
  db.cola.hook('creating', hook)
  const reloj = setInterval(() => { if (document.visibilityState === 'visible') pronto(0) }, 60_000)
  pronto(0)

  return () => {
    clearTimeout(t)
    clearInterval(reloj)
    window.removeEventListener('online', hook)
    document.removeEventListener('visibilitychange', alVolver)
    navigator.serviceWorker?.removeEventListener('message', alMensaje)
    db.cola.hook('creating').unsubscribe(hook)
  }
}
