import Dexie, { type EntityTable } from 'dexie'

// Modelo local (IndexedDB). Sigue CONTEXTO_ARTQUITECTURA.md; Detalle_Pedido va embebido en Pedido.items.

export type Ventana = 'MAÑANA' | 'TARDE'
export type EstadoPedido = 'PENDIENTE' | 'ENTREGADO' | 'RECORDAR_MAS_TARDE' | 'OMITIDO'

// dias: 0 = domingo ... 6 = sábado
export type Frecuencia = { tipo: 'semana'; dias: number[] } | { tipo: 'intervalo'; cada: number }

export interface Cliente {
  id: string
  nombre: string
  direccion: string
  notas?: string
  latitud: number
  longitud: number
  telefono: string
  frecuencia: Frecuencia
  ventana: Ventana
  qr_uuid: string
  nfc_uid?: string
  activo: boolean
  creado: number
  actualizado: number
  // Los pone el servidor al sincronizar (src/lib/sync.ts); la app no los edita.
  version?: number
  vendedorId?: string
}

export interface Producto {
  id: string
  sabor: string
  descripcion?: string
  presentacion?: number // litros por envase (RF-032); sin dato, 1 L. Se fija al crear el sabor.
  precio_litro: number
  costo_litro: number
  color_hex: string
  disponible: boolean
  version?: number
}

export interface DetallePedido {
  productoId: string
  litros: number
  precio_litro: number
}

export interface Pedido {
  id: string
  clienteId: string
  fecha: string // YYYY-MM-DD, fecha programada
  estado: EstadoPedido
  items: DetallePedido[]
  total: number
  metodo_pago?: 'EFECTIVO' | 'TRANSFERENCIA'
  orden_ruta?: number
  urgente?: boolean // el administrador lo marcó para entregarse ya (RF-054); sólo él lo cambia
  fecha_entregado_real?: number
  creado: number
  actualizado: number
  version?: number
  vendedorId?: string
}

// Litros de un sabor que el administrador le asignó a este vendedor en un día (RF-037). Sólo se lee: lo escribe el servidor.
export interface StockDia {
  id: string
  fecha: string // YYYY-MM-DD
  productoId: string
  asignada: number
  devuelta: number
  version?: number
}

export type TipoAviso = 'pedido_urgente' | 'ruta_modificada' | 'stock_asignado' | 'prueba' | 'stock_bajo' | 'sync_pendiente'
export type PestanaAviso = 'ruta' | 'clientes' | 'stock' | 'cuenta'

// Avisos para el vendedor (RF-054, RF-055). Los de pedido urgente, ruta y carga los manda el servidor; los de stock
// bajo y ventas sin enviar los genera esta app en el teléfono (`local`).
export interface Aviso {
  id: string
  tipo: TipoAviso
  titulo: string
  cuerpo: string
  pestana?: PestanaAviso // a dónde lleva al tocarlo
  creado: number
  leida: boolean
  local?: boolean
}

export interface Recordatorio {
  id: string
  clienteId: string
  creado: number
  hecho: boolean
  version?: number
}

// Cola de cambios por sincronizar con el servidor (RF-051). Guarda qué registro cambió, no una copia:
// al sincronizar se manda su estado actual, así varias ediciones seguidas viajan como una sola.
export interface Cambio {
  id?: number
  opId: string // identifica la operación en el servidor: reenviarla nunca la aplica dos veces (RF-053)
  tabla: Tabla
  registroId: string
  op: 'put' | 'delete'
  ts: number
  version?: number // al borrar: versión del servidor que tenía el registro
}

export interface Meta {
  clave: string
  valor: unknown
}

// Cambios que el servidor no aceptó o que perdieron contra otro dispositivo; la persona debe enterarse.
export interface Problema {
  id: string
  tabla: Tabla
  registroId: string
  tipo: 'conflicto' | 'rechazada'
  mensaje: string
  ts: number
  visto: boolean
}

export const db = new Dexie('reparto-yogurt') as Dexie & {
  clientes: EntityTable<Cliente, 'id'>
  productos: EntityTable<Producto, 'id'>
  pedidos: EntityTable<Pedido, 'id'>
  recordatorios: EntityTable<Recordatorio, 'id'>
  cola: EntityTable<Cambio, 'id'>
  meta: EntityTable<Meta, 'clave'>
  problemas: EntityTable<Problema, 'id'>
  stock: EntityTable<StockDia, 'id'>
  avisos: EntityTable<Aviso, 'id'>
}

db.version(1).stores({
  clientes: 'id, nombre, activo',
  productos: 'id, disponible',
  pedidos: 'id, clienteId, fecha, estado, [fecha+estado]',
  recordatorios: 'id, clienteId, hecho',
  cola: '++id, ts',
})

db.version(2)
  .stores({ cola: '++id, ts, registroId, opId', meta: 'clave', problemas: 'id, ts, visto' })
  .upgrade((t) => t.table('cola').toCollection().modify((c) => { c.opId = crypto.randomUUID() }))

db.version(3).stores({ stock: 'id, fecha, productoId', avisos: 'id, creado' })

export const uid = () => crypto.randomUUID()

export type Tabla = 'clientes' | 'productos' | 'pedidos' | 'recordatorios'

const encolar = (tabla: Tabla, registroId: string, op: Cambio['op'], version?: number) =>
  db.cola.add({ opId: uid(), tabla, registroId, op, ts: Date.now(), version })

// Lo que el servidor puso en el registro no se pierde si la pantalla arma un objeto nuevo al editar.
async function conservarDelServidor<T extends { id: string; version?: number; vendedorId?: string }>(tabla: Tabla, r: T): Promise<T> {
  const previo = (await db.table(tabla).get(r.id)) as T | undefined
  if (!previo) return r
  return { ...r, version: r.version ?? previo.version, vendedorId: r.vendedorId ?? previo.vendedorId }
}

export async function guardar<T extends { id: string }>(tabla: Tabla, registro: T) {
  await db.transaction('rw', db.table(tabla), db.cola, async () => {
    const r = await conservarDelServidor(tabla, registro)
    await db.table(tabla).put({ ...r, actualizado: Date.now() })
    await encolar(tabla, registro.id, 'put')
  })
}

export async function guardarVarios<T extends { id: string }>(tabla: Tabla, registros: T[]) {
  await db.transaction('rw', db.table(tabla), db.cola, async () => {
    for (const registro of registros) {
      const r = await conservarDelServidor(tabla, registro)
      await db.table(tabla).put(r)
      await encolar(tabla, registro.id, 'put')
    }
  })
}

export async function borrar(tabla: Tabla, id: string) {
  await db.transaction('rw', db.table(tabla), db.cola, async () => {
    const previo = await db.table(tabla).get(id)
    await db.table(tabla).delete(id)
    await encolar(tabla, id, 'delete', previo?.version)
  })
}

export const totalDe = (items: DetallePedido[]) =>
  Math.round(items.reduce((s, i) => s + i.litros * i.precio_litro, 0) * 100) / 100

export const SABORES_INICIALES: Omit<Producto, 'id'>[] = [
  { sabor: 'Fresa', precio_litro: 60, costo_litro: 28, color_hex: '#f472b6', disponible: true },
  { sabor: 'Natural', precio_litro: 55, costo_litro: 24, color_hex: '#f5ecd7', disponible: true },
  { sabor: 'Durazno', precio_litro: 60, costo_litro: 28, color_hex: '#fdba74', disponible: true },
  { sabor: 'Mango', precio_litro: 62, costo_litro: 29, color_hex: '#facc15', disponible: true },
  { sabor: 'Nuez', precio_litro: 70, costo_litro: 35, color_hex: '#b45309', disponible: true },
  { sabor: 'Zarzamora', precio_litro: 65, costo_litro: 31, color_hex: '#7e22ce', disponible: true },
]

export async function asegurarCatalogo() {
  if ((await db.productos.count()) > 0) return
  await db.productos.bulkPut(SABORES_INICIALES.map((p) => ({ ...p, id: uid() })))
}
