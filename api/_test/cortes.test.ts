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
    // Al administrador le llega «Corte por confirmar».
    const { rows: [entregado] } = await db.query(`SELECT cuerpo, datos FROM notificaciones WHERE tipo = 'corte_entregado' AND id_usuario = $1`, [x.admin.id])
    assert.ok(entregado.cuerpo.includes('$160.00 (faltan $10.00)'), entregado.cuerpo)
    assert.equal(entregado.datos.url, '/admin?ir=cortes')
    // Un administrador que lo apagó ya no lo recibe; un tipo que no se puede apagar se rechaza.
    const ajustar = (payload: object) => app.inject({ method: 'PATCH', url: '/me', headers: { authorization: `Bearer ${x.admin.token}` }, payload })
    assert.equal((await ajustar({ avisosApagados: ['prueba'] })).statusCode, 400)
    assert.deepEqual((await ajustar({ avisosApagados: ['corte_entregado'] })).json().avisosApagados, ['corte_entregado'])
    await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 165 })
    assert.equal((await db.query(`SELECT 1 FROM notificaciones WHERE tipo = 'corte_entregado' AND id_usuario = $1`, [x.admin.id])).rowCount, 1)
    await ajustar({ avisosApagados: [] })
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
    // Efectivo con fecha de un día ya confirmado: nadie lo esperaría. Por transferencia sí entra.
    const tarde = await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'efectivo', fecha: hoy })
    assert.equal(tarde.status, 409)
    assert.match(tarde.body.error, /confirmado/)
    assert.equal((await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'transferencia' })).status, 201)

    // Reabrirlo pide motivo y es del administrador; vuelve a pendiente y entonces sí entra el efectivo tardío.
    assert.equal((await llamar(x.ana, 'POST', `/cortes/${r.body.id}/reabrir`, { motivo: 'Cobro tardío' })).status, 403)
    assert.equal((await llamar(x.admin, 'POST', `/cortes/${r.body.id}/reabrir`, { motivo: 'no' })).status, 400)
    assert.equal((await llamar(x.admin, 'POST', `/cortes/${r.body.id}/reabrir`, { motivo: 'Llegó un cobro tardío' })).status, 200)
    assert.equal((await llamar(x.admin, 'POST', `/cortes/${r.body.id}/reabrir`, { motivo: 'Llegó un cobro tardío' })).status, 409)
    assert.equal((await llamar(x.ana, 'POST', '/cobranza/abonos', { clienteId: x.c.id, monto: 10, metodo: 'efectivo' })).status, 201)
    const reabierto = (await llamar(x.ana, 'GET', '/cortes')).body.filas[0]
    assert.equal(reabierto.estado, 'pendiente')
    assert.equal(reabierto.esperado, 180)
    assert.equal(reabierto.reabierto.motivo, 'Llegó un cobro tardío')
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 180 })).body.diferencia, 0)
    assert.equal((await llamar(x.admin, 'POST', `/cortes/${r.body.id}/confirmar`, {})).status, 200)
    const { rows: [h] } = await db.query(`SELECT historial FROM cortes_dia WHERE id_corte = $1`, [r.body.id])

    // Una venta en efectivo que sincroniza después de confirmar: el corte queda marcado para reabrirlo.
    assert.deepEqual((await llamar(x.admin, 'GET', '/cortes/descuadres')).body.cortes, [])
    await x.entrega('EFECTIVO', 1) // $60 tarde
    const marcado = (await llamar(x.admin, 'GET', '/cortes')).body.filas.find((f: { vendedorId: string }) => f.vendedorId === x.ana.id)
    assert.equal(marcado.cambioDespues, 60)
    // …y al administrador le llega el aviso (al vendedor que sincronizó, no).
    const { rows: avisos } = await db.query(`SELECT id_usuario, cuerpo, datos FROM notificaciones WHERE tipo = 'corte_descuadrado' AND id_usuario = ANY($1::uuid[])`, [[x.admin.id, x.ana.id]])
    assert.equal(avisos.length, 1)
    assert.equal(avisos[0].id_usuario, x.admin.id)
    assert.ok(avisos[0].cuerpo.includes('+$60.00'), avisos[0].cuerpo)
    assert.equal(avisos[0].datos.url, '/admin?ir=cortes')
    const d = (await llamar(x.admin, 'GET', '/cortes/descuadres')).body.cortes
    assert.deepEqual(d.map((c: { id: string; cambio: number }) => [c.id, c.cambio]), [[r.body.id, 60]])
    assert.equal((await llamar(x.ana, 'GET', '/cortes/descuadres')).status, 403)
    assert.deepEqual(h.historial.map((e: { accion: string }) => e.accion), ['confirmado', 'reabierto', 'confirmado'])
  })

  it('el administrador ve lo esperado de cada vendedor por separado', async () => {
    const x = await escenario()
    await x.entrega('EFECTIVO', 2) // $120 de Ana
    const c = cliente({ nombre: 'Tienda de Beto' })
    await push(x.beto, [op('clientes', c.id, c)])
    const p = pedido(c.id, x.s.id, { fecha: hoy, estado: 'ENTREGADO', metodo_pago: 'TRANSFERENCIA', fecha_entregado_real: Date.now(), items: [{ productoId: x.s.id, litros: 1, precio_litro: 60 }] })
    await push(x.beto, [op('pedidos', p.id, p)])
    const filas = (await llamar(x.admin, 'GET', '/cortes')).body.filas as { vendedorId: string; esperado: number; transferencias: number }[]
    const de = (id: string) => filas.find((f) => f.vendedorId === id)!
    assert.deepEqual([de(x.ana.id).esperado, de(x.ana.id).transferencias], [120, 0])
    assert.deepEqual([de(x.beto.id).esperado, de(x.beto.id).transferencias], [0, 60])
  })

  it('un vendedor no captura el corte de otro; el administrador sí, y no hay cortes de días futuros', async () => {
    const x = await escenario()
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 0, vendedorId: x.beto.id })).status, 403)
    assert.equal((await llamar(x.admin, 'POST', '/cortes', { efectivoEntregado: 0, vendedorId: x.beto.id })).status, 201)
    assert.equal((await llamar(x.ana, 'POST', '/cortes', { efectivoEntregado: 0, fecha: '2999-01-01' })).status, 400)
  })
})

describe('el administrador que también reparte', () => {
  it('con un cliente a su nombre sale en los cortes, entrega el suyo y recibe su stock al sincronizar', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const s = sabor()
    await push(admin, [op('productos', s.id, s)])
    const sinNada = (await llamar(admin, 'GET', '/cortes')).body
    assert.equal(sinNada.filas.length, 0) // todavía no vende: no aparece
    // Desde la app de reparto lo que crea va a su nombre (vendedorId), como el de un vendedor.
    const c = cliente({ nombre: 'Tienda del Dueño', vendedorId: admin.id })
    await push(admin, [op('clientes', c.id, c)])
    const p = pedido(c.id, s.id, { fecha: hoy, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO', fecha_entregado_real: Date.now(), vendedorId: admin.id, items: [{ productoId: s.id, litros: 2, precio_litro: 60 }] })
    assert.equal((await push(admin, [op('pedidos', p.id, p)])).body.resultados[0].estado, 'aplicada')
    const fila = (await llamar(admin, 'GET', '/cortes')).body.filas.find((f: { vendedorId: string }) => f.vendedorId === admin.id)
    assert.equal(fila?.esperado, 120)
    const r = await llamar(admin, 'POST', '/cortes', { efectivoEntregado: 120 })
    assert.equal(r.status, 201)
    assert.equal(r.body.diferencia, 0)
    // Su carga del día le llega por sync como a un vendedor.
    const asignar = await app.inject({ method: 'PUT', url: `/stock/vendedor/${admin.id}`, headers: { authorization: `Bearer ${admin.token}` }, payload: { fecha: hoy, lineas: [{ productoId: s.id, asignada: 5, devuelta: 0 }] } })
    assert.equal(asignar.statusCode, 200, asignar.body)
    const { body } = await app.inject({ method: 'GET', url: '/sync/pull?desde=0', headers: { authorization: `Bearer ${admin.token}` } }).then((x) => ({ body: x.json() }))
    assert.equal(body.stock.filter((x: { productoId: string }) => x.productoId === s.id)[0]?.asignada, 5)
  })

  it('pone su propia meta del mes; un vendedor no puede', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const ana = await sesion('vendedor', 'tel-v', empresa)
    assert.equal((await llamar(admin, 'PATCH', '/mi-meta', { metaMensual: 0 })).status, 400)
    assert.equal((await llamar(admin, 'PATCH', '/mi-meta', { metaMensual: 8000 })).status, 200)
    assert.equal((await llamar(admin, 'GET', '/mi-meta')).body.meta, 8000)
    assert.equal((await llamar(ana, 'PATCH', '/mi-meta', { metaMensual: 1 })).status, 403)
    assert.equal((await llamar(admin, 'PATCH', '/mi-meta', { metaMensual: null })).status, 200)
    assert.equal((await llamar(admin, 'GET', '/mi-meta')).body.meta, null)
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
    // Su lugar entre los vendedores, sin las cifras de los demás.
    assert.deepEqual([m.lugar, m.de], [1, 2])
    const b = (await llamar(x.beto, 'GET', '/mi-meta')).body
    assert.deepEqual([b.lugar, b.de], [2, 2])
    assert.equal(Object.keys(b).some((k) => /otros|vendedores/.test(k)), false)
    assert.equal((await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { metaMensual: null })).status, 200)
    assert.equal((await llamar(x.ana, 'GET', '/mi-meta')).body.meta, null)
    // La misma meta para todos de un jalón; sólo el administrador.
    assert.equal((await llamar(x.ana, 'POST', '/usuarios/metas', { metaMensual: 500 })).status, 403)
    assert.equal((await llamar(x.admin, 'POST', '/usuarios/metas', { metaMensual: 0 })).status, 400)
    assert.equal((await llamar(x.admin, 'POST', '/usuarios/metas', { metaMensual: 500 })).body.actualizados, 2)
    assert.equal((await llamar(x.beto, 'GET', '/mi-meta')).body.meta, 500)
    // O según lo que vendió cada uno el mes pasado: Ana $120 + 25% = $150; Beto no vendió y se queda con la suya.
    const [a, mm] = hoy.slice(0, 7).split('-').map(Number)
    const pasado = mm === 1 ? `${a - 1}-12-10` : `${a}-${String(mm - 1).padStart(2, '0')}-10`
    await x.entrega('EFECTIVO', 2, pasado)
    assert.equal((await llamar(x.admin, 'POST', '/usuarios/metas', { pctMesAnterior: 400 })).status, 400)
    const r = (await llamar(x.admin, 'POST', '/usuarios/metas', { pctMesAnterior: 25 })).body
    assert.deepEqual([r.actualizados, r.sinVentas], [1, 1])
    // La vista previa trae lo del mes pasado de cada uno (sólo el administrador).
    assert.equal((await llamar(x.ana, 'GET', '/usuarios/metas/mes-pasado')).status, 403)
    const previa = (await llamar(x.admin, 'GET', '/usuarios/metas/mes-pasado')).body.ventas
    assert.deepEqual([previa[x.ana.id], previa[x.beto.id]], [120, 0])
    assert.equal((await llamar(x.ana, 'GET', '/mi-meta')).body.meta, 150)
    assert.equal((await llamar(x.beto, 'GET', '/mi-meta')).body.meta, 500)
  })
})

describe('cierre de mes', () => {
  // El mes pasado: el cierre no admite el mes en curso, y la lista de /cierres llega hasta el primer pedido.
  const MES = (() => { const [a, m] = hoy.slice(0, 7).split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}` })()
  it('al cerrar el mes, quien llega a 3 meses seguidos en su meta gana medalla y los administradores se enteran, una vez', async () => {
    const x = await escenario()
    await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { metaMensual: 100 })
    await x.entrega('EFECTIVO', 2, `${MES}-10`) // $120: 120% de su meta
    const antes = (n: number) => { const [a, m] = MES.split('-').map(Number); const f = new Date(a, m - 1 - n, 1); return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-01` }
    const cifras = JSON.stringify({ vendedores: [{ id: x.ana.id, nombre: 'Ana', ventas: 110, meta: 100, cumplimientoPct: 110 }] })
    // La empresa va explícita: un set_config en el pool cambiaría la de otras pruebas que usen esa conexión.
    await db.query(`INSERT INTO cierres_mes (id_empresa, mes, estado, cifras, cerrado_en, historial) VALUES ($4, $1, 'cerrado', $3, now(), '[]'), ($4, $2, 'cerrado', $3, now(), '[]')`, [antes(1), antes(2), cifras, x.empresa])
    const r0 = (await llamar(x.admin, 'GET', '/usuarios/rachas')).body[x.ana.id]
    assert.deepEqual([r0.racha, r0.mejorRacha, r0.medallas], [0, 2, []])
    assert.equal((await llamar(x.ana, 'GET', '/usuarios/rachas')).status, 403)
    const medallas = async () => (await db.query(`SELECT titulo, datos FROM notificaciones WHERE tipo = 'medalla_ganada' AND id_usuario = $1`, [x.admin.id])).rows
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)).status, 200)
    const r1 = (await llamar(x.admin, 'GET', '/usuarios/rachas')).body[x.ana.id]
    assert.deepEqual([r1.racha, r1.mejorRacha, r1.medallas, r1.cumplidos], [3, 3, [{ medalla: 3, mes: MES }], 3])
    const [m] = await medallas()
    assert.equal(m.titulo, 'Medalla de 3 meses')
    assert.deepEqual([m.datos.medalla, m.datos.vendedorIds], [3, [x.ana.id]])
    // A ella también le llega, y su historial trae los tres meses con la meta y lo vendido.
    const suya = (await db.query(`SELECT titulo FROM notificaciones WHERE tipo = 'medalla_ganada' AND id_usuario = $1`, [x.ana.id])).rows
    assert.deepEqual(suya.map((n) => n.titulo), ['¡Ganaste la medalla de 3 meses!'])
    const h = (await llamar(x.admin, 'GET', `/usuarios/${x.ana.id}/metas`)).body.historial
    assert.equal(h.length, 3)
    assert.deepEqual([h[0].mes, h[0].ventas, h[0].meta, h[0].cumplimientoPct], [MES, 120, 100, 120])
    // Su lugar en el salón de la fama (sólo el número) y, sin medalla nueva, el récord personal no aplica todavía.
    assert.deepEqual((await llamar(x.ana, 'GET', '/mi-meta/trofeos')).body.fama, { lugar: 1, de: 1 })
    assert.equal((await db.query(`SELECT 1 FROM notificaciones WHERE tipo = 'record_personal'  AND id_usuario = $1`, [x.ana.id])).rowCount, 0)
    // El Excel del informe lleva la hoja «Medallas»; el resumen del año, a Ana como vendedora del año y su racha.
    const xlsx = await llamar(x.admin, 'GET', `/cierres/${MES}/informe?formato=xlsx`)
    assert.ok(xlsx.bruto.toString('latin1').includes('xl/worksheets/sheet4.xml')) // la cuarta hoja: Medallas
    const anio = (await llamar(x.admin, 'GET', `/cierres/anio/${MES.slice(0, 4)}`)).body
    assert.equal(anio.vendedorDelAnio?.id ?? x.ana.id, x.ana.id)
    assert.ok(anio.meses.some((m: { mes: string }) => m.mes === MES))
    assert.equal((await llamar(x.ana, 'GET', `/cierres/anio/${MES.slice(0, 4)}`)).status, 403)
    assert.equal(anio.vendedores, undefined) // el detalle por vendedor no sale
    // Contra el año anterior: mismos meses cerrados en los dos años.
    await db.query(`INSERT INTO cierres_mes (id_empresa, mes, estado, cifras, cerrado_en, historial) VALUES ($3, $1, 'cerrado', $2, now(), '[]')
       ON CONFLICT (id_empresa, mes) DO UPDATE SET estado = 'cerrado', cifras = EXCLUDED.cifras`,
      [`${Number(MES.slice(0, 4)) - 1}-${MES.slice(5)}-01`, JSON.stringify({ ventas: { ingreso: 60 }, vendedores: [] }), x.empresa])
    const conAnterior = (await llamar(x.admin, 'GET', `/cierres/anio/${MES.slice(0, 4)}`)).body.anterior
    assert.ok(conAnterior)
    assert.equal(conAnterior.total, 60)
    // Ana ve sólo lo suyo del año.
    const suyo = (await llamar(x.ana, 'GET', `/mi-meta/anio/${MES.slice(0, 4)}`)).body
    assert.ok(suyo.ventas >= 120)
    assert.equal(suyo.vendedorDelAnio, true)
    assert.ok(suyo.mejorMes)
    const beto = (await llamar(x.beto, 'GET', `/mi-meta/anio/${MES.slice(0, 4)}`)).body
    assert.deepEqual([beto.ventas, beto.vendedorDelAnio, beto.mejorMes], [0, false, null])
    // Reabrir y volver a cerrar no la repite.
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/reabrir`, { motivo: 'Corrección de prueba' })).status, 200)
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)).status, 200)
    assert.equal((await medallas()).length, 1)
  })

  it('al superar su mejor racha sin medalla nueva, el vendedor recibe su récord personal, una vez', async () => {
    const x = await escenario()
    await llamar(x.admin, 'PATCH', `/usuarios/${x.ana.id}`, { metaMensual: 100 })
    await x.entrega('EFECTIVO', 2, `${MES}-10`)
    const antes = (n: number) => { const [a, m] = MES.split('-').map(Number); const f = new Date(a, m - 1 - n, 1); return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-01` }
    const bien = JSON.stringify({ vendedores: [{ id: x.ana.id, nombre: 'Ana', ventas: 110, meta: 100, cumplimientoPct: 110 }] })
    const mal = JSON.stringify({ vendedores: [{ id: x.ana.id, nombre: 'Ana', ventas: 10, meta: 100, cumplimientoPct: 10 }] })
    // Antes: una racha de 1 (hace 3 meses), luego un mes sin llegar; ahora 2 seguidos (el anterior y este) = récord de 2.
    await db.query(`INSERT INTO cierres_mes (id_empresa, mes, estado, cifras, cerrado_en, historial) VALUES ($6, $1, 'cerrado', $3, now(), '[]'), ($6, $2, 'cerrado', $4, now(), '[]'), ($6, $5, 'cerrado', $3, now(), '[]')`,
      [antes(3), antes(2), bien, mal, antes(1), x.empresa])
    assert.equal((await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)).status, 200)
    const records = async () => (await db.query(`SELECT titulo, cuerpo, datos FROM notificaciones WHERE tipo = 'record_personal' AND id_usuario = $1`, [x.ana.id])).rows
    const [r] = await records()
    assert.equal(r.titulo, '¡Nuevo récord personal!')
    assert.match(r.cuerpo, /^2 meses seguidos .*Uno más y ganas la medalla de 3 meses/)
    assert.equal(r.datos.racha, 2)
    await llamar(x.admin, 'POST', `/cierres/${MES}/reabrir`, { motivo: 'Corrección de prueba' })
    await llamar(x.admin, 'POST', `/cierres/${MES}/cerrar`)
    assert.equal((await records()).length, 1)
  })
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
    const corte = await llamar(x.admin, 'POST', '/cortes', { efectivoEntregado: 120, fecha: `${MES}-10`, vendedorId: x.ana.id })
    assert.equal(corte.status, 409) // los cortes de un mes cerrado tampoco cambian
    assert.match(corte.body.error, /ya está cerrado/)

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
