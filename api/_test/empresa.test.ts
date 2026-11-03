import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { app, crearEmpresa, db, get, sesion } from './ayuda.js'

// Marca de la empresa (GET/PATCH /empresa).

after(async () => { await app.close(); await db.end() })

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const cambiar = async (s: { token: string }, payload: unknown) => {
  const r = await app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${s.token}` }, payload: payload as object })
  return { status: r.statusCode, body: r.json() }
}

describe('marca de la empresa', () => {
  it('el administrador la cambia, su equipo la ve y otra empresa no se entera', async () => {
    const empresa = await crearEmpresa('Agua La Fuente')
    const admin = await sesion('administrador', 'panel', empresa)
    const vend = await sesion('vendedor', 'tel', empresa)
    const otra = await sesion('administrador', 'panel', await crearEmpresa('Otra'))

    const r = await cambiar(admin, { nombre: 'Agua La Fuente SA', color: '#1d4ed8', logo: LOGO })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { nombre: 'Agua La Fuente SA', color: '#1d4ed8', logo: LOGO, lema: null, contacto: null, zonaHoraria: 'America/Mexico_City' })
    assert.deepEqual((await get(vend, '/empresa')).body, r.body)
    assert.deepEqual((await get(otra, '/empresa')).body, { nombre: 'Otra', color: null, logo: null, lema: null, contacto: null, zonaHoraria: 'America/Mexico_City' })

    // Cambiar sólo una cosa deja las demás; null quita el logo.
    assert.deepEqual((await cambiar(admin, { logo: null })).body, { nombre: 'Agua La Fuente SA', color: '#1d4ed8', logo: null, lema: null, contacto: null, zonaHoraria: 'America/Mexico_City' })
  })

  it('lema y contacto: se guardan sin espacios de sobra y vacíos se quitan', async () => {
    const admin = await sesion('administrador', 'panel', await crearEmpresa('Con lema'))
    const r = await cambiar(admin, { lema: '  Frescura diaria ', contacto: 'Tel. 55 1234 5678 · Calle 5 #12' })
    assert.equal(r.status, 200)
    assert.equal(r.body.lema, 'Frescura diaria')
    assert.equal(r.body.contacto, 'Tel. 55 1234 5678 · Calle 5 #12')
    assert.equal((await cambiar(admin, { lema: '' })).body.lema, null)
    assert.equal((await cambiar(admin, { lema: 'x'.repeat(81) })).status, 400)
  })

  it('sólo el administrador la cambia y con datos válidos', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    const vend = await sesion('vendedor', 'tel', empresa)
    assert.equal((await cambiar(vend, { color: '#000000' })).status, 403)
    assert.equal((await cambiar(admin, { color: 'rojo' })).status, 400)
    assert.equal((await cambiar(admin, { logo: 'javascript:alert(1)' })).status, 400)
    assert.equal((await cambiar(admin, {})).status, 400)
  })

  it('se lee aunque la prueba haya vencido (la pantalla de cobro la muestra)', async () => {
    const empresa = await crearEmpresa('Vencida')
    const admin = await sesion('administrador', 'panel', empresa)
    await db.query(`UPDATE empresas SET prueba_hasta = now() - interval '1 day' WHERE id_empresa = $1`, [empresa])
    assert.equal((await get(admin, '/empresa')).body.nombre, 'Vencida')
    assert.equal((await cambiar(admin, { nombre: 'Nueva' })).status, 402)
  })

  it('se lee con la contraseña temporal pendiente (si no, quedaba la marca de otra empresa del navegador)', async () => {
    const empresa = await crearEmpresa('Recién Llegada')
    const vend = await sesion('vendedor', 'tel', empresa)
    await db.query(`UPDATE usuarios SET debe_cambiar_password = true WHERE id_usuario = $1`, [vend.id])
    assert.equal((await get(vend, '/empresa')).body.nombre, 'Recién Llegada')
    assert.equal((await get(vend, '/sync/pull')).status, 403)
  })
})
