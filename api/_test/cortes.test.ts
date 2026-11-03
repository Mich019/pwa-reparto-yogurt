import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { hoyEn } from '../_lib/fechas.js'
import { app, cliente, config, crearEmpresa, db, op, pedido, push, sesion } from './ayuda.js'

// Corte del día, cierre de mes e informe mensual.

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function llamar(s: S, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as never })
  return { status: r.statusCode, body: r.body && r.headers['content-type']?.toString().includes('json') ? r.json() : null, bruto: r.rawPayload, tipo: r.headers['content-type']?.toString() }
}
const sabor = () => ({ id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#f472b6', disponible: true })
const hoy = hoyEn(config.zonaHoraria)

async function escenario() {
  const empresa = await crearEmpresa()
  const admin = await sesion('administrador', 'tel-a', empresa)
  const ana = await sesion('vendedor', 'tel-v1', empresa)
  const beto = await sesion('vendedor', 'tel-v2', empresa)
  const s = sabor()
  await push(admin, [op('productos', s.id, s)])
  const c = cliente({ nombre: 'Tienda Corte' })
  await push(ana, [op('clientes', c.id, c)])
  const entrega = async (metodo: string, litros: number, fecha = hoy) => {
    const p = pedido(c.id, s.id, { fecha, estado: 'ENTREGADO', metodo_pago: metodo, fecha_entregado_real: Date.now(), items: [{ productoId: s.id, litros, precio_litro: 60 }] })
    const r = await push(ana, [op('pedidos', p.id, p)])
    if (!r.body.resultados) throw new Error(JSON.stringify(r.body))
    return { id: p.id, estado: r.body.resultados[0].estado as string, error: r.body.resultados[0].error as string | undefined }
  }
  return { empresa, admin, ana, beto, c, s, entrega }
}

describe('corte del día', () => {
  it('el esperado es el efectivo cobrado (ventas y abonos); la diferencia queda a la vista y el administrador confirma', async () => {
    const x = await escenario()
    await x.entrega('EFECTIVO', 2) // $120
    await x.entrega('TRANSFERENCIA', 1) // $60, no es efectivo
    await x.entrega('CREDITO', 3) // $180 fiado
    await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 50, metodo: 'efectivo' })

    const antes = (await llamar(x.ana, 'GET', '/cortes')).body
    assert.equal(antes.filas.length, 1) // el vendedor sólo ve el suyo
    assert.equal(antes.filas[0].esperado, 170)
    assert.equal(antes.filas[0].transferencias, 60)
    assert.equal(antes.filas[0].credito, 180)
    assert.equal(antes.filas[0].estado, 'sin_corte')

    const r = await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 160, nota: 'Faltan 10 de cambio' })
    assert.equal(r.status, 201)
    assert.equal(r.body.diferencia, -10)
    // Lo puede corregir mientras esté pendiente.
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 170 })).body.diferencia, 0)
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 165 })).body.diferencia, -5)

    const admin = (await llamar(x.admin, 'GET', '/cortes')).body
    assert.equal(admin.filas.length, 2) // Ana (con ventas) y Beto (activo)
    assert.equal(admin.filas.find((f: { vendedorId: string }) => f.vendedorId === x.ana.id).estado, 'pendiente')

    assert.equal((await llamar(x.ana, 'POST', `/cortes/${r.body.id}/confirmar`, {})).status, 403)
    const ok = await llamar(x.admin, 'POST', `/cortes/${r.body.id}/confirmar`, { nota: 'Se descuenta del siguiente' })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.diferencia, -5)
    assert.equal((await llamar(x.admin, 'POST', `/cortes/${r.body.id}/confirmar`, {})).status, 409)
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 170 })).status, 409) // confirmado: ya no cambia
  })

  it('un vendedor no captura el corte de otro; el administrador sí, y no hay cortes de días futuros', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 0, vendedorId: x.beto.id })).status, 403)
    assert.equal((await llamar(x.admin, 'POST', '/cortes', { efectivoEntregado: 0, vendedorId: x.beto.id })).status, 201)
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 0, fecha: '2999-01-01' })).status, 400)
  })
})

describe('meta y comisión', () => {
  it('el vendedor ve su avance contra su meta y la comisión; el administrador las fija', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { comisionPct: 5, metaMensual: 1000 })).status, 200)
    assert.equal((await llamar(x.ana, 'PATCH', `/usuarios/${x.ana.id}`, { comisionPct: 50 })).status, 403)
    await x.entrega('EFECTIVO', 5) // $300
    const m = (await llamar(x.ana, 'GET', '/mi-meta')).body
    assert.equal(m.ventas, 300)
    assert.equal(m.meta, 1000)
    assert.equal(m.cumplimientoPct, 30)
    assert.equal(m.comision, 15)
    assert.equal((await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { metaMensual: null })).status, 200)
    assert.equal((await llamar(x.ana, 'GET', '/mi-meta')).body.meta, null)
  })
})

describe('cierre de mes', () => {
  // El mes pasado: el cierre no admite el mes en curso, y la lista de /cierres llega hasta el primer pedido.
  const MES = (() => { const [a, m] = hoy.slice(0, 7).split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}` })()
  it('no cierra el mes en curso ni uno con pedidos sin cerrar; al cerrar guarda las cifras y bloquea las correcciones', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${hoy.slice(0, 7)}/cerrar`)).status, 409) // todavía no termina
    const v1 = await x.entrega('EFECTIVO', 2, `${MES}-10`) // $120
    await x.entrega('CREDITO', 1, `${MES}-20`) // $60 fiado
    assert.equal(v1.estado, 'aplicada')
    // Un pedido sin entregar en ese mes lo impide.
    const pendiente = pedido(x.c.id, x.s.id, { fecha: `${MES}-25` })
    await push(x.ana, [op('pedidos', pendiente.id, pendiente)])
    const noCierra = await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)
    assert.equal(noCierra.status, 409)
    assert.match(noCierra.body.error, /sin cerrar/)
    await db.query(`DELETE FROM pedidos WHERE id_pedido = $1`, [pendiente.id])

    const vivo = (await llamar(x.admin, 'GET', `/cierres/${MES}`)).body
    assert.equal(vivo.estado, 'abierto')
    assert.equal(vivo.cifras.ventas.ingreso, 180)
    assert.equal(vivo.cifras.ventas.utilidad, 120) // costo 20 × 3 L
    assert.equal(vivo.cifras.cobro.credito, 60)
    assert.equal(vivo.cifras.porCobrar.saldo, 60)

    assert.equal((await llamar(x.ana, 'POST', `/cierres/${MES}/cerrar`)).status, 403)
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)).status, 200)
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)).status, 409)

    // Correcciones bloqueadas: ni cambiar una venta de ese mes ni cobrar abonos con fecha de ese mes.
    const cambio = pedido(x.c.id, x.s.id, { id: v1.id, fecha: `${MES}-10`, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO', fecha_entregado_real: Date.now(), items: [{ productoId: x.s.id, litros: 9, precio_litro: 60 }] })
    const r = await push(x.admin, [op('pedidos', v1.id, cambio, 1, Date.now() + 5000)])
    assert.notEqual(r.body.resultados[0].estado, 'aplicada')
    assert.equal(Number((await db.query(`SELECT total FROM pedidos WHERE id_pedido = $1`, [v1.id])).rows[0].total), 120)
    const abono = await llamar(x.admin, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'efectivo', fecha: `${MES}-28` })
    assert.equal(abono.status, 409)
    assert.match(abono.body.error, /ya está cerrado/)

    // Las cifras del mes quedan congeladas aunque después cambie la deuda.
    await llamar(x.admin, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 60, metodo: 'efectivo' })
    const cerrado = (await llamar(x.admin, 'GET', `/cierres/${MES}`)).body
    assert.equal(cerrado.estado, 'cerrado')
    assert.equal(cerrado.cifras.porCobrar.saldo, 60)
    assert.equal(cerrado.historial.length, 1)

    // Reabrir pide motivo, deja el rastro y permite corregir.
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/reabrir`, { motivo: 'xx' })).status, 400)
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/reabrir`, { motivo: 'Capturé mal un cobro' })).status, 200)
    const reabierto = (await llamar(x.admin, 'GET', `/cierres/${MES}`)).body
    assert.equal(reabierto.estado, 'reabierto')
    assert.equal(reabierto.historial[1].motivo, 'Capturé mal un cobro')
    assert.equal((await llamar(x.admin, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 0.5, metodo: 'efectivo', fecha: `${MES}-28` })).status, 409) // ya no debe: saldo 0
    const lista = (await llamar(x.admin, 'GET', '/cierres')).body.meses
    assert.equal(lista.find((m: { mes: string }) => m.mes === MES).estado, 'reabierto')
  })

  it('el informe mensual sale en JSON y en Excel con ventas, utilidad, cobranza por vendedor y diferencias de cortes', async () => {
    const x = await escenario()
    await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { comisionPct: 10, metaMensual: 500 })
    await x.entrega('EFECTIVO', 4, '2020-04-05') // $240
    await x.entrega('CREDITO', 2, '2020-04-06') // $120
    await db.query(`INSERT INTO cortes_dia (id_empresa, fecha, id_vendedor, efectivo_esperado, efectivo_entregado, estado) VALUES ($2, '2020-04-05', $1, 240, 230, 'confirmado')`, [x.ana.id, x.empresa])
    const j = await llamar(x.admin, 'GET', '/cierres/2020-04/informe')
    assert.equal(j.status, 200)
    const c = j.body.cifras
    assert.equal(c.ventas.ingreso, 360)
    assert.equal(c.cobro.efectivo, 240)
    const ana = c.vendedores.find((v: { id: string }) => v.id === x.ana.id)
    assert.equal(ana.comision, 36)
    assert.equal(ana.cumplimientoPct, 72)
    assert.equal(c.cortes.diferencia, -10)
    assert.equal(c.cortes.confirmados, 1)
    const xl = await llamar(x.admin, 'GET', '/cierres/2020-04/informe?formato=xlsx')
    assert.equal(xl.status, 200)
    assert.match(xl.tipo ?? '', /spreadsheetml/)
    assert.equal(xl.bruto.subarray(0, 2).toString(), 'PK')
    assert.equal((await llamar(x.ana, 'GET', '/cierres/2020-04/informe')).status, 403)
    assert.equal((await llamar(x.admin, 'GET', '/cierres/abril/informe')).status, 400)
  })
})
