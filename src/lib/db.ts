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
}

export interface Producto {
  id: string
  sabor: string
  precio_litro: number
  costo_litro: number
  color_hex: string
  disponible: boolean
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
  fecha_entregado_real?: number
  creado: number
  actualizado: number
}

export interface Recordatorio {
  id: string
  clienteId: string
  creado: number
  hecho: boolean
}

// Cola de cambios para sincronizar con el backend cuando exista (RF-051).
export interface Cambio {
  id?: number
  tabla: string
  registroId: string
  op: 'put' | 'delete'
  ts: number
}

export const db = new Dexie('reparto-yogurt') as Dexie & {
  clientes: EntityTable<Cliente, 'id'>
  productos: EntityTable<Producto, 'id'>
  pedidos: EntityTable<Pedido, 'id'>
  recordatorios: EntityTable<Recordatorio, 'id'>
  cola: EntityTable<Cambio, 'id'>
}

db.version(1).stores({
  clientes: 'id, nombre, activo',
  productos: 'id, disponible',
  pedidos: 'id, clienteId, fecha, estado, [fecha+estado]',
  recordatorios: 'id, clienteId, hecho',
  cola: '++id, ts',
})

export const uid = () => crypto.randomUUID()

type Tabla = 'clientes' | 'productos' | 'pedidos' | 'recordatorios'

export async function guardar<T extends { id: string }>(tabla: Tabla, registro: T) {
  await db.transaction('rw', db.table(tabla), db.cola, async () => {
    await db.table(tabla).put({ ...registro, actualizado: Date.now() })
    await db.cola.add({ tabla, registroId: registro.id, op: 'put', ts: Date.now() })
  })
}

export async function borrar(tabla: Tabla, id: string) {
  await db.transaction('rw', db.table(tabla), db.cola, async () => {
    await db.table(tabla).delete(id)
    await db.cola.add({ tabla, registroId: id, op: 'delete', ts: Date.now() })
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
