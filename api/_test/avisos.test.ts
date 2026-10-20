import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, beforeEach, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { hoyEn } from '../_lib/fechas.js'
import { SuscripcionCaducada, endpointPermitido, type Enviador } from '../_lib/push.js'
import { app, borrarOp, cliente, config, db, op, pedido, pull, push, sabores, sesion } from './ayuda.js'

// RF-054 · avisos al vendedor: pedido urgente, cambios en su ruta y en su cartera. Con push falso, para ver qué saldría.

interface Enviado { endpoint: string; carga: { id: string; tipo: string; titulo: string; cuerpo: string; datos: { pestana?: string; pedidoId?: string } } }
const enviados: Enviado[] = []
const fallar = new Map<string, Error>() // endpoint → error al mandar
const falso: Enviador = async (sub, carga) => {
  const e = fallar.get(sub.endpoint)
  if (e) throw e
  enviados.push({ endpoint: sub.endpoint, carga: JSON.parse(carga) })
}
const srv = await construirApp({ db, config: { ...config, vapidPublica: 'BClavePublicaDePrueba' }, enviador: falso })
beforeEach(() => { enviados.length = 0; fallar.clear() })
after(async () => { await srv.close(); await app.close(); await db.end() })

type S = { token: string; dispositivo: string; id: string }
async function llamar(s: { token: string } | null, method: 'GET' | 'POST', url: string, payload?: unknown, servidor = srv) {
  const r = await servidor.inject({ method, url, headers: s ? { authorization: `Bearer ${s.token}` } : {}, payload: payload as any })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const hoy = () => hoyEn(config.zonaHoraria)
const manana = () => hoyEn(config.zonaHoraria, new Date(Date.now() + 36 * 3600_000))

async function suscribir(s: S, endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const r = await llamar(s, 'POST', '/notificaciones/suscripcion', { endpoint, keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') } })
  assert.equal(r.status, 200)
  return endpoint
}
const filas = (idUsuario: string) => db.query(`SELECT * FROM notificaciones WHERE id_usuario = $1 ORDER BY creado_en, id_notificacion`, [idUsuario]).then((r) => r.rows)

// Un vendedor con un cliente suyo y un administrador, cada uno con un teléfono suscrito.
async function escenario() {
  const admin = (await sesion('administrador')) as S
  const vend = (await sesion('vendedor')) as S
  const c = cliente({ nombre: 'Doña Lupita' })
  assert.equal((await push(vend, [op('clientes', c.id, c)], Date.now(), srv)).body.resultados[0].estado, 'aplicada')
  const [producto] = await sabores(admin)
  const tel = await suscribir(vend)
  return { admin, vend, c, producto, tel }
}

describe('suscripción a las notificaciones push', () => {
  it('sin claves VAPID el servidor lo dice; con ellas da la clave pública para suscribirse', async () => {
    const s = await sesion('vendedor')
    assert.deepEqual((await llamar(s, 'GET', '/notificaciones/config', undefined, app)).body, { push: false, clavePublica: null })
    assert.deepEqual((await llamar(s, 'GET', '/notificaciones/config')).body, { push: true, clavePublica: 'BClavePublicaDePrueba' })
    assert.equal((await llamar(null, 'GET', '/notificaciones/config')).status, 401)
  })

  it('sólo acepta direcciones de los servicios de push conocidos (no es una puerta a la red interna)', async () => {
    for (const bueno of [
      'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) assert.equal(endpointPermitido(bueno), true, bueno)
    for (const malo of [
      'http://fcm.googleapis.com/fcm/send/abc', 'https://169.254.169.254/latest/meta-data', 'https://localhost:3000/x',
      'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com@evil.com/x', 'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com:8443/x', 'https://notfcm.googleapis.com.example/x', 'no es una url',
    ]) assert.equal(endpointPermitido(malo), false, malo)

    const s = (await sesion('vendedor')) as S
    const keys = { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') }
    assert.equal((await llamar(s, 'POST', '/notificaciones/suscripcion', { endpoint: 'https://169.254.169.254/x', keys })).status, 400)
    assert.equal((await llamar(s, 'POST', '/notificaciones/suscripcion', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: '<script>', auth: 'x' } })).status, 400)
    assert.equal((await llamar(null, 'POST', '/notificaciones/suscripcion', { endpoint: 'https://fcm.googleapis.com/x', keys })).status, 401)
  })

  it('suscribirse dos veces no duplica; el mismo teléfono con otra cuenta pasa a ser de ésa; la baja es sólo de quien la hace', async () => {
    const a = (await sesion('vendedor')) as S
    const b = (await sesion('vendedor')) as S
    const tel = await suscribir(a)
    await suscribir(a, tel)
    const cuenta = async (id: string) => (await db.query(`SELECT count(*)::int AS n FROM suscripciones_push WHERE id_usuario = $1`, [id])).rows[0].n
    assert.equal(await cuenta(a.id), 1)

    await llamar(b, 'POST', '/notificaciones/suscripcion/baja', { endpoint: tel }) // b no puede quitar el de a
    assert.equal(await cuenta(a.id), 1)

    await suscribir(b, tel) // el teléfono ahora entra con la cuenta de b
    assert.equal(await cuenta(a.id), 0)
    assert.equal(await cuenta(b.id), 1)
    await llamar(b, 'POST', '/notificaciones/suscripcion/baja', { endpoint: tel })
    assert.equal(await cuenta(b.id), 0)
  })

  it('una cuenta guarda como mucho 10 teléfonos: los más viejos se olvidan', async () => {
    const s = (await sesion('vendedor')) as S
    const primero = await suscribir(s)
    for (let i = 0; i < 10; i++) await suscribir(s)
    const { rows } = await db.query(`SELECT endpoint FROM suscripciones_push WHERE id_usuario = $1`, [s.id])
    assert.equal(rows.length, 10)
    assert.ok(!rows.some((r) => r.endpoint === primero))
  })

  it('dar de baja o restablecer la contraseña de una cuenta le quita los teléfonos suscritos', async () => {
    const admin = (await sesion('administrador')) as S
    const v = (await sesion('vendedor')) as S
    await suscribir(v)
    assert.equal((await llamar(admin, 'POST', `/usuarios/${v.id}/baja`, {})).status, 200)
    assert.equal((await db.query(`SELECT 1 FROM suscripciones_push WHERE id_usuario = $1`, [v.id])).rowCount, 0)
  })
})

describe('pedido urgente (RF-054)', () => {
  it('cuando el administrador marca un pedido urgente, el vendedor recibe el push y el aviso al sincronizar', async () => {
    const { admin, vend, c, producto, tel } = await escenario()
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    const r = await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    assert.equal(r.body.resultados[0].estado, 'aplicada')

    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].endpoint, tel)
    assert.equal(enviados[0].carga.tipo, 'pedido_urgente')
    assert.equal(enviados[0].carga.titulo, 'Pedido urgente')
    assert.match(enviados[0].carga.cuerpo, /Doña Lupita: 3 L/)
    assert.deepEqual(enviados[0].carga.datos, { pestana: 'ruta', pedidoId: p.id })

    const bajada = await pull(vend, 0, srv)
    assert.equal(bajada.body.pedidos.find((x: any) => x.id === p.id).urgente, true)
    assert.equal(bajada.body.avisos.length, 1)
    assert.equal(bajada.body.avisos[0].id, enviados[0].carga.id)
    assert.equal(bajada.body.avisos[0].tipo, 'pedido_urgente')
  })

  it('un vendedor no puede marcar urgente ni quitar la marca, y no avisa a nadie', async () => {
    const { admin, vend, c, producto } = await escenario()
    const propio = pedido(c.id, producto.id, { fecha: hoy(), urgente: true })
    assert.equal((await push(vend, [op('pedidos', propio.id, propio)], Date.now(), srv)).body.resultados[0].estado, 'aplicada')
    assert.equal((await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === propio.id).urgente, false)
    assert.equal(enviados.length, 0)

    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    const v1 = (await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    assert.equal(v1.urgente, true)
    enviados.length = 0
    // El vendedor edita el pedido (con la marca en falso, como una copia vieja) y no la quita.
    await push(vend, [op('pedidos', p.id, { ...v1, urgente: false, items: [{ productoId: producto.id, litros: 5, precio_litro: 60 }] }, v1.version)], Date.now(), srv)
    assert.equal((await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id).urgente, true)
    assert.equal(enviados.length, 0)
  })

  it('al entregarse, el pedido deja de ser urgente; si el administrador lo vuelve a marcar, vuelve a avisar', async () => {
    const { admin, vend, c, producto } = await escenario()
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    const v1 = (await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    await push(vend, [op('pedidos', p.id, { ...v1, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO' }, v1.version)], Date.now(), srv)
    assert.equal((await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id).urgente, false)

    // Marcado una vez y editado otra vez sin cambiar la marca: no vuelve a ser «nuevo urgente».
    const q = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', q.id, q)], Date.now(), srv)
    const q1 = (await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === q.id)
    enviados.length = 0
    await push(admin, [op('pedidos', q.id, { ...q1, urgente: true, items: [{ productoId: producto.id, litros: 4, precio_litro: 60 }] }, q1.version)], Date.now(), srv)
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].carga.tipo, 'ruta_modificada') // cambió, pero ya se había avisado como urgente

    // Quitar la marca y ponerla otra vez sí avisa de nuevo.
    const q2 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === q.id)
    await push(admin, [op('pedidos', q.id, { ...q2, urgente: false }, q2.version)], Date.now(), srv)
    const q3 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === q.id)
    enviados.length = 0
    await push(admin, [op('pedidos', q.id, { ...q3, urgente: true }, q3.version)], Date.now(), srv)
    assert.equal(enviados[0].carga.tipo, 'pedido_urgente')
  })

  it('una copia vieja del administrador (sin el campo) no quita la marca', async () => {
    const { admin, vend, c, producto } = await escenario()
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    const a1 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    const { urgente: _, ...sinCampo } = a1
    await push(admin, [op('pedidos', p.id, { ...sinCampo, items: [{ productoId: producto.id, litros: 7, precio_litro: 60 }] }, a1.version)], Date.now(), srv)
    assert.equal((await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id).urgente, true)
  })
})

describe('cambios en la ruta del día (RF-054)', () => {
  it('avisa cuando el administrador agrega, cambia o quita un pedido de hoy; no por los de otros días', async () => {
    const { admin, vend, c, producto } = await escenario()
    const p = { ...pedido(c.id, producto.id, { fecha: hoy() }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].carga.tipo, 'ruta_modificada')
    assert.match(enviados[0].carga.cuerpo, /Nueva parada: Doña Lupita, 3 L/)

    const para = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    enviados.length = 0
    await push(admin, [op('pedidos', p.id, { ...para, items: [{ productoId: producto.id, litros: 6, precio_litro: 60 }] }, para.version)], Date.now(), srv)
    assert.match(enviados[0].carga.cuerpo, /Cambió el pedido de Doña Lupita: ahora 6 L/)

    enviados.length = 0
    const v2 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    await push(admin, [op('pedidos', p.id, { ...v2, fecha: manana() }, v2.version)], Date.now(), srv)
    assert.match(enviados[0].carga.cuerpo, /Doña Lupita ya no se visita hoy/)

    // Un pedido de otro día no mueve la ruta de hoy.
    enviados.length = 0
    const futuro = { ...pedido(c.id, producto.id, { fecha: manana() }), vendedorId: vend.id }
    await push(admin, [op('pedidos', futuro.id, futuro)], Date.now(), srv)
    assert.equal(enviados.length, 0)

    // Y si se pasa a hoy, sí.
    const f1 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === futuro.id)
    await push(admin, [op('pedidos', futuro.id, { ...f1, fecha: hoy() }, f1.version)], Date.now(), srv)
    assert.match(enviados[0].carga.cuerpo, /Se agregó a tu ruta de hoy: Doña Lupita/)

    // Quitarlo.
    enviados.length = 0
    const f2 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === futuro.id)
    await push(admin, [borrarOp('pedidos', futuro.id, f2.version)], Date.now(), srv)
    assert.match(enviados[0].carga.cuerpo, /Se quitó el pedido de Doña Lupita de tu ruta de hoy/)
  })

  it('varios cambios en un mismo envío llegan como un solo aviso', async () => {
    const { admin, vend, c, producto } = await escenario()
    const c2 = cliente({ nombre: 'Tienda Don Beto' })
    await push(vend, [op('clientes', c2.id, c2)], Date.now(), srv)
    const ps = [c, c2, c].map((x) => ({ ...pedido(x.id, producto.id, { fecha: hoy() }), vendedorId: vend.id }))
    await push(admin, ps.map((p) => op('pedidos', p.id, p)), Date.now(), srv)
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].carga.titulo, 'Tu ruta cambió')
    assert.match(enviados[0].carga.cuerpo, /Doña Lupita/)
    assert.match(enviados[0].carga.cuerpo, /Tienda Don Beto/)
    assert.equal((await filas(vend.id)).length, 1)
  })

  it('un urgente y otros cambios en el mismo envío son dos avisos distintos', async () => {
    const { admin, vend, c, producto } = await escenario()
    const normal = { ...pedido(c.id, producto.id, { fecha: hoy() }), vendedorId: vend.id }
    const urgente = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', normal.id, normal), op('pedidos', urgente.id, urgente)], Date.now(), srv)
    assert.deepEqual(enviados.map((e) => e.carga.tipo).sort(), ['pedido_urgente', 'ruta_modificada'])
  })

  it('no avisa de lo que hace el vendedor, de las operaciones rechazadas, de repetidas ni de ventas ya cerradas', async () => {
    const { admin, vend, c, producto } = await escenario()
    // El vendedor agrega a su ruta.
    const propio = pedido(c.id, producto.id, { fecha: hoy() })
    await push(vend, [op('pedidos', propio.id, propio)], Date.now(), srv)
    assert.equal(enviados.length, 0)

    // Operación inválida del administrador: no se aplica, no avisa.
    const malo = { ...pedido(c.id, producto.id, { fecha: hoy() }), vendedorId: vend.id, items: [{ productoId: randomUUID(), litros: 1, precio_litro: 1 }] }
    const r = await push(admin, [op('pedidos', malo.id, malo)], Date.now(), srv)
    assert.equal(r.body.resultados[0].estado, 'rechazada')
    assert.equal(enviados.length, 0)

    // Reenviar la misma operación no avisa dos veces.
    const p = { ...pedido(c.id, producto.id, { fecha: hoy() }), vendedorId: vend.id }
    const o = op('pedidos', p.id, p)
    await push(admin, [o], Date.now(), srv)
    await push(admin, [o], Date.now(), srv)
    assert.equal(enviados.length, 1)

    // Corregir una venta ya entregada es historia, no ruta.
    const v1 = (await pull(vend, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    await push(vend, [op('pedidos', p.id, { ...v1, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO' }, v1.version)], Date.now(), srv)
    const a1 = (await pull(admin, 0, srv)).body.pedidos.find((x: any) => x.id === p.id)
    enviados.length = 0
    await push(admin, [op('pedidos', p.id, { ...a1, metodo_pago: 'TRANSFERENCIA' }, a1.version)], Date.now(), srv)
    assert.equal(enviados.length, 0)

    // El administrador no se avisa a sí mismo: un pedido suyo (sin vendedor) no manda nada.
    const delAdmin = cliente()
    await push(admin, [op('clientes', delAdmin.id, delAdmin)], Date.now(), srv)
    const suyo = pedido(delAdmin.id, producto.id, { fecha: hoy(), urgente: true })
    await push(admin, [op('pedidos', suyo.id, suyo)], Date.now(), srv)
    assert.equal(enviados.length, 0)
  })

  it('reasignar clientes avisa al vendedor que los recibe y al que los pierde', async () => {
    const admin = (await sesion('administrador')) as S
    const A = (await sesion('vendedor')) as S
    const B = (await sesion('vendedor')) as S
    const telA = await suscribir(A)
    const telB = await suscribir(B)
    const [c1, c2] = [cliente(), cliente()]
    await push(A, [op('clientes', c1.id, c1), op('clientes', c2.id, c2)], Date.now(), srv)
    enviados.length = 0

    const r = await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id, c2.id], hacia: B.id })
    assert.equal(r.status, 200)
    const aA = enviados.find((e) => e.endpoint === telA)!
    const aB = enviados.find((e) => e.endpoint === telB)!
    assert.equal(aA.carga.cuerpo, '2 clientes ya no son tuyos')
    assert.equal(aB.carga.cuerpo, '2 clientes pasaron a tu cartera')
    assert.equal(aB.carga.datos.pestana, 'ruta')

    // Un solo cliente, en singular.
    const c3 = cliente()
    await push(B, [op('clientes', c3.id, c3)], Date.now(), srv)
    enviados.length = 0
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c3.id], hacia: A.id })
    assert.equal(enviados.find((e) => e.endpoint === telB)!.carga.cuerpo, '1 cliente ya no es tuyo')
    assert.equal(enviados.find((e) => e.endpoint === telA)!.carga.cuerpo, '1 cliente pasó a tu cartera')
  })
})

describe('entrega de los avisos', () => {
  it('un teléfono caducado (410) se olvida; un error pasajero no borra la suscripción ni tumba el cambio', async () => {
    const { admin, vend, c, producto } = await escenario()
    const viejo = await suscribir(vend)
    const roto = await suscribir(vend)
    fallar.set(viejo, new SuscripcionCaducada())
    fallar.set(roto, new Error('el servicio de push no responde'))
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    const r = await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    assert.equal(r.status, 200)
    assert.equal(r.body.resultados[0].estado, 'aplicada') // el pedido quedó aunque el push fallara
    const { rows } = await db.query(`SELECT endpoint FROM suscripciones_push WHERE id_usuario = $1`, [vend.id])
    const quedan = rows.map((x) => x.endpoint)
    assert.ok(!quedan.includes(viejo))
    assert.ok(quedan.includes(roto))
    assert.equal(enviados.length, 1) // el teléfono bueno sí lo recibió
  })

  it('no avisa a quien está dado de baja', async () => {
    const { admin, vend, c, producto } = await escenario()
    await db.query(`UPDATE usuarios SET activo = false WHERE id_usuario = $1`, [vend.id])
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    assert.equal(enviados.length, 0)
    assert.equal((await filas(vend.id)).length, 0)
  })

  it('sin claves VAPID los avisos igual se guardan y llegan con la sincronización', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    const [producto] = await sabores(admin)
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)]) // servidor `app`: sin push
    const { body } = await pull(vend)
    assert.equal(body.avisos.length, 1)
    assert.equal(body.avisos[0].tipo, 'pedido_urgente')
  })

  it('el pull sólo trae los avisos nuevos, y en la primera descarga nada de hace más de 3 días', async () => {
    const { admin, vend, c, producto } = await escenario()
    await db.query(`INSERT INTO notificaciones (id_usuario, tipo, titulo, creado_en) VALUES ($1, 'ruta_modificada', 'Vieja', now() - interval '10 days')`, [vend.id])
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)

    const primera = await pull(vend, 0, srv)
    assert.deepEqual(primera.body.avisos.map((a: any) => a.titulo), ['Pedido urgente'])
    assert.ok(Math.abs(primera.body.avisos[0].creado - Date.now()) < 60_000)

    // (El cursor real resta 5 s de solape y repetiría este aviso; la app lo guarda por id, así que no se duplica.)
    const segunda = await pull(vend, Math.ceil(primera.body.ahora), srv)
    assert.equal(segunda.body.avisos.length, 0)
    const q = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', q.id, q)], Date.now(), srv)
    assert.equal((await pull(vend, Math.ceil(primera.body.ahora), srv)).body.avisos.length, 1)
  })

  it('cada quien sólo recibe sus avisos', async () => {
    const { admin, vend, c, producto } = await escenario()
    const otro = (await sesion('vendedor')) as S
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    assert.equal((await pull(otro, 0, srv)).body.avisos.length, 0)
    assert.equal((await pull(admin, 0, srv)).body.avisos.length, 0)
  })

  it('marcar como leídos sólo afecta a los propios', async () => {
    const { admin, vend, c, producto } = await escenario()
    const otro = (await sesion('vendedor')) as S
    const p = { ...pedido(c.id, producto.id, { fecha: hoy(), urgente: true }), vendedorId: vend.id }
    await push(admin, [op('pedidos', p.id, p)], Date.now(), srv)
    const id = (await pull(vend, 0, srv)).body.avisos[0].id
    await llamar(otro, 'POST', '/notificaciones/leidas', { ids: [id] })
    assert.equal((await filas(vend.id))[0].leida_en, null)
    assert.equal((await llamar(vend, 'POST', '/notificaciones/leidas', { ids: [id] })).status, 200)
    assert.notEqual((await filas(vend.id))[0].leida_en, null)
    assert.equal((await llamar(vend, 'POST', '/notificaciones/leidas', { ids: ['no-es-uuid'] })).status, 400)
  })

  it('«enviar prueba» llega a los teléfonos de la cuenta, y sin push responde que no está activado', async () => {
    const { vend, tel } = await escenario()
    const r = await llamar(vend, 'POST', '/notificaciones/prueba')
    assert.deepEqual(r.body, { dispositivos: 1, enviados: 1 })
    assert.equal(enviados[0].endpoint, tel)
    assert.equal(enviados[0].carga.tipo, 'prueba')

    const sinPush = await llamar(vend, 'POST', '/notificaciones/prueba', undefined, app)
    assert.equal(sinPush.status, 409)
    assert.equal(sinPush.body.codigo, 'PUSH_NO_CONFIGURADO')
  })
})

