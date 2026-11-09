import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { app, cliente, crearEmpresa, db, op, pedido, pull, push, sesion } from './ayuda.js'

// Precio especial por cliente: gana al de lista en sus pedidos nuevos y viaja con el cliente al teléfono.

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function llamar(s: S, method: 'GET' | 'PUT', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as never })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const fresa = () => ({ id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#f472b6', disponible: true })

async function escenario() {
  const empresa = await crearEmpresa()
  const admin = await sesion('administrador', 'tel-a', empresa)
  const ana = await sesion('vendedor', 'tel-v1', empresa)
  const s = fresa()
  await push(admin, [op('productos', s.id, s)])
  const mayorista = cliente({ nombre: 'Mayorista' })
  const normal = cliente({ nombre: 'Normal' })
  await push(ana, [op('clientes', mayorista.id, mayorista), op('clientes', normal.id, normal)])
  return { admin, ana, s, mayorista, normal }
}
const precioDeLinea = async (idPedido: string) => Number((await db.query(`SELECT precio_unitario FROM detalle_pedido WHERE id_pedido = $1`, [idPedido])).rows[0].precio_unitario)

describe('límite de fiado por cliente', () => {
  it('lo pone el administrador, viaja con el cliente al teléfono y null lo quita', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.ana, 'PUT', `/clientes/${x.mayorista.id}/limite-fiado`, { limite: 500 })).status, 403)
    assert.equal((await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/limite-fiado`, { limite: -1 })).status, 400)
    assert.equal((await llamar(x.admin, 'PUT', `/clientes/${randomUUID()}/limite-fiado`, { limite: 1 })).status, 404)
    const r = await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/limite-fiado`, { limite: 500 })
    assert.equal(r.status, 200)
    const delTelefono = async (id: string) => (await pull(x.ana)).body.clientes.find((c: { id: string }) => c.id === id)
    assert.equal((await delTelefono(x.mayorista.id)).limiteFiado, 500)
    assert.equal((await delTelefono(x.normal.id)).limiteFiado, undefined)
    // Lo que el teléfono sube no lo cambia.
    const editado = { ...(await delTelefono(x.mayorista.id)), limiteFiado: 99999, nombre: 'Mayorista Centro' }
    assert.equal((await push(x.ana, [op('clientes', editado.id, editado)])).body.resultados[0].estado, 'aplicada')
    assert.equal((await delTelefono(x.mayorista.id)).limiteFiado, 500)
    await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/limite-fiado`, { limite: null })
    assert.equal((await delTelefono(x.mayorista.id)).limiteFiado, undefined)
  })
})

describe('precio especial por cliente', () => {
  it('el pedido nuevo del cliente sale con su precio; el de otro cliente, con el de lista', async () => {
    const x = await escenario()
    const r = await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: x.s.id, precioLitro: 48 }] })
    assert.equal(r.status, 200)
    assert.equal(r.body.precios[0].precioLitro, 48)
    assert.equal(r.body.precios[0].lista, 60)
    // El vendedor manda el precio de lista desde su teléfono; el servidor pone el especial.
    const p1 = pedido(x.mayorista.id, x.s.id)
    const p2 = pedido(x.normal.id, x.s.id)
    await push(x.ana, [op('pedidos', p1.id, p1), op('pedidos', p2.id, p2)])
    assert.equal(await precioDeLinea(p1.id), 48)
    assert.equal(await precioDeLinea(p2.id), 60)
  })

  it('el teléfono del vendedor recibe los precios de su cliente; null los quita', async () => {
    const x = await escenario()
    await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: x.s.id, precioLitro: 50 }] })
    const conPrecio = (await pull(x.ana)).body.clientes.find((c: { id: string }) => c.id === x.mayorista.id)
    assert.deepEqual(conPrecio.precios, { [x.s.id]: 50 })
    const otro = (await pull(x.ana)).body.clientes.find((c: { id: string }) => c.id === x.normal.id)
    assert.equal(otro.precios, undefined)
    await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: x.s.id, precioLitro: null }] })
    const sin = (await pull(x.ana)).body.clientes.find((c: { id: string }) => c.id === x.mayorista.id)
    assert.equal(sin.precios, undefined)
  })

  it('sólo el administrador los cambia y el producto debe existir', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.ana, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: x.s.id, precioLitro: 1 }] })).status, 403)
    assert.equal((await llamar(x.ana, 'GET', `/clientes/${x.mayorista.id}/precios`)).status, 403)
    assert.equal((await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: randomUUID(), precioLitro: 5 }] })).status, 400)
    assert.equal((await llamar(x.admin, 'PUT', `/clientes/${randomUUID()}/precios`, { precios: [{ productoId: x.s.id, precioLitro: 5 }] })).status, 404)
    assert.equal((await llamar(x.admin, 'PUT', `/clientes/${x.mayorista.id}/precios`, { precios: [{ productoId: x.s.id, precioLitro: 0 }] })).status, 400)
  })
})
