import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { crearDespachador } from '../_lib/notificaciones.js'
import { avisarPruebasPorVencer } from '../_lib/plataforma.js'
import { app, config, crearEmpresa, db, sesion } from './ayuda.js'

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

  it('avisa a los administradores el último día de su prueba gratis (y no a quien ya paga)', async () => {
    const vence = await crearEmpresa()
    const paga = await crearEmpresa()
    await db.query(`UPDATE empresas SET exenta = false, prueba_hasta = now() + interval '20 hours' WHERE id_empresa = ANY($1::uuid[])`, [[vence, paga]])
    await db.query(`UPDATE empresas SET suscripcion_estado = 'authorized' WHERE id_empresa = $1`, [paga])
    const admin = await sesion('administrador', 'tel-a', vence)
    const vend = await sesion('vendedor', 'tel-v', vence)
    const otro = await sesion('administrador', 'tel-b', paga)
    // El despachador del cron corre como dueño de la base, sin empresa en alcance.
    await avisarPruebasPorVencer(db, config, crearDespachador(db, null, { error: () => {} }))
    const { rows } = await db.query(`SELECT id_usuario, id_empresa, titulo, datos FROM notificaciones WHERE tipo = 'prueba_por_vencer' AND id_usuario = ANY($1::uuid[])`, [[admin.id, vend.id, otro.id]])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id_usuario, admin.id)
    assert.equal(rows[0].id_empresa, vence)
    assert.match(rows[0].titulo, /Mañana termina/)
    assert.equal(rows[0].datos.url, '/admin?ir=suscripcion')
  })
})
