import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { verify } from '@node-rs/argon2'
import { construirApp } from '../_lib/app.js'
import { leerConfig } from '../_lib/config.js'
import { verificarPassword } from '../_lib/contrasenas.js'
import { app, config, crearUsuario, db, ipAleatoria, login, PASSWORD, sesion } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

const nadie = () => `nadie-${randomUUID().slice(0, 8)}@prueba.local`
const recuperar = (correo: string, ip = ipAleatoria()) => app.inject({ method: 'POST', url: '/auth/recuperar', payload: { correo }, remoteAddress: ip })
const restablecer = (correo: string, codigo: string, nueva: string) =>
  app.inject({ method: 'POST', url: '/auth/restablecer', payload: { correo, codigo, nueva }, remoteAddress: ipAleatoria() })
// El código viaja por correo; en la prueba se pone uno conocido en el último pedido de la cuenta.
async function fijarCodigo(idUsuario: string, codigo: string) {
  const hash = createHmac('sha256', config.pimienta).update(`recuperacion:${codigo}`).digest('hex')
  await db.query(
    `UPDATE recuperaciones_password SET codigo_hash = $2
      WHERE id_recuperacion = (SELECT id_recuperacion FROM recuperaciones_password WHERE id_usuario = $1 ORDER BY creado_en DESC LIMIT 1)`,
    [idUsuario, hash],
  )
}

describe('límites de intentos (RF-003)', () => {
  it('el bloqueo se ve igual con una cuenta que no existe: no dice qué correos hay', async () => {
    const u = await crearUsuario('vendedor')
    const otro = nadie()
    const [ip1, ip2] = [ipAleatoria(), ipAleatoria()]
    for (let i = 0; i < 5; i++) {
      await login(u.correo, 'mala-clave-1', 'x', ip1)
      await login(otro, 'mala-clave-1', 'x', ip2)
    }
    const a = await login(u.correo, 'mala-clave-1', 'x', ip1)
    const b = await login(otro, 'mala-clave-1', 'x', ip2)
    assert.equal(a.status, 429)
    assert.equal(b.status, 429)
    assert.deepEqual(a.body, b.body)
  })

  it('cuentan los fallidos seguidos: entrar bien vuelve a empezar la cuenta', async () => {
    const u = await crearUsuario('vendedor')
    const ip = ipAleatoria()
    for (let i = 0; i < 4; i++) assert.equal((await login(u.correo, 'mala-clave-1', 'x', ip)).status, 401)
    assert.equal((await login(u.correo, PASSWORD, 'x', ip)).status, 200)
    for (let i = 0; i < 4; i++) assert.equal((await login(u.correo, 'mala-clave-1', 'x', ip)).status, 401)
    assert.equal((await login(u.correo, PASSWORD, 'x', ip)).status, 200)
  })

  it('una conexión que prueba muchas cuentas queda bloqueada para todas', async () => {
    const ip = ipAleatoria()
    for (let i = 0; i < config.maxIntentosIp; i++) assert.equal((await login(nadie(), 'mala-clave-1', 'x', ip)).status, 401)
    const u = await crearUsuario('vendedor')
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo: u.correo, password: PASSWORD }, remoteAddress: ip })
    assert.equal(r.statusCode, 429)
    assert.equal(r.headers['retry-after'], String(config.bloqueoMinutos * 60))
  })

  it('inventar X-Forwarded-For no salta el límite', async () => {
    const u = await crearUsuario('vendedor')
    const ip = ipAleatoria()
    const intento = (password: string) =>
      app.inject({ method: 'POST', url: '/auth/login', payload: { correo: u.correo, password }, remoteAddress: ip, headers: { 'x-forwarded-for': ipAleatoria() } })
    for (let i = 0; i < 5; i++) assert.equal((await intento('mala-clave-1')).statusCode, 401)
    assert.equal((await intento(PASSWORD)).statusCode, 429)
  })

  it('en Vercel cuenta la IP que pone su red: dos personas detrás del mismo proxy no se bloquean entre sí', async () => {
    const srv = await construirApp({ db, config: { ...config, enVercel: true, trustProxy: 1 } })
    try {
      const u = await crearUsuario('vendedor')
      const [proxy, atacante, dueno] = [ipAleatoria(), ipAleatoria(), ipAleatoria()]
      const intento = (password: string, ip: string) =>
        srv.inject({ method: 'POST', url: '/auth/login', payload: { correo: u.correo, password }, remoteAddress: proxy, headers: { 'x-vercel-forwarded-for': ip } })
      for (let i = 0; i < 5; i++) await intento('mala-clave-1', atacante)
      assert.equal((await intento(PASSWORD, atacante)).statusCode, 429)
      assert.equal((await intento(PASSWORD, dueno)).statusCode, 200)
    } finally {
      await srv.close()
    }
  })

  it('probar la contraseña actual al cambiarla también cuenta (un teléfono ajeno abierto no sirve para adivinarla)', async () => {
    const s = await sesion('vendedor')
    const ip = ipAleatoria()
    const cambiar = (actual: string) =>
      app.inject({ method: 'POST', url: '/auth/cambiar-password', headers: { authorization: `Bearer ${s.token}` }, payload: { actual, nueva: 'OtraClave2030' }, remoteAddress: ip })
    for (let i = 0; i < 5; i++) assert.equal((await cambiar('mala-clave-1')).statusCode, 401)
    assert.equal((await cambiar(PASSWORD)).statusCode, 429)
  })
})

describe('contraseñas con pepper (RF-004)', () => {
  it('el hash guardado no se puede comprobar sin el pepper del servidor', async () => {
    const u = await crearUsuario('vendedor')
    const { rows } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [u.id])
    assert.match(rows[0].password_hash, /^\$argon2id\$/)
    assert.equal(await verify(rows[0].password_hash, PASSWORD), false)
    assert.equal((await verificarPassword(config, rows[0].password_hash, PASSWORD)).ok, true)
  })

  it('rotar el pepper no deja a nadie fuera: con el anterior configurado se entra y el hash se rehace con el nuevo', async () => {
    const u = await crearUsuario('vendedor')
    const nuevo = { pimienta: 'n'.repeat(40), pimientaAnterior: null }
    const srv = await construirApp({ db, config: { ...config, pimienta: nuevo.pimienta, pimientaAnterior: config.pimienta } })
    try {
      const hash = async () => (await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [u.id])).rows[0].password_hash as string
      const antes = await hash()
      assert.equal((await verificarPassword(nuevo, antes, PASSWORD)).ok, false) // sin el anterior no entraría
      const r = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo: u.correo, password: PASSWORD }, remoteAddress: ipAleatoria() })
      assert.equal(r.statusCode, 200)
      const despues = await hash()
      assert.notEqual(despues, antes)
      assert.equal((await verificarPassword(nuevo, despues, PASSWORD)).ok, true)
    } finally {
      await srv.close()
    }
  })

  it('sin AUTH_PEPPER_SECRET, con uno corto o igual a JWT_SECRET la API no arranca', () => {
    const antes = process.env.AUTH_PEPPER_SECRET
    try {
      delete process.env.AUTH_PEPPER_SECRET
      assert.throws(() => leerConfig(), /AUTH_PEPPER_SECRET/)
      process.env.AUTH_PEPPER_SECRET = 'corto'
      assert.throws(() => leerConfig(), /32 caracteres/)
      process.env.AUTH_PEPPER_SECRET = process.env.JWT_SECRET
      assert.throws(() => leerConfig(), /distintos/)
    } finally {
      process.env.AUTH_PEPPER_SECRET = antes
    }
  })

  it('la contraseña nueva: al menos 10 caracteres con letras y números, sin el correo ni el nombre de la app', async () => {
    const s = await sesion('vendedor')
    const cambiar = (nueva: string) =>
      app.inject({ method: 'POST', url: '/auth/cambiar-password', headers: { authorization: `Bearer ${s.token}` }, payload: { actual: PASSWORD, nueva }, remoteAddress: ipAleatoria() })
    const usuario = s.correo.split('@')[0]
    for (const mala of ['Corta123', 'sololetrasaqui', `${usuario}99`, 'MiYogurt12345', 'x'.repeat(199) + '1z']) {
      const r = await cambiar(mala)
      assert.equal(r.statusCode, 400, mala)
      assert.ok(r.json().error, mala)
    }
    assert.equal((await cambiar('BuenaClave2026')).statusCode, 204)
  })
})

describe('recuperar contraseña sin fugas (RF-002)', () => {
  it('responde igual y tarda lo mismo exista o no el correo', async () => {
    const u = await crearUsuario('vendedor')
    const t0 = Date.now()
    const a = await recuperar(u.correo)
    const t1 = Date.now()
    const b = await recuperar(nadie())
    const t2 = Date.now()
    assert.equal(a.statusCode, 200)
    assert.equal(b.statusCode, 200)
    assert.equal(a.body, b.body)
    assert.ok(t1 - t0 >= config.recuperacionPisoMs - 5 && t2 - t1 >= config.recuperacionPisoMs - 5)
  })

  it('como mucho 3 códigos por cuenta cada hora, sin avisarlo', async () => {
    const u = await crearUsuario('vendedor')
    const respuestas = new Set<string>()
    for (let i = 0; i < 4; i++) respuestas.add((await recuperar(u.correo)).body)
    assert.equal(respuestas.size, 1)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM recuperaciones_password WHERE id_usuario = $1`, [u.id])
    assert.equal(rows[0].n, config.recuperacionPorHoraCuenta)
  })

  it('con el código: contraseña nueva válida, sesiones cerradas y la cuenta desbloqueada; 5 códigos malos lo anulan', async () => {
    const s = await sesion('vendedor')
    const ip = ipAleatoria()
    for (let i = 0; i < 5; i++) await login(s.correo, 'olvide-la-1', 'x', ip)
    assert.equal((await login(s.correo, PASSWORD, 'x', ip)).status, 429)

    await recuperar(s.correo)
    await fijarCodigo(s.id, '123456')
    assert.equal((await restablecer(s.correo, '123456', 'corta1')).statusCode, 400) // la regla de contraseñas también aplica
    assert.equal((await restablecer(s.correo, '000000', 'NuevaClave2026')).json().codigo, 'CODIGO_INVALIDO')
    assert.equal((await restablecer(s.correo, '123456', 'NuevaClave2026')).statusCode, 204)
    assert.equal((await restablecer(s.correo, '123456', 'OtraClave2026')).statusCode, 400) // un código sirve una vez

    assert.equal((await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${s.token}` } })).statusCode, 401)
    assert.equal((await login(s.correo, 'NuevaClave2026', 'x', ip)).status, 200) // desde la misma conexión, sin esperar

    await recuperar(s.correo)
    await fijarCodigo(s.id, '654321')
    for (let i = 0; i < config.recuperacionMaxIntentos; i++) await restablecer(s.correo, '111111', 'OtraClave2026')
    assert.equal((await restablecer(s.correo, '654321', 'OtraClave2026')).statusCode, 400)
  })
})

describe('respuestas de la API', () => {
  it('llevan cabeceras de seguridad y no se guardan en cachés', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(r.headers['cache-control'], 'no-store')
    assert.equal(r.headers['x-content-type-options'], 'nosniff')
    assert.equal(r.headers['x-frame-options'], 'DENY')
    assert.equal(r.headers['referrer-policy'], 'no-referrer')
    assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/)
  })

  it('no aceptan cuerpos de más de 1 MB, salvo la sincronización', async () => {
    const grande = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo: 'a@b.mx', password: 'x'.repeat(1_100_000) } })
    assert.equal(grande.statusCode, 413)
    const s = await sesion('vendedor')
    const relleno = 'x'.repeat(700_000)
    const ops = [0, 1].map(() => ({ id: randomUUID(), tabla: 'clientes', registroId: randomUUID(), op: 'put', ts: Date.now(), datos: { relleno } }))
    const sync = await app.inject({ method: 'POST', url: '/sync/push', headers: { authorization: `Bearer ${s.token}` }, payload: { dispositivo: 'x', ahoraCliente: Date.now(), operaciones: ops } })
    assert.equal(sync.statusCode, 200)
  })
})
