import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { app, crearUsuario, db, get, ipAleatoria, login, PASSWORD, pull, sesion } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

describe('login y sesiones (M01)', () => {
  it('entra con credenciales correctas y devuelve el rol', async () => {
    const u = await crearUsuario('vendedor')
    const r = await login(u.correo)
    assert.equal(r.status, 200)
    assert.equal(r.body.usuario.rol, 'vendedor')
    assert.ok(r.body.accessToken && r.body.refreshToken)
  })

  it('no distingue entre correo inexistente y contraseña incorrecta', async () => {
    const u = await crearUsuario('vendedor')
    const a = await login(u.correo, 'mala-clave-1')
    const b = await login('nadie@prueba.local', 'mala-clave-1')
    assert.equal(a.status, 401)
    assert.equal(b.status, 401)
    assert.equal(a.body.error, b.body.error)
  })

  it('RF-003: tras 5 intentos fallidos seguidos esa conexión queda bloqueada para la cuenta, aun con la contraseña correcta', async () => {
    const u = await crearUsuario('vendedor')
    const ip = ipAleatoria()
    for (let i = 0; i < 5; i++) assert.equal((await login(u.correo, 'mala-clave-1', 'x', ip)).status, 401)
    const r = await login(u.correo, PASSWORD, 'x', ip)
    assert.equal(r.status, 429)
    assert.equal(r.body.codigo, 'BLOQUEADA')
    // Quien ataca desde otro lado no deja fuera al dueño: desde su teléfono entra.
    assert.equal((await login(u.correo, PASSWORD, 'x', ipAleatoria())).status, 200)
    // Pasada la ventana, la misma conexión vuelve a poder.
    await db.query(`UPDATE intentos_login SET creado_en = creado_en - interval '16 minutes' WHERE lower(correo) = lower($1) AND ip = $2`, [u.correo, ip])
    assert.equal((await login(u.correo, PASSWORD, 'x', ip)).status, 200)
  })

  it('un usuario desactivado no entra', async () => {
    const u = await crearUsuario('vendedor', { activo: false })
    const r = await login(u.correo)
    assert.equal(r.status, 403) // con la contraseña correcta se le avisa por qué (RF-040)
    assert.equal(r.body.codigo, 'CUENTA_SUSPENDIDA')
    assert.equal((await login(u.correo, 'otra-clave-1')).status, 401) // sin ella no se revela nada de la cuenta
  })

  it('RF-006: cerrar sesión invalida el token de acceso y el de renovación', async () => {
    const s = await sesion('vendedor')
    assert.equal((await pull(s)).status, 200)
    const out = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: s.refreshToken } })
    assert.equal(out.statusCode, 204)
    assert.equal((await pull(s)).status, 401)
    const r = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } })
    assert.equal(r.statusCode, 401)
  })

  it('renueva el token de acceso con el refresh token', async () => {
    const s = await sesion('vendedor')
    const r = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } })
    assert.equal(r.statusCode, 200)
    assert.equal((await pull({ token: r.json().accessToken, dispositivo: 'x' })).status, 200)
  })

  it('rechaza peticiones sin token o con token falso', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/sync/pull' })).statusCode, 401)
    assert.equal((await app.inject({ method: 'GET', url: '/sync/pull', headers: { authorization: 'Bearer abc.def.ghi' } })).statusCode, 401)
  })

  it('RF-039: con contraseña pendiente de cambio sólo se puede cambiarla', async () => {
    const u = await crearUsuario('vendedor', { debeCambiar: true })
    const { body } = await login(u.correo)
    const s = { token: body.accessToken as string, dispositivo: 'x' }
    assert.equal(body.usuario.debeCambiarPassword, true)
    const bloqueado = await pull(s)
    assert.equal(bloqueado.status, 403)
    assert.equal(bloqueado.body.codigo, 'CAMBIAR_PASSWORD')

    const h = { authorization: `Bearer ${s.token}` }
    const mala = await app.inject({ method: 'POST', url: '/auth/cambiar-password', headers: h, payload: { actual: 'otra-clave-1', nueva: 'NuevaClave123' } })
    assert.equal(mala.statusCode, 401)
    const debil = await app.inject({ method: 'POST', url: '/auth/cambiar-password', headers: h, payload: { actual: PASSWORD, nueva: 'sololetras' } })
    assert.equal(debil.statusCode, 400)
    const ok = await app.inject({ method: 'POST', url: '/auth/cambiar-password', headers: h, payload: { actual: PASSWORD, nueva: 'NuevaClave123' } })
    assert.equal(ok.statusCode, 204)
    assert.equal((await pull(s)).status, 200)
    assert.equal((await login(u.correo, 'NuevaClave123')).status, 200)
    assert.equal((await login(u.correo)).status, 401)
  })

  it('RF-005: el vendedor no entra a rutas de administrador', async () => {
    const v = await sesion('vendedor')
    const a = await sesion('administrador')
    assert.equal((await get(v, '/sync/conflictos')).status, 403)
    assert.equal((await get(a, '/sync/conflictos')).status, 200)
  })

  it('la contraseña se guarda con Argon2id (RF-004)', async () => {
    const u = await crearUsuario('vendedor')
    const { rows } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [u.id])
    assert.match(rows[0].password_hash, /^\$argon2id\$/)
  })
})
