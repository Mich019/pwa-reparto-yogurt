import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as esperar } from 'node:timers/promises'
import { after, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { app, cliente, config, crearEmpresa, db, op, push, sesion } from './ayuda.js'

// GET /eventos: la señal de «cambió algo» para no recargar (envivo.ts, migración 029).

const srv = await construirApp({ db, config, enVivo: { intervaloMs: 50, duracionMs: 1200, latidoMs: 100_000 } })
after(async () => { await srv.close(); await app.close(); await db.end() })

const escuchar = (token?: string) => srv.inject({ method: 'GET', url: '/eventos', headers: token ? { authorization: `Bearer ${token}` } : {} })
const eventos = (cuerpo: string) => cuerpo.split('\n\n').filter((b) => b.startsWith('event: ')).map((b) => {
  const [evento, datos] = b.split('\n')
  return { evento: evento.slice(7), datos: JSON.parse(datos.slice(6)) }
})

describe('cambios en vivo', () => {
  it('pide sesión', async () => {
    assert.equal((await escuchar()).statusCode, 401)
  })

  it('avisa qué área cambió en su empresa, una vez por cambio, y no lo de otra empresa', async () => {
    // Cada prueba en su empresa: las demás pruebas escriben en la de siempre al mismo tiempo.
    const vend = await sesion('vendedor', 'tel-1', await crearEmpresa())
    const otra = await sesion('vendedor', 'tel-x', await crearEmpresa())
    const r = escuchar(vend.token)
    const ajena = escuchar(otra.token)
    await esperar(300)
    const c = cliente()
    assert.equal((await push(vend, [op('clientes', c.id as string, c)])).body.resultados[0].estado, 'aplicada')
    const res = await r
    assert.equal(res.statusCode, 200)
    assert.match(String(res.headers['content-type']), /text\/event-stream/)
    const lista = eventos(res.body)
    assert.equal(lista[0].evento, 'hola')
    const cambios = lista.filter((e) => e.evento === 'cambio')
    assert.equal(cambios.length, 1)
    assert.deepEqual(cambios[0].datos.areas, ['datos'])
    assert.equal(lista.at(-1)!.evento, 'otra-vez') // se cierra sola y el navegador vuelve a conectarse
    assert.equal(eventos((await ajena).body).filter((e) => e.evento === 'cambio').length, 0)
  })

  it('una cuenta nueva despierta a equipo y no a cobranza', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'tel-1', empresa)
    const r = escuchar(admin.token)
    await esperar(300)
    await sesion('vendedor', 'tel-2', empresa) // otra cuenta que entra: crea un usuario (equipo) pero un login solo no debe contar
    const res = eventos((await r).body).filter((e) => e.evento === 'cambio').flatMap((e) => e.datos.areas)
    assert.ok(res.includes('equipo'))
    assert.ok(!res.includes('cobranza'))
  })

  it('al cerrar sesión se corta en segundos', async () => {
    const vend = await sesion('vendedor')
    const r = escuchar(vend.token)
    await esperar(200)
    await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: vend.refreshToken } })
    const lista = eventos((await r).body)
    assert.equal(lista.at(-1)!.evento, 'fin')
  })
})
