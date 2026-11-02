import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { app, config, crearEmpresa, db, sesion } from './ayuda.js'

// Panel de la plataforma (/plataforma): sólo cuentas marcadas de la empresa interna, con verificación en dos pasos.

// La empresa interna y una cuenta de la plataforma en ella, como las deja npm run db:plataforma.
const interna = await crearEmpresa('Plataforma')
await db.query(`UPDATE empresas SET interna = true, exenta = true WHERE id_empresa = $1`, [interna])
const dueno = await sesion('administrador', 'panel', interna)
await db.query(`UPDATE usuarios SET es_plataforma = true WHERE id_usuario = $1`, [dueno.id])
const srv = await construirApp({ db, config: { ...config, mercadoPago: { ...config.mercadoPago, precioMensual: 299 } } })
after(async () => { await srv.close(); await app.close(); await db.end() })

const pedir = async (s: { token: string }, metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) => {
  const r = await srv.inject({ method: metodo, url, headers: { authorization: `Bearer ${s.token}` }, payload })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const conDosPasos = (id: string) => db.query(`INSERT INTO dos_pasos (id_usuario, secreto, activado_en) VALUES ($1, 'x', now()) ON CONFLICT (id_usuario) DO UPDATE SET activado_en = now()`, [id])

describe('panel de la plataforma', () => {
  it('el estado del servicio dice qué está listo, sin claves, y sólo a la plataforma', async () => {
    await conDosPasos(dueno.id)
    const r = await pedir(dueno, 'GET', '/plataforma/servicio')
    assert.equal(r.status, 200)
    assert.equal(r.body.precioMensual, 299)
    assert.equal(typeof r.body.cobro, 'boolean')
    assert.equal(typeof r.body.uso.usuarios, 'number')
    assert.ok(r.body.base.tamano > 0)
    assert.ok(!JSON.stringify(r.body).includes(config.jwtSecret))
    const ajena = await sesion('administrador')
    assert.equal((await pedir(ajena, 'GET', '/plataforma/servicio')).status, 403)
    assert.equal((await pedir(ajena, 'PATCH', '/plataforma/ajustes', { correoSoporte: 'a@b.mx' })).status, 403)

    // Ajustes: el correo de soporte se lee sin sesión; null lo quita. (Registro y días de prueba se prueban en
    // registro.test.ts, para no cruzarse con sus altas.)
    const a = await pedir(dueno, 'PATCH', '/plataforma/ajustes', { correoSoporte: 'Ayuda@Delisy.MX' })
    assert.equal(a.status, 200)
    assert.equal(a.body.correoSoporte, 'ayuda@delisy.mx')
    const publico = await srv.inject({ method: 'GET', url: '/plataforma/publico' })
    assert.deepEqual(publico.json(), { registroAbierto: true, correoSoporte: 'ayuda@delisy.mx' })
    assert.equal((await pedir(dueno, 'PATCH', '/plataforma/ajustes', { correoSoporte: 'no-es-correo' })).status, 400)
    assert.equal((await pedir(dueno, 'PATCH', '/plataforma/ajustes', { pruebaDias: 400 })).status, 400)
    assert.equal((await pedir(dueno, 'PATCH', '/plataforma/ajustes', { otro: 1 })).status, 400)
    assert.equal((await pedir(dueno, 'PATCH', '/plataforma/ajustes', { avisoPruebaDias: 90 })).status, 400)
    const b = await pedir(dueno, 'PATCH', '/plataforma/ajustes', { correoSoporte: null })
    assert.equal(b.body.correoSoporte, null)
    // Una empresa la lee pero no la cambia, ni con una consulta propia (sin permiso de escritura para reparto_app).
    const cx = await db.connect()
    try {
      await cx.query('BEGIN')
      await cx.query('SET LOCAL ROLE reparto_app')
      assert.equal((await cx.query('SELECT registro_abierto FROM plataforma_ajustes')).rowCount, 1)
      await cx.query('SAVEPOINT s')
      await assert.rejects(cx.query(`SELECT 1 FROM avisos_plataforma`), /permission denied|permiso denegado/) // ni la lee: sólo por la API
      await cx.query('ROLLBACK TO s')
      await assert.rejects(cx.query(`UPDATE plataforma_ajustes SET correo_soporte = 'x'`), /permission denied|permiso denegado/)
    } finally {
      await cx.query('ROLLBACK')
      cx.release()
    }
    await db.query(`DELETE FROM dos_pasos WHERE id_usuario = $1`, [dueno.id]) // la prueba siguiente empieza sin ella
  })

  it('los avisos salen sólo con sesión, mientras están vigentes y a quien van; y el automático de la prueba por vencer', async () => {
    await conDosPasos(dueno.id)
    const empresa = await crearEmpresa('Avisos')
    await db.query(`UPDATE empresas SET exenta = false, prueba_hasta = now() + interval '3 days', suscripcion_estado = null WHERE id_empresa = $1`, [empresa])
    const admin = await sesion('administrador', 'panel', empresa)
    const vendedor = await sesion('vendedor', 'tel-1', empresa)
    const hora = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
    const crear = (cuerpo: object) => pedir(dueno, 'POST', '/plataforma/avisos', cuerpo)
    const vigentes = async (s: { token: string }) => (await pedir(s, 'GET', '/plataforma/avisos/vigentes')).body.avisos as { clave: string; texto: string; accion?: string }[]
    const textos = async (s: { token: string }) => (await vigentes(s)).map((a) => a.texto)

    assert.equal((await pedir(admin, 'POST', '/plataforma/avisos', { texto: 'x' })).status, 403)
    assert.equal((await crear({ texto: '   ' })).status, 400)
    assert.equal((await crear({ texto: 'x', desde: hora(2), hasta: hora(1) })).status, 400)
    assert.equal((await crear({ texto: 'x', para: 'nadie' })).status, 400)
    const todos = await crear({ texto: '  Mantenimiento el domingo  ', tipo: 'aviso' })
    assert.equal(todos.status, 201)
    assert.equal(todos.body.aviso.texto, 'Mantenimiento el domingo')
    const soloVendedores = await crear({ texto: 'Ruta nueva', para: 'vendedores', hasta: hora(1) })
    const futuro = await crear({ texto: 'Mañana', desde: hora(20) })
    const vencido = await crear({ texto: 'Ayer', desde: hora(-30), hasta: hora(-2) })

    assert.equal((await srv.inject({ method: 'GET', url: '/plataforma/avisos/vigentes' })).statusCode, 401)
    // Al administrador: el automático primero (con su botón), y sólo lo vigente que va a todos.
    const delAdmin = await vigentes(admin)
    assert.deepEqual(delAdmin.map((a) => a.texto), ['Quedan 3 días de prueba gratis. Suscríbete para que tu equipo no pierda el acceso.', 'Mantenimiento el domingo'])
    assert.equal(delAdmin[0].accion, 'suscripcion')
    assert.equal(delAdmin[0].clave, 'prueba:3')
    // Al vendedor no le sale el automático hasta que se active para ellos.
    assert.deepEqual(await textos(vendedor), ['Mantenimiento el domingo', 'Ruta nueva'])
    const ajustes = await pedir(dueno, 'PATCH', '/plataforma/ajustes', { avisoPruebaVendedores: true })
    assert.deepEqual(ajustes.body.avisoPrueba, { dias: 7, vendedores: true })
    assert.match((await textos(vendedor))[0], /^Quedan 3 días de prueba gratis de Avisos\. Avísale/)
    // Fuera del plazo del aviso, suscrita o exenta, no hay automático.
    await pedir(dueno, 'PATCH', '/plataforma/ajustes', { avisoPruebaDias: 2 })
    assert.deepEqual(await textos(admin), ['Mantenimiento el domingo'])
    await pedir(dueno, 'PATCH', '/plataforma/ajustes', { avisoPruebaDias: 7 })
    await db.query(`UPDATE empresas SET suscripcion_estado = 'authorized' WHERE id_empresa = $1`, [empresa])
    assert.deepEqual(await textos(admin), ['Mantenimiento el domingo'])

    // Cambiarlo cambia su clave (vuelve a salir a quien lo cerró); la lista de la plataforma trae todos, vencidos al final.
    const antes = (await vigentes(admin))[0].clave
    const cambiado = await pedir(dueno, 'PUT', `/plataforma/avisos/${todos.body.aviso.id}`, { texto: 'Mantenimiento el lunes', tipo: 'aviso' })
    assert.equal(cambiado.status, 200)
    assert.notEqual((await vigentes(admin))[0].clave, antes)
    const lista = await pedir(dueno, 'GET', '/plataforma/avisos')
    assert.equal(lista.body.avisos.at(-1).texto, 'Ayer')
    assert.equal(lista.body.avisos.length, 4)
    assert.equal((await pedir(dueno, 'PUT', `/plataforma/avisos/${crypto.randomUUID()}`, { texto: 'x' })).status, 404)

    for (const a of [todos, soloVendedores, futuro, vencido]) assert.equal((await pedir(dueno, 'DELETE', `/plataforma/avisos/${a.body.aviso.id}`)).status, 204)
    assert.equal((await pedir(dueno, 'DELETE', `/plataforma/avisos/${todos.body.aviso.id}`)).status, 404)
    assert.deepEqual(await vigentes(vendedor), [])
    await pedir(dueno, 'PATCH', '/plataforma/ajustes', { avisoPruebaVendedores: false })
    await db.query(`DELETE FROM dos_pasos WHERE id_usuario = $1`, [dueno.id])
  })


  it('sólo entra una cuenta de la plataforma y con verificación en dos pasos', async () => {
    const otro = await sesion('administrador')
    assert.equal((await pedir(otro, 'GET', '/plataforma/empresas')).status, 403)
    await conDosPasos(otro.id) // aunque la tenga, no es de la plataforma
    assert.equal((await pedir(otro, 'GET', '/plataforma/empresas')).body.codigo, 'SIN_PERMISO')
    // La marca en una cuenta de un negocio no basta: tiene que vivir en la empresa interna.
    await db.query(`UPDATE usuarios SET es_plataforma = true WHERE id_usuario = $1`, [otro.id])
    assert.equal((await pedir(otro, 'GET', '/plataforma/empresas')).body.codigo, 'SIN_PERMISO')
    const sin = await pedir(dueno, 'GET', '/plataforma/empresas')
    assert.equal(sin.status, 403)
    assert.equal(sin.body.codigo, 'DOS_PASOS_REQUERIDOS')
  })

  it('ve todas las empresas con su estado y uso, y el ingreso del mes', async () => {
    await conDosPasos(dueno.id)
    const nueva = await crearEmpresa('Hielo Polar')
    const adminNueva = await sesion('administrador', 'panel', nueva)
    const pagando = await crearEmpresa('Agua Pagando')
    await db.query(`UPDATE empresas SET suscripcion_estado = 'authorized' WHERE id_empresa = $1`, [pagando])
    const r = await pedir(dueno, 'GET', '/plataforma/empresas')
    assert.equal(r.status, 200)
    const e = r.body.empresas.find((x: { id: string }) => x.id === nueva)
    assert.equal(e.estado, 'prueba')
    assert.equal(e.contacto, adminNueva.correo)
    assert.equal(e.usuarios, 1)
    assert.equal(r.body.empresas.find((x: { id: string }) => x.id === pagando).estado, 'activa')
    assert.equal(r.body.resumen.ingresoMensual, r.body.resumen.activas * 299)
    assert.equal(r.body.resumen.total, r.body.empresas.length)
  })

  it('suspende y reactiva empresas, pero no la propia', async () => {
    await conDosPasos(dueno.id)
    const otra = await crearEmpresa('Por suspender')
    const admin = await sesion('administrador', 'panel', otra)
    assert.equal((await pedir(dueno, 'POST', `/plataforma/empresas/${otra}/activa`, { activa: false })).status, 200)
    const r = await srv.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${admin.token}` } })
    assert.equal(r.json().codigo, 'EMPRESA_SUSPENDIDA')
    assert.equal((await pedir(dueno, 'POST', `/plataforma/empresas/${otra}/activa`, { activa: true })).status, 200)
    assert.equal((await srv.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${admin.token}` } })).statusCode, 200)

    assert.equal((await pedir(dueno, 'POST', `/plataforma/empresas/${interna}/activa`, { activa: false })).body.codigo, 'PROPIA_EMPRESA')
    assert.equal((await pedir(dueno, 'POST', '/plataforma/empresas/no-es-uuid/activa', { activa: false })).status, 404)
  })

  it('el correo no da el permiso: un administrador de empresa no se hace de la plataforma', async () => {
    // Antes bastaba con que el correo estuviera en una lista: cualquier administrador podía crear una cuenta con él.
    const admin = await sesion('administrador')
    const r = await srv.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${admin.token}` }, payload: { nombre: 'Falso', correo: `falso-${Date.now()}@prueba.local`, rol: 'administrador', password: 'Lacteos2026!x' } })
    assert.equal(r.statusCode, 201)
    const l = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo: r.json().usuario.correo, password: 'Lacteos2026!x', dispositivo: 'x' } })
    assert.equal(l.json().usuario.plataforma, false)
    // Y un administrador de empresa no ve las cuentas de la plataforma en su equipo.
    const equipo = await srv.inject({ method: 'GET', url: '/usuarios', headers: { authorization: `Bearer ${admin.token}` } })
    assert.ok(!equipo.json().usuarios.some((u: { id: string }) => u.id === dueno.id))
  })

  it('crea cuentas de super admin en la empresa interna, que no sale en la lista', async () => {
    await conDosPasos(dueno.id)
    const correo = `super-${Date.now()}@prueba.local`
    const r = await pedir(dueno, 'POST', '/plataforma/cuentas', { nombre: 'Otra Persona', correo })
    assert.equal(r.status, 201)
    assert.equal((await pedir(dueno, 'POST', '/plataforma/cuentas', { nombre: 'Otra', correo })).status, 409)
    // Entra con la temporal: la sesión dice que es de la plataforma (la app la lleva a /plataforma).
    const l = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo, password: r.body.passwordTemporal, dispositivo: 'x' } })
    assert.equal(l.json().usuario.plataforma, true)
    const lista = await pedir(dueno, 'GET', '/plataforma/empresas')
    assert.ok(lista.body.cuentas.some((c: { correo: string }) => c.correo === correo))
    assert.ok(!lista.body.empresas.some((e: { id: string }) => e.id === interna))
    const { rows: [u] } = await db.query(`SELECT u.debe_cambiar_password, e.interna FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.correo = $1`, [correo])
    assert.deepEqual(u, { debe_cambiar_password: true, interna: true })
    // Quien no es de la plataforma no crea cuentas, y su sesión no dice que lo sea.
    const otro = await sesion('administrador')
    assert.equal((await pedir(otro, 'POST', '/plataforma/cuentas', { nombre: 'X', correo: `x-${Date.now()}@prueba.local` })).status, 403)
    const lo = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo: otro.correo, password: 'Yogurt2026!', dispositivo: 'x' } })
    assert.equal(lo.json().usuario.plataforma, false)
  })

  it('trae las series de la plataforma y el detalle de una empresa, sin las de otras', async () => {
    await conDosPasos(dueno.id)
    const empresa = await crearEmpresa('Detalle SA')
    const admin = await sesion('administrador', 'panel', empresa)
    const r = await pedir(dueno, 'GET', '/plataforma/empresas')
    assert.equal(r.body.series.altasPorMes.length, 12)
    assert.equal(r.body.series.pedidosPorDia.length, 30)
    assert.equal(typeof r.body.resumen.porVencer, 'number')
    const d = await pedir(dueno, 'GET', `/plataforma/empresas/${empresa}`)
    assert.equal(d.status, 200)
    assert.equal(d.body.nombre, 'Detalle SA')
    assert.deepEqual(d.body.equipo.map((u: { correo: string }) => u.correo), [admin.correo])
    assert.equal(d.body.pedidosPorDia.length, 30)
    assert.equal((await pedir(dueno, 'GET', `/plataforma/empresas/${interna}`)).status, 404) // la interna no se ve
    assert.equal((await pedir(admin, 'GET', `/plataforma/empresas/${empresa}`)).status, 403)
  })

  it('ajusta la prueba, la exención y el nombre de una empresa', async () => {
    await conDosPasos(dueno.id)
    const empresa = await crearEmpresa('Por ajustar')
    const vend = await sesion('vendedor', 'tel', empresa)
    assert.equal((await pedir(dueno, 'PATCH', `/plataforma/empresas/${empresa}`, { pruebaHasta: '2020-01-01' })).status, 200)
    assert.equal((await srv.inject({ method: 'GET', url: '/sync/pull?desde=0', headers: { authorization: `Bearer ${vend.token}` } })).statusCode, 402)
    assert.equal((await pedir(dueno, 'PATCH', `/plataforma/empresas/${empresa}`, { exenta: true, nombre: 'Ya ajustada' })).status, 200)
    assert.equal((await srv.inject({ method: 'GET', url: '/sync/pull?desde=0', headers: { authorization: `Bearer ${vend.token}` } })).statusCode, 200)
    const d = await pedir(dueno, 'GET', `/plataforma/empresas/${empresa}`)
    assert.equal(d.body.estado, 'exenta')
    assert.equal(d.body.nombre, 'Ya ajustada')
    assert.equal((await pedir(dueno, 'PATCH', `/plataforma/empresas/${empresa}`, {})).status, 400)
  })

  it('crea una empresa con su administrador invitado, que entra a esa empresa', async () => {
    await conDosPasos(dueno.id)
    const correoAdmin = `nuevo-admin-${Date.now()}@prueba.local`
    const r = await pedir(dueno, 'POST', '/plataforma/empresas', { nombre: 'Hielo Nuevo', administrador: { nombre: 'Rosa Ruiz', correo: correoAdmin }, pruebaDias: 30 })
    assert.equal(r.status, 201)
    assert.match(r.body.enlace, /\/invitacion#.+/)
    assert.equal((await pedir(dueno, 'POST', '/plataforma/empresas', { nombre: 'Otra', administrador: { nombre: 'Rosa', correo: dueno.correo } })).status, 409)
    // El administrador acepta el enlace y queda en esa empresa, con su rol.
    const token = r.body.enlace.split('#')[1]
    const a = await srv.inject({ method: 'POST', url: '/invitacion/aceptar', payload: { token, nombre: 'Rosa Ruiz', password: 'Lacteos2026!x' } })
    assert.equal(a.statusCode, 201)
    const { rows: [u] } = await db.query(`SELECT u.rol, u.id_empresa, e.nombre, e.prueba_hasta > now() + interval '29 days' AS treinta FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.correo = $1`, [correoAdmin])
    assert.deepEqual([u.rol, u.id_empresa, u.nombre, u.treinta], ['administrador', r.body.id, 'Hielo Nuevo', true])
  })
})
