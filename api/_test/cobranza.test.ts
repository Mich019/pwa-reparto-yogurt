import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { hoyEn } from '../_lib/fechas.js'
import { avisarFiadoAtrasado } from '../_lib/cobranza.js'
import { crearDespachador } from '../_lib/notificaciones.js'
import { cifrasDeAyer } from '../_lib/resumen.js'
import { correoResumen } from '../_lib/correo.js'
import { app, cliente, config, crearEmpresa, db, op, pedido, push, sesion } from './ayuda.js'

// Fiado: lo vendido a crédito suma a lo que debe el cliente, los abonos lo bajan.

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function llamar(s: S, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as never })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const sabor = () => ({ id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#f472b6', disponible: true })

// Una empresa propia con su administrador, dos vendedores y un cliente de uno de ellos con ventas a crédito.
async function escenario() {
  const empresa = await crearEmpresa()
  const admin = await sesion('administrador', 'tel-a', empresa)
  const ana = await sesion('vendedor', 'tel-v1', empresa)
  const beto = await sesion('vendedor', 'tel-v2', empresa)
  const s = sabor()
  assert.equal((await push(admin, [op('productos', s.id, s)])).body.resultados[0].estado, 'aplicada')
  const c = cliente({ nombre: 'Tienda Fiada' })
  assert.equal((await push(ana, [op('clientes', c.id, c)])).body.resultados[0].estado, 'aplicada')
  const hoy = hoyEn(config.zonaHoraria)
  const entrega = (metodo: string, litros: number, fecha = hoy) => {
    const p = pedido(c.id, s.id, { fecha, estado: 'ENTREGADO', metodo_pago: metodo, fecha_entregado_real: Date.now(), items: [{ productoId: s.id, litros, precio_litro: 60 }] })
    return push(ana, [op('pedidos', p.id, p)])
  }
  return { empresa, admin, ana, beto, c, s, hoy, entrega }
}

describe('fiado', () => {
  it('el límite de fiado: el de la empresa vale si el cliente no tiene uno propio, y el aviso dice quién lo pasó', async () => {
    const x = await escenario()
    const empresa = (payload: object) => app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${x.admin.token}` }, payload })
    assert.equal((await empresa({ limiteFiado: -5 })).statusCode, 400)
    assert.equal((await empresa({ limiteFiado: 100 })).json().limiteFiado, 100)
    assert.equal((await x.entrega('CREDITO', 3, hoyEn(config.zonaHoraria, new Date(Date.now() - 40 * 86_400_000)))).body.resultados[0].estado, 'aplicada') // $180
    const deudor = async () => (await llamar(x.admin, 'GET', '/cobranza')).body.deudores[0]
    assert.equal((await deudor()).limite, 100)
    await app.inject({ method: 'PUT', url: `/clientes/${x.c.id}/limite-fiado`, headers: { authorization: `Bearer ${x.admin.token}` }, payload: { limite: 1000 } })
    assert.equal((await deudor()).limite, 1000) // el suyo gana
    await app.inject({ method: 'PUT', url: `/clientes/${x.c.id}/limite-fiado`, headers: { authorization: `Bearer ${x.admin.token}` }, payload: { limite: null } })
    await avisarFiadoAtrasado(db, crearDespachador(db, null, { error: () => {} }))
    const { rows: [a] } = await db.query(`SELECT cuerpo FROM notificaciones WHERE tipo = 'fiado_atrasado' AND id_usuario = $1`, [x.admin.id])
    assert.match(a.cuerpo, /y ya pasó su límite de \$100$/)
    // El resumen diario cuenta a quien ya debía de más al terminar ayer.
    const cifras = await cifrasDeAyer(db, x.empresa)
    assert.equal(cifras.pasaronLimite, 1)
    assert.match(correoResumen('Ana', 'X', cifras, 'u').texto, /1 cliente pasó su límite de fiado/)
    assert.equal((await empresa({ limiteFiado: null })).json().limiteFiado, null)
    assert.equal((await deudor()).limite, null)
  })

  it('si un vendedor fía de más, los administradores se enteran; dentro del límite, no', async () => {
    const x = await escenario()
    await app.inject({ method: 'PUT', url: `/clientes/${x.c.id}/limite-fiado`, headers: { authorization: `Bearer ${x.admin.token}` }, payload: { limite: 150 } })
    const avisos = async () => (await db.query(`SELECT cuerpo FROM notificaciones WHERE tipo = 'fiado_sobre_limite' AND id_usuario = $1`, [x.admin.id])).rows
    await x.entrega('CREDITO', 2) // $120: dentro
    assert.equal((await avisos()).length, 0)
    await x.entrega('CREDITO', 1) // $180: pasó
    const a = await avisos()
    assert.equal(a.length, 1)
    assert.match(a[0].cuerpo, /le fió a Tienda Fiada: ahora debe \$180\.00 y su límite es \$150\.00/)
    // La ficha del vendedor cuenta las veces del mes (sólo la segunda venta lo dejó arriba).
    const deMas = await llamar(x.admin, 'GET', '/cobranza/fiado-de-mas')
    assert.deepEqual(deMas.body.vendedores, [{ id: x.ana.id, veces: 1 }])
    assert.equal((await llamar(x.ana, 'GET', '/cobranza/fiado-de-mas')).status, 403)
  })

  it('límites de varios clientes de una vez y el código para fiar de más', async () => {
    const x = await escenario()
    const poner = (s: S, limites: unknown) => app.inject({ method: 'PUT', url: '/clientes/limites-fiado', headers: { authorization: `Bearer ${s.token}` }, payload: { limites } })
    assert.equal((await poner(x.ana, [{ clienteId: x.c.id, limite: 300 }])).statusCode, 403)
    assert.equal((await poner(x.admin, [{ clienteId: x.c.id, limite: -1 }])).statusCode, 400)
    assert.equal((await poner(x.admin, [{ clienteId: x.c.id, limite: 300 }, { clienteId: randomUUID(), limite: 50 }])).json().actualizados, 1)
    assert.equal((await db.query(`SELECT limite_fiado::float8 AS l FROM clientes WHERE id_cliente = $1`, [x.c.id])).rows[0].l, 300)
    const empresa = (payload: object) => app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${x.admin.token}` }, payload })
    assert.equal((await empresa({ codigoFiado: '12' })).statusCode, 400)
    const guardado = (await empresa({ codigoFiado: '4821' })).json().codigoFiado as string
    const [sal, hash] = guardado.split(':')
    assert.equal(createHash('sha256').update(`${sal}:4821`).digest('hex'), hash) // el teléfono lo revisa igual
    assert.equal((await empresa({ limiteFiado: 100 })).json().codigoFiado, guardado) // cambiar otra cosa no lo toca
    assert.equal((await empresa({ codigoFiado: null })).json().codigoFiado, null)
  })

  it('avisa a los administradores de quien debe desde hace más de un mes, una vez por cliente', async () => {
    const x = await escenario()
    const nuevo = await x.entrega('CREDITO', 1) // de hoy: todavía no
    assert.equal(nuevo.body.resultados[0].estado, 'aplicada')
    const despachador = crearDespachador(db, null, { error: () => {} })
    const avisos = async () => (await db.query(`SELECT titulo, cuerpo, datos FROM notificaciones WHERE tipo = 'fiado_atrasado' AND id_usuario = $1`, [x.admin.id])).rows
    await avisarFiadoAtrasado(db, despachador)
    assert.equal((await avisos()).length, 0)
    assert.equal((await x.entrega('CREDITO', 3, hoyEn(config.zonaHoraria, new Date(Date.now() - 40 * 86_400_000)))).body.resultados[0].estado, 'aplicada')
    await avisarFiadoAtrasado(db, despachador)
    const [a] = await avisos()
    assert.equal(a.titulo, 'Fiado de más de un mes')
    assert.match(a.cuerpo, /^Tienda Fiada debe \$240 desde el /)
    assert.deepEqual(a.datos.clienteIds, [x.c.id])
    assert.equal(a.datos.url, `/admin?ir=cobrar&cliente=${x.c.id}`) // uno solo: abre su ficha
    // A su vendedora le llega el suyo (abre Clientes); al otro vendedor, nada. Otra vuelta del cron no lo repite.
    const { rows: deAna } = await db.query(`SELECT datos FROM notificaciones WHERE tipo = 'fiado_atrasado' AND id_usuario = $1`, [x.ana.id])
    assert.equal(deAna.length, 1)
    assert.deepEqual(deAna[0].datos, { pestana: 'clientes', clienteIds: [x.c.id] })
    assert.equal((await db.query(`SELECT 1 FROM notificaciones WHERE tipo = 'fiado_atrasado' AND id_usuario = $1`, [x.beto.id])).rowCount, 0)
    await avisarFiadoAtrasado(db, despachador)
    assert.equal((await avisos()).length, 1)
  })

  it('lo vendido a crédito es deuda; lo pagado de contado no', async () => {
    const x = await escenario()
    assert.equal((await x.entrega('CREDITO', 3)).body.resultados[0].estado, 'aplicada') // $180 fiados
    assert.equal((await x.entrega('EFECTIVO', 2)).body.resultados[0].estado, 'aplicada') // $120 de contado
    const { body } = await llamar(x.ana, 'GET', '/cobranza')
    assert.equal(body.total, 180)
    assert.equal(body.deudores.length, 1)
    assert.equal(body.deudores[0].nombre, 'Tienda Fiada')
    assert.equal(body.deudores[0].saldo, 180)
    assert.equal(body.deudores[0].desde, x.hoy)
  })

  it('los abonos bajan el saldo, no pasan de lo que se debe y el que paga todo sale de la lista', async () => {
    const x = await escenario()
    await x.entrega('CREDITO', 3)
    const abonar = (monto: number, s: S = x.ana) => llamar(s, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto, metodo: 'efectivo' })
    const a1 = await abonar(100)
    assert.equal(a1.status, 201)
    assert.equal(a1.body.saldo, 80)
    assert.equal((await abonar(100)).status, 409) // sólo debe 80
    assert.equal((await abonar(80)).body.saldo, 0)
    assert.equal((await llamar(x.ana, 'GET', '/cobranza')).body.deudores.length, 0)
    assert.equal((await abonar(1)).status, 409) // ya no debe nada
    const cuenta = (await llamar(x.admin, 'GET', `/cobranza/clientes/${x.c.id}`)).body
    assert.equal(cuenta.saldo, 0)
    assert.equal(cuenta.movimientos.filter((m: { tipo: string }) => m.tipo === 'abono').length, 2)
  })

  it('cada vendedor ve y cobra sólo a los suyos; el administrador, a todos', async () => {
    const x = await escenario()
    await x.entrega('CREDITO', 1)
    assert.equal((await llamar(x.beto, 'GET', '/cobranza')).body.deudores.length, 0)
    assert.equal((await llamar(x.beto, 'GET', `/cobranza/clientes/${x.c.id}`)).status, 404)
    assert.equal((await llamar(x.beto, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'efectivo' })).status, 404)
    assert.equal((await llamar(x.admin, 'GET', '/cobranza')).body.deudores.length, 1)
    assert.equal((await llamar(x.admin, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'transferencia' })).status, 201)
  })

  it('un abono se anula con motivo (sólo el administrador) y vuelve a deberse', async () => {
    const x = await escenario()
    await x.entrega('CREDITO', 2)
    const { body: a } = await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 120, metodo: 'efectivo' })
    assert.equal((await llamar(x.ana, 'POST', `/cobranza/abonos/${a.id}/anular`, { motivo: 'Me equivoqué' })).status, 403)
    assert.equal((await llamar(x.admin, 'POST', `/cobranza/abonos/${a.id}/anular`, { motivo: '' })).status, 400)
    assert.equal((await llamar(x.admin, 'POST', `/cobranza/abonos/${a.id}/anular`, { motivo: 'Capturado dos veces' })).status, 200)
    assert.equal((await llamar(x.admin, 'POST', `/cobranza/abonos/${a.id}/anular`, { motivo: 'Otra vez' })).status, 409)
    assert.equal((await llamar(x.admin, 'GET', '/cobranza')).body.total, 120)
  })

  it('el reporte separa lo vendido a crédito de lo cobrado', async () => {
    const x = await escenario()
    await x.entrega('CREDITO', 3)
    await x.entrega('EFECTIVO', 1)
    const r = await llamar(x.admin, 'GET', `/reportes/ventas?desde=${x.hoy}&hasta=${x.hoy}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.resumen.credito, 180)
    assert.equal(r.body.resumen.efectivo, 60)
    // Fiado del periodo contra abonos, y por vendedor: Ana fió 180 y cobró 50; el administrador cobró 20 sin fiar.
    assert.equal((await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 50, metodo: 'efectivo' })).status, 201)
    assert.equal((await llamar(x.admin, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 20, metodo: 'transferencia' })).status, 201)
    const r2 = (await llamar(x.admin, 'GET', `/reportes/ventas?desde=${x.hoy}&hasta=${x.hoy}`)).body
    assert.equal(r2.abonos, 70)
    assert.deepEqual(r2.fiadoPorVendedor.map((v: { id: string; fiado: number; abonos: number }) => [v.id, v.fiado, v.abonos]), [[x.admin.id, 0, 20], [x.ana.id, 180, 50]])
  })
})
