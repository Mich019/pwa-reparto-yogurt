import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { app, config, db } from './ayuda.js'

// GET /cron/avisos: el despertador de los avisos programados por correo.

const SECRETO = 'secreto-de-prueba-de-al-menos-24-caracteres'
const conSecreto = await construirApp({ db, config: { ...config, cronSecret: SECRETO } })
after(async () => { await conSecreto.close(); await app.close(); await db.end() })

const llamar = (srv: typeof app, token?: string) =>
  srv.inject({ method: 'GET', url: '/cron/avisos', headers: token ? { authorization: `Bearer ${token}` } : {} })

describe('cron de avisos', () => {
  it('sin CRON_SECRET la ruta no existe', async () => {
    assert.equal((await llamar(app, SECRETO)).statusCode, 404)
  })

  it('pide el secreto y manda los avisos programados que ya les tocó', async () => {
    assert.equal((await llamar(conSecreto)).statusCode, 401)
    assert.equal((await llamar(conSecreto, 'otro-secreto-de-igual-longitud-aprox')).statusCode, 401)

    const { rows: [a] } = await db.query(
      `INSERT INTO avisos_plataforma (texto, tipo, para, desde, por_correo) VALUES ('Cron de prueba', 'aviso', 'administradores', now() - interval '1 minute', true) RETURNING id_aviso`)
    try {
      assert.equal((await llamar(conSecreto, SECRETO)).statusCode, 200)
      const { rows: [r] } = await db.query(`SELECT correo_enviado_en FROM avisos_plataforma WHERE id_aviso = $1`, [a.id_aviso])
      assert.ok(r.correo_enviado_en)
    } finally {
      await db.query(`DELETE FROM avisos_plataforma WHERE id_aviso = $1`, [a.id_aviso])
    }
  })
})
