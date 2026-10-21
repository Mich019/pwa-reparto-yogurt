import { api } from './api'
import { db, uid, type Cambio, type Tabla } from './db'

// Envío de la cola de cambios al servidor (RF-051 a RF-053). Lo usan la app (sync.ts) y el service worker
// (src/sw/envio.ts, RF-052: con la app cerrada), así que sólo depende de la base local y de cómo llamar a la API.
//  · Manda el estado actual de cada registro tocado, en orden de dependencias (sabores → clientes → pedidos).
//  · El servidor decide los conflictos (api/_lib/sync/aplicar.ts): aquí se adopta su respuesta y lo que no se
//    aplicó queda en `problemas` para avisar a la persona.

export type Llamar = <T>(ruta: string, cuerpo?: unknown) => Promise<T>

export const ORDEN: Record<Tabla, number> = { productos: 0, clientes: 1, pedidos: 2, recordatorios: 3 }
const LOTE = 100
const ETIQUETA: Record<Tabla, string> = { productos: 'el sabor', clientes: 'el cliente', pedidos: 'el pedido', recordatorios: 'el recordatorio' }

interface Resultado {
  id: string
  estado: 'aplicada' | 'conflicto' | 'rechazada'
  registro?: { id: string; version: number; [k: string]: unknown }
  eliminado?: boolean
  retirado?: boolean // ya no es de tu cartera (el administrador lo pasó a otro vendedor)
  error?: string
}

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

async function enviarSinCandado(llamar: Llamar, dispositivo: string) {
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

    const r = await llamar<{ resultados: Resultado[] }>('/sync/push', { dispositivo, ahoraCliente: Date.now(), operaciones: lote })
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

// La app y el service worker pueden querer enviar a la vez: un candado del navegador hace que uno espere al otro.
// (Si se repitiera un envío, el servidor no lo aplica dos veces: cada operación lleva su id.)
export function enviarCola(llamar: Llamar, dispositivo: string): Promise<void> {
  const candados = (globalThis.navigator as Navigator | undefined)?.locks
  if (!candados) return enviarSinCandado(llamar, dispositivo)
  return candados.request('reparto-yogurt-envio', () => enviarSinCandado(llamar, dispositivo))
}

// Lo que el service worker necesita para enviar con la app cerrada: la sesión vive en localStorage, que él no puede
// leer, así que la app deja una copia en la base local (mismo origen, mismo nivel de protección) y la borra al salir.
export interface SesionSegundoPlano {
  accessToken: string
  expiraEn: number
  refreshToken: string
  usuarioId: string
  dispositivo: string
  debeCambiarPassword: boolean
}
export const CLAVE_SESION_SW = 'sesion-segundo-plano'

// Cierre de sesión sin señal (RF-006): el teléfono ya olvidó la sesión, pero el servidor la daría por buena hasta que
// venza. Su token queda aquí y se revoca en cuanto haya conexión (la app al volver la señal, o el service worker).
export const CLAVE_REVOCAR = 'revocar-pendientes'

export async function guardarRevocacion(refreshToken: string) {
  await db.transaction('rw', db.meta, async () => {
    const lista = ((await db.meta.get(CLAVE_REVOCAR))?.valor as string[] | undefined) ?? []
    if (!lista.includes(refreshToken)) await db.meta.put({ clave: CLAVE_REVOCAR, valor: [...lista, refreshToken] })
  })
}

// Un error (sin señal) deja pendientes las que falten, para el siguiente intento.
export async function revocarPendientes(): Promise<void> {
  const lista = ((await db.meta.get(CLAVE_REVOCAR))?.valor as string[] | undefined) ?? []
  for (const refreshToken of lista) {
    await api('/auth/logout', { cuerpo: { refreshToken } }) // siempre 204, aunque ya estuviera revocada
    await db.transaction('rw', db.meta, async () => {
      const ahora = ((await db.meta.get(CLAVE_REVOCAR))?.valor as string[] | undefined) ?? []
      await db.meta.put({ clave: CLAVE_REVOCAR, valor: ahora.filter((t) => t !== refreshToken) })
    })
  }
}
