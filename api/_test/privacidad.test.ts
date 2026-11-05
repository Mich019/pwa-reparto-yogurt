import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import type { ClienteMp } from '../_lib/mercadopago.js'
import { construirApp } from '../_lib/app.js'
import { purgarBajas, VERSION_LEGAL } from '../_lib/privacidad.js'
import { app, cliente, config, crearEmpresa, db, login, op, PASSWORD, push, sesion } from './ayuda.js'

// Privacidad y derechos ARCO: aviso aceptado, descargar los datos, eliminar la cuenta y dar de baja la empresa.

const canceladas: string[] = []
const mpFalso: ClienteMp = {
  async crear() { return { id: 'x', url: 'https://mp.test' } },
  async consultar(id) { return { id, estado: 'authorized', empresa: null } },
  async cancelar(id) { canceladas.push(id) },
}
const srv = await construirApp({ db, config, mercadoPago: mpFalso })
after(async () => { await srv.close(); await app.close(); await db.end() })

type S = { token: string }
const pedir = async (s: S, method: 'GET' | 'POST', url: string, payload?: object) => {
  const r = await srv.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const silencio = { info: () => {}, error: () => {} }

describe('aviso de privacidad y términos', () => {
  it('la versión del servidor es la misma que muestra la app', () => {
    const front = readFileSync(new URL('../../src/lib/legal.ts', import.meta.url), 'utf8')
    assert.match(front, new RegExp(`VERSION_LEGAL = '${VERSION_LEGAL}'`))
  })

  it('una cuenta creada por el administrador lo acepta al entrar, sólo la versión vigente', async () => {
    const v = await sesion('vendedor')
    assert.equal((await pedir(v, 'GET', '/me')).body.legalPendiente, true)
    assert.equal((await pedir(v, 'POST', '/me/legal', { version: '2000-01-01' })).status, 409)
    assert.equal((await pedir(v, 'POST', '/me/legal', { version: VERSION_LEGAL })).status, 200)
    assert.equal((await pedir(v, 'GET', '/me')).body.legalPendiente, false)
  })
})

describe('derecho de acceso', () => {
  it('descarga sus datos sin contraseñas ni secretos', async () => {
    const v = await sesion('vendedor')
    const r = await pedir(v, 'GET', '/me/datos')
    assert.equal(r.status, 200)
    assert.equal(r.body.cuenta.correo, (v as unknown as { correo: string }).correo)
    assert.ok(r.body.sesiones.length >= 1)
    assert.doesNotMatch(JSON.stringify(r.body), /argon2|password_hash|secreto/)
  })

  it('el administrador descarga lo de su empresa por páginas; el vendedor no', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const c = cliente({ nombre: 'Cliente para exportar' })
    await push(vend, [op('clientes', c.id, c)], Date.now(), srv)
    const r = await pedir(admin, 'GET', '/empresa/datos')
    assert.equal(r.status, 200)
    assert.ok(r.body.tablas.includes('clientes'))
    assert.equal(r.body.usuarios.length, 2)
    const t = await pedir(admin, 'GET', '/empresa/datos/clientes')
    assert.deepEqual(t.body.filas.map((f: { nombre: string }) => f.nombre), ['Cliente para exportar'])
    assert.equal(t.body.filas[0].id_empresa, undefined)
    assert.equal(t.body.siguiente, null)
    assert.equal((await pedir(admin, 'GET', '/empresa/datos/usuarios')).status, 404) // sólo las tablas de la lista
    assert.equal((await pedir(vend, 'GET', '/empresa/datos')).status, 403)
  })
})

describe('eliminar la cuenta propia', () => {
  it('pide la contraseña, anonimiza la cuenta y la deja sin entrar; sus clientes quedan sin vendedor', async () => {
    const v = await sesion('vendedor')
    const c = cliente({ nombre: 'Cliente de quien se va' })
    await push(v, [op('clientes', c.id, c)], Date.now(), srv)
    assert.equal((await pedir(v, 'POST', '/me/eliminar', { password: 'otra-cosa' })).status, 403)
    assert.equal((await pedir(v, 'POST', '/me/eliminar', { password: PASSWORD })).status, 204)

    const { rows: [u] } = await db.query(`SELECT nombre, correo, telefono, activo, eliminado_en FROM usuarios WHERE id_usuario = $1`, [v.id])
    assert.equal(u.nombre, 'Cuenta eliminada')
    assert.match(u.correo, /@cuenta-eliminada\.invalid$/)
    assert.equal(u.activo, false)
    assert.ok(u.eliminado_en)
    assert.equal((await login(v.correo)).status, 401)
    assert.equal((await pedir(v, 'GET', '/me')).status, 401) // la sesión ya no sirve
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM sesiones WHERE id_usuario = $1`, [v.id])).rows[0].n, 0)
    assert.equal((await db.query(`SELECT id_vendedor FROM clientes WHERE id_cliente = $1`, [c.id])).rows[0].id_vendedor, null)
    const { rows: bitacora } = await db.query(`SELECT datos_antes, datos_despues FROM auditoria WHERE tabla = 'usuarios' AND id_registro = $1`, [v.id])
    assert.doesNotMatch(JSON.stringify(bitacora), new RegExp(v.correo))
  })

  it('el único administrador no puede: primero nombra a otro', async () => {
    const empresa = await crearEmpresa()
    const a1 = await sesion('administrador', 'tel-1', empresa)
    const r = await pedir(a1, 'POST', '/me/eliminar', { password: PASSWORD })
    assert.equal(r.status, 409)
    assert.equal(r.body.codigo, 'ULTIMO_ADMIN')
    await sesion('administrador', 'tel-2', empresa)
    assert.equal((await pedir(a1, 'POST', '/me/eliminar', { password: PASSWORD })).status, 204)
  })
})

describe('baja de la empresa', () => {
  it('cancela el cobro, deja fuera a todos y borra todo al vencer el plazo, aunque otra empresa cerrara ese mes', async () => {
    const empresa = await crearEmpresa(`Baja ${randomUUID().slice(0, 6)}`)
    const { rows: [{ nombre }] } = await db.query(`SELECT nombre FROM empresas WHERE id_empresa = $1`, [empresa])
    const preapproval = `pre-${randomUUID()}`
    await db.query(`UPDATE empresas SET mp_preapproval_id = $2, suscripcion_estado = 'authorized' WHERE id_empresa = $1`, [empresa, preapproval])
    const admin = await sesion('administrador', 'tel-a', empresa)
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const c = cliente({ nombre: 'Cliente que se borra' })
    await push(vend, [op('clientes', c.id, c)], Date.now(), srv)
    await db.query(`INSERT INTO abonos (id_empresa, id_cliente, id_vendedor, fecha, monto, metodo) VALUES ($1, $2, $3, '2020-01-15', 10, 'efectivo')`, [empresa, c.id, vend.id])
    // Otra empresa cerró enero de 2020: no debe frenar el borrado de ésta.
    const otra = await crearEmpresa()
    await db.query(`INSERT INTO cierres_mes (id_empresa, mes, estado, cifras) VALUES ($1, '2020-01-01', 'cerrado', '{}')`, [otra])

    assert.equal((await pedir(vend, 'POST', '/empresa/baja', { password: PASSWORD, nombre })).status, 403)
    assert.equal((await pedir(admin, 'POST', '/empresa/baja', { password: PASSWORD, nombre: 'Otra' })).body.codigo, 'NOMBRE_DISTINTO')
    const r = await pedir(admin, 'POST', '/empresa/baja', { password: PASSWORD, nombre: nombre.toUpperCase(), motivo: 'Cerramos el negocio' })
    assert.equal(r.status, 200)
    const dias = (new Date(r.body.borrarEn).getTime() - Date.now()) / 86_400_000
    assert.ok(dias > 29 && dias <= 30)
    assert.deepEqual(canceladas, [preapproval])
    assert.equal((await pedir(vend, 'GET', '/me')).status, 401) // sesiones cerradas
    assert.equal((await login(vend.correo)).body.codigo, 'EMPRESA_SUSPENDIDA')

    await purgarBajas(db, silencio)
    assert.equal((await db.query(`SELECT 1 FROM empresas WHERE id_empresa = $1`, [empresa])).rowCount, 1) // aún dentro del plazo
    await db.query(`UPDATE empresas SET baja_borrar_en = now() - interval '1 minute' WHERE id_empresa = $1`, [empresa])
    await purgarBajas(db, silencio)
    assert.equal((await db.query(`SELECT 1 FROM empresas WHERE id_empresa = $1`, [empresa])).rowCount, 0)
    assert.equal((await db.query(`SELECT 1 FROM usuarios WHERE id_empresa = $1`, [empresa])).rowCount, 0)
    assert.equal((await db.query(`SELECT 1 FROM cierres_mes WHERE id_empresa = $1`, [otra])).rowCount, 1)
  })
})

describe('cierre de mes', () => {
  it('anular un abono de un mes cerrado también está bloqueado', async () => {
    const empresa = await crearEmpresa()
    const vend = await sesion('vendedor', 'tel-v', empresa)
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)], Date.now(), srv)
    const { rows: [a] } = await db.query(
      `INSERT INTO abonos (id_empresa, id_cliente, id_vendedor, fecha, monto, metodo) VALUES ($1, $2, $3, '2020-02-10', 10, 'efectivo') RETURNING id_abono`,
      [empresa, c.id, vend.id],
    )
    await db.query(`INSERT INTO cierres_mes (id_empresa, mes, estado, cifras) VALUES ($1, '2020-02-01', 'cerrado', '{}')`, [empresa])
    await assert.rejects(db.query(`UPDATE abonos SET anulado_en = now(), motivo_anulacion = 'x' WHERE id_abono = $1`, [a.id_abono]), /ya está cerrado/)
  })
})
