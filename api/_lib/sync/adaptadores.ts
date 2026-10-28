import type { z } from 'zod'
import type { Cx } from '../db.js'
import type { Usuario } from '../app.js'
import type { AvisoPendiente } from '../notificaciones.js'
import { totalPorUnidad } from '../unidades.js'
import {
  clienteWire, pedidoWire, productoWire, recordatorioWire,
  type ClienteWire, type PedidoWire, type ProductoWire, type RecordatorioWire, type Tabla,
} from './esquemas.js'

// Un adaptador traduce entre el formato de la app y las tablas SQL de db/01_esquema.sql,
// y dice qué puede hacer cada rol. Todo el SQL de la sincronización vive aquí.

export class ErrorNegocio extends Error {}

export interface Existente<W> {
  wire: W
  version: number
  actualizadoMs: number
  actualizadoUs: number
  final: boolean // pedido entregado/omitido/cancelado: ya no se edita
  dueno: string | null // id del vendedor responsable
  extra?: Record<string, unknown>
}

export interface Filtro {
  id?: string
  desde?: number // ms epoch: sólo lo cambiado después
  vendedor?: string // limita a lo visible para este vendedor
  bloquear?: boolean
}

export interface Adaptador<W> {
  esquema: z.ZodType<W>
  listar(c: Cx, f: Filtro): Promise<Existente<W>[]>
  autorizarEscritura(c: Cx, u: Usuario, w: W, ex: Existente<W> | null): Promise<string | null>
  escribir(c: Cx, u: Usuario, w: W, ex: Existente<W> | null): Promise<void>
  autorizarBorrado(u: Usuario, ex: Existente<W>): string | null
  borrar(c: Cx, id: string): Promise<void>
  // Avisos para el vendedor (RF-054). Se llaman ya aplicado el cambio, dentro de su transacción; `hoy` es el día en la
  // zona horaria del negocio. Lo que devuelven sólo sale si la transacción se confirma.
  avisarEscritura?(c: Cx, u: Usuario, w: W, ex: Existente<W> | null, hoy: string): Promise<AvisoPendiente[]>
  avisarBorrado?(c: Cx, u: Usuario, ex: Existente<W>, hoy: string): Promise<AvisoPendiente[]>
  verCostos?: boolean
}

const esAdmin = (u: Usuario) => u.rol === 'administrador'
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const dinero = (n: number) => Math.round(n * 100) / 100
const MS = (col: string) => `(extract(epoch from ${col}) * 1000)::float8`
const US = (col: string) => `(extract(epoch from ${col}) * 1000000)::float8`
const DESDE = `($2::bigint IS NULL OR %T.actualizado_en > to_timestamp(($2::bigint) / 1000.0))`

// ---------------------------------------------------------------- productos
const productos: Adaptador<ProductoWire> = {
  esquema: productoWire,
  async listar(c, f) {
    const { rows } = await c.query(
      `SELECT p.*, ${MS('p.actualizado_en')} AS act_ms, ${US('p.actualizado_en')} AS act_us
         FROM productos p
        WHERE ($1::uuid IS NULL OR p.id_producto = $1) AND ${DESDE.replace('%T', 'p')}
        ORDER BY p.actualizado_en, p.id_producto ${f.bloquear ? 'FOR UPDATE' : ''}`,
      [f.id ?? null, f.desde ?? null],
    )
    return rows.map((r) => {
      const pres = num(r.presentacion_litros)
      return {
        wire: {
          id: r.id_producto, sabor: r.sabor, descripcion: r.descripcion ?? undefined, presentacion: pres, unidad: r.unidad, envase: r.envase ?? undefined,
          precio_litro: dinero(num(r.precio_unitario) / pres),
          costo_litro: dinero(num(r.costo_produccion) / pres), color_hex: r.color_hex, disponible: r.disponible, version: r.version,
        },
        version: r.version, actualizadoMs: r.act_ms, actualizadoUs: r.act_us, final: false, dueno: null, extra: { presentacion: pres },
      }
    })
  },
  async autorizarEscritura(_c, u) {
    return esAdmin(u) ? null : 'Sólo el administrador puede cambiar los sabores y precios'
  },
  async escribir(c, _u, w, ex) {
    // La presentación (contenido, unidad y envase) se fija al crear el sabor: lo ya vendido está guardado en envases de
    // ese tamaño. Los precios van por unidad (precio_litro = por L, kg o pieza).
    const pres = ex ? (ex.extra?.presentacion as number) : dinero(w.presentacion ?? 1)
    if (!ex) {
      await c.query(
        `INSERT INTO productos (id_producto, sabor, descripcion, presentacion_litros, precio_unitario, costo_produccion, color_hex, disponible, unidad, envase)
         VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, NULLIF($10, ''))`,
        [w.id, w.sabor, w.descripcion ?? null, pres, dinero(w.precio_litro * pres), dinero(w.costo_litro * pres), w.color_hex, w.disponible, w.unidad ?? 'L', w.envase ?? null],
      )
    } else {
      await c.query(
        `UPDATE productos SET sabor = $2, precio_unitario = $3, costo_produccion = $4, color_hex = $5, disponible = $6,
                descripcion = CASE WHEN $7::boolean THEN NULLIF($8, '') ELSE descripcion END
          WHERE id_producto = $1`,
        [w.id, w.sabor, dinero(w.precio_litro * pres), dinero(w.costo_litro * pres), w.color_hex, w.disponible, w.descripcion !== undefined, w.descripcion ?? null],
      )
    }
  },
  autorizarBorrado: (u) => (esAdmin(u) ? null : 'Sólo el administrador puede borrar sabores'),
  async borrar(c, id) {
    await c.query(`DELETE FROM productos WHERE id_producto = $1`, [id])
  },
}

// ---------------------------------------------------------------- clientes
const clientes: Adaptador<ClienteWire> = {
  esquema: clienteWire,
  async listar(c, f) {
    const { rows } = await c.query(
      `SELECT c.*, ${MS('c.creado_en')} AS creado_ms, ${MS('c.actualizado_en')} AS act_ms, ${US('c.actualizado_en')} AS act_us
         FROM clientes c
        WHERE ($1::uuid IS NULL OR c.id_cliente = $1) AND ${DESDE.replace('%T', 'c')}
          AND ($3::uuid IS NULL OR c.id_vendedor = $3)
        ORDER BY c.actualizado_en, c.id_cliente ${f.bloquear ? 'FOR UPDATE' : ''}`,
      [f.id ?? null, f.desde ?? null, f.vendedor ?? null],
    )
    return rows.map((r) => ({
      wire: {
        id: r.id_cliente, nombre: r.nombre, direccion: r.direccion, notas: r.referencias ?? undefined,
        latitud: num(r.latitud), longitud: num(r.longitud), telefono: r.telefono ?? '',
        frecuencia: r.frecuencia_tipo === 'intervalo' ? { tipo: 'intervalo' as const, cada: r.cada_dias } : { tipo: 'semana' as const, dias: r.dias_semana },
        ventana: r.ventana_horario === 'tarde' ? ('TARDE' as const) : ('MAÑANA' as const),
        qr_uuid: r.qr_uuid, nfc_uid: r.nfc_uid ?? undefined, activo: r.activo,
        creado: r.creado_ms, actualizado: r.act_ms, vendedorId: r.id_vendedor ?? undefined, version: r.version,
      },
      version: r.version, actualizadoMs: r.act_ms, actualizadoUs: r.act_us, final: false, dueno: r.id_vendedor,
    }))
  },
  async autorizarEscritura(_c, u, _w, ex) {
    if (esAdmin(u) || !ex) return null
    return ex.dueno === u.id ? null : 'Ese cliente no está en tu cartera'
  },
  async escribir(c, u, w, ex) {
    // El vendedor de un cliente que ya existe sólo cambia con /clientes/reasignar (RF-041); una copia vieja no lo deshace.
    const dueno = ex ? ex.dueno : esAdmin(u) ? (w.vendedorId ?? null) : u.id
    const intervalo = w.frecuencia.tipo === 'intervalo'
    const dias = w.frecuencia.tipo === 'semana' ? [...new Set(w.frecuencia.dias)].sort() : []
    const datos = [
      w.id, dueno, w.nombre, w.direccion, w.notas ?? null, w.latitud, w.longitud, w.telefono || null,
      intervalo ? 'intervalo' : 'dias_semana', dias, w.frecuencia.tipo === 'intervalo' ? w.frecuencia.cada : null,
      w.ventana === 'TARDE' ? 'tarde' : 'manana', w.qr_uuid, w.nfc_uid || null, w.activo,
    ]
    if (!ex) {
      await c.query(
        `INSERT INTO clientes (id_cliente, id_vendedor, nombre, direccion, referencias, latitud, longitud, telefono,
                               frecuencia_tipo, dias_semana, cada_dias, ventana_horario, qr_uuid, nfc_uid, activo, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::tipo_frecuencia,$10::smallint[],$11,$12::ventana_horario,$13,$14,$15,
                 LEAST(to_timestamp($16::float8 / 1000.0), now()))`,
        [...datos, w.creado],
      )
    } else {
      await c.query(
        `UPDATE clientes SET id_vendedor=$2, nombre=$3, direccion=$4, referencias=$5, latitud=$6, longitud=$7, telefono=$8,
                frecuencia_tipo=$9::tipo_frecuencia, dias_semana=$10::smallint[], cada_dias=$11, ventana_horario=$12::ventana_horario,
                qr_uuid=$13, nfc_uid=$14, activo=$15
          WHERE id_cliente=$1`,
        datos,
      )
    }
  },
  autorizarBorrado: (u) => (esAdmin(u) ? null : 'Los clientes se archivan, sólo el administrador puede borrarlos'),
  async borrar(c, id) {
    await c.query(`DELETE FROM clientes WHERE id_cliente = $1`, [id])
  },
}

// ---------------------------------------------------------------- pedidos
const ESTADOS_FINALES = new Set(['entregado', 'omitido', 'cancelado'])
const ESTADO_A_DB = { PENDIENTE: 'pendiente', RECORDAR_MAS_TARDE: 'pendiente', ENTREGADO: 'entregado', OMITIDO: 'omitido' } as const

function agrupar(items: PedidoWire['items']) {
  const m = new Map<string, { litros: number; precio: number }>()
  for (const it of items) {
    const a = m.get(it.productoId)
    if (a) a.litros += it.litros
    else m.set(it.productoId, { litros: it.litros, precio: it.precio_litro })
  }
  return m
}

const firmaItems = (items: PedidoWire['items']) =>
  [...agrupar(items)].map(([k, v]) => `${k}:${dinero(v.litros)}`).sort().join()

// El precio lo pone el administrador (RF-033). Un vendedor no lo decide desde el teléfono: las líneas nuevas toman el
// del catálogo (trigger fn_detalle_precios) y las que ya existían conservan el que quedó congelado al venderse.
async function escribirDetalle(c: Cx, idPedido: string, items: PedidoWire['items'], fijarPrecio: boolean) {
  const grupos = agrupar(items)
  const ids = [...grupos.keys()]
  const { rows: prods } = await c.query(`SELECT id_producto, presentacion_litros::float8 AS pres FROM productos WHERE id_producto = ANY($1::uuid[])`, [ids])
  if (prods.length !== ids.length) throw new ErrorNegocio('El pedido usa un sabor que no existe en el servidor')
  // Quita lo que ya no está; lo que sigue se actualiza y conserva el costo congelado de su primera venta.
  await c.query(`DELETE FROM detalle_pedido WHERE id_pedido = $1 AND id_producto <> ALL($2::uuid[])`, [idPedido, ids])
  for (const p of prods) {
    const g = grupos.get(p.id_producto)!
    await c.query(
      `INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_pedido, id_producto) DO UPDATE
         SET cantidad = EXCLUDED.cantidad, precio_unitario = CASE WHEN $5 THEN EXCLUDED.precio_unitario ELSE detalle_pedido.precio_unitario END`,
      [idPedido, p.id_producto, dinero(g.litros / p.pres), fijarPrecio ? dinero(g.precio * p.pres) : null, fijarPrecio],
    )
  }
}

const pedidos: Adaptador<PedidoWire> = {
  esquema: pedidoWire,
  async listar(c, f) {
    const { rows } = await c.query(
      `SELECT p.*, cl.id_vendedor AS vendedor_cliente,
              ${MS('p.creado_en')} AS creado_ms, ${MS('p.actualizado_en')} AS act_ms, ${US('p.actualizado_en')} AS act_us,
              ${MS('p.fecha_entregado_real')} AS entregado_ms
         FROM pedidos p JOIN clientes cl ON cl.id_cliente = p.id_cliente
        WHERE ($1::uuid IS NULL OR p.id_pedido = $1) AND ${DESDE.replace('%T', 'p')}
          AND ($3::uuid IS NULL OR p.id_vendedor = $3 OR cl.id_vendedor = $3)
        ORDER BY p.actualizado_en, p.id_pedido ${f.bloquear ? 'FOR UPDATE OF p' : ''}`,
      [f.id ?? null, f.desde ?? null, f.vendedor ?? null],
    )
    const ids = rows.map((r) => r.id_pedido)
    const { rows: det } = ids.length
      ? await c.query(
          `SELECT d.id_pedido, d.id_producto, (d.cantidad * pr.presentacion_litros)::float8 AS litros,
                  (d.precio_unitario / pr.presentacion_litros)::float8 AS precio_litro
             FROM detalle_pedido d JOIN productos pr USING (id_producto)
            WHERE d.id_pedido = ANY($1::uuid[]) ORDER BY pr.sabor`,
          [ids],
        )
      : { rows: [] }
    const porPedido = new Map<string, PedidoWire['items']>()
    for (const d of det) {
      const l = porPedido.get(d.id_pedido) ?? []
      l.push({ productoId: d.id_producto, litros: dinero(d.litros), precio_litro: dinero(d.precio_litro) })
      porPedido.set(d.id_pedido, l)
    }
    return rows.map((r) => ({
      wire: {
        id: r.id_pedido, clienteId: r.id_cliente, fecha: r.fecha,
        estado: r.estado === 'entregado' ? ('ENTREGADO' as const) : r.estado === 'pendiente' || r.estado === 'en_camino' ? ('PENDIENTE' as const) : ('OMITIDO' as const),
        items: porPedido.get(r.id_pedido) ?? [], total: num(r.total),
        metodo_pago: r.metodo_pago ? (r.metodo_pago === 'efectivo' ? ('EFECTIVO' as const) : ('TRANSFERENCIA' as const)) : undefined,
        orden_ruta: r.orden_ruta ?? undefined, urgente: r.urgente, fecha_entregado_real: r.entregado_ms ?? undefined,
        creado: r.creado_ms, actualizado: r.act_ms, vendedorId: r.id_vendedor ?? undefined, version: r.version,
      },
      version: r.version, actualizadoMs: r.act_ms, actualizadoUs: r.act_us, final: ESTADOS_FINALES.has(r.estado),
      dueno: r.id_vendedor, extra: { vendedorCliente: r.vendedor_cliente },
    }))
  },
  async autorizarEscritura(c, u, w, ex) {
    const { rows } = await c.query(`SELECT id_vendedor FROM clientes WHERE id_cliente = $1`, [w.clienteId])
    if (!rows[0]) return 'El cliente de este pedido no existe en el servidor'
    if (!esAdmin(u)) {
      const propio = ex ? ex.dueno === u.id || ex.extra?.vendedorCliente === u.id : true
      if (!propio || rows[0].id_vendedor !== u.id) return 'Ese pedido no es de tu cartera'
      if (ex?.final) {
        const mismoEstado = ESTADO_A_DB[w.estado] === (ex.wire.estado === 'ENTREGADO' ? 'entregado' : 'omitido')
        if (!mismoEstado || firmaItems(w.items) !== firmaItems(ex.wire.items)) return 'El pedido ya está cerrado y no se puede cambiar'
      }
    }
    return null
  },
  async escribir(c, u, w, ex) {
    const { rows: cl } = await c.query(`SELECT id_vendedor FROM clientes WHERE id_cliente = $1`, [w.clienteId])
    const dueno = ex ? ex.dueno : esAdmin(u) ? (w.vendedorId ?? cl[0].id_vendedor ?? null) : u.id // igual que en clientes: lo cambia /clientes/reasignar
    const estado = ESTADO_A_DB[w.estado]
    const entregado = estado === 'entregado'
    // Sólo el administrador marca un pedido como urgente; una copia vieja del teléfono no lo quita. Cerrado, ya no lo es.
    const urgente = estado === 'pendiente' && (esAdmin(u) ? (w.urgente ?? ex?.wire.urgente ?? false) : (ex?.wire.urgente ?? false))
    if (ex?.final) {
      // Un pedido cerrado sólo lo corrige el administrador. Al vendedor se le acepta reenviarlo igual (autorizarEscritura),
      // p. ej. una entrega que el teléfono repite, pero no cambia nada: ni fecha, ni cobro, ni precios.
      if (!esAdmin(u)) return
      await c.query(`SELECT set_config('app.permitir_correccion', 'on', true)`)
    }

    if (!ex) {
      await c.query(
        `INSERT INTO pedidos (id_pedido, id_cliente, id_vendedor, fecha, creado_por, creado_en)
         VALUES ($1, $2, $3, $4, $5, LEAST(to_timestamp($6::float8 / 1000.0), now()))`,
        [w.id, w.clienteId, dueno, w.fecha, u.id, w.creado],
      )
    }
    await escribirDetalle(c, w.id, w.items, esAdmin(u))
    await c.query(
      `UPDATE pedidos
          SET id_cliente = $2, id_vendedor = $3, fecha = $4, estado = $5::estado_pedido,
              metodo_pago = CASE WHEN $6::text IS NOT NULL THEN $6::metodo_pago WHEN $7 THEN 'efectivo'::metodo_pago END,
              orden_ruta = $8, urgente = $10,
              fecha_entregado_real = CASE WHEN $9::float8 IS NOT NULL THEN to_timestamp($9::float8 / 1000.0) WHEN $7 THEN now() END,
              motivo_omision = CASE WHEN $5 = 'omitido' THEN coalesce(motivo_omision, 'Omitido desde la app') END
        WHERE id_pedido = $1`,
      [w.id, w.clienteId, dueno, w.fecha, estado, w.metodo_pago ? w.metodo_pago.toLowerCase() : null, entregado, w.orden_ruta ?? null, w.fecha_entregado_real ?? null, urgente],
    )
  },
  // RF-054: cuando el administrador agrega, cambia o urgente un pedido del día, el vendedor se entera.
  async avisarEscritura(c, u, w, ex, hoy) {
    if (!esAdmin(u) || ex?.final) return []
    const { rows: [p] } = await c.query(
      `SELECT p.id_vendedor, p.urgente, cl.nombre FROM pedidos p JOIN clientes cl USING (id_cliente) WHERE p.id_pedido = $1`,
      [w.id],
    )
    if (!p?.id_vendedor || p.id_vendedor === u.id) return []
    // Por unidad (catálogo flexible): «3 L», «60 L + 10 kg».
    const { rows: unidades } = await c.query(`SELECT id_producto, unidad FROM productos WHERE id_producto = ANY($1::uuid[])`, [w.items.map((i) => i.productoId)])
    const unidad = new Map(unidades.map((r) => [r.id_producto as string, r.unidad as string]))
    const litros = totalPorUnidad(w.items.map((i) => ({ unidad: unidad.get(i.productoId), cantidad: i.litros })))
    const datos = { pestana: 'ruta' as const, pedidoId: w.id }
    const aviso = (tipo: AvisoPendiente['tipo'], titulo: string, cuerpo: string): AvisoPendiente[] => [{ para: p.id_vendedor, tipo, titulo, cuerpo, datos }]

    if (p.urgente && !ex?.wire.urgente) return aviso('pedido_urgente', 'Pedido urgente', `${p.nombre}: ${litros}, entrégalo cuanto antes`)

    const antes = ex?.wire
    const eraDeHoy = antes?.fecha === hoy
    const esDeHoy = w.fecha === hoy
    if (!eraDeHoy && !esDeHoy) return []
    const ruta = (cuerpo: string) => aviso('ruta_modificada', 'Tu ruta cambió', cuerpo)
    if (!antes) return w.estado === 'PENDIENTE' ? ruta(`Nueva parada: ${p.nombre}, ${litros}`) : []
    if (antes.fecha !== w.fecha) return esDeHoy ? ruta(`Se agregó a tu ruta de hoy: ${p.nombre}`) : ruta(`${p.nombre} ya no se visita hoy`)
    if (antes.estado !== w.estado) return w.estado === 'PENDIENTE' ? ruta(`${p.nombre} volvió a tu ruta de hoy`) : ruta(`${p.nombre} se quitó de tu ruta de hoy`)
    if (firmaItems(antes.items) !== firmaItems(w.items)) return ruta(`Cambió el pedido de ${p.nombre}: ahora ${litros}`)
    return []
  },
  async avisarBorrado(c, u, ex, hoy) {
    if (!esAdmin(u) || ex.final || ex.wire.fecha !== hoy || !ex.dueno || ex.dueno === u.id) return []
    const { rows: [cl] } = await c.query(`SELECT nombre FROM clientes WHERE id_cliente = $1`, [ex.wire.clienteId])
    return [{ para: ex.dueno, tipo: 'ruta_modificada', titulo: 'Tu ruta cambió', cuerpo: `Se quitó el pedido de ${cl?.nombre ?? 'un cliente'} de tu ruta de hoy`, datos: { pestana: 'ruta' } }]
  },
  autorizarBorrado(u, ex) {
    if (esAdmin(u)) return null
    if (ex.final) return 'El pedido ya está cerrado y no se puede borrar'
    return ex.dueno === u.id || ex.extra?.vendedorCliente === u.id ? null : 'Ese pedido no es de tu cartera'
  },
  async borrar(c, id) {
    await c.query(`SELECT set_config('app.permitir_correccion', 'on', true)`)
    await c.query(`DELETE FROM pedidos WHERE id_pedido = $1`, [id])
  },
}

// ---------------------------------------------------------------- recordatorios
const recordatorios: Adaptador<RecordatorioWire> = {
  esquema: recordatorioWire,
  async listar(c, f) {
    const { rows } = await c.query(
      `SELECT r.*, ${MS('r.creado_en')} AS creado_ms, ${MS('r.actualizado_en')} AS act_ms, ${US('r.actualizado_en')} AS act_us
         FROM recordatorios r
        WHERE ($1::uuid IS NULL OR r.id_recordatorio = $1) AND ${DESDE.replace('%T', 'r')}
          AND ($3::uuid IS NULL OR r.id_vendedor = $3)
        ORDER BY r.actualizado_en, r.id_recordatorio ${f.bloquear ? 'FOR UPDATE' : ''}`,
      [f.id ?? null, f.desde ?? null, f.vendedor ?? null],
    )
    return rows.map((r) => ({
      wire: { id: r.id_recordatorio, clienteId: r.id_cliente, creado: r.creado_ms, hecho: r.estado !== 'pendiente', version: r.version },
      version: r.version, actualizadoMs: r.act_ms, actualizadoUs: r.act_us, final: false, dueno: r.id_vendedor,
    }))
  },
  async autorizarEscritura(c, u, w, ex) {
    if (esAdmin(u)) return null
    if (ex) return ex.dueno === u.id ? null : 'Ese recordatorio no es tuyo'
    const { rows } = await c.query(`SELECT id_vendedor FROM clientes WHERE id_cliente = $1`, [w.clienteId])
    return rows[0]?.id_vendedor === u.id ? null : 'Ese cliente no está en tu cartera'
  },
  async escribir(c, u, w, ex) {
    const dueno = ex ? ex.dueno : u.id
    if (!ex) {
      await c.query(
        `INSERT INTO recordatorios (id_recordatorio, id_cliente, id_vendedor, estado, creado_en, atendido_en)
         VALUES ($1, $2, $3, $4::estado_recordatorio, LEAST(to_timestamp($5::float8 / 1000.0), now()), CASE WHEN $6 THEN now() END)`,
        [w.id, w.clienteId, dueno, w.hecho ? 'atendido' : 'pendiente', w.creado, w.hecho],
      )
    } else {
      await c.query(
        `UPDATE recordatorios SET estado = $2::estado_recordatorio, atendido_en = CASE WHEN $3 THEN coalesce(atendido_en, now()) END WHERE id_recordatorio = $1`,
        [w.id, w.hecho ? 'atendido' : 'pendiente', w.hecho],
      )
    }
  },
  autorizarBorrado: (u, ex) => (esAdmin(u) || ex.dueno === u.id ? null : 'Ese recordatorio no es tuyo'),
  async borrar(c, id) {
    await c.query(`DELETE FROM recordatorios WHERE id_recordatorio = $1`, [id])
  },
}

export const ADAPTADORES = { productos, clientes, pedidos, recordatorios } as { [T in Tabla]: Adaptador<any> }
