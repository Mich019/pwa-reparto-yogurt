import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import type { ClienteMp, EstadoMp } from '../_lib/mercadopago.js'
import { app, config, crearEmpresa, db, EMPRESA, pull, sesion } from './ayuda.js'

// Prueba gratis y suscripción con Mercado Pago (suscripcion.ts). Mercado Pago es un cliente falso.

const SECRETO = 'secreto-de-webhooks'
const estados = new Map<string, EstadoMp>()
const creadas: Parameters<ClienteMp['crear']>[0][] = []
const falso: ClienteMp = {
  async crear(d) {
    creadas.push(d)
    const id = `pre-${creadas.length}-${Date.now()}`
    estados.set(id, 'pending')
    return { id, url: `https://mp.example/checkout/${id}` }
  },
  async consultar(id) { return { id, estado: estados.get(id) ?? 'pending', empresa: null } },
  async cancelar(id) { estados.set(id, 'cancelled') },
}
const conCobro = { ...config, mercadoPago: { ...config.mercadoPago, accessToken: 'x', webhookSecret: SECRETO, precioMensual: 299, activo: true } }
const srv = await construirApp({ db, config: conCobro, mercadoPago: falso })

after(async () => { await srv.close(); await app.close(); await db.end() })

type S = { token: string; dispositivo: string }
const pedir = async (s: S, metodo: 'GET' | 'POST', url: string) => {
  const r = await srv.inject({ method: metodo, url, headers: { authorization: `Bearer ${s.token}` } })
  return { status: r.statusCode, body: r.json() }
}
const vencer = (empresa: string) => db.query(`UPDATE empresas SET prueba_hasta = now() - interval '1 day' WHERE id_empresa = $1`, [empresa])

// Un aviso de Mercado Pago firmado como lo firma Mercado Pago.
function aviso(id: string, secreto = SECRETO) {
  const ts = String(Date.now())
  const firma = createHmac('sha256', secreto).update(`id:${id};request-id:req-1;ts:${ts};`).digest('hex')
  return srv.inject({
    method: 'POST', url: `/mercadopago/webhook?data.id=${id}&type=subscription_preapproval`,
    headers: { 'x-signature': `ts=${ts},v1=${firma}`, 'x-request-id': 'req-1' },
    payload: { type: 'subscription_preapproval', data: { id } },
  })
}

describe('prueba gratis', () => {
  it('una empresa nueva usa todo durante su prueba', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    const { body } = await pedir(admin, 'GET', '/suscripcion')
    assert.equal(body.estado, 'prueba')
    assert.equal(body.diasPrueba, 14)
    assert.equal(body.cobroDisponible, true)
    assert.equal((await pull(admin, 0, srv)).status, 200)
  })

  it('al vencer, la API responde 402 salvo la sesión y la pantalla de cobro; los datos siguen ahí', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    const vend = await sesion('vendedor', 'tel', empresa)
    await vencer(empresa)
    const r = await pull(vend, 0, srv)
    assert.equal(r.status, 402)
    assert.equal(r.body.codigo, 'SUSCRIPCION_VENCIDA')
    assert.equal((await pedir(admin, 'GET', '/usuarios')).status, 402)
    assert.equal((await pedir(admin, 'GET', '/me')).status, 200)
    assert.equal((await pedir(admin, 'GET', '/suscripcion')).body.estado, 'vencida')
    // Un vendedor no ve el cobro.
    assert.equal((await pedir(vend, 'GET', '/suscripcion')).status, 403)
  })

  it('la empresa de siempre está exenta y no se suscribe', async () => {
    const { rows: [e] } = await db.query(`SELECT exenta FROM empresas WHERE id_empresa = $1`, [EMPRESA])
    assert.equal(e.exenta, true)
    const admin = await sesion('administrador')
    assert.equal((await pedir(admin, 'GET', '/suscripcion')).body.estado, 'exenta')
    assert.equal((await pedir(admin, 'POST', '/suscripcion')).status, 409)
  })
})

describe('suscripción con Mercado Pago', () => {
  it('pagar devuelve el acceso; el aviso firmado actualiza el estado', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    await vencer(empresa)
    const r = await pedir(admin, 'POST', '/suscripcion')
    assert.equal(r.status, 201)
    assert.match(r.body.url, /^https:\/\/mp\.example\//)
    const c = creadas.at(-1)!
    assert.equal(c.empresa, empresa)
    assert.equal(c.monto, 299)
    assert.equal(c.inicio, null) // ya sin prueba: cobra desde hoy
    const id = r.body.url.split('/').at(-1)

    estados.set(id, 'authorized')
    assert.equal((await aviso(id, 'otra-clave')).statusCode, 401) // firma de alguien más: no cambia nada
    assert.equal((await pull(admin, 0, srv)).status, 402)
    assert.equal((await aviso(id)).statusCode, 200)
    assert.equal((await pull(admin, 0, srv)).status, 200)
    assert.equal((await pedir(admin, 'GET', '/suscripcion')).body.estado, 'activa')
    assert.equal((await pedir(admin, 'POST', '/suscripcion')).status, 409)

    // Cancelar quita el acceso (la prueba ya había vencido).
    assert.equal((await pedir(admin, 'POST', '/suscripcion/cancelar')).body.estado, 'vencida')
    assert.equal((await pull(admin, 0, srv)).status, 402)
  })

  it('suscribirse durante la prueba deja el primer cobro para cuando termina', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    assert.equal((await pedir(admin, 'POST', '/suscripcion')).status, 201)
    const { rows: [e] } = await db.query(`SELECT prueba_hasta FROM empresas WHERE id_empresa = $1`, [empresa])
    assert.equal(creadas.at(-1)!.inicio?.getTime(), new Date(e.prueba_hasta).getTime())
  })

  it('al volver de pagar, el panel pregunta el estado sin esperar el aviso', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'panel', empresa)
    await vencer(empresa)
    const id = (await pedir(admin, 'POST', '/suscripcion')).body.url.split('/').at(-1)
    estados.set(id, 'authorized')
    assert.equal((await pedir(admin, 'GET', '/suscripcion')).body.estado, 'vencida')
    assert.equal((await pedir(admin, 'GET', '/suscripcion?actualizar=1')).body.estado, 'activa')
  })

  it('sin Mercado Pago configurado no se puede suscribir; los avisos ajenos se ignoran', async () => {
    const admin = await sesion('administrador', 'panel', await crearEmpresa())
    const r = await app.inject({ method: 'POST', url: '/suscripcion', headers: { authorization: `Bearer ${admin.token}` } })
    assert.equal(r.statusCode, 503)
    const otro = await srv.inject({ method: 'POST', url: '/mercadopago/webhook', payload: { type: 'payment', data: { id: '123' } } })
    assert.equal(otro.statusCode, 200)
  })
})
