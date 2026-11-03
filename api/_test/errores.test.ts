import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { crearPool } from '../_lib/db.js'
import { armarEnvelope, leerDsn, marcosDe, reportarError } from '../_lib/errores.js'
import { config } from './ayuda.js'

// Monitoreo de errores: el envelope de Sentry se arma a mano y sólo sale con SENTRY_DSN.

const DSN = 'https://abc123@o42.ingest.sentry.io/777'
const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal })

describe('monitoreo de errores', () => {
  it('lee el DSN y rechaza los inválidos', () => {
    const d = leerDsn(DSN)
    assert.ok(d)
    assert.match(d.envelope, /^https:\/\/o42\.ingest\.sentry\.io\/api\/777\/envelope\/\?.*sentry_key=abc123/)
    assert.equal(leerDsn(''), null)
    assert.equal(leerDsn(undefined), null)
    assert.equal(leerDsn('no-es-url'), null)
    assert.equal(leerDsn('https://o42.ingest.sentry.io/777'), null) // sin llave
    assert.equal(leerDsn('https://abc@o42.ingest.sentry.io'), null) // sin proyecto
  })

  it('el envelope trae el error y la ruta, sin cuerpo ni datos de la base', () => {
    const e = Object.assign(new Error('falló algo\nsegunda línea'), { code: '23505', detail: 'Key (correo)=(ana@correo.com) already exists' })
    const sobre = armarEnvelope(leerDsn(DSN)!, e, { metodo: 'POST', ruta: '/clientes/:id', entorno: 'production', version: 'abc1234' })
    const [cabecera, tipo, evento] = sobre.split('\n').map((x) => JSON.parse(x))
    assert.equal(cabecera.dsn, DSN)
    assert.equal(tipo.type, 'event')
    assert.equal(evento.exception.values[0].value, 'falló algo')
    assert.equal(evento.request.url, '/clientes/:id')
    assert.equal(evento.release, 'abc1234')
    assert.deepEqual(evento.tags, { codigo: '23505' })
    assert.ok(!sobre.includes('ana@correo.com'))
  })

  it('convierte el rastro en marcos, el más viejo primero', () => {
    const marcos = marcosDe('Error: x\n    at interno (/app/a.ts:10:5)\n    at /app/b.ts:20:7')
    assert.deepEqual(marcos.map((m) => [m.filename, m.lineno]), [['/app/b.ts', 20], ['/app/a.ts', 10]])
    assert.equal(marcos[1].function, 'interno')
  })

  it('reportarError no truena si Sentry no responde', async () => {
    globalThis.fetch = (async () => { throw new Error('sin red') }) as typeof fetch
    assert.equal(await reportarError(DSN, new Error('x')), false)
    assert.equal(await reportarError('', new Error('x')), false)
  })

  it('un error interno de la API se manda a Sentry y la respuesta no lo cuenta', async () => {
    const enviados: { url: string; cuerpo: string }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => { enviados.push({ url, cuerpo: String(init?.body) }); return new Response('{}', { status: 200 }) }) as typeof fetch
    // Una base inalcanzable hace fallar a la ruta pública con un 500.
    const rota = crearPool({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 500 })
    const srv = await construirApp({ db: rota, config: { ...config, sentryDsn: DSN } })
    try {
      const r = await srv.inject({ method: 'GET', url: '/plataforma/publico' })
      assert.equal(r.statusCode, 500)
      assert.deepEqual(r.json(), { error: 'Error interno del servidor' })
      assert.equal(enviados.length, 1)
      assert.match(enviados[0].url, /envelope/)
      assert.match(enviados[0].cuerpo, /\/plataforma\/publico/)
    } finally {
      await srv.close()
      await rota.end()
    }
  })
})
