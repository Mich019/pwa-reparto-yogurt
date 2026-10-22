// Conexión a la base (Railway): estas pruebas no se conectan a nada, sólo revisan cómo se arma la configuración.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { leerConfig } from '../_lib/config.js'

const BASE = { JWT_SECRET: 'x'.repeat(40), AUTH_PEPPER_SECRET: 'p'.repeat(40) }
const VARIABLES = ['DATABASE_URL', 'DB_SSL', 'DB_SSL_CA', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'VERCEL', 'DB_POOL_MAX']
const antes = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))

function conexion(env: Record<string, string>) {
  for (const v of VARIABLES) delete process.env[v]
  Object.assign(process.env, BASE, env)
  return leerConfig().conexion
}

describe('conexión a la base (Railway)', () => {
  afterEach(() => {
    for (const [v, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[v]
      else process.env[v] = valor
    }
  })

  it('la dirección pública de Railway se cifra sin pedir verificar su certificado propio', () => {
    const c = conexion({ DATABASE_URL: 'postgresql://postgres:clave@roundhouse.proxy.rlwy.net:41234/railway' })
    assert.deepEqual(c.ssl, { rejectUnauthorized: false })
  })

  it('quita ?sslmode=require de la dirección para que no pise la opción ssl', () => {
    const c = conexion({ DATABASE_URL: 'postgresql://postgres:clave@db.ejemplo.com:5432/railway?sslmode=require&application_name=api' })
    assert.equal(c.connectionString, 'postgresql://postgres:clave@db.ejemplo.com:5432/railway?application_name=api')
    assert.deepEqual(c.ssl, { rejectUnauthorized: false })
  })

  it('la red privada de Railway y localhost van sin cifrar', () => {
    assert.equal(conexion({ DATABASE_URL: 'postgresql://postgres:clave@postgres.railway.internal:5432/railway' }).ssl, undefined)
    assert.equal(conexion({ DATABASE_URL: 'postgres://postgres:test@localhost:5432/x' }).ssl, undefined)
  })

  it('DB_SSL manda sobre lo que diga la dirección', () => {
    assert.equal(conexion({ DATABASE_URL: 'postgresql://u:c@roundhouse.proxy.rlwy.net:1/railway', DB_SSL: 'false' }).ssl, undefined)
    assert.deepEqual(conexion({ DATABASE_URL: 'postgresql://u:c@10.0.0.5:5432/x', DB_SSL: 'true' }).ssl, { rejectUnauthorized: false })
  })

  it('con DB_SSL_CA exige ese certificado (PEM o base64), sin atar el nombre del proxy', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----'
    for (const valor of [pem, Buffer.from(pem).toString('base64')]) {
      const ssl = conexion({ DATABASE_URL: 'postgresql://u:c@h.rlwy.net:1/r', DB_SSL_CA: valor }).ssl as Record<string, unknown>
      assert.equal(ssl.rejectUnauthorized, true)
      assert.equal(ssl.ca, pem)
      assert.equal(typeof ssl.checkServerIdentity, 'function')
    }
  })

  it('sslmode=verify-full se respeta (no se degrada a cifrar sin verificar)', () => {
    assert.deepEqual(conexion({ DATABASE_URL: 'postgresql://u:c@db.ejemplo.com:5432/x?sslmode=verify-full' }).ssl, { rejectUnauthorized: true })
    assert.deepEqual(conexion({ DATABASE_URL: 'postgresql://u:c@h.rlwy.net:1/r', DB_SSL: 'verify-full' }).ssl, { rejectUnauthorized: true })
    assert.throws(() => conexion({ DATABASE_URL: 'postgresql://u:c@h.rlwy.net:1/r?sslmode=verify-ca' }), /DB_SSL_CA/)
  })

  it('por partes (DB_HOST…) también decide el cifrado', () => {
    const c = conexion({ DB_HOST: 'roundhouse.proxy.rlwy.net', DB_NAME: 'railway', DB_USER: 'postgres', DB_PASSWORD: 'c' })
    assert.deepEqual(c.ssl, { rejectUnauthorized: false })
  })

  it('en Vercel usa pocas conexiones y las suelta pronto', () => {
    const c = conexion({ DATABASE_URL: 'postgresql://u:c@h.rlwy.net:1/r', VERCEL: '1' })
    assert.equal(c.max, 3)
    assert.equal(c.idleTimeoutMillis, 10_000)
  })

  it('rechaza una dirección que no es de PostgreSQL', () => {
    assert.throws(() => conexion({ DATABASE_URL: 'mysql://u:c@h:3306/x' }), /postgresql:\/\//)
    assert.throws(() => conexion({ DATABASE_URL: 'no es url' }), /no es una dirección válida/)
  })
})

describe('direcciones de notificaciones push', async () => {
  const { endpointPermitido } = await import('../_lib/push.js')
  it('acepta las de los servicios de push tal como las da el navegador', () => {
    assert.equal(endpointPermitido('https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y'), true)
    assert.equal(endpointPermitido('https://web.push.apple.com/QGx1'), true)
    assert.equal(endpointPermitido('https://updates.push.services.mozilla.com/wpush/v2/gAAAA'), true)
  })
  it('rechaza formas raras que otro analizador entendería como otro destino', () => {
    assert.equal(endpointPermitido('https:/fcm.googleapis.com/x'), false)
    assert.equal(endpointPermitido('https:\\\\fcm.googleapis.com\\x'), false)
    assert.equal(endpointPermitido('HTTPS://FCM.googleapis.com/x'), false)
    assert.equal(endpointPermitido('https://fcm.googleapis.com:8443/x'), false)
    assert.equal(endpointPermitido('https://127.0.0.1/x'), false)
  })
})

describe('CORS_ORIGINS', () => {
  const previos = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGINS: process.env.CORS_ORIGINS, VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL }
  afterEach(() => {
    for (const [v, valor] of Object.entries(previos)) {
      if (valor === undefined) delete process.env[v]
      else process.env[v] = valor
    }
  })
  function origenes(env: { NODE_ENV?: string; CORS_ORIGINS?: string }) {
    delete process.env.VERCEL
    delete process.env.CORS_ORIGINS
    Object.assign(process.env, BASE, { DATABASE_URL: 'postgresql://u:c@localhost:5432/b', NODE_ENV: 'development' }, env)
    return leerConfig().corsOrigins
  }

  it('en desarrollo, sin la variable, deja pasar a Vite en localhost', () => {
    assert.deepEqual(origenes({}), ['http://localhost:5173'])
  })

  it('en producción, sin la variable, no deja pasar a ningún otro dominio (app y API juntas)', () => {
    assert.deepEqual(origenes({ NODE_ENV: 'production' }), [])
  })

  it('en producción acepta direcciones https exactas, separadas por comas', () => {
    assert.deepEqual(origenes({ NODE_ENV: 'production', CORS_ORIGINS: 'https://reparto.vercel.app, https://mich019.github.io' }), ['https://reparto.vercel.app', 'https://mich019.github.io'])
  })

  it('no arranca con comodines, localhost o http en producción, ni con rutas', () => {
    assert.throws(() => origenes({ NODE_ENV: 'production', CORS_ORIGINS: '*' }), /comodines/)
    assert.throws(() => origenes({ CORS_ORIGINS: 'https://*.vercel.app' }), /comodines/)
    assert.throws(() => origenes({ NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:5173' }), /https públicas/)
    assert.throws(() => origenes({ NODE_ENV: 'production', CORS_ORIGINS: 'http://reparto.example.com' }), /https públicas/)
    assert.throws(() => origenes({ CORS_ORIGINS: 'https://reparto.vercel.app/' }), /sin ruta/)
    assert.throws(() => origenes({ CORS_ORIGINS: 'reparto.vercel.app' }), /no válida/)
  })
})
