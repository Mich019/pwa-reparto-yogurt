import { tx, type Cx, type Db } from '../db.ts'
import type { Usuario } from '../app.ts'
import { ADAPTADORES, ErrorNegocio, type Existente } from './adaptadores.ts'
import type { OperacionEntrante } from './esquemas.ts'

export type EstadoOperacion = 'aplicada' | 'conflicto' | 'rechazada'

export interface Resultado {
  id: string
  estado: EstadoOperacion
  registro?: unknown // cómo quedó (o cómo está) el registro en el servidor, para que el teléfono lo adopte
  eliminado?: boolean // el registro ya no existe en el servidor
  error?: string
}

interface Reloj {
  dispositivo: string
  skewMs: number // reloj del servidor menos reloj del teléfono
  ahoraMs: number
}

// RF-053 · Reglas de resolución de conflictos
//  1. El id de la operación es único: reenviarla devuelve lo que pasó, nunca se aplica dos veces.
//  2. Si el teléfono editó sobre la versión vigente (o el último cambio vino de su mismo dispositivo),
//     se aplica sin más.
//  3. Si otro dispositivo cambió el registro mientras tanto:
//       · un pedido ya cerrado (entregado, omitido) gana siempre: no se pisa una venta;
//       · un pedido que se cierra gana sobre una edición de un pedido abierto;
//       · en lo demás gana el cambio más reciente según la hora en que se hizo (reloj del teléfono
//         corregido con su desfase contra el servidor); en empate gana el servidor.
//  4. Borrar un registro que otro modificó no se aplica: se conserva el dato.
//  5. Lo que no se aplica queda en operaciones_sync (estado 'conflicto' o 'rechazada') con sus datos.

function resolver(op: OperacionEntrante, ex: Existente<any>, entrante: any, tsMs: number, referenciaMs: number): 'entrante' | 'servidor' {
  if (op.tabla === 'pedidos') {
    if (ex.final) return 'servidor'
    if (entrante.estado === 'ENTREGADO' || entrante.estado === 'OMITIDO') return 'entrante'
  }
  return tsMs > referenciaMs ? 'entrante' : 'servidor'
}

// Último cambio aplicado sobre el registro, si sigue vigente (nadie lo tocó por fuera desde entonces).
async function ultimoCambio(c: Cx, op: OperacionEntrante, ex: Existente<any>) {
  const { rows } = await c.query(
    `SELECT dispositivo, id_usuario, (extract(epoch from creado_en_cliente) * 1000)::float8 AS reloj_ms
       FROM operaciones_sync
      WHERE tabla = $1 AND id_registro = $2 AND estado = 'aplicada'
        AND recibido_en >= to_timestamp($3::float8 / 1000000.0) - interval '5 milliseconds'
      ORDER BY recibido_en DESC LIMIT 1`,
    [op.tabla, op.registroId, ex.actualizadoUs],
  )
  return rows[0] as { dispositivo: string; id_usuario: string; reloj_ms: number } | undefined
}

async function estadoActual(c: Cx, u: Usuario, op: OperacionEntrante): Promise<Pick<Resultado, 'registro' | 'eliminado'>> {
  const [ex] = await ADAPTADORES[op.tabla].listar(c, { id: op.registroId, vendedor: u.rol === 'vendedor' ? u.id : undefined })
  return ex ? { registro: conCostos(op.tabla, u, ex.wire) } : { eliminado: true }
}

// El vendedor no ve costos ni márgenes (RF-005).
export function conCostos(tabla: string, u: Usuario, wire: any) {
  if (tabla === 'productos' && u.rol !== 'administrador') return { ...wire, costo_litro: 0 }
  return wire
}

function mensajeBD(e: any): string | null {
  switch (e?.code) {
    case '23505': return 'Ya existe un registro igual (nombre o código repetido)'
    case '23503': return 'Depende de otro registro que no existe, o tiene registros que dependen de él'
    case '23514':
    case '22003':
    case '22P02':
    case '22007': return 'Algún dato está fuera de rango o no tiene el formato correcto'
    case 'P0001': return e.message
    default: return null
  }
}

export async function procesarOperacion(db: Db, u: Usuario, op: OperacionEntrante, reloj: Reloj): Promise<Resultado> {
  const ad = ADAPTADORES[op.tabla]
  const tsMs = Math.min(op.ts + reloj.skewMs, reloj.ahoraMs) // el desfase del reloj del teléfono no cuenta; nunca en el futuro

  return tx(db, u.id, async (c) => {
    // Serializa operaciones sobre el mismo registro (también cuando todavía no existe).
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${op.tabla}:${op.registroId}`])

    // Regla 1: ya la procesamos.
    const { rows: previas } = await c.query(`SELECT id_usuario, estado, detalle_error FROM operaciones_sync WHERE id_operacion = $1`, [op.id])
    if (previas[0]) {
      if (previas[0].id_usuario !== u.id) return { id: op.id, estado: 'rechazada' as const, error: 'Identificador de operación repetido' }
      return { id: op.id, estado: previas[0].estado as EstadoOperacion, error: previas[0].detalle_error ?? undefined, ...(await estadoActual(c, u, op)) }
    }

    await c.query('SAVEPOINT operacion')
    let estado: EstadoOperacion
    let nota: string | undefined
    try {
      ;({ estado, nota } = await aplicar(c, u, op, tsMs, reloj))
      await c.query('RELEASE SAVEPOINT operacion')
    } catch (e: any) {
      await c.query('ROLLBACK TO SAVEPOINT operacion')
      const msg = e instanceof ErrorNegocio ? e.message : mensajeBD(e)
      if (!msg) throw e
      estado = 'rechazada'
      nota = msg
    }

    await c.query(
      `INSERT INTO operaciones_sync (id_operacion, id_usuario, dispositivo, tabla, id_registro, operacion, version_cliente, datos, creado_en_cliente, estado, detalle_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9::float8 / 1000.0), $10::estado_sync, $11)`,
      [op.id, u.id, reloj.dispositivo, op.tabla, op.registroId, op.op === 'delete' ? 'delete' : 'update', op.version ?? null, JSON.stringify(op.datos ?? {}), tsMs, estado, nota ?? null],
    )
    // Datos de rechazos de permisos no deben filtrar registros ajenos: estadoActual ya filtra por cartera.
    return { id: op.id, estado, error: nota, ...(await estadoActual(c, u, op)) }
  })
}

async function aplicar(c: Cx, u: Usuario, op: OperacionEntrante, tsMs: number, reloj: Reloj): Promise<{ estado: EstadoOperacion; nota?: string }> {
  const ad = ADAPTADORES[op.tabla]
  const [ex] = (await ad.listar(c, { id: op.registroId, bloquear: true })) as Existente<any>[]
  const base = op.version ?? 0

  if (op.op === 'delete') {
    if (!ex) return { estado: 'aplicada' }
    const sinPermiso = ad.autorizarBorrado(u, ex)
    if (sinPermiso) return { estado: 'rechazada', nota: sinPermiso }
    if (ex.version !== base) {
      const ultimo = await ultimoCambio(c, op, ex)
      if (!(ultimo && ultimo.dispositivo === reloj.dispositivo && ultimo.id_usuario === u.id)) {
        return { estado: 'conflicto', nota: 'Otro dispositivo lo modificó; no se borró.' }
      }
    }
    await ad.borrar(c, op.registroId)
    return { estado: 'aplicada' }
  }

  const parsed = ad.esquema.safeParse(op.datos)
  if (!parsed.success) return { estado: 'rechazada', nota: 'Datos inválidos: ' + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ') }
  const w = parsed.data
  if (w.id !== op.registroId) return { estado: 'rechazada', nota: 'El id del registro no coincide' }

  const sinPermiso = await ad.autorizarEscritura(c, u, w, ex ?? null)
  if (sinPermiso) return { estado: 'rechazada', nota: sinPermiso }

  if (!ex) {
    if (base > 0) return { estado: 'conflicto', nota: 'Ya se había borrado en otro dispositivo.' }
    await ad.escribir(c, u, w, null)
    return { estado: 'aplicada' }
  }

  let nota: string | undefined
  if (ex.version !== base) {
    const ultimo = await ultimoCambio(c, op, ex)
    const mismoOrigen = ultimo && ultimo.dispositivo === reloj.dispositivo && ultimo.id_usuario === u.id
    if (!mismoOrigen) {
      const referencia = ultimo?.reloj_ms ?? ex.actualizadoMs
      if (resolver(op, ex, w, tsMs, referencia) === 'servidor') {
        return { estado: 'conflicto', nota: ex.final ? 'El pedido ya estaba cerrado en otro dispositivo.' : 'Se conservó el cambio más reciente, hecho en otro dispositivo.' }
      }
      nota = 'Reemplazó un cambio anterior hecho en otro dispositivo.'
    }
  }
  await ad.escribir(c, u, w, ex)
  return { estado: 'aplicada', nota }
}
