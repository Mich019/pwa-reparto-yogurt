import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { hoyEn } from '../_lib/fechas.js'
import { app, cliente, config, crearEmpresa, db, op, pedido, pull, push, sesion } from './ayuda.js'

// Saldo de envases retornables: lo entregado menos lo que el cliente devuelve.

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function llamar(s: S, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as never })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const producto = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), sabor: 'Agua 20 L', descripcion: '', presentacion: 20, unidad: 'L', envase: 'garrafon', precio_litro: 2.5, costo_litro: 1, color_hex: '#7cc6f0', disponible: true, ...over })

async function escenario() {
  const empresa = await crearEmpresa()
  const admin = await sesion('administrador', 'tel-a', empresa)
  const ana = await sesion('vendedor', 'tel-v1', empresa)
  const beto = await sesion('vendedor', 'tel-v2', empresa)
  const garrafon = producto({ retornable: true })
  const botella = producto({ sabor: 'Agua 600 ml', presentacion: 0.6, envase: 'botella', precio_litro: 15 }) // no retornable
  await push(admin, [op('productos', garrafon.id, garrafon), op('productos', botella.id, botella)])
  const c = cliente({ nombre: 'Oficina Centro' })
  await push(ana, [op('clientes', c.id, c)])
  const hoy = hoyEn(config.zonaHoraria)
  const entrega = (p: { id: string; presentacion: number }, envases: number) => {
    const o = pedido(c.id, p.id, { fecha: hoy, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO', fecha_entregado_real: Date.now(), items: [{ productoId: p.id, litros: envases * p.presentacion, precio_litro: 2.5 }] })
    return push(ana, [op('pedidos', o.id, o)])
  }
  return { admin, ana, beto, c, garrafon, botella, entrega }
}

describe('envases retornables', () => {
  it('sólo cuentan los productos marcados retornables, y la marca viaja con el catálogo', async () => {
    const x = await escenario()
    await x.entrega(x.garrafon, 3)
    await x.entrega(x.botella, 6)
    const { body } = await llamar(x.ana, 'GET', '/envases')
    assert.equal(body.total, 3)
    assert.equal(body.clientes.length, 1)
    assert.equal(body.clientes[0].envases[0].prestados, 3)
    const cat = (await pull(x.ana)).body.productos as { id: string; retornable?: boolean }[]
    assert.equal(cat.find((p) => p.id === x.garrafon.id)?.retornable, true)
    assert.equal(cat.find((p) => p.id === x.botella.id)?.retornable, false)
  })

  it('lo que el cliente devuelve baja su saldo, sin pasar de lo prestado', async () => {
    const x = await escenario()
    await x.entrega(x.garrafon, 4)
    const recoger = (cantidad: number, s: S = x.ana) => llamar(s, 'POST', '/envases/recogidas', { clienteId: x.c.id, productoId: x.garrafon.id, cantidad })
    assert.equal((await recoger(3)).body.prestados, 1)
    assert.equal((await recoger(2)).status, 409)
    assert.equal((await recoger(1)).body.prestados, 0)
    assert.equal((await llamar(x.ana, 'GET', '/envases')).body.total, 0)
    const cuenta = (await llamar(x.admin, 'GET', `/envases/clientes/${x.c.id}`)).body
    assert.equal(cuenta.total, 0)
    assert.equal(cuenta.recogidas.length, 2)
  })

  it('cada vendedor trabaja con los suyos; sólo el administrador anula', async () => {
    const x = await escenario()
    await x.entrega(x.garrafon, 2)
    assert.equal((await llamar(x.beto, 'GET', '/envases')).body.total, 0)
    assert.equal((await llamar(x.beto, 'POST', '/envases/recogidas', { clienteId: x.c.id, productoId: x.garrafon.id, cantidad: 1 })).status, 404)
    const { body: r } = await llamar(x.ana, 'POST', '/envases/recogidas', { clienteId: x.c.id, productoId: x.garrafon.id, cantidad: 2 })
    assert.equal((await llamar(x.ana, 'POST', `/envases/recogidas/${r.id}/anular`)).status, 403)
    assert.equal((await llamar(x.admin, 'POST', `/envases/recogidas/${r.id}/anular`)).status, 200)
    assert.equal((await llamar(x.admin, 'GET', '/envases')).body.total, 2)
  })

  it('lo recogido hoy por cada quien, sin lo anulado (para «¡Ruta terminada!»)', async () => {
    const x = await escenario()
    await x.entrega(x.garrafon, 5)
    const recoger = (cantidad: number) => llamar(x.ana, 'POST', '/envases/recogidas', { clienteId: x.c.id, productoId: x.garrafon.id, cantidad })
    await recoger(2)
    const { body: r } = await recoger(1)
    assert.deepEqual((await llamar(x.ana, 'GET', '/envases/recogidas/hoy')).body.productos, [{ sabor: 'Agua 20 L', cantidad: 3 }])
    assert.equal((await llamar(x.beto, 'GET', '/envases/recogidas/hoy')).body.total, 0)
    await llamar(x.admin, 'POST', `/envases/recogidas/${r.id}/anular`)
    assert.equal((await llamar(x.ana, 'GET', '/envases/recogidas/hoy')).body.total, 2)
  })
})
