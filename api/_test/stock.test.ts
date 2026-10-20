import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, beforeEach, describe, it } from 'node:test'
import { construirApp } from '../_lib/app.js'
import { hoyEn } from '../_lib/fechas.js'
import type { Enviador } from '../_lib/push.js'
import { app, cliente, config, db, op, pedido, pull, push, sabores, sesion } from './ayuda.js'

// RF-037 · stock diario: lo producido, lo asignado a cada vendedor, lo que va entregando y lo que devuelve.

const enviados: { endpoint: string; carga: { tipo: string; titulo: string; cuerpo: string; datos: { pestana?: string } } }[] = []
const falso: Enviador = async (sub, carga) => { enviados.push({ endpoint: sub.endpoint, carga: JSON.parse(carga) }) }
const srv = await construirApp({ db, config: { ...config, vapidPublica: 'BClavePublicaDePrueba' }, enviador: falso })
beforeEach(() => { enviados.length = 0 })
// Cada prueba usa su propio día lejano (lo producido es de todos, no de un vendedor) y al terminar se borra.
const usados = new Set<string>()
const diaNuevo = () => {
  const d = new Date(Date.UTC(2100, 0, 1) + Math.floor(Math.random() * 292_000) * 86_400_000).toISOString().slice(0, 10)
  usados.add(d)
  return d
}
after(async () => {
  await db.query(`DELETE FROM stock_diario WHERE fecha = ANY($1::date[])`, [[...usados]])
  await db.query(`DELETE FROM produccion_diaria WHERE fecha = ANY($1::date[])`, [[...usados]])
  await srv.close(); await app.close(); await db.end()
})

type S = { token: string; dispositivo: string; id: string }
async function llamar(s: { token: string } | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  const r = await srv.inject({ method, url, headers: s ? { authorization: `Bearer ${s.token}` } : {}, payload: payload as any })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const hoy = () => hoyEn(config.zonaHoraria)

const carga = (admin: S, vendedorId: string, fecha: string, lineas: { productoId: string; asignada: number; devuelta?: number }[]) =>
  llamar(admin, 'PUT', `/stock/vendedor/${vendedorId}`, { fecha, lineas })
const de = (dia: any, vendedorId: string) => dia.vendedores.find((v: any) => v.id === vendedorId)
const linea = (dia: any, vendedorId: string, productoId: string) => de(dia, vendedorId)?.lineas.find((l: any) => l.productoId === productoId)

async function suscribir(s: S) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`
  await llamar(s, 'POST', '/notificaciones/suscripcion', { endpoint, keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') } })
  return endpoint
}

describe('producción y carga del día (RF-037)', () => {
  it('sólo el administrador ve y captura el stock', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [fresa] = await sabores(admin)
    const f = diaNuevo()
    assert.equal((await llamar(null, 'GET', `/stock?fecha=${f}`)).status, 401)
    for (const [metodo, url, body] of [
      ['GET', `/stock?fecha=${f}`, undefined],
      ['PUT', '/stock/produccion', { fecha: f, lineas: [{ productoId: fresa.id, litros: 10 }] }],
      ['PUT', `/stock/vendedor/${vend.id}`, { fecha: f, lineas: [{ productoId: fresa.id, asignada: 5 }] }],
      ['POST', '/stock/copiar', { desde: f, hacia: diaNuevo() }],
    ] as const) assert.equal((await llamar(vend, metodo, url, body)).status, 403, `${metodo} ${url}`)
    assert.equal((await llamar(admin, 'GET', '/stock')).status, 400)
    assert.equal((await llamar(admin, 'GET', '/stock?fecha=ayer')).status, 400)
  })

  it('registra los litros producidos de cada sabor y se pueden corregir', async () => {
    const admin = (await sesion('administrador')) as S
    const [a, b] = await sabores(admin)
    const f = diaNuevo()
    const vacio = await llamar(admin, 'GET', `/stock?fecha=${f}`)
    assert.deepEqual(vacio.body.produccion, [])

    const r = await llamar(admin, 'PUT', '/stock/produccion', { fecha: f, lineas: [{ productoId: a.id, litros: 40 }, { productoId: b.id, litros: 25.5 }] })
    assert.equal(r.status, 200)
    const lit = (d: any, id: string) => d.produccion.find((p: any) => p.productoId === id)?.litros
    assert.equal(lit(r.body, a.id), 40)
    assert.equal(lit(r.body, b.id), 25.5)

    const c = await llamar(admin, 'PUT', '/stock/produccion', { fecha: f, lineas: [{ productoId: a.id, litros: 0 }] })
    assert.equal(lit(c.body, a.id), 0)
    assert.equal(lit(c.body, b.id), 25.5) // lo que no se mandó no se toca
  })

  it('rechaza litros negativos o absurdos, sabores repetidos o que no existen', async () => {
    const admin = (await sesion('administrador')) as S
    const [a] = await sabores(admin)
    const f = diaNuevo()
    const put = (lineas: unknown[]) => llamar(admin, 'PUT', '/stock/produccion', { fecha: f, lineas })
    assert.equal((await put([{ productoId: a.id, litros: -1 }])).status, 400)
    assert.equal((await put([{ productoId: a.id, litros: 1_000_000 }])).status, 400)
    assert.equal((await put([{ productoId: a.id, litros: 'mucho' }])).status, 400)
    assert.equal((await put([{ productoId: a.id, litros: 1 }, { productoId: a.id, litros: 2 }])).status, 400)
    assert.equal((await put([])).status, 400)
    assert.equal((await put([{ productoId: randomUUID(), litros: 1 }])).status, 404)
    assert.equal((await llamar(admin, 'PUT', '/stock/produccion', { fecha: '2040-13-45', lineas: [{ productoId: a.id, litros: 1 }] })).status, 400)
  })

  it('asigna litros a un vendedor y los muestra junto con lo que ya entregó ese día', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [a, b] = await sabores(admin)
    const f = diaNuevo()

    const r = await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 12 }, { productoId: b.id, asignada: 8 }])
    assert.equal(r.status, 200)
    assert.deepEqual(linea(r.body, vend.id, a.id), { productoId: a.id, asignada: 12, devuelta: 0, entregado: 0 })

    // El vendedor entrega 3 L del primer sabor ese día.
    const c = cliente()
    const p = pedido(c.id, a.id, { fecha: f, items: [{ productoId: a.id, litros: 3, precio_litro: 60 }], estado: 'ENTREGADO', metodo_pago: 'EFECTIVO' })
    await push(vend, [op('clientes', c.id, c), op('pedidos', p.id, p)])
    // Y otro sin entregar, que no cuenta.
    const q = pedido(c.id, b.id, { fecha: f })
    await push(vend, [op('pedidos', q.id, q)])

    const dia = (await llamar(admin, 'GET', `/stock?fecha=${f}`)).body
    assert.equal(linea(dia, vend.id, a.id).entregado, 3)
    assert.equal(linea(dia, vend.id, b.id).entregado, 0)
    assert.equal(de(dia, vend.id).nombre, 'Prueba vendedor')
  })

  it('cambiar un sabor no toca los demás; asignar 0 lo deja en cero; cada vendedor tiene lo suyo', async () => {
    const admin = (await sesion('administrador')) as S
    const [v1, v2] = [(await sesion('vendedor')) as S, (await sesion('vendedor')) as S]
    const [a, b] = await sabores(admin)
    const f = diaNuevo()
    await carga(admin, v1.id, f, [{ productoId: a.id, asignada: 10 }, { productoId: b.id, asignada: 6 }])
    await carga(admin, v2.id, f, [{ productoId: a.id, asignada: 4 }])
    const r = await carga(admin, v1.id, f, [{ productoId: a.id, asignada: 9.5 }])
    assert.equal(linea(r.body, v1.id, a.id).asignada, 9.5)
    assert.equal(linea(r.body, v1.id, b.id).asignada, 6)
    assert.equal(linea(r.body, v2.id, a.id).asignada, 4)
    const cero = await carga(admin, v1.id, f, [{ productoId: b.id, asignada: 0 }])
    assert.equal(linea(cero.body, v1.id, b.id), undefined) // en cero ya no aparece
  })

  it('al cerrar el día registra lo devuelto, sin pasar de lo asignado', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [a, b] = await sabores(admin)
    const f = diaNuevo()
    await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 10 }, { productoId: b.id, asignada: 5 }])

    const r = await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 10, devuelta: 2.5 }])
    assert.equal(linea(r.body, vend.id, a.id).devuelta, 2.5)
    // Mandar sólo la asignación no borra lo devuelto.
    const igual = await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 10 }])
    assert.equal(linea(igual.body, vend.id, a.id).devuelta, 2.5)

    const mucho = await carga(admin, vend.id, f, [{ productoId: b.id, asignada: 5, devuelta: 6 }])
    assert.equal(mucho.status, 400)
    assert.match(mucho.body.error, /no puede ser más de lo asignado/)
    // Bajar lo asignado por debajo de lo ya devuelto también se rechaza.
    assert.equal((await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 1 }])).status, 400)
    assert.equal(linea((await llamar(admin, 'GET', `/stock?fecha=${f}`)).body, vend.id, b.id).devuelta, 0) // nada se guardó a medias
  })

  it('rechaza vendedor inexistente o que no es vendedor, sabores que no existen y datos inválidos', async () => {
    const admin = (await sesion('administrador')) as S
    const [a] = await sabores(admin)
    const f = diaNuevo()
    assert.equal((await carga(admin, randomUUID(), f, [{ productoId: a.id, asignada: 1 }])).status, 404)
    assert.equal((await carga(admin, admin.id, f, [{ productoId: a.id, asignada: 1 }])).status, 404) // el administrador no recibe carga
    const vend = (await sesion('vendedor')) as S
    assert.equal((await carga(admin, vend.id, f, [{ productoId: randomUUID(), asignada: 1 }])).status, 404)
    assert.equal((await carga(admin, vend.id, f, [{ productoId: a.id, asignada: -2 }])).status, 400)
    assert.equal((await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 1 }, { productoId: a.id, asignada: 2 }])).status, 400)
    assert.equal((await llamar(admin, 'PUT', '/stock/vendedor/no-es-uuid', { fecha: f, lineas: [{ productoId: a.id, asignada: 1 }] })).status, 400)
  })

  it('a un vendedor dado de baja no se le asigna más, pero se le puede registrar lo que devolvió', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [a] = await sabores(admin)
    const f = diaNuevo()
    await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 10 }])
    await db.query(`UPDATE usuarios SET activo = false WHERE id_usuario = $1`, [vend.id])
    assert.equal((await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 11 }])).status, 409)
    const ok = await carga(admin, vend.id, f, [{ productoId: a.id, asignada: 10, devuelta: 4 }])
    assert.equal(ok.status, 200)
    assert.equal(de(ok.body, vend.id).activo, false) // sigue en la lista de ese día
    const otroDia = (await llamar(admin, 'GET', `/stock?fecha=${diaNuevo()}`)).body
    assert.equal(de(otroDia, vend.id), undefined) // y en los días sin carga ya no
  })
})

describe('el vendedor recibe su stock al sincronizar', () => {
  it('sólo el suyo, de hoy y de los días recientes; el administrador no lo recibe', async () => {
    const admin = (await sesion('administrador')) as S
    const [v1, v2] = [(await sesion('vendedor')) as S, (await sesion('vendedor')) as S]
    const [a, b] = await sabores(admin)
    const ayer = hoyEn(config.zonaHoraria, new Date(Date.now() - 24 * 3600_000))
    const viejo = hoyEn(config.zonaHoraria, new Date(Date.now() - 20 * 24 * 3600_000))
    await carga(admin, v1.id, hoy(), [{ productoId: a.id, asignada: 10 }, { productoId: b.id, asignada: 6 }])
    await carga(admin, v1.id, ayer, [{ productoId: a.id, asignada: 7 }])
    await carga(admin, v1.id, viejo, [{ productoId: a.id, asignada: 99 }])
    await carga(admin, v2.id, hoy(), [{ productoId: a.id, asignada: 4 }])

    const { body } = await pull(v1)
    const mias = body.stock.map((s: any) => [s.fecha, s.productoId, s.asignada]).sort()
    assert.deepEqual(mias, [[ayer, a.id, 7], [hoy(), a.id, 10], [hoy(), b.id, 6]].sort())
    assert.equal(body.stock[0].devuelta, 0)
    assert.ok(body.stock[0].id && body.stock[0].version >= 1)
    assert.deepEqual((await pull(admin)).body.stock, [])
  })

  it('en las descargas siguientes sólo viene lo que cambió', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [a, b] = await sabores(admin)
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 10 }, { productoId: b.id, asignada: 6 }])
    const primera = await pull(vend)
    const desde = Math.ceil(primera.body.ahora)

    // Guardar lo mismo no cambia nada (ni sube la versión): el teléfono no vuelve a bajarlo.
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 10 }, { productoId: b.id, asignada: 6 }])
    assert.equal((await pull(vend, desde)).body.stock.length, 0)

    await carga(admin, vend.id, hoy(), [{ productoId: b.id, asignada: 8 }])
    const cambio = (await pull(vend, desde)).body.stock
    assert.equal(cambio.length, 1)
    assert.equal(cambio[0].productoId, b.id)
    assert.equal(cambio[0].asignada, 8)
    assert.ok(cambio[0].version > primera.body.stock.find((s: any) => s.productoId === b.id).version)
  })
})

describe('aviso de la carga al vendedor', () => {
  it('le llega «Tu carga de hoy» con los litros de cada sabor; si cambia, «Cambió tu carga»', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const tel = await suscribir(vend)
    const [a, b] = await sabores(admin)
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 5 }, { productoId: b.id, asignada: 7.5 }])
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].endpoint, tel)
    assert.equal(enviados[0].carga.tipo, 'stock_asignado')
    assert.equal(enviados[0].carga.titulo, 'Tu carga de hoy')
    assert.match(enviados[0].carga.cuerpo, new RegExp(`${a.sabor} 5 L`))
    assert.match(enviados[0].carga.cuerpo, new RegExp(`${b.sabor} 7.5 L`))
    assert.match(enviados[0].carga.cuerpo, /12\.5 L en total/)
    assert.equal(enviados[0].carga.datos.pestana, 'stock')

    enviados.length = 0
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 9 }])
    assert.equal(enviados[0].carga.titulo, 'Cambió tu carga de hoy')
    assert.match(enviados[0].carga.cuerpo, /16\.5 L en total/)

    const avisos = (await pull(vend)).body.avisos
    assert.deepEqual(avisos.map((x: any) => x.tipo), ['stock_asignado', 'stock_asignado'])
  })

  it('no avisa si no cambió lo asignado, si sólo se registra una devolución, ni por días que ya pasaron', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    await suscribir(vend)
    const [a] = await sabores(admin)
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 5 }])
    enviados.length = 0
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 5 }])
    await carga(admin, vend.id, hoy(), [{ productoId: a.id, asignada: 5, devuelta: 1 }])
    await carga(admin, vend.id, hoyEn(config.zonaHoraria, new Date(Date.now() - 48 * 3600_000)), [{ productoId: a.id, asignada: 5 }])
    assert.equal(enviados.length, 0)
  })
})

describe('repetir la carga de otro día', () => {
  it('copia lo asignado de un día al otro sin pisar lo que ya está, y avisa a cada vendedor', async () => {
    const admin = (await sesion('administrador')) as S
    const [v1, v2, baja] = [(await sesion('vendedor')) as S, (await sesion('vendedor')) as S, (await sesion('vendedor')) as S]
    await suscribir(v1)
    const [a, b] = await sabores(admin)
    const desde = diaNuevo()
    const hacia = diaNuevo()
    await carga(admin, v1.id, desde, [{ productoId: a.id, asignada: 10, devuelta: 3 }, { productoId: b.id, asignada: 6 }])
    await carga(admin, v2.id, desde, [{ productoId: a.id, asignada: 4 }])
    await carga(admin, baja.id, desde, [{ productoId: a.id, asignada: 2 }])
    await db.query(`UPDATE usuarios SET activo = false WHERE id_usuario = $1`, [baja.id])
    await carga(admin, v2.id, hacia, [{ productoId: a.id, asignada: 99 }]) // ya capturado: se respeta

    enviados.length = 0 // (asignar cada día ya avisó; aquí interesa lo que avisa copiar)
    const r = await llamar(admin, 'POST', '/stock/copiar', { desde, hacia })
    assert.equal(r.status, 200)
    assert.equal(r.body.copiadas, 2) // los dos sabores de v1; v2 ya tenía; el de baja no se copia
    assert.deepEqual(linea(r.body, v1.id, a.id), { productoId: a.id, asignada: 10, devuelta: 0, entregado: 0 }) // sin lo devuelto
    assert.equal(linea(r.body, v1.id, b.id).asignada, 6)
    assert.equal(linea(r.body, v2.id, a.id).asignada, 99)
    assert.equal(de(r.body, baja.id), undefined)

    // v1 (con teléfono suscrito) se entera de su carga del nuevo día; v2 y el de baja no tienen push.
    assert.equal(enviados.length, 1)
    assert.match(enviados[0].carga.titulo, /^Tu carga del \d\d\/\d\d$/)
    assert.match(enviados[0].carga.cuerpo, /16 L en total/)

    // Copiar otra vez no cambia nada.
    enviados.length = 0
    assert.equal((await llamar(admin, 'POST', '/stock/copiar', { desde, hacia })).body.copiadas, 0)
    assert.equal(enviados.length, 0)
  })

  it('no copia sabores que ya no están disponibles, ni de un día a sí mismo', async () => {
    const admin = (await sesion('administrador')) as S
    const vend = (await sesion('vendedor')) as S
    const [a, b] = await sabores(admin)
    const desde = diaNuevo()
    const hacia = diaNuevo()
    await carga(admin, vend.id, desde, [{ productoId: a.id, asignada: 3 }, { productoId: b.id, asignada: 2 }])
    await db.query(`UPDATE productos SET disponible = false WHERE id_producto = $1`, [b.id])
    try {
      const r = await llamar(admin, 'POST', '/stock/copiar', { desde, hacia })
      assert.equal(r.body.copiadas, 1)
      assert.equal(linea(r.body, vend.id, b.id), undefined)
    } finally {
      await db.query(`UPDATE productos SET disponible = true WHERE id_producto = $1`, [b.id])
    }
    assert.equal((await llamar(admin, 'POST', '/stock/copiar', { desde, hacia: desde })).status, 400)
    assert.equal((await llamar(admin, 'POST', '/stock/copiar', { desde: 'x', hacia })).status, 400)
  })
})
