import { z } from 'zod'

// Formato de intercambio con la app: es el mismo modelo que la app guarda en IndexedDB
// (src/lib/db.ts), más `version` (la del servidor) y `vendedorId`.

const ms = z.number().finite().nonnegative()
const texto = (max: number) => z.string().max(max)

export const clienteWire = z.object({
  id: z.uuid(),
  nombre: texto(100).min(1),
  direccion: texto(500),
  notas: texto(1000).optional(),
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
  telefono: texto(20),
  frecuencia: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('semana'), dias: z.array(z.number().int().min(0).max(6)).max(7) }),
    z.object({ tipo: z.literal('intervalo'), cada: z.number().int().min(1).max(90) }),
  ]),
  ventana: z.enum(['MAÑANA', 'TARDE']),
  qr_uuid: z.uuid(),
  nfc_uid: texto(64).optional(),
  activo: z.boolean(),
  creado: ms,
  actualizado: ms,
  vendedorId: z.uuid().optional(),
  version: z.number().int().optional(),
})

export const productoWire = z.object({
  id: z.uuid(),
  sabor: texto(100).min(1),
  precio_litro: z.number().positive().max(99999999),
  costo_litro: z.number().min(0).max(99999999),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  disponible: z.boolean(),
  version: z.number().int().optional(),
})

export const pedidoWire = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estado: z.enum(['PENDIENTE', 'ENTREGADO', 'RECORDAR_MAS_TARDE', 'OMITIDO']),
  items: z
    .array(z.object({ productoId: z.uuid(), litros: z.number().positive().max(100000), precio_litro: z.number().min(0).max(99999999) }))
    .max(100),
  total: z.number().min(0).optional(),
  metodo_pago: z.enum(['EFECTIVO', 'TRANSFERENCIA']).optional(),
  orden_ruta: z.number().int().min(0).max(32000).optional(),
  fecha_entregado_real: ms.optional(),
  creado: ms,
  actualizado: ms,
  vendedorId: z.uuid().optional(),
  version: z.number().int().optional(),
})

export const recordatorioWire = z.object({
  id: z.uuid(),
  clienteId: z.uuid(),
  creado: ms,
  hecho: z.boolean(),
  version: z.number().int().optional(),
})

export type ClienteWire = z.infer<typeof clienteWire>
export type ProductoWire = z.infer<typeof productoWire>
export type PedidoWire = z.infer<typeof pedidoWire>
export type RecordatorioWire = z.infer<typeof recordatorioWire>

export const TABLAS = ['productos', 'clientes', 'pedidos', 'recordatorios'] as const
export type Tabla = (typeof TABLAS)[number]

export const bodyPush = z.object({
  dispositivo: z.string().min(1).max(200),
  ahoraCliente: ms,
  operaciones: z
    .array(
      z.object({
        id: z.uuid(), // identifica la operación: reenviarla nunca la aplica dos veces (RF-053)
        tabla: z.enum(TABLAS),
        registroId: z.uuid(),
        op: z.enum(['put', 'delete']),
        version: z.number().int().min(0).optional(), // versión del servidor sobre la que editó el teléfono
        ts: ms, // cuándo se hizo el cambio, con el reloj del teléfono
        datos: z.unknown().optional(),
      }),
    )
    .max(200),
})
export type OperacionEntrante = z.infer<typeof bodyPush>['operaciones'][number]
