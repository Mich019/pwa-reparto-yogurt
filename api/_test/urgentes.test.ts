import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { hoyEn } from '../_lib/fechas.js'
import { callado } from '../_lib/bitacora.js'
import { crearDespachador } from '../_lib/notificaciones.js'
import { avisarUrgentesSinAtender } from '../_lib/urgentes.js'
import { avisarProduccionPendiente } from '../_lib/produccion.js'
import { app, cliente, config, crearEmpresa, db, op, pedido, push, sesion } from './ayuda.js'

// Pedido urgente sin atender (urgentes.ts): a los 30 minutos se le recuerda al vendedor y se avisa a los administradores.

after(async () => { await app.close(); await db.end() })
const despachador = crearDespachador(db, null, callado)
async function unSabor(admin: Parameters<typeof push>[0]) {
  const s = { id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#f472b6', disponible: true }
  assert.equal((await push(admin, [op('productos', s.id, s)])).body.resultados[0].estado, 'aplicada')
  return s
}
const de = async (ids: string[]) =>
  (await db.query(`SELECT id_usuario, titulo, cuerpo, datos FROM notificaciones WHERE tipo = 'urgente_sin_atender' AND id_usuario = ANY($1::uuid[])`, [ids])).rows

describe('producción pendiente para mañana', () => {
  it('avisa a los administradores lo que falta producir de los pedidos de mañana, una vez por día', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const c = cliente()
    assert.equal((await push(vend, [op('clientes', c.id, c)])).body.resultados[0].estado, 'aplicada')
    const producto = await unSabor(admin)
    const { rows: [{ manana }] } = await db.query(`SELECT to_char((now() AT TIME ZONE zona_horaria)::date + 1, 'YYYY-MM-DD') AS manana FROM empresas WHERE id_empresa = $1`, [empresa])
    const p = { ...pedido(c.id, producto.id, { fecha: manana, items: [{ productoId: producto.id, litros: 12, precio_litro: 60 }] }), vendedorId: vend.id }
    assert.equal((await push(admin, [op('pedidos', p.id, p)])).body.resultados[0].estado, 'aplicada')
    const avisos = async () => (await db.query(`SELECT id_usuario, cuerpo, datos FROM notificaciones WHERE tipo = 'produccion_pendiente' AND id_empresa = $1`, [empresa])).rows
    const revisar = (horaDesde = 0) => avisarProduccionPendiente(db, despachador, { horaDesde, idEmpresa: empresa, esperar: true })

    await revisar(25) // antes de la hora: nada
    assert.equal((await avisos()).length, 0)
    // Con 4 L ya anotados, faltan 8.
    await db.query(`INSERT INTO produccion_diaria (id_empresa, fecha, id_producto, litros) VALUES ($1, $2, $3, 4)`, [empresa, manana, producto.id])
    assert.equal(await revisar(), 1)
    const [a] = await avisos()
    assert.equal(a.id_usuario, admin.id) // sólo a los administradores
    assert.match(a.cuerpo, /Fresa 8 L/)
    assert.deepEqual([a.datos.fecha, a.datos.url], [manana, '/admin?ir=produccion'])
    assert.equal(await revisar(), 0) // una vez por día
    assert.equal((await avisos()).length, 1)
  })

  it('no avisa si lo de mañana ya está producido', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const c = cliente()
    assert.equal((await push(admin, [op('clientes', c.id, c)])).body.resultados[0].estado, 'aplicada')
    const producto = await unSabor(admin)
    const { rows: [{ manana }] } = await db.query(`SELECT to_char((now() AT TIME ZONE zona_horaria)::date + 1, 'YYYY-MM-DD') AS manana FROM empresas WHERE id_empresa = $1`, [empresa])
    const p = pedido(c.id, producto.id, { fecha: manana })
    assert.equal((await push(admin, [op('pedidos', p.id, p)])).body.resultados[0].estado, 'aplicada')
    await db.query(`INSERT INTO produccion_diaria (id_empresa, fecha, id_producto, litros) VALUES ($1, $2, $3, 3)`, [empresa, manana, producto.id])
    assert.equal(await avisarProduccionPendiente(db, despachador, { horaDesde: 0, idEmpresa: empresa, esperar: true }), 0)
  })
})

describe('urgente sin atender', () => {
  it('avisa una vez a los 30 minutos, al vendedor y a los administradores, y no si ya se entregó', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const otroAdmin = await sesion('administrador', 'tel-b', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const c = cliente({ nombre: 'Doña Lupita' })
    assert.equal((await push(vend, [op('clientes', c.id, c)])).body.resultados[0].estado, 'aplicada')
    const producto = await unSabor(admin)
    const hoy = hoyEn(config.zonaHoraria)
    const p = { ...pedido(c.id, producto.id, { fecha: hoy, urgente: true }), vendedorId: vend.id }
    const q = { ...pedido(c.id, producto.id, { fecha: hoy, urgente: true }), vendedorId: vend.id }
    assert.equal((await push(admin, [op('pedidos', p.id, p), op('pedidos', q.id, q)])).body.resultados[1].estado, 'aplicada')
    const todos = [admin.id, otroAdmin.id, vend.id]

    // Recién marcado: todavía no.
    await avisarUrgentesSinAtender(db, despachador, null, true)
    assert.equal((await de(todos)).length, 0)

    // Pasaron 40 minutos y q ya se entregó: sólo p.
    await db.query(`UPDATE notificaciones SET creado_en = now() - interval '40 minutes' WHERE tipo = 'pedido_urgente' AND id_usuario = $1`, [vend.id])
    await db.query(`UPDATE pedidos SET estado = 'entregado', fecha_entregado_real = now(), metodo_pago = 'efectivo' WHERE id_pedido = $1`, [q.id])
    await avisarUrgentesSinAtender(db, despachador, null, true)
    const avisos = await de(todos)
    assert.equal(avisos.length, 3)
    assert.deepEqual(new Set(avisos.map((a) => a.id_usuario)), new Set(todos))
    for (const a of avisos) {
      assert.match(a.cuerpo, /Doña Lupita/)
      assert.deepEqual(a.datos.pedidoIds ?? [a.datos.pedidoId], [p.id])
    }
    assert.equal(avisos.find((a) => a.id_usuario === admin.id).datos.url, '/admin')

    // Una sola vez.
    await avisarUrgentesSinAtender(db, despachador, null, true)
    assert.equal((await de(todos)).length, 3)
  })

  it('cada empresa elige cuántos minutos espera', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const cambio = await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { minutosUrgente: 60 } })
    assert.equal(cambio.json().minutosUrgente, 60)
    const malo = await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { minutosUrgente: 2 } })
    assert.equal(malo.statusCode, 400)
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const producto = await unSabor(admin)
    const p = { ...pedido(c.id, producto.id, { fecha: hoyEn(config.zonaHoraria), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)])
    const hace = (min: number) => db.query(`UPDATE notificaciones SET creado_en = now() - make_interval(mins => $2) WHERE tipo = 'pedido_urgente' AND id_usuario = $1`, [vend.id, min])
    await hace(40)
    await avisarUrgentesSinAtender(db, despachador, null, true)
    assert.equal((await de([admin.id, vend.id])).length, 0) // a los 40 todavía no: eligió una hora
    await hace(65)
    await avisarUrgentesSinAtender(db, despachador, null, true)
    assert.equal((await de([admin.id, vend.id])).length, 2)
  })

  it('cada administrador lo puede apagar en Preferencias', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const r = await app.inject({ method: 'PATCH', url: '/me', headers: { authorization: `Bearer ${admin.token}` }, payload: { avisosApagados: ['urgente_sin_atender'] } })
    assert.equal(r.statusCode, 200)
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const producto = await unSabor(admin)
    const p = { ...pedido(c.id, producto.id, { fecha: hoyEn(config.zonaHoraria), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)])
    await db.query(`UPDATE notificaciones SET creado_en = now() - interval '40 minutes' WHERE tipo = 'pedido_urgente' AND id_usuario = $1`, [vend.id])
    await avisarUrgentesSinAtender(db, despachador, null, true)
    assert.deepEqual((await de([admin.id, vend.id])).map((a) => a.id_usuario), [vend.id])
  })
})
