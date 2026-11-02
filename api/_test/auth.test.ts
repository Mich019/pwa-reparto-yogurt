import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { app, crearUsuario, db, get, ipAleatoria, login, otroTelefono, PASSWORD, pull, sesion } from './ayuda.js'

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

  it('cada quien edita su nombre, su teléfono y su foto, pero no su correo ni su rol', async () => {
    const s = await sesion('vendedor')
    const editar = (payload: object) => app.inject({ method: 'PATCH', url: '/me', headers: { authorization: `Bearer ${s.token}` }, payload })
    const r = await editar({ nombre: '  Rosa Pérez ', telefono: '555 123 4567' })
    assert.equal(r.statusCode, 200)
    assert.deepEqual(r.json(), { nombre: 'Rosa Pérez', telefono: '555 123 4567', foto: null })
    const yo = await get(s, '/me')
    assert.equal(yo.body.nombre, 'Rosa Pérez')
    assert.equal(yo.body.telefono, '555 123 4567')
    assert.equal((await editar({ telefono: '' })).json().telefono, '')
    assert.equal((await editar({ correo: 'otro@prueba.local' })).statusCode, 400)
    assert.equal((await editar({ rol: 'administrador' })).statusCode, 400)
    assert.equal((await editar({ nombre: 'x' })).statusCode, 400)
    assert.equal((await get(s, '/me')).body.rol, 'vendedor')
    // Foto: sólo imágenes JPG, PNG o WEBP como data URL; null la quita.
    const png = 'data:image/png;base64,iVBORw0KGgo='
    assert.equal((await editar({ foto: png })).json().foto, png)
    assert.equal((await get(s, '/me')).body.foto, png)
    assert.equal((await editar({ foto: 'data:image/svg+xml;base64,PHN2Zz4=' })).statusCode, 400)
    assert.equal((await editar({ foto: 'javascript:alert(1)' })).statusCode, 400)
    assert.equal((await editar({ foto: 'data:image/png;base64,' + 'A'.repeat(200_001) })).statusCode, 400)
    assert.equal((await get(s, '/me')).body.foto, png)
    assert.equal((await editar({ foto: null })).json().foto, null)
  })

  it('lista sus sesiones abiertas y cierra una o todas las demás, nunca la propia ni las de otro', async () => {
    const s = await sesion('vendedor', 'tel-a')
    const otra = await otroTelefono(s, 'tel-b')
    const tercera = await otroTelefono(s, 'tel-c')
    const ajena = await sesion('vendedor')
    const cerrar = (quien: { token: string }, payload: object) => app.inject({ method: 'POST', url: '/me/sesiones/cerrar', headers: { authorization: `Bearer ${quien.token}` }, payload })
    const lista = (await get(s, '/me/sesiones')).body as { id: string; actual: boolean }[]
    assert.equal(lista.length, 3)
    assert.equal(lista.filter((x) => x.actual).length, 1)
    const propia = lista.find((x) => x.actual)!.id
    assert.equal((await cerrar(s, { id: propia })).statusCode, 400)
    // La de otra cuenta no se toca aunque se mande su id.
    const deAjena = ((await get(ajena, '/me/sesiones')).body as { id: string }[])[0].id
    assert.equal((await cerrar(s, { id: deAjena })).json().cerradas, 0)
    assert.equal((await get(ajena, '/me')).status, 200)
    const unaMas = lista.find((x) => !x.actual)!.id
    assert.equal((await cerrar(s, { id: unaMas })).json().cerradas, 1)
    assert.equal((await cerrar(s, {})).json().cerradas, 1)
    assert.equal((await get(otra, '/me')).status, 401)
    assert.equal((await get(tercera, '/me')).status, 401)
    assert.equal((await get(s, '/me')).status, 200)
    assert.equal(((await get(s, '/me/sesiones')).body as unknown[]).length, 1)
  })
})
