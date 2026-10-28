import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { productosDelRegistro } from '../_lib/registro.js'
import { app, config, db, ipAleatoria, login, pull, sesion } from './ayuda.js'

// Alta de empresas por cuenta propia (/registro) e invitaciones a repartidores.

after(async () => { await app.close(); await db.end() })

// Los códigos y enlaces sólo viajan por correo: las pruebas ponen uno conocido en la base, con el mismo HMAC.
const hmac = (uso: string, valor: string) => createHmac('sha256', config.pimienta).update(`${uso}:${valor}`).digest('hex')
const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, remoteAddress: ipAleatoria(), headers: token ? { authorization: `Bearer ${token}` } : {} })
// Una contraseña que cumple las reglas al crearla (la de ayuda.ts lleva «Yogurt», que no se permite en cuentas nuevas).
const CLAVE = 'Lacteos2026!x'
const nuevoCorreo = () => `duena-${randomUUID().slice(0, 8)}@prueba.local`

async function confirmar(correo: string) {
  assert.equal((await post('/registro/codigo', { correo })).statusCode, 200)
  await db.query(`UPDATE verificaciones_correo SET codigo_hash = $2 WHERE lower(correo) = $1 AND usado_en IS NULL`, [correo, hmac('registro', '123456')])
  const r = await post('/registro/verificar', { correo, codigo: '123456' })
  assert.equal(r.statusCode, 200)
  return r.json().comprobante as string
}

function cuerpo(correo: string, comprobante: string, over: { invitaciones?: string[] } = {}) {
  const frasco = randomUUID()
  const vaso = randomUUID()
  return {
    comprobante,
    empresa: { nombre: `Lácteos ${correo.slice(6, 12)}`, giros: ['lacteos'], zonaHoraria: 'America/Mexico_City', color: '#1d4ed8', logo: null, controlRetornables: false },
    administrador: { nombre: 'Marta Duarte', correo, password: CLAVE, aceptaTerminos: true },
    envases: [
      { id: frasco, nombre: 'Frasco 1 L', tipo: 'frasco', contenido: 1, unidad: 'L', retornable: true },
      { id: vaso, nombre: 'Vaso 250 ml', tipo: 'vaso', contenido: 250, unidad: 'ml', retornable: false },
    ],
    productos: [{
      nombre: 'Yogurt', color: '#efe8d6',
      variantes: [{ nombre: 'Fresa', color: '#e5484d' }, { nombre: 'Mango', color: '#f5a623' }],
      presentaciones: [{ envase: frasco, precio: 70, costo: 30 }, { envase: vaso, precio: 20, costo: null }],
    }],
    invitaciones: over.invitaciones ?? [],
  }
}

async function aceptar(correo: string, nombre = 'Pepe Reparto') {
  const token = `prueba-${randomUUID()}`
  await db.query(`UPDATE invitaciones SET token_hash = $2 WHERE correo = $1 AND usado_en IS NULL`, [correo, hmac('invitacion', token)])
  return { token, r: await post('/invitacion/aceptar', { token, nombre, password: CLAVE }) }
}

describe('registro de una empresa', () => {
  it('confirma el correo, crea la empresa con su catálogo y su administrador entra', async () => {
    const correo = nuevoCorreo()
    const r = await post('/registro/empresa', cuerpo(correo, await confirmar(correo)))
    assert.equal(r.statusCode, 201)
    assert.equal(r.json().productos, 4) // 2 sabores × 2 envases

    const l = await login(correo, CLAVE)
    assert.equal(l.status, 200)
    const { body } = await pull({ token: l.body.accessToken, dispositivo: 'panel' })
    assert.deepEqual(body.productos.map((p: { sabor: string; presentacion: number }) => `${p.sabor} ${p.presentacion}`).sort(), ['Fresa 0.25', 'Fresa 1', 'Mango 0.25', 'Mango 1'])
    const { rows: [e] } = await db.query(`SELECT e.color_marca, e.giros FROM empresas e JOIN usuarios u USING (id_empresa) WHERE u.correo = $1`, [correo])
    assert.deepEqual(e, { color_marca: '#1d4ed8', giros: ['lacteos'] })
  })

  it('sin comprobante, o con el de otro correo, no crea nada', async () => {
    const correo = nuevoCorreo()
    const otro = await confirmar(nuevoCorreo())
    for (const comprobante of ['', otro, `${Date.now() - 1000}.${hmac('verificado', `${correo}:${Date.now() - 1000}`)}`]) {
      const r = await post('/registro/empresa', cuerpo(correo, comprobante))
      assert.equal(r.statusCode, 400)
      assert.equal(r.json().codigo, 'CORREO_SIN_CONFIRMAR')
    }
    assert.equal((await db.query(`SELECT 1 FROM usuarios WHERE correo = $1`, [correo])).rowCount, 0)
  })

  it('cinco códigos incorrectos invalidan el código', async () => {
    const correo = nuevoCorreo()
    await post('/registro/codigo', { correo })
    await db.query(`UPDATE verificaciones_correo SET codigo_hash = $2 WHERE correo = $1 AND usado_en IS NULL`, [correo, hmac('registro', '123456')])
    for (let i = 0; i < 5; i++) assert.equal((await post('/registro/verificar', { correo, codigo: '000000' })).statusCode, 400)
    assert.equal((await post('/registro/verificar', { correo, codigo: '123456' })).statusCode, 400)
  })

  it('un correo con cuenta no recibe código ni crea otra empresa', async () => {
    const s = await sesion('administrador')
    const a = await post('/registro/codigo', { correo: s.correo })
    assert.equal(a.statusCode, 200) // la misma respuesta que con un correo nuevo
    const { rows } = await db.query(`SELECT usado_en FROM verificaciones_correo WHERE correo = $1`, [s.correo])
    assert.ok(rows.length === 1 && rows[0].usado_en) // sólo cuenta para los topes
    // Aun con un comprobante válido (p. ej. de antes de tener cuenta), el alta se rechaza sin dejar una empresa vacía.
    const vence = Date.now() + 60_000
    const c = cuerpo(s.correo, `${vence}.${hmac('verificado', `${s.correo}:${vence}`)}`)
    const r = await post('/registro/empresa', c)
    assert.equal(r.statusCode, 409)
    assert.equal((await db.query(`SELECT 1 FROM empresas WHERE nombre = $1`, [c.empresa.nombre])).rowCount, 0)
  })
})

describe('invitaciones', () => {
  it('el invitado crea su contraseña, entra a esa empresa y el enlace no sirve dos veces', async () => {
    const correo = nuevoCorreo()
    const invitado = nuevoCorreo()
    assert.equal((await post('/registro/empresa', cuerpo(correo, await confirmar(correo), { invitaciones: [invitado] }))).statusCode, 201)
    const { token, r } = await aceptar(invitado)
    assert.equal(r.statusCode, 201)

    const l = await login(invitado, CLAVE)
    assert.equal(l.status, 200)
    assert.equal(l.body.usuario.rol, 'vendedor')
    const { body } = await pull({ token: l.body.accessToken, dispositivo: 'tel' })
    assert.equal(body.productos.length, 4) // el catálogo de su empresa, no el de otra
    assert.equal((await post('/invitacion/aceptar', { token, nombre: 'Otra vez', password: CLAVE })).statusCode, 404)
    assert.equal((await post('/invitacion/consultar', { token })).statusCode, 404)
  })

  it('el administrador invita desde su equipo; un vendedor no puede', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    const invitado = nuevoCorreo()
    assert.equal((await post('/invitaciones', { correo: invitado }, vend.token)).statusCode, 403)
    assert.equal((await post('/invitaciones', { correo: vend.correo }, admin.token)).statusCode, 409)
    assert.equal((await post('/invitaciones', { correo: invitado }, admin.token)).statusCode, 201)
    const token = `prueba-${randomUUID()}`
    await db.query(`UPDATE invitaciones SET token_hash = $2 WHERE correo = $1`, [invitado, hmac('invitacion', token)])
    const c = await post('/invitacion/consultar', { token })
    assert.equal(c.statusCode, 200)
    assert.equal(c.json().correo, invitado)
  })
})

describe('catálogo del registro', () => {
  it('pasa ml y g a litros y kilos, y distingue envases del mismo tamaño', () => {
    const filas = productosDelRegistro({
      envases: [
        { id: 'b', nombre: 'Botella 1 L', tipo: 'botella', contenido: 1, unidad: 'L', retornable: false },
        { id: 'f', nombre: 'Frasco 1 L', tipo: 'frasco', contenido: 1, unidad: 'L', retornable: false },
        { id: 'g', nombre: 'Bolsa 500 g', tipo: 'bolsa', contenido: 500, unidad: 'g', retornable: false },
      ],
      productos: [{ nombre: 'Leche', color: '#ffffff', variantes: [], presentaciones: [{ envase: 'b', precio: 30, costo: null }, { envase: 'f', precio: 35, costo: 10 }, { envase: 'g', precio: 40, costo: null }] }],
    })
    assert.deepEqual(filas.map((f) => [f.sabor, f.presentacion, f.precio, f.costo]), [['Leche', 1, 30, 0], ['Leche (Frasco 1 L)', 1, 35, 10], ['Leche', 0.5, 40, 0]])
  })
})
