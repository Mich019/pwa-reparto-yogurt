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
    assert.deepEqual(r.body, { nombre: 'Agua La Fuente SA', color: '#1d4ed8', logo: LOGO })
    assert.deepEqual((await get(vend, '/empresa')).body, r.body)
    assert.deepEqual((await get(otra, '/empresa')).body, { nombre: 'Otra', color: null, logo: null })

    // Cambiar sólo una cosa deja las demás; null quita el logo.
    assert.deepEqual((await cambiar(admin, { logo: null })).body, { nombre: 'Agua La Fuente SA', color: '#1d4ed8', logo: null })
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
})
