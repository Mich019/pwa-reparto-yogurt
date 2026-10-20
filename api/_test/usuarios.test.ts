import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { construirApp } from '../_lib/app.js'
import { hashPassword } from '../_lib/auth.js'
import { PASSWORD, app, cliente, config, crearUsuario, db, login, op, pedido, pull, push, sabores, sesion } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

type S = { token: string; dispositivo: string }
async function llamar(s: { token: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, servidor: FastifyInstance = app) {
  const r = await servidor.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as any })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
const nuevaCuenta = (admin: S, extra: Record<string, unknown> = {}) =>
  llamar(admin, 'POST', '/usuarios', { nombre: 'Rosa Vendedora', correo: `rosa-${randomUUID().slice(0, 8)}@prueba.local`, ...extra })

// Una base propia (esquema aparte) para lo que depende de cuántos administradores o clientes sin vendedor hay en total.
async function enBaseAislada(prueba: (x: { srv: FastifyInstance; pool: pg.Pool; usuario: (nombre: string, rol: 'administrador' | 'vendedor') => Promise<S & { id: string }> }) => Promise<void>) {
  const esquema = `aislado_${randomUUID().slice(0, 8)}`
  const cx = new pg.Client(config.conexion)
  await cx.connect()
  await cx.query(`CREATE SCHEMA ${esquema}`)
  await cx.query(`SET search_path TO ${esquema}`)
  await cx.query(readFileSync(new URL('../../db/01_esquema.sql', import.meta.url), 'utf8'))
  const pool = new pg.Pool({ ...config.conexion, options: `-c search_path=${esquema}`, max: 4 })
  const srv = await construirApp({ db: pool, config })
  const hash = await hashPassword(PASSWORD)
  const usuario = async (nombre: string, rol: 'administrador' | 'vendedor') => {
    const correo = `${nombre}@prueba.local`
    const { rows } = await pool.query(`INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id_usuario`, [nombre, correo, hash, rol])
    const r = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo, password: PASSWORD, dispositivo: nombre } })
    return { id: rows[0].id_usuario as string, token: r.json().accessToken as string, dispositivo: nombre }
  }
  try {
    await prueba({ srv, pool, usuario })
  } finally {
    await srv.close()
    await pool.end()
    await cx.query(`DROP SCHEMA ${esquema} CASCADE`)
    await cx.end()
  }
}

describe('altas, cambios y bajas de cuentas (RF-038 a RF-040)', () => {
  it('el administrador da de alta a un vendedor con contraseña temporal, y la persona debe cambiarla al entrar', async () => {
    const admin = await sesion('administrador')
    const r = await nuevaCuenta(admin, { telefono: '5512345678' })
    assert.equal(r.status, 201)
    assert.equal(r.body.usuario.rol, 'vendedor')
    assert.equal(r.body.usuario.debeCambiarPassword, true)
    assert.equal(r.body.usuario.activo, true)
    assert.match(r.body.passwordTemporal, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/)

    const entra = await login(r.body.usuario.correo, r.body.passwordTemporal)
    assert.equal(entra.status, 200)
    assert.equal(entra.body.usuario.debeCambiarPassword, true)
    const tok = { token: entra.body.accessToken as string }
    assert.equal((await llamar(tok, 'GET', '/sync/pull')).body.codigo, 'CAMBIAR_PASSWORD')

    const cambio = await llamar(tok, 'POST', '/auth/cambiar-password', { actual: r.body.passwordTemporal, nueva: 'MiClaveNueva9' })
    assert.equal(cambio.status, 204)
    assert.equal((await llamar(tok, 'GET', '/sync/pull')).status, 200)
  })

  it('guarda la contraseña con Argon2id y nunca la devuelve ni la deja en la bitácora', async () => {
    const admin = await sesion('administrador')
    const r = await nuevaCuenta(admin)
    const { rows } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [r.body.usuario.id])
    assert.match(rows[0].password_hash, /^\$argon2id\$/)
    assert.ok(!JSON.stringify(r.body).includes('argon2'))
    const { rows: aud } = await db.query(`SELECT id_usuario, datos_despues FROM auditoria WHERE tabla = 'usuarios' AND id_registro = $1`, [r.body.usuario.id])
    assert.equal(aud.length, 1)
    assert.equal(aud[0].id_usuario, admin.id) // queda quién la creó
    assert.ok(!('password_hash' in aud[0].datos_despues))
  })

  it('acepta una contraseña inicial elegida por el administrador y no la repite en la respuesta', async () => {
    const admin = await sesion('administrador')
    const r = await nuevaCuenta(admin, { password: 'Inicial2026x' })
    assert.equal(r.status, 201)
    assert.equal(r.body.passwordTemporal, undefined)
    assert.equal((await login(r.body.usuario.correo, 'Inicial2026x')).status, 200)
    assert.equal((await nuevaCuenta(admin, { password: 'sinnumeros' })).status, 400)
  })

  it('rechaza correo repetido (sin importar mayúsculas) y datos inválidos', async () => {
    const admin = await sesion('administrador')
    const a = await nuevaCuenta(admin)
    const repetida = await nuevaCuenta(admin, { correo: a.body.usuario.correo.toUpperCase() })
    assert.equal(repetida.status, 409)
    assert.equal(repetida.body.codigo, 'CORREO_REPETIDO')
    assert.equal((await nuevaCuenta(admin, { correo: 'no-es-correo' })).status, 400)
    assert.equal((await nuevaCuenta(admin, { nombre: 'A' })).status, 400)
    assert.equal((await nuevaCuenta(admin, { rol: 'jefe' })).status, 400)
  })

  it('un vendedor no puede ver ni tocar cuentas', async () => {
    const vend = await sesion('vendedor')
    const otro = await crearUsuario('vendedor')
    assert.equal((await llamar(vend, 'GET', '/usuarios')).status, 403)
    assert.equal((await llamar(vend, 'POST', '/usuarios', { nombre: 'Intruso', correo: 'x@prueba.local' })).status, 403)
    assert.equal((await llamar(vend, 'PATCH', `/usuarios/${otro.id}`, { rol: 'administrador' })).status, 403)
    assert.equal((await llamar(vend, 'POST', `/usuarios/${otro.id}/password`)).status, 403)
    assert.equal((await llamar(vend, 'POST', `/usuarios/${otro.id}/baja`)).status, 403)
    assert.equal((await llamar(vend, 'POST', `/usuarios/${otro.id}/reactivar`)).status, 403)
    assert.equal((await llamar(vend, 'POST', '/clientes/reasignar', { hacia: vend.id, desde: otro.id })).status, 403)
    assert.equal((await app.inject({ method: 'GET', url: '/usuarios' })).statusCode, 401)
    assert.equal((await db.query(`SELECT rol FROM usuarios WHERE id_usuario = $1`, [otro.id])).rows[0].rol, 'vendedor')
  })

  it('la lista trae cuántos clientes tiene cada quien', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    const [a, b] = [cliente(), cliente({ activo: false })]
    await push(vend, [op('clientes', a.id, a), op('clientes', b.id, b)])
    const r = await llamar(admin, 'GET', '/usuarios')
    assert.equal(r.status, 200)
    const yo = r.body.usuarios.find((u: any) => u.id === vend.id)
    assert.equal(yo.clientes, 2)
    assert.equal(yo.clientesActivos, 1)
    assert.equal(yo.activo, true)
    assert.ok(typeof r.body.clientesSinAsignar === 'number')
    assert.ok(!JSON.stringify(r.body).includes('password_hash') && !JSON.stringify(r.body).includes('argon2'))
  })

  it('edita nombre, correo, teléfono y rol; el rol nuevo rige de inmediato con el mismo token', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    assert.equal((await llamar(vend, 'GET', '/usuarios')).status, 403)

    const r = await llamar(admin, 'PATCH', `/usuarios/${vend.id}`, { nombre: 'Nombre Nuevo', telefono: '5500001111', rol: 'administrador' })
    assert.equal(r.status, 200)
    assert.equal(r.body.usuario.nombre, 'Nombre Nuevo')
    assert.equal(r.body.usuario.telefono, '5500001111')
    assert.equal(r.body.usuario.rol, 'administrador')
    assert.equal((await llamar(vend, 'GET', '/usuarios')).status, 200)

    const borra = await llamar(admin, 'PATCH', `/usuarios/${vend.id}`, { telefono: '', rol: 'vendedor' })
    assert.equal(borra.body.usuario.telefono, '')
    assert.equal(borra.body.usuario.rol, 'vendedor')
    assert.equal((await llamar(vend, 'GET', '/usuarios')).status, 403)

    assert.equal((await llamar(admin, 'PATCH', `/usuarios/${vend.id}`, {})).status, 400)
    assert.equal((await llamar(admin, 'PATCH', `/usuarios/${randomUUID()}`, { nombre: 'Nadie' })).status, 404)
    const otra = await nuevaCuenta(admin)
    const choque = await llamar(admin, 'PATCH', `/usuarios/${vend.id}`, { correo: otra.body.usuario.correo })
    assert.equal(choque.status, 409)
    assert.equal(choque.body.codigo, 'CORREO_REPETIDO')
  })

  it('un administrador no puede cambiar su propio rol', async () => {
    const admin = await sesion('administrador')
    const r = await llamar(admin, 'PATCH', `/usuarios/${admin.id}`, { rol: 'vendedor' })
    assert.equal(r.status, 400)
    assert.equal((await llamar(admin, 'GET', '/usuarios')).status, 200)
    assert.equal((await llamar(admin, 'PATCH', `/usuarios/${admin.id}`, { nombre: 'Mi nombre nuevo' })).status, 200) // lo demás sí
  })

  it('el restablecimiento cierra sus sesiones, anula la contraseña vieja y quita el bloqueo', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    await db.query(`UPDATE usuarios SET bloqueado_hasta = now() + interval '10 minutes', intentos_fallidos = 3 WHERE id_usuario = $1`, [vend.id])
    assert.equal((await login(vend.correo)).status, 423)

    const r = await llamar(admin, 'POST', `/usuarios/${vend.id}/password`)
    assert.equal(r.status, 200)
    assert.match(r.body.passwordTemporal, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/)

    assert.equal((await llamar(vend, 'GET', '/me')).status, 401) // su sesión de antes ya no sirve
    assert.equal((await login(vend.correo, PASSWORD)).status, 401)
    const entra = await login(vend.correo, r.body.passwordTemporal)
    assert.equal(entra.status, 200)
    assert.equal(entra.body.usuario.debeCambiarPassword, true)

    assert.equal((await llamar(admin, 'POST', `/usuarios/${admin.id}/password`)).status, 400) // la propia se cambia en Cuenta
    assert.equal((await llamar(admin, 'POST', `/usuarios/${randomUUID()}/password`)).status, 404)
  })

  it('la baja corta el acceso al instante y se puede revertir', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    assert.equal((await llamar(vend, 'GET', '/sync/pull')).status, 200)

    const baja = await llamar(admin, 'POST', `/usuarios/${vend.id}/baja`)
    assert.equal(baja.status, 200)
    assert.equal(baja.body.usuario.activo, false)

    assert.equal((await llamar(vend, 'GET', '/sync/pull')).status, 401) // mismo token, de inmediato
    assert.equal((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: vend.refreshToken } })).statusCode, 401)
    const entra = await login(vend.correo)
    assert.equal(entra.status, 403)
    assert.equal(entra.body.codigo, 'CUENTA_SUSPENDIDA')
    assert.equal((await login(vend.correo, 'otra-clave-1')).status, 401) // sin la contraseña correcta no se revela nada

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM sesiones WHERE id_usuario = $1 AND revocado_en IS NULL`, [vend.id])
    assert.equal(rows[0].n, 0)

    const alta = await llamar(admin, 'POST', `/usuarios/${vend.id}/reactivar`)
    assert.equal(alta.body.usuario.activo, true)
    assert.equal((await login(vend.correo)).status, 200)

    assert.equal((await llamar(admin, 'POST', `/usuarios/${admin.id}/baja`)).status, 400)
    assert.equal((await llamar(admin, 'POST', `/usuarios/${randomUUID()}/baja`)).status, 404)
  })

  it('su cartera sigue ahí tras la baja, hasta que se reasigne', async () => {
    const admin = await sesion('administrador')
    const vend = await sesion('vendedor')
    const c = cliente()
    await push(vend, [op('clientes', c.id, c)])
    await llamar(admin, 'POST', `/usuarios/${vend.id}/baja`)
    const lista = (await llamar(admin, 'GET', '/usuarios')).body.usuarios.find((u: any) => u.id === vend.id)
    assert.equal(lista.activo, false)
    assert.equal(lista.clientes, 1)
    assert.ok((await pull(admin)).body.clientes.some((x: any) => x.id === c.id))
  })

  it('dos administradores que se dan de baja (o se degradan) a la vez no dejan al sistema sin administrador', async () => {
    await enBaseAislada(async ({ srv, pool, usuario }) => {
      for (let ronda = 0; ronda < 6; ronda++) {
        await pool.query(`DELETE FROM usuarios`) // cada ronda parte de exactamente dos administradores
        const a = await usuario(`ana${ronda}`, 'administrador')
        const b = await usuario(`beto${ronda}`, 'administrador')
        const accion = ronda % 2 ? { method: 'PATCH' as const, sufijo: '', payload: { rol: 'vendedor' } } : { method: 'POST' as const, sufijo: '/baja', payload: undefined }
        const [ra, rb] = await Promise.all([
          llamar(a, accion.method, `/usuarios/${b.id}${accion.sufijo}`, accion.payload, srv),
          llamar(b, accion.method, `/usuarios/${a.id}${accion.sufijo}`, accion.payload, srv),
        ])
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'administrador' AND activo`)
        assert.ok(rows[0].n >= 1, `ronda ${ronda}: sin administradores (${ra.status}, ${rb.status})`)
        assert.ok(!(ra.status === 200 && rb.status === 200), `ronda ${ronda}: los dos cambios se aplicaron`)
        for (const x of [ra, rb]) assert.ok([200, 401, 403, 409].includes(x.status), `ronda ${ronda}: estado inesperado ${x.status}`)
      }
    })
  })

  it('con dos administradores, uno sí puede dar de baja al otro; a sí mismo no', async () => {
    await enBaseAislada(async ({ srv, pool, usuario }) => {
      const a = await usuario('ana', 'administrador')
      const b = await usuario('beto', 'administrador')
      assert.equal((await llamar(a, 'POST', `/usuarios/${b.id}/baja`, undefined, srv)).status, 200)
      assert.equal((await llamar(b, 'GET', '/usuarios', undefined, srv)).status, 401)
      assert.equal((await llamar(a, 'POST', `/usuarios/${a.id}/baja`, undefined, srv)).status, 400)
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'administrador' AND activo`)
      assert.equal(rows[0].n, 1)
    })
  })
})

describe('reasignar clientes (RF-041)', () => {
  // Un vendedor A con tres clientes: c1 con un pedido agendado, c2 con un recordatorio y c3 con una entrega ya hecha.
  async function escenario() {
    const admin = await sesion('administrador', 'tel-admin')
    const A = await sesion('vendedor', 'tel-A')
    const B = await sesion('vendedor', 'tel-B')
    const [fresa] = await sabores(admin)
    const c1 = cliente({ nombre: 'Uno' }), c2 = cliente({ nombre: 'Dos' }), c3 = cliente({ nombre: 'Tres' })
    const pendiente = pedido(c1.id, fresa.id)
    const entregado = pedido(c3.id, fresa.id, { estado: 'ENTREGADO', metodo_pago: 'EFECTIVO', fecha_entregado_real: Date.now() })
    const rec = { id: randomUUID(), clienteId: c2.id, creado: Date.now(), hecho: false }
    const r = await push(A, [op('clientes', c1.id, c1), op('clientes', c2.id, c2), op('clientes', c3.id, c3), op('pedidos', pendiente.id, pendiente), op('pedidos', entregado.id, entregado), op('recordatorios', rec.id, rec)])
    assert.deepEqual(r.body.resultados.map((x: any) => x.estado), Array(6).fill('aplicada'))
    return { admin, A, B, c1, c2, c3, pendiente, entregado, rec }
  }
  const ids = (xs: any[]) => xs.map((x) => x.id)
  const duenoBd = async (id: string) => (await db.query(`SELECT id_vendedor FROM clientes WHERE id_cliente = $1`, [id])).rows[0].id_vendedor as string | null

  it('pasa un cliente a otro vendedor con su pedido agendado; el anterior deja de verlo', async () => {
    const { admin, A, B, c1, c2, pendiente } = await escenario()
    const r = await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })
    assert.deepEqual(r.body, { clientes: 1, pedidos: 1, recordatorios: 0 })
    assert.equal(await duenoBd(c1.id), B.id)
    assert.equal((await db.query(`SELECT id_vendedor FROM pedidos WHERE id_pedido = $1`, [pendiente.id])).rows[0].id_vendedor, B.id)

    const deB = (await pull(B)).body
    assert.ok(ids(deB.clientes).includes(c1.id))
    assert.ok(ids(deB.pedidos).includes(pendiente.id))

    const deA = (await pull(A)).body
    assert.ok(!ids(deA.clientes).includes(c1.id))
    assert.ok(ids(deA.clientes).includes(c2.id)) // el resto sigue siendo suyo
    assert.ok(deA.eliminados.some((e: any) => e.tabla === 'clientes' && e.id === c1.id))
    assert.ok(deA.eliminados.some((e: any) => e.tabla === 'pedidos' && e.id === pendiente.id))
    // el vendedor nuevo y el administrador no reciben ese retiro como borrado
    assert.ok(!deB.eliminados.some((e: any) => e.id === c1.id))
    assert.ok(!(await pull(admin)).body.eliminados.some((e: any) => e.id === c1.id))
  })

  it('el vendedor nuevo recibe también el historial ya entregado; el anterior conserva sus ventas', async () => {
    const { admin, A, B, c3, entregado } = await escenario()
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c3.id], hacia: B.id })
    const deB = (await pull(B)).body
    assert.ok(ids(deB.clientes).includes(c3.id))
    assert.ok(ids(deB.pedidos).includes(entregado.id)) // para su historial y "igual que el anterior"
    assert.equal((await db.query(`SELECT id_vendedor FROM pedidos WHERE id_pedido = $1`, [entregado.id])).rows[0].id_vendedor, A.id) // la venta sigue siendo de A

    const deA = (await pull(A)).body
    assert.ok(ids(deA.pedidos).includes(entregado.id))
    assert.ok(deA.eliminados.some((e: any) => e.tabla === 'clientes' && e.id === c3.id))
    assert.ok(!deA.eliminados.some((e: any) => e.id === entregado.id)) // lo vendido no se quita
  })

  it('con cursor el vendedor anterior se entera de lo nuevo; los recordatorios pendientes se van con el cliente', async () => {
    const { admin, A, B, c2, rec } = await escenario()
    const antes = (await pull(A)).body.cursor
    const r = await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c2.id], hacia: B.id })
    assert.equal(r.body.recordatorios, 1)
    const incremental = (await pull(A, antes)).body
    assert.ok(incremental.eliminados.some((e: any) => e.tabla === 'recordatorios' && e.id === rec.id))
    assert.ok(incremental.eliminados.some((e: any) => e.tabla === 'clientes' && e.id === c2.id))
    const despues = (await pull(A, Math.floor(incremental.ahora) + 1)).body
    assert.equal(despues.eliminados.filter((e: any) => e.id === c2.id).length, 0) // ya no se repite
    assert.ok(ids((await pull(B)).body.recordatorios).includes(rec.id))
  })

  it('pasa toda la cartera de un vendedor de una vez, y reasignar a quien ya lo tiene no hace nada', async () => {
    const { admin, A, B, c1, c2, c3 } = await escenario()
    const r = await llamar(admin, 'POST', '/clientes/reasignar', { desde: A.id, hacia: B.id })
    assert.deepEqual(r.body, { clientes: 3, pedidos: 1, recordatorios: 1 })
    for (const c of [c1, c2, c3]) assert.equal(await duenoBd(c.id), B.id)
    const deA = (await pull(A)).body
    assert.equal(deA.clientes.length, 0)
    const quitados = deA.eliminados.filter((e: any) => e.tabla === 'clientes').map((e: any) => e.id)
    for (const c of [c1, c2, c3]) assert.ok(quitados.includes(c.id))

    assert.deepEqual((await llamar(admin, 'POST', '/clientes/reasignar', { desde: A.id, hacia: B.id })).body, { clientes: 0, pedidos: 0, recordatorios: 0 })
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })).body.clientes, 0)
  })

  it('si el cliente vuelve al vendedor anterior, ya no se le pide quitarlo', async () => {
    const { admin, A, B, c1 } = await escenario()
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })
    assert.ok((await pull(A)).body.eliminados.some((e: any) => e.id === c1.id))
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: A.id })
    const deA = (await pull(A)).body
    assert.ok(ids(deA.clientes).includes(c1.id))
    assert.ok(!deA.eliminados.some((e: any) => e.id === c1.id))
    assert.ok((await pull(B)).body.eliminados.some((e: any) => e.tabla === 'clientes' && e.id === c1.id))
  })

  it('"sin vendedor" deja el cliente sólo para el administrador, y de ahí se puede asignar', async () => {
    const { admin, A, B, c1 } = await escenario()
    const r = await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: null })
    assert.equal(r.body.clientes, 1)
    assert.equal(await duenoBd(c1.id), null)
    assert.ok(!ids((await pull(A)).body.clientes).includes(c1.id))
    assert.equal((await pull(admin)).body.clientes.find((c: any) => c.id === c1.id).vendedorId, undefined)
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })
    assert.equal(await duenoBd(c1.id), B.id)
  })

  it('toda la cartera sin vendedor pasa a alguien, y el conteo de la lista lo refleja', async () => {
    await enBaseAislada(async ({ srv, usuario }) => {
      const admin = await usuario('ana', 'administrador')
      const V = await usuario('vera', 'vendedor')
      const [x, y] = [cliente(), cliente()]
      assert.equal((await push(admin, [op('clientes', x.id, x), op('clientes', y.id, y)], Date.now(), srv)).status, 200)
      assert.equal((await llamar(admin, 'GET', '/usuarios', undefined, srv)).body.clientesSinAsignar, 2)

      const r = await llamar(admin, 'POST', '/clientes/reasignar', { desde: null, hacia: V.id }, srv)
      assert.equal(r.body.clientes, 2)
      const lista = (await llamar(admin, 'GET', '/usuarios', undefined, srv)).body
      assert.equal(lista.clientesSinAsignar, 0)
      assert.equal(lista.usuarios.find((u: any) => u.id === V.id).clientes, 2)
      assert.equal((await pull(V, 0, srv)).body.clientes.length, 2)
    })
  })

  it('no admite destinos dados de baja ni inexistentes, clientes que no existen ni cuerpos mal armados', async () => {
    const { admin, c1 } = await escenario()
    const baja = await crearUsuario('vendedor', { activo: false })
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: baja.id })).status, 409)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: randomUUID() })).status, 404)
    const vivo = await crearUsuario('vendedor')
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id, randomUUID()], hacia: vivo.id })).status, 404)
    assert.notEqual(await duenoBd(c1.id), vivo.id) // nada se movió
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { hacia: vivo.id })).status, 400)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { hacia: vivo.id, clienteIds: [c1.id], desde: null })).status, 400)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [], hacia: vivo.id })).status, 400)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id] })).status, 400)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { desde: randomUUID(), hacia: vivo.id })).status, 404)
  })

  it('la cartera de un vendedor dado de baja se entrega a otro; la baja no la mueve sola', async () => {
    const { admin, A, B, c1 } = await escenario()
    await llamar(admin, 'POST', `/usuarios/${A.id}/baja`)
    assert.equal(await duenoBd(c1.id), A.id)
    assert.equal((await llamar(admin, 'POST', '/clientes/reasignar', { desde: A.id, hacia: B.id })).body.clientes, 3)
    assert.equal(await duenoBd(c1.id), B.id)
    assert.equal((await llamar(admin, 'GET', '/usuarios')).body.usuarios.find((u: any) => u.id === A.id).clientes, 0)
  })

  it('queda en la bitácora quién reasignó', async () => {
    const { admin, B, c1 } = await escenario()
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })
    const { rows } = await db.query(
      `SELECT id_usuario, datos_despues->>'id_vendedor' AS nuevo FROM auditoria WHERE tabla = 'clientes' AND id_registro = $1 AND accion = 'UPDATE' ORDER BY id_auditoria DESC LIMIT 1`,
      [c1.id],
    )
    assert.equal(rows[0].id_usuario, admin.id)
    assert.equal(rows[0].nuevo, B.id)
  })

  it('una copia vieja del administrador no deshace la reasignación', async () => {
    const { admin, A, B, c1 } = await escenario()
    const vieja = (await pull(admin)).body.clientes.find((c: any) => c.id === c1.id)
    assert.equal(vieja.vendedorId, A.id)
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })
    const r = await push(admin, [op('clientes', c1.id, { ...vieja, nombre: 'Editado por el admin', actualizado: Date.now() }, vieja.version)])
    assert.equal(r.body.resultados[0].estado, 'aplicada')
    assert.equal(r.body.resultados[0].registro.nombre, 'Editado por el admin')
    assert.equal(await duenoBd(c1.id), B.id)
  })

  it('el vendedor anterior que edita sin conexión recibe "retirado" y no puede tocar el cliente', async () => {
    const { admin, A, B, c1, pendiente } = await escenario()
    const base = (await pull(A)).body.clientes.find((c: any) => c.id === c1.id)
    await llamar(admin, 'POST', '/clientes/reasignar', { clienteIds: [c1.id], hacia: B.id })

    const r = await push(A, [
      op('clientes', c1.id, { ...base, nombre: 'Cambio tardío' }, base.version),
      op('pedidos', pendiente.id, { ...pendiente, items: [{ productoId: pendiente.items[0].productoId, litros: 9, precio_litro: 60 }] }, 1),
    ])
    assert.deepEqual(r.body.resultados.map((x: any) => x.estado), ['rechazada', 'rechazada'])
    assert.ok(r.body.resultados.every((x: any) => x.retirado === true))
    assert.ok(r.body.resultados.every((x: any) => x.registro === undefined)) // no se le filtran datos del cliente
    assert.notEqual((await db.query(`SELECT nombre FROM clientes WHERE id_cliente = $1`, [c1.id])).rows[0].nombre, 'Cambio tardío')

    // un rechazo común no marca "retirado": un cliente inválido nuevo no debe borrarse del teléfono
    const malo = await push(A, [op('clientes', randomUUID(), { ...cliente(), latitud: 999 })])
    assert.equal(malo.body.resultados[0].estado, 'rechazada')
    assert.equal(malo.body.resultados[0].retirado, undefined)
  })
})
