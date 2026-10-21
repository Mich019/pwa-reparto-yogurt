import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { app, db, sesion } from './ayuda.js'

// Resumen del panel del administrador (GET /admin/stats).

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function stats(s: S, fecha?: string) {
  const r = await app.inject({ method: 'GET', url: `/admin/stats${fecha ? `?fecha=${fecha}` : ''}`, headers: { authorization: `Bearer ${s.token}` } })
  return { status: r.statusCode, body: r.json() }
}

describe('resumen del administrador', () => {
  it('sólo lo ve el administrador y rechaza fechas inválidas', async () => {
    const vend = (await sesion('vendedor')) as S
    const admin = (await sesion('administrador')) as S
    assert.equal((await stats(vend)).status, 403)
    assert.equal((await stats(admin, 'ayer')).status, 400)
    const r = await stats(admin)
    assert.equal(r.status, 200)
    assert.match(r.body.fecha, /^\d{4}-\d{2}-\d{2}$/)
  })

  it('cuenta los pedidos del día pedido y deja fuera los cancelados de lo esperado y los litros', async () => {
    const admin = (await sesion('administrador')) as S
    const fecha = '2099-03-14' // un día propio: ninguna otra prueba agenda pedidos aquí
    const { rows: [prod] } = await db.query(`SELECT id_producto, sabor FROM productos WHERE presentacion_litros = 1 LIMIT 1`)
    const { rows: [cli] } = await db.query(`INSERT INTO clientes (nombre, direccion) VALUES ('Stats', 'Calle 1') RETURNING id_cliente`)
    // El detalle va antes del estado: un pedido entregado o cancelado ya no deja cambiar su detalle.
    const nuevo = async (estado: string, litros: number) => {
      const { rows: [p] } = await db.query(`INSERT INTO pedidos (id_cliente, fecha) VALUES ($1, $2) RETURNING id_pedido`, [cli.id_cliente, fecha])
      await db.query(`INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, costo_unitario) VALUES ($1, $2, $3, 50, 20)`, [p.id_pedido, prod.id_producto, litros])
      const entregado = estado === 'entregado'
      await db.query(
        `UPDATE pedidos SET estado = $2, metodo_pago = $3, fecha_entregado_real = $4 WHERE id_pedido = $1`,
        [p.id_pedido, estado, entregado ? 'efectivo' : null, entregado ? new Date() : null],
      )
    }
    try {
      await nuevo('entregado', 2)
      await nuevo('pendiente', 3)
      await nuevo('cancelado', 10)
      const { body } = await stats(admin, fecha)
      assert.equal(body.fecha, fecha)
      assert.equal(body.pedidosHoy.total, 3)
      assert.equal(body.pedidosHoy.entregados, 1)
      assert.equal(body.pedidosHoy.cancelados, 1)
      assert.equal(body.pedidosHoy.totalCobrado, 100)
      assert.equal(body.pedidosHoy.totalEsperado, 250)
      assert.equal(body.pedidosHoy.litrosHoy, 5)
      assert.deepEqual(body.saboresTop.map((s: { sabor: string; litros: number }) => [s.sabor, s.litros]), [[prod.sabor, 5]])
    } finally {
      await db.query(`DELETE FROM pedidos WHERE id_cliente = $1`, [cli.id_cliente])
      await db.query(`DELETE FROM clientes WHERE id_cliente = $1`, [cli.id_cliente])
    }
  })
})
