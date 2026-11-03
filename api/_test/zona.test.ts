import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { hoyEn } from '../_lib/fechas.js'
import { app, crearEmpresa, db, get, sesion } from './ayuda.js'

// Zona horaria por empresa: «hoy» sale de empresas.zona_horaria, no de una sola zona para todo el servidor.

after(async () => { await app.close(); await db.end() })

// Dos zonas con 26 horas de diferencia: nunca comparten fecha.
const ADELANTE = 'Pacific/Kiritimati'
const ATRAS = 'Etc/GMT+12'

describe('zona horaria por empresa', () => {
  it('el resumen de cada empresa usa su propio «hoy»', async () => {
    const idB = await crearEmpresa()
    await db.query(`UPDATE empresas SET zona_horaria = $2 WHERE id_empresa = $1`, [idB, ATRAS])
    const adminB = await sesion('administrador', 'tel-zona-b', idB)
    const { rows: [a] } = await db.query(`SELECT id_empresa FROM empresas ORDER BY creado_en LIMIT 1`)
    await db.query(`UPDATE empresas SET zona_horaria = $2 WHERE id_empresa = $1`, [a.id_empresa, ADELANTE])
    const adminA = await sesion('administrador', 'tel-zona-a')
    try {
      const ra = (await get(adminA, '/admin/stats')).body
      const rb = (await get(adminB, '/admin/stats')).body
      assert.equal(ra.fecha, hoyEn(ADELANTE))
      assert.equal(rb.fecha, hoyEn(ATRAS))
      assert.notEqual(ra.fecha, rb.fecha)
    } finally {
      await db.query(`UPDATE empresas SET zona_horaria = 'America/Mexico_City' WHERE id_empresa = $1`, [a.id_empresa])
    }
  })

  it('el administrador cambia la zona de su empresa y no acepta una inventada', async () => {
    const admin = await sesion('administrador', 'tel-zona-c', await crearEmpresa())
    const cambiar = (zonaHoraria: string) => app.inject({ method: 'PATCH', url: '/empresa', headers: { authorization: `Bearer ${admin.token}` }, payload: { zonaHoraria } })
    assert.equal((await cambiar('Marte/Olimpo')).statusCode, 400)
    const r = await cambiar('America/Cancun')
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().zonaHoraria, 'America/Cancun')
    assert.equal((await get(admin, '/admin/stats')).body.fecha, hoyEn('America/Cancun'))
  })
})
