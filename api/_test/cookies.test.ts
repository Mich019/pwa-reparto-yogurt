import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { codigoTotp, pasoActual } from '../_lib/dosPasos.js'
import { PASSWORD, app, crearUsuario, db, ipAleatoria, sesion } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

// Sesión del panel web en cookies HttpOnly (api/_lib/cookies.ts). Fuera de producción se llaman ry_acceso y ry_sesion.

const lista = (h: string | string[] | number | undefined) => (Array.isArray(h) ? h : h ? [String(h)] : [])
// Lo que el navegador mandaría de vuelta: «nombre=valor» de cada Set-Cookie que no se borró.
const frasco = (setCookie: string[]) => setCookie.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ')

async function entrarConCookie(correo: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo, password: PASSWORD, dispositivo: 'panel', modo: 'cookie' }, remoteAddress: ipAleatoria() })
  return { status: r.statusCode, body: r.json(), cookies: lista(r.headers['set-cookie']) }
}
const pedir = (metodo: 'GET' | 'POST', url: string, cookie: string, extra: Record<string, string> = {}, payload?: object) =>
  app.inject({ method: metodo, url, headers: { cookie, ...extra }, payload })

describe('sesión del panel web en cookies', () => {
  it('al entrar, los tokens van sólo en cookies HttpOnly y SameSite=Strict, no en la respuesta', async () => {
    const u = await crearUsuario('administrador')
    const r = await entrarConCookie(u.correo)
    assert.equal(r.status, 200)
    assert.equal(r.body.cookie, true)
    assert.equal(r.body.accessToken, undefined)
    assert.equal(r.body.refreshToken, undefined)
    assert.equal(r.body.usuario.correo, u.correo)
    assert.equal(r.cookies.length, 2)
    for (const c of r.cookies) {
      assert.match(c, /^ry_(acceso|sesion)=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/)
    }
    assert.ok(r.cookies.some((c) => c.startsWith('ry_sesion=') && c.includes(`Max-Age=${30 * 86_400}`)))
  })

  it('con la cookie se usa la API; los cambios exigen además la cabecera de la app', async () => {
    const u = await crearUsuario('administrador')
    const cookie = frasco((await entrarConCookie(u.correo)).cookies)
    const me = await pedir('GET', '/me', cookie)
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().correo, u.correo)
    // Una petición que cambia algo sin la cabecera (lo que haría un formulario de otro sitio) no pasa
    const sin = await pedir('POST', '/notificaciones/leidas', cookie, {}, { ids: ['00000000-0000-4000-8000-000000000000'] })
    assert.equal(sin.statusCode, 403)
    assert.equal(sin.json().codigo, 'SIN_CABECERA')
    const con = await pedir('POST', '/notificaciones/leidas', cookie, { 'x-solicitud': 'app' }, { ids: ['00000000-0000-4000-8000-000000000000'] })
    assert.notEqual(con.statusCode, 403)
    assert.ok(con.statusCode < 400, `respondió ${con.statusCode}`)
    // Sin cookie ni token, nada
    assert.equal((await app.inject({ method: 'GET', url: '/me' })).statusCode, 401)
  })

  it('se renueva con la cookie de sesión: sale otra cookie de acceso y ningún token en la respuesta', async () => {
    const u = await crearUsuario('vendedor')
    const cookies = (await entrarConCookie(u.correo)).cookies
    const sesionCookie = cookies.find((c) => c.startsWith('ry_sesion='))!.split(';')[0]
    const r = await pedir('POST', '/auth/refresh', sesionCookie, { 'x-solicitud': 'app' }, {})
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().cookie, true)
    assert.equal(r.json().accessToken, undefined)
    const nuevas = lista(r.headers['set-cookie'])
    assert.equal(nuevas.length, 1)
    assert.match(nuevas[0], /^ry_acceso=/)
    assert.equal((await pedir('GET', '/me', frasco(nuevas))).statusCode, 200)
  })

  it('al cerrar sesión se revoca en el servidor y se borran las cookies', async () => {
    const u = await crearUsuario('administrador')
    const cookie = frasco((await entrarConCookie(u.correo)).cookies)
    const r = await pedir('POST', '/auth/logout', cookie, { 'x-solicitud': 'app' }, {})
    assert.equal(r.statusCode, 204)
    const borradas = lista(r.headers['set-cookie'])
    assert.equal(borradas.length, 2)
    assert.ok(borradas.every((c) => /^ry_\w+=; .*Max-Age=0/.test(c)))
    // La cookie vieja ya no renueva (aunque alguien la hubiera copiado)
    const refresh = await pedir('POST', '/auth/refresh', cookie, { 'x-solicitud': 'app' }, {})
    assert.equal(refresh.statusCode, 401)
    assert.equal((await pedir('GET', '/me', cookie)).statusCode, 401)
  })

  it('con verificación en dos pasos, el segundo paso también entrega la sesión en cookies', async () => {
    const s = await sesion('administrador')
    const auth = { authorization: `Bearer ${s.token}` }
    const { secreto } = (await app.inject({ method: 'POST', url: '/auth/dos-pasos/iniciar', headers: auth, payload: {} })).json()
    await app.inject({ method: 'POST', url: '/auth/dos-pasos/activar', headers: auth, payload: { codigo: codigoTotp(secreto, pasoActual()) } })
    const paso1 = await entrarConCookie(s.correo)
    assert.equal(paso1.body.dosPasos, true)
    assert.equal(paso1.cookies.length, 0) // la contraseña sola no deja cookie
    const paso2 = await app.inject({ method: 'POST', url: '/auth/login/codigo', payload: { desafio: paso1.body.desafio, codigo: codigoTotp(secreto, pasoActual() + 1), modo: 'cookie' } })
    assert.equal(paso2.statusCode, 200)
    assert.equal(paso2.json().accessToken, undefined)
    assert.equal((await pedir('GET', '/me', frasco(lista(paso2.headers['set-cookie'])))).statusCode, 200)
  })

  it('la app de reparto sigue con tokens y sin cookies', async () => {
    const u = await crearUsuario('vendedor')
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo: u.correo, password: PASSWORD }, remoteAddress: ipAleatoria() })
    assert.ok(r.json().accessToken && r.json().refreshToken)
    assert.equal(r.headers['set-cookie'], undefined)
  })

  it('si vienen token y cookie, manda el token', async () => {
    const a = await sesion('vendedor')
    const b = await crearUsuario('administrador')
    const cookieB = frasco((await entrarConCookie(b.correo)).cookies)
    const r = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${a.token}`, cookie: cookieB } })
    assert.equal(r.json().correo, a.correo)
  })
})
