import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Contexto } from './app.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

export async function rutasAdmin(
  app: FastifyInstance,
  { db }: Contexto,
  { requiereAdmin }: { requiereAdmin: Guardia },
) {
  const pre = { preHandler: requiereAdmin }

  // Métricas y KPIs en tiempo real para el Dashboard del Administrador
  app.get('/admin/stats', pre, async () => {
    // 1. Usuarios / Vendedores
    const { rows: [u] } = await db.query(`
      SELECT 
        count(*)::int AS total,
        count(*) FILTER (WHERE activo)::int AS activos,
        count(*) FILTER (WHERE rol = 'vendedor' AND activo)::int AS vendedores_activos,
        count(*) FILTER (WHERE rol = 'vendedor')::int AS total_vendedores
      FROM usuarios
    `)

    // 2. Clientes
    const { rows: [c] } = await db.query(`
      SELECT 
        count(*)::int AS total,
        count(*) FILTER (WHERE activo)::int AS activos,
        count(*) FILTER (WHERE id_vendedor IS NULL AND activo)::int AS sin_vendedor
      FROM clientes
    `)

    // 3. Productos / Catálogo
    const { rows: [pr] } = await db.query(`
      SELECT 
        count(*)::int AS total,
        count(*) FILTER (WHERE disponible)::int AS disponibles
      FROM productos
    `)

    // 4. Pedidos del día de hoy
    const { rows: [p] } = await db.query(`
      SELECT 
        count(*)::int AS total,
        count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
        count(*) FILTER (WHERE estado = 'en_camino')::int AS en_camino,
        count(*) FILTER (WHERE estado = 'entregado')::int AS entregados,
        count(*) FILTER (WHERE estado = 'omitido')::int AS omitidos,
        count(*) FILTER (WHERE estado = 'cancelado')::int AS cancelados,
        coalesce(sum(total) FILTER (WHERE estado = 'entregado'), 0)::float8 AS total_cobrado,
        coalesce(sum(total), 0)::float8 AS total_esperado
      FROM pedidos
      WHERE fecha = CURRENT_DATE
    `)

    // 5. Litros programados / vendidos hoy
    const { rows: [lit] } = await db.query(`
      SELECT 
        coalesce(sum(d.cantidad * prod.presentacion_litros), 0)::float8 AS litros_hoy
      FROM detalle_pedido d
      JOIN pedidos ped ON d.id_pedido = ped.id_pedido
      JOIN productos prod ON d.id_producto = prod.id_producto
      WHERE ped.fecha = CURRENT_DATE
    `)

    // 6. Sabores con más demanda hoy
    const { rows: saboresTop } = await db.query(`
      SELECT 
        prod.sabor,
        prod.color_hex AS color,
        coalesce(sum(d.cantidad * prod.presentacion_litros), 0)::float8 AS litros
      FROM detalle_pedido d
      JOIN pedidos ped ON d.id_pedido = ped.id_pedido
      JOIN productos prod ON d.id_producto = prod.id_producto
      WHERE ped.fecha = CURRENT_DATE
      GROUP BY prod.sabor, prod.color_hex
      ORDER BY litros DESC
      LIMIT 4
    `)

    return {
      vendedores: {
        total: u?.total_vendedores ?? 0,
        activos: u?.vendedores_activos ?? 0,
      },
      clientes: {
        total: c?.total ?? 0,
        activos: c?.activos ?? 0,
        sinVendedor: c?.sin_vendedor ?? 0,
      },
      productos: {
        total: pr?.total ?? 0,
        disponibles: pr?.disponibles ?? 0,
      },
      pedidosHoy: {
        total: p?.total ?? 0,
        pendientes: p?.pendientes ?? 0,
        enCamino: p?.en_camino ?? 0,
        entregados: p?.entregados ?? 0,
        omitidos: p?.omitidos ?? 0,
        cancelados: p?.cancelados ?? 0,
        totalCobrado: p?.total_cobrado ?? 0,
        totalEsperado: p?.total_esperado ?? 0,
        litrosHoy: lit?.litros_hoy ?? 0,
      },
      saboresTop: (saboresTop ?? []).map((s) => ({
        sabor: s.sabor as string,
        color: s.color as string,
        litros: Number(s.litros),
      })),
    }
  })
}
