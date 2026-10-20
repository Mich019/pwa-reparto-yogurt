import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { tx, type Db } from './db.js'
import { hoyEn } from './fechas.js'
import type { AvisoPendiente, Despachador } from './notificaciones.js'

// RF-037 · Control de stock diario: los litros que se produjeron de cada sabor y los que se le entregan a cada
// vendedor al empezar la jornada. El vendedor recibe el suyo con la sincronización (/sync/pull, `stock`) y la app
// le resta lo que va entregando; todo lo demás es del administrador.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
type Consulta = Pick<Db, 'query'>

const fechaIso = z.iso.date()
const litros = z.number().finite().min(0).max(99999)
const redondear = (n: number) => Math.round(n * 100) / 100
const sinRepetidos = (l: { productoId: string }[]) => new Set(l.map((x) => x.productoId)).size === l.length

const queryDia = z.object({ fecha: fechaIso })
const idVendedor = z.object({ id: z.uuid() })
const bodyProduccion = z.object({
  fecha: fechaIso,
  lineas: z.array(z.object({ productoId: z.uuid(), litros })).min(1).max(200).refine(sinRepetidos, 'Un sabor aparece dos veces'),
})
const bodyCarga = z.object({
  fecha: fechaIso,
  lineas: z.array(z.object({ productoId: z.uuid(), asignada: litros, devuelta: litros.optional() })).min(1).max(200).refine(sinRepetidos, 'Un sabor aparece dos veces'),
})
const bodyCopiar = z.object({ desde: fechaIso, hacia: fechaIso })

export interface LineaStock { productoId: string; asignada: number; devuelta: number; entregado: number }
export interface DiaStock {
  fecha: string
  productos: { id: string; sabor: string; color: string; disponible: boolean }[] // para pintar la pantalla sin depender del catálogo del teléfono
  produccion: { productoId: string; litros: number }[]
  vendedores: { id: string; nombre: string; activo: boolean; lineas: LineaStock[] }[]
}

class Falla extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje)
  }
}

// El día completo: lo producido, y por vendedor lo asignado, lo devuelto y lo que ya entregó según sus pedidos.
export async function leerDia(q: Consulta, fecha: string): Promise<DiaStock> {
  const [{ rows: catalogo }, { rows: prod }, { rows: vend }, { rows: stock }, { rows: entregas }] = await Promise.all([
    q.query(`SELECT id_producto, sabor, color_hex, disponible FROM productos ORDER BY lower(sabor), id_producto`),
    q.query(`SELECT id_producto, litros::float8 AS litros FROM produccion_diaria WHERE fecha = $1 ORDER BY id_producto`, [fecha]),
    q.query(
      `SELECT u.id_usuario, u.nombre, u.activo FROM usuarios u
        WHERE u.rol = 'vendedor' AND (u.activo OR EXISTS (SELECT 1 FROM stock_diario s WHERE s.id_vendedor = u.id_usuario AND s.fecha = $1))
        ORDER BY lower(u.nombre), u.id_usuario`,
      [fecha],
    ),
    q.query(`SELECT id_vendedor, id_producto, cantidad_asignada::float8 AS asignada, cantidad_devuelta::float8 AS devuelta FROM stock_diario WHERE fecha = $1`, [fecha]),
    q.query(
      `SELECT p.id_vendedor, d.id_producto, sum(d.cantidad * pr.presentacion_litros)::float8 AS litros
         FROM pedidos p JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
        WHERE p.fecha = $1 AND p.estado = 'entregado' AND p.id_vendedor IS NOT NULL
        GROUP BY p.id_vendedor, d.id_producto`,
      [fecha],
    ),
  ])
  const lineas = new Map<string, Map<string, LineaStock>>()
  const linea = (v: string, p: string) => {
    const m = lineas.get(v) ?? lineas.set(v, new Map()).get(v)!
    return m.get(p) ?? m.set(p, { productoId: p, asignada: 0, devuelta: 0, entregado: 0 }).get(p)!
  }
  for (const s of stock) Object.assign(linea(s.id_vendedor, s.id_producto), { asignada: s.asignada, devuelta: s.devuelta })
  for (const e of entregas) linea(e.id_vendedor, e.id_producto).entregado = redondear(e.litros)
  return {
    fecha,
    productos: catalogo.map((r) => ({ id: r.id_producto, sabor: r.sabor, color: r.color_hex, disponible: r.disponible })),
    produccion: prod.map((r) => ({ productoId: r.id_producto, litros: r.litros })),
    vendedores: vend.map((v) => ({
      id: v.id_usuario,
      nombre: v.nombre,
      activo: v.activo,
      lineas: [...(lineas.get(v.id_usuario)?.values() ?? [])].filter((l) => l.asignada > 0 || l.devuelta > 0 || l.entregado > 0),
    })),
  }
}

// «Tu carga de hoy: Fresa 5 L, Mango 7 L · 12 L en total»
async function avisoDeCarga(c: Consulta, idVendedor: string, fecha: string, hoy: string, teniaCarga: boolean): Promise<AvisoPendiente | null> {
  if (fecha < hoy) return null // corregir un día que ya pasó no le dice nada al vendedor
  const { rows } = await c.query(
    `SELECT pr.sabor, s.cantidad_asignada::float8 AS litros FROM stock_diario s JOIN productos pr USING (id_producto)
      WHERE s.fecha = $1 AND s.id_vendedor = $2 AND s.cantidad_asignada > 0 ORDER BY pr.sabor`,
    [fecha, idVendedor],
  )
  const total = redondear(rows.reduce((s, r) => s + r.litros, 0))
  const dia = fecha === hoy ? 'de hoy' : `del ${fecha.slice(8)}/${fecha.slice(5, 7)}`
  return {
    para: idVendedor,
    tipo: 'stock_asignado',
    titulo: teniaCarga ? `Cambió tu carga ${dia}` : `Tu carga ${dia}`,
    cuerpo: rows.length ? `${rows.map((r) => `${r.sabor} ${redondear(r.litros)} L`).join(', ')} · ${total} L en total` : 'Hoy no tienes carga asignada',
    datos: { pestana: 'stock' },
  }
}

async function existenProductos(c: Consulta, ids: string[]) {
  const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM productos WHERE id_producto = ANY($1::uuid[])`, [ids])
  if (n !== ids.length) throw new Falla(404, 'Alguno de los sabores no existe')
}

export async function rutasStock(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }, despachador: Despachador) {
  const responder = (rep: FastifyReply, e: unknown) => {
    if (e instanceof Falla) return rep.code(e.status).send({ error: e.message })
    throw e
  }

  app.get('/stock', { preHandler: requiereAdmin }, async (req, rep) => {
    const q = queryDia.safeParse(req.query)
    if (!q.success) return rep.code(400).send({ error: 'Indica la fecha (AAAA-MM-DD)' })
    return leerDia(db, q.data.fecha)
  })

  // Litros producidos de cada sabor ese día.
  app.put('/stock/produccion', { preHandler: requiereAdmin }, async (req, rep) => {
    const b = bodyProduccion.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica la fecha y los litros producidos de cada sabor' })
    try {
      await tx(db, req.usuario.id, async (c) => {
        await existenProductos(c, b.data.lineas.map((l) => l.productoId))
        await c.query(
          `INSERT INTO produccion_diaria (fecha, id_producto, litros)
           SELECT $1::date, p, l FROM unnest($2::uuid[], $3::numeric[]) AS x(p, l)
           ON CONFLICT (fecha, id_producto) DO UPDATE SET litros = EXCLUDED.litros, actualizado_en = now()`,
          [b.data.fecha, b.data.lineas.map((l) => l.productoId), b.data.lineas.map((l) => redondear(l.litros))],
        )
      })
    } catch (e) {
      return responder(rep, e)
    }
    return leerDia(db, b.data.fecha)
  })

  // La carga de un vendedor ese día: lo que se le asigna de cada sabor y, al cerrar, lo que devuelve.
  app.put('/stock/vendedor/:id', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idVendedor.safeParse(req.params)
    const b = bodyCarga.safeParse(req.body)
    if (!p.success || !b.success) return rep.code(400).send({ error: 'Indica la fecha y los litros de cada sabor' })
    const { fecha, lineas } = b.data
    const hoy = hoyEn(config.zonaHoraria)
    let avisos: AvisoPendiente[] = []
    try {
      await tx(db, req.usuario.id, async (c) => {
        const { rows: [v] } = await c.query(`SELECT activo FROM usuarios WHERE id_usuario = $1 AND rol = 'vendedor' FOR UPDATE`, [p.data.id])
        if (!v) throw new Falla(404, 'Ese vendedor no existe')
        await existenProductos(c, lineas.map((l) => l.productoId))

        const { rows: previas } = await c.query(
          `SELECT s.id_producto, pr.sabor, s.cantidad_asignada::float8 AS asignada, s.cantidad_devuelta::float8 AS devuelta
             FROM stock_diario s JOIN productos pr USING (id_producto) WHERE s.fecha = $1 AND s.id_vendedor = $2 FOR UPDATE OF s`,
          [fecha, p.data.id],
        )
        const previa = new Map(previas.map((r) => [r.id_producto as string, r]))
        const { rows: nombres } = await c.query(`SELECT id_producto, sabor FROM productos WHERE id_producto = ANY($1::uuid[])`, [lineas.map((l) => l.productoId)])
        const sabor = new Map(nombres.map((r) => [r.id_producto as string, r.sabor as string]))

        const filas = lineas.map((l) => {
          const asignada = redondear(l.asignada)
          const devuelta = redondear(l.devuelta ?? previa.get(l.productoId)?.devuelta ?? 0)
          if (devuelta > asignada) throw new Falla(400, `Lo devuelto de ${sabor.get(l.productoId)} no puede ser más de lo asignado`)
          return { productoId: l.productoId, asignada, devuelta }
        })
        if (!v.activo && filas.some((f) => f.asignada > (previa.get(f.productoId)?.asignada ?? 0))) {
          throw new Falla(409, 'Ese vendedor está dado de baja: no se le puede asignar más')
        }

        const { rowCount } = await c.query(
          `INSERT INTO stock_diario AS s (fecha, id_producto, id_vendedor, cantidad_asignada, cantidad_devuelta)
           SELECT $1::date, p, $2::uuid, a, d FROM unnest($3::uuid[], $4::numeric[], $5::numeric[]) AS x(p, a, d)
           ON CONFLICT (fecha, id_producto, id_vendedor) DO UPDATE
             SET cantidad_asignada = EXCLUDED.cantidad_asignada, cantidad_devuelta = EXCLUDED.cantidad_devuelta
           WHERE (s.cantidad_asignada, s.cantidad_devuelta) IS DISTINCT FROM (EXCLUDED.cantidad_asignada, EXCLUDED.cantidad_devuelta)`,
          [fecha, p.data.id, filas.map((f) => f.productoId), filas.map((f) => f.asignada), filas.map((f) => f.devuelta)],
        )
        // Sólo se avisa si cambió lo asignado, no si sólo se registró una devolución o se guardó lo mismo.
        const cambioLoAsignado = filas.some((f) => f.asignada !== (previa.get(f.productoId)?.asignada ?? 0))
        if (rowCount && cambioLoAsignado) {
          const aviso = await avisoDeCarga(c, p.data.id, fecha, hoy, previas.some((r) => r.asignada > 0))
          if (aviso) avisos = [aviso]
        }
      })
    } catch (e) {
      return responder(rep, e)
    }
    await despachador.despachar(avisos)
    return leerDia(db, fecha)
  })

  // «Repetir la carga de ayer»: copia lo asignado de un día a otro, sin pisar lo que ya se haya capturado.
  app.post('/stock/copiar', { preHandler: requiereAdmin }, async (req, rep) => {
    const b = bodyCopiar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica de qué día a qué día copiar' })
    if (b.data.desde === b.data.hacia) return rep.code(400).send({ error: 'Elige dos días distintos' })
    const hoy = hoyEn(config.zonaHoraria)
    const avisos: AvisoPendiente[] = []
    const copiadas = await tx(db, req.usuario.id, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO stock_diario (fecha, id_producto, id_vendedor, cantidad_asignada)
         SELECT $2::date, s.id_producto, s.id_vendedor, s.cantidad_asignada
           FROM stock_diario s
           JOIN usuarios u ON u.id_usuario = s.id_vendedor AND u.activo AND u.rol = 'vendedor'
           JOIN productos pr ON pr.id_producto = s.id_producto AND pr.disponible
          WHERE s.fecha = $1 AND s.cantidad_asignada > 0
         ON CONFLICT (fecha, id_producto, id_vendedor) DO NOTHING
         RETURNING id_vendedor`,
        [b.data.desde, b.data.hacia],
      )
      for (const v of new Set(rows.map((r) => r.id_vendedor as string))) {
        const aviso = await avisoDeCarga(c, v, b.data.hacia, hoy, false)
        if (aviso) avisos.push(aviso)
      }
      return rows.length
    })
    await despachador.despachar(avisos)
    return { copiadas, ...(await leerDia(db, b.data.hacia)) }
  })
}
