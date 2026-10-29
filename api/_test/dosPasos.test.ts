import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { codigoTotp, pasoActual } from '../_lib/dosPasos.js'
import { PASSWORD, app, db, ipAleatoria, login, sesion } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

type S = { token: string }
async function post(s: S | null, url: string, payload: unknown = {}, ip = ipAleatoria()) {
  const r = await app.inject({ method: 'POST', url, payload: payload as object, headers: s ? { authorization: `Bearer ${s.token}` } : {}, remoteAddress: ip })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
async function get(s: S, url: string) {
  const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${s.token}` } })
  return { status: r.statusCode, body: r.json() }
}

// Activa la verificación de una cuenta nueva con el código de la ventana actual. Los siguientes códigos válidos son
// los de ventanas posteriores (el de activación ya se gastó).
async function conDosPasos(rol: 'administrador' | 'vendedor' = 'administrador') {
  const s = await sesion(rol)
  const { body: { secreto, uri } } = await post(s, '/auth/dos-pasos/iniciar')
  assert.match(uri, /^otpauth:\/\/totp\/Delisy%3A.+\?secret=[A-Z2-7]{32}&issuer=Delisy/)
  const act = await post(s, '/auth/dos-pasos/activar', { codigo: codigoTotp(secreto, pasoActual()) })
  assert.equal(act.status, 200)
  return { ...s, secreto: secreto as string, respaldo: act.body.respaldo as string[] }
}
const siguiente = (secreto: string) => codigoTotp(secreto, pasoActual() + 1)

describe('verificación en dos pasos', () => {
  it('se activa con un código del autenticador y entrega 10 códigos de respaldo una sola vez', async () => {
    const s = await conDosPasos()
    assert.equal(s.respaldo.length, 10)
    assert.ok(s.respaldo.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)))
    assert.deepEqual((await get(s, '/auth/dos-pasos')).body.activa, true)
    assert.equal((await get(s, '/auth/dos-pasos')).body.respaldoRestante, 10)
    // En la base no queda el secreto en claro ni los códigos de respaldo
    const { rows: [f] } = await db.query(`SELECT secreto, respaldo FROM dos_pasos WHERE id_usuario = $1`, [s.id])
    assert.ok(!f.secreto.includes(s.secreto))
    assert.ok(!f.respaldo.includes(s.respaldo[0]))
    // Ya activa no se puede volver a iniciar (cambiaría el secreto sin pedir nada)
    assert.equal((await post(s, '/auth/dos-pasos/iniciar')).status, 409)
  })

  it('con un código equivocado no se activa', async () => {
    const s = await sesion('administrador')
    const { body: { secreto } } = await post(s, '/auth/dos-pasos/iniciar')
    const malo = codigoTotp(secreto, pasoActual() + 5)
    assert.equal((await post(s, '/auth/dos-pasos/activar', { codigo: malo })).status, 400)
    assert.equal((await get(s, '/auth/dos-pasos')).body.activa, false)
    // Sin activar, entrar sigue pidiendo sólo la contraseña
    assert.ok((await login(s.correo)).body.accessToken)
  })

  it('con la verificación activa la contraseña sola no abre sesión: hace falta el código', async () => {
    const s = await conDosPasos()
    const paso1 = await login(s.correo)
    assert.equal(paso1.status, 200)
    assert.equal(paso1.body.dosPasos, true)
    assert.equal(paso1.body.accessToken, undefined)
    // El desafío no sirve como sesión
    const r = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${paso1.body.desafio}` } })
    assert.equal(r.statusCode, 401)

    assert.equal((await post(null, '/auth/login/codigo', { desafio: paso1.body.desafio, codigo: '000000' })).status, 401)
    const bueno = siguiente(s.secreto)
    const paso2 = await post(null, '/auth/login/codigo', { desafio: paso1.body.desafio, codigo: bueno, dispositivo: 'tel-2' })
    assert.equal(paso2.status, 200)
    assert.ok(paso2.body.accessToken && paso2.body.refreshToken)
    assert.equal((await get({ token: paso2.body.accessToken }, '/me')).status, 200)
    // El mismo código no sirve dos veces, aunque siga en su ventana de 30 s
    const otra = await login(s.correo)
    assert.equal((await post(null, '/auth/login/codigo', { desafio: otra.body.desafio, codigo: bueno })).status, 401)
  })

  it('un token de sesión no sirve como desafío', async () => {
    const s = await conDosPasos()
    const r = await post(null, '/auth/login/codigo', { desafio: s.token, codigo: siguiente(s.secreto) })
    assert.equal(r.status, 401)
    assert.equal(r.body.codigo, 'DESAFIO_VENCIDO')
  })

  it('los códigos equivocados cuentan como intentos fallidos y bloquean', async () => {
    const s = await conDosPasos()
    const ip = ipAleatoria()
    const { body: { desafio } } = await login(s.correo, PASSWORD, 'prueba', ip)
    for (let i = 0; i < 5; i++) assert.equal((await post(null, '/auth/login/codigo', { desafio, codigo: '000000' }, ip)).status, 401)
    const bloqueado = await post(null, '/auth/login/codigo', { desafio, codigo: siguiente(s.secreto) }, ip)
    assert.equal(bloqueado.status, 429)
    assert.equal(bloqueado.body.codigo, 'BLOQUEADA')
  })

  it('un código de respaldo sirve una sola vez', async () => {
    const s = await conDosPasos()
    const [codigo] = s.respaldo
    const a = await login(s.correo)
    assert.equal((await post(null, '/auth/login/codigo', { desafio: a.body.desafio, codigo: codigo.toUpperCase().replace('-', ' ') })).status, 200)
    const b = await login(s.correo)
    assert.equal((await post(null, '/auth/login/codigo', { desafio: b.body.desafio, codigo })).status, 401)
    assert.equal((await get(s, '/auth/dos-pasos')).body.respaldoRestante, 9)
  })

  it('códigos de respaldo nuevos: los anteriores dejan de servir', async () => {
    const s = await conDosPasos()
    const r = await post(s, '/auth/dos-pasos/respaldo', { codigo: siguiente(s.secreto) })
    assert.equal(r.status, 200)
    assert.equal(r.body.respaldo.length, 10)
    const a = await login(s.correo)
    assert.equal((await post(null, '/auth/login/codigo', { desafio: a.body.desafio, codigo: s.respaldo[0] })).status, 401)
    assert.equal((await post(null, '/auth/login/codigo', { desafio: a.body.desafio, codigo: r.body.respaldo[0] })).status, 200)
  })

  it('desactivarla pide la contraseña y un código; después se entra sólo con la contraseña', async () => {
    const s = await conDosPasos('vendedor')
    assert.equal((await post(s, '/auth/dos-pasos/desactivar', { password: 'otra-cosa-123', codigo: siguiente(s.secreto) })).status, 401)
    assert.equal((await post(s, '/auth/dos-pasos/desactivar', { password: PASSWORD, codigo: '000000' })).status, 401)
    assert.equal((await post(s, '/auth/dos-pasos/desactivar', { password: PASSWORD, codigo: s.respaldo[1] })).status, 204)
    assert.equal((await get(s, '/auth/dos-pasos')).body.activa, false)
    assert.ok((await login(s.correo)).body.accessToken)
    const { rows } = await db.query(`SELECT datos_despues FROM auditoria WHERE tabla = 'dos_pasos' AND id_registro = $1 ORDER BY id_auditoria`, [s.id])
    assert.deepEqual(rows.map((r) => r.datos_despues), [{ dos_pasos: true }, { dos_pasos: false }])
  })

  it('si un administrador restablece la contraseña, la verificación se quita (teléfono perdido)', async () => {
    const admin = await sesion('administrador')
    const v = await conDosPasos('vendedor')
    const r = await post(admin, `/usuarios/${v.id}/password`, {})
    assert.equal(r.status, 200)
    const entrar = await login(v.correo, r.body.passwordTemporal)
    assert.ok(entrar.body.accessToken)
    assert.equal(entrar.body.dosPasos, undefined)
  })

  it('una cuenta dada de baja no pasa del segundo paso', async () => {
    const s = await conDosPasos('vendedor')
    const { body: { desafio } } = await login(s.correo)
    await db.query(`UPDATE usuarios SET activo = false WHERE id_usuario = $1`, [s.id])
    assert.equal((await post(null, '/auth/login/codigo', { desafio, codigo: siguiente(s.secreto) })).status, 401)
  })

  it('sin sesión no se puede configurar', async () => {
    assert.equal((await post(null, '/auth/dos-pasos/iniciar')).status, 401)
    assert.equal((await post(null, '/auth/dos-pasos/desactivar', { password: PASSWORD, codigo: '123456' })).status, 401)
  })
})
