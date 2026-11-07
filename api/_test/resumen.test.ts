import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { correoResumen } from '../_lib/correo.js'
import { cifrasDeAyer, mandarResumenes } from '../_lib/resumen.js'
import { app, cliente, config, crearEmpresa, db, get, op, pedido, push, sesion } from './ayuda.js'

// Resumen diario por correo para el administrador (resumen.ts) y lo que el equipo muestra de los avisos de cada quien.

after(async () => { await app.close(); await db.end() })
const log = { info: () => {}, warn: () => {} }
const yo = (s: { token: string }, payload: object) => app.inject({ method: 'PATCH', url: '/me', headers: { authorization: `Bearer ${s.token}` }, payload })

describe('resumen diario por correo', () => {
  it('lo de ayer de su empresa, sólo a quien lo pidió y una vez al día', async () => {
    const empresa = await crearEmpresa('Lácteos Resumen')
    const pide = await sesion('administrador', 'tel-a', empresa)
    const noPide = await sesion('administrador', 'tel-b', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    assert.equal((await yo(pide, { resumenCorreo: true })).json().resumenCorreo, true)
    assert.equal((await get(noPide, '/me')).body.resumenCorreo, false)
    assert.equal((await yo(vend, { resumenCorreo: 'si' })).statusCode, 400)

    const s = { id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 50, costo_litro: 20, color_hex: '#f472b6', disponible: true }
    await push(pide, [op('productos', s.id, s)])
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const p = pedido(c.id, s.id)
    assert.equal((await push(vend, [op('pedidos', p.id, p)])).body.resultados[0].estado, 'aplicada')
    // Entregado ayer, en efectivo.
    await db.query(`UPDATE pedidos SET estado = 'entregado', metodo_pago = 'efectivo', fecha_entregado_real = now() - interval '1 day', fecha = (now() - interval '1 day')::date WHERE id_pedido = $1`, [p.id])

    const cifras = await cifrasDeAyer(db, empresa)
    assert.equal(cifras.entregados, 1)
    assert.equal(cifras.vendido, cifras.efectivo)
    assert.ok(cifras.vendido > 0)
    const correo = correoResumen('Ana López', 'Lácteos Resumen', cifras, 'https://ejemplo.test/admin')
    assert.match(correo.asunto, /Lácteos Resumen: tu resumen de ayer/)
    assert.match(correo.texto, /Vendido: \$[\d,.]+ en 1 pedido/)
    assert.match(correo.html, /Abrir el panel/)

    await mandarResumenes(db, config, log)
    const enviado = async (id: string) => (await db.query(`SELECT resumen_enviado_dia FROM usuarios WHERE id_usuario = $1`, [id])).rows[0].resumen_enviado_dia
    assert.ok(await enviado(pide.id))
    assert.equal(await enviado(noPide.id), null)
    // Otra vuelta del cron el mismo día: ya estaba reclamado, no se vuelve a mandar.
    const antes = await enviado(pide.id)
    await mandarResumenes(db, config, log)
    assert.deepEqual(await enviado(pide.id), antes)
  })

  it('el equipo muestra en cuántos dispositivos tiene los avisos cada quien y cuáles apagó', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    await yo(vend, { avisosApagados: ['stock_asignado'] })
    const fila = ((await get(admin, '/usuarios')).body.usuarios as any[]).find((u) => u.id === vend.id)
    assert.equal(fila.dispositivosPush, 0)
    assert.deepEqual(fila.avisosApagados, ['stock_asignado'])
  })
})
