import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { correoMensual, correoResumen, correoVendedor } from '../_lib/correo.js'
import { avisarMetasAtrasadas, felicitarMeta, cifrasDeAyer, cifrasDeLaSemana, cifrasVendedor, mandarResumenes } from '../_lib/resumen.js'
import { xlsxDelMes } from '../_lib/cortes.js'
import { crearDespachador } from '../_lib/notificaciones.js'
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

  it('el semanal cuenta los siete días anteriores y sale sólo el lunes', async () => {
    const empresa = await crearEmpresa('Lácteos Semana')
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    assert.equal((await yo(admin, { resumenSemanal: true })).json().resumenSemanal, true)
    const s = { id: randomUUID(), sabor: 'Mango', descripcion: '', presentacion: 1, precio_litro: 40, costo_litro: 15, color_hex: '#f59e0b', disponible: true }
    await push(admin, [op('productos', s.id, s)])
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const dentro = pedido(c.id, s.id), fuera = pedido(c.id, s.id)
    await push(vend, [op('pedidos', dentro.id, dentro), op('pedidos', fuera.id, fuera)])
    const entregar = (id: string, dias: number) => db.query(
      `UPDATE pedidos SET estado = 'entregado', metodo_pago = 'transferencia', fecha_entregado_real = now() - make_interval(days => $2), fecha = (now() - make_interval(days => $2))::date WHERE id_pedido = $1`, [id, dias])
    await entregar(dentro.id, 3)
    await entregar(fuera.id, 9)
    const semana = await cifrasDeLaSemana(db, empresa)
    assert.equal(semana.entregados, 1)
    assert.equal(semana.vendido, semana.transferencia)
    assert.equal((await cifrasDeAyer(db, empresa)).entregados, 0)
    assert.equal((await cifrasDeAyer(db, empresa)).vendidoAntes, null)
    assert.equal((await cifrasDeAyer(db, empresa)).semana, null)
    assert.equal(semana.semana?.sabor?.nombre, 'Mango')
    assert.equal(semana.semana?.mejorDia?.vendido, semana.vendido)
    // El de hace 9 días cae en la semana anterior: mismo pedido, misma venta.
    assert.equal(semana.vendidoAntes, semana.vendido)
    await db.query(`UPDATE usuarios SET meta_mensual = 1000 WHERE id_usuario = $1`, [vend.id])
    const conMeta = await cifrasDeLaSemana(db, empresa)
    const fila = conMeta.semana!.vendedores.find((v) => v.semana > 0)!
    assert.equal(fila.semana, semana.vendido)
    assert.equal(fila.meta, 1000)
    const correo = correoResumen('Ana', 'Lácteos Semana', conMeta, 'https://ejemplo.test/admin')
    assert.match(correo.texto, /Vendedores:\n· .+: \$[\d,.]+ · mes: \$[\d,.]+ de \$1,000\.00 \(\d+%\)/)
    assert.match(correo.texto, /Lo que más se vendió: Mango/)
    assert.match(correo.asunto, /tu resumen de la semana/)
    assert.match(correo.texto, /del .+ al .+:/)
    assert.match(correo.texto, /Contra la semana anterior: Igual/)
    assert.match(correoResumen('Ana', 'X', { ...semana, vendidoAntes: semana.vendido / 2 }, 'u').texto, /100% más/)
    assert.match(correoResumen('Ana', 'X', { ...semana, vendidoAntes: semana.vendido * 4 }, 'u').texto, /75% menos/)

    const enviado = async () => (await db.query(`SELECT resumen_semanal_enviado FROM usuarios WHERE id_usuario = $1`, [admin.id])).rows[0].resumen_semanal_enviado
    const { rows: [{ hoy }] } = await db.query(`SELECT extract(isodow FROM now() AT TIME ZONE zona_horaria)::int AS hoy FROM empresas WHERE id_empresa = $1`, [empresa])
    // Cada quien elige el día: si no es hoy, no sale; si es hoy, sí.
    assert.equal((await yo(admin, { resumenSemanalDia: (hoy % 7) + 1 })).json().resumenSemanalDia, (hoy % 7) + 1)
    assert.equal((await yo(admin, { resumenSemanalDia: 8 })).statusCode, 400)
    await mandarResumenes(db, config, log)
    assert.equal(await enviado(), null)
    await yo(admin, { resumenSemanalDia: hoy })
    // El vendedor también lo pide: le llega lo suyo, sin costos.
    assert.equal((await yo(vend, { resumenSemanal: true, resumenSemanalDia: hoy })).statusCode, 200)
    await mandarResumenes(db, config, log)
    assert.ok(await enviado())
    assert.ok((await db.query(`SELECT resumen_semanal_enviado FROM usuarios WHERE id_usuario = $1`, [vend.id])).rows[0].resumen_semanal_enviado)
    const suyo = await cifrasVendedor(db, empresa, vend.id)
    assert.equal(suyo.vendido, semana.vendido)
    assert.equal(suyo.vendidoAntes, semana.vendido)
    assert.equal(suyo.meta, 1000)
    const cv = correoVendedor('Beto', 'Lácteos Semana', suyo, 'https://ejemplo.test/')
    assert.match(cv.texto, /Contra la semana anterior: Igual/)
    assert.match(cv.texto, /Tu mes: \$[\d,.]+ de \$1,000\.00/)
    assert.doesNotMatch(cv.texto, /utilidad|costo/i)
  })

  it('a mitad de mes avisa a los administradores del vendedor atrasado, una vez', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const { rows: [{ dia }] } = await db.query(`SELECT extract(day FROM now() AT TIME ZONE zona_horaria)::int AS dia FROM empresas WHERE id_empresa = $1`, [empresa])
    if (dia === 1) return // el día 1 nadie va atrasado: el mes no ha empezado
    await db.query(`UPDATE usuarios SET meta_mensual = 100000 WHERE id_usuario = $1`, [vend.id])
    const despachador = crearDespachador(db, null, { error: () => {} })
    const avisos = async () => (await db.query(`SELECT cuerpo, datos FROM notificaciones WHERE tipo = 'meta_atrasada' AND id_usuario = $1`, [admin.id])).rows
    await avisarMetasAtrasadas(db, despachador, [dia + 1, 31]) // fuera de los días: nada
    assert.equal((await avisos()).length, 0)
    await avisarMetasAtrasadas(db, despachador, [1, 31])
    const [a] = await avisos()
    assert.match(a.cuerpo, /lleva \$0 de \$100,000 \(0%\)/)
    assert.deepEqual(a.datos.vendedorIds, [vend.id])
    assert.equal(a.datos.url, `/admin?ir=equipo&persona=${vend.id}`)
    await avisarMetasAtrasadas(db, despachador, [1, 31])
    assert.equal((await avisos()).length, 1)
  })

  it('el umbral de meta atrasada es de cada empresa', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const r = await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { ritmoMetaPct: 50 } })
    assert.equal(r.json().ritmoMetaPct, 50)
    assert.equal((await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { ritmoMetaPct: 10 } })).statusCode, 400)
    const { rows: [{ dia, avance }] } = await db.query(
      `SELECT extract(day FROM now() AT TIME ZONE zona_horaria)::int AS dia,
              ((extract(day FROM now() AT TIME ZONE zona_horaria) - 1) / extract(day FROM date_trunc('month', now() AT TIME ZONE zona_horaria) + interval '1 month - 1 day'))::float8 AS avance
         FROM empresas WHERE id_empresa = $1`, [empresa])
    if (dia === 1) return
    const s = { id: randomUUID(), sabor: 'Coco', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#ffffff', disponible: true }
    await push(admin, [op('productos', s.id, s)])
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const p = pedido(c.id, s.id) // $180
    await push(vend, [op('pedidos', p.id, p)])
    await db.query(`UPDATE pedidos SET estado = 'entregado', metodo_pago = 'efectivo', fecha_entregado_real = date_trunc('month', now()) + interval '12 hours' WHERE id_pedido = $1`, [p.id])
    // La meta deja los $180 en el 60% del ritmo: con umbral 50% no va atrasado; con 90%, sí.
    await db.query(`UPDATE usuarios SET meta_mensual = $2 WHERE id_usuario = $1`, [vend.id, Math.round(180 / (avance * 0.6))])
    const despachador = crearDespachador(db, null, { error: () => {} })
    const avisos = async () => (await db.query(`SELECT 1 FROM notificaciones WHERE tipo = 'meta_atrasada' AND id_usuario = $1`, [admin.id])).rowCount
    await avisarMetasAtrasadas(db, despachador, [1, 31])
    assert.equal(await avisos(), 0)
    await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { ritmoMetaPct: 90 } })
    await avisarMetasAtrasadas(db, despachador, [1, 31])
    assert.equal(await avisos(), 1)
  })

  it('felicita al vendedor una vez cuando llega a su meta', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const despachador = crearDespachador(db, null, { error: () => {} })
    await db.query(`UPDATE usuarios SET meta_mensual = 150 WHERE id_usuario = $1`, [vend.id])
    assert.equal(await felicitarMeta(db, despachador, vend.id), false) // sin ventas
    const s = { id: randomUUID(), sabor: 'Nuez', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#a16207', disponible: true }
    await push(admin, [op('productos', s.id, s)])
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const p = pedido(c.id, s.id) // 3 × $60 = $180
    await push(vend, [op('pedidos', p.id, p)])
    await db.query(`UPDATE pedidos SET estado = 'entregado', metodo_pago = 'efectivo', fecha_entregado_real = now() WHERE id_pedido = $1`, [p.id])
    assert.equal(await felicitarMeta(db, despachador, vend.id), true)
    const { rows } = await db.query(`SELECT titulo, cuerpo FROM notificaciones WHERE tipo = 'meta_alcanzada' AND id_usuario = $1`, [vend.id])
    assert.equal(rows.length, 1)
    assert.match(rows[0].cuerpo, /Llevas \$180 de \$150/)
    assert.equal(await felicitarMeta(db, despachador, vend.id), false) // una vez al mes
  })

  it('«mandar uno ahora» le llega al administrador que lo pide', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const ahora = (s: { token: string }, payload: object) => app.inject({ method: 'POST', url: '/me/resumen/ahora', headers: { authorization: `Bearer ${s.token}` }, payload })
    const r = await ahora(admin, { tipo: 'semanal' })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().para, (await get(admin, '/me')).body.correo)
    assert.equal((await ahora(admin, { tipo: 'mensual' })).statusCode, 400)
    assert.equal((await ahora(vend, { tipo: 'diario' })).statusCode, 403)
    // No cuenta como el del día.
    assert.equal((await db.query(`SELECT resumen_enviado_dia FROM usuarios WHERE id_usuario = $1`, [admin.id])).rows[0].resumen_enviado_dia, null)
  })

  it('al cerrar el mes, el informe en PDF va a quien lo pidió', async () => {
    const empresa = await crearEmpresa('Lácteos Mes')
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const pedir = (s: { token: string }, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${s.token}` }, payload })
    assert.equal((await pedir(admin, '/cierres/2026-01/cerrar')).json().porCorreo, 0)
    await yo(admin, { resumenMensual: true })
    await pedir(admin, '/cierres/2026-01/reabrir', { motivo: 'Para volver a cerrarlo' })
    assert.equal((await pedir(admin, '/cierres/2026-01/cerrar')).json().porCorreo, 1)

    const pdf = Buffer.from('%PDF-1.4\n%prueba\n').toString('base64')
    const r = await pedir(admin, '/cierres/2026-01/correo', { pdf })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().enviados, 1)
    assert.equal((await pedir(admin, '/cierres/2026-01/correo', { pdf: Buffer.from('<html>').toString('base64') })).statusCode, 400)
    assert.equal((await pedir(admin, '/cierres/2025-12/correo', { pdf })).statusCode, 409) // abierto
    assert.equal((await pedir(vend, '/cierres/2026-01/correo', { pdf })).statusCode, 403)
    const c = correoMensual('Ana López', 'Lácteos Mes', '2026-01', { ingreso: 1500, utilidad: 600, pedidos: 12, porCobrar: 0, vendedores: [{ nombre: 'Beto', ventas: 900, meta: 1000, cumplimientoPct: 90 }] }, 'https://ejemplo.test/admin')
    assert.match(c.asunto, /Lácteos Mes: cierre de enero de 2026/)
    const informe = (await app.inject({ method: 'GET', url: '/cierres/2026-01', headers: { authorization: `Bearer ${admin.token}` } })).json()
    assert.equal(xlsxDelMes(informe.cifras, '2026-01', 'Mes cerrado').subarray(0, 2).toString(), 'PK')
    assert.match(c.texto, /Beto: \$900\.00 de \$1,000\.00 \(90%\)/)
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
