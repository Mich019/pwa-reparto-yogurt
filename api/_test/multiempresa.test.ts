import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { app, borrarOp, cliente, crearEmpresa, crearUsuario, db, get, login, op, pedido, pull, push, sesion } from './ayuda.js'

// Multiempresa: cada empresa sólo ve y toca lo suyo, aunque compartan la misma base.

after(async () => { await app.close(); await db.end() })

const sabor = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, precio_litro: 60, costo_litro: 20, color_hex: '#f472b6', disponible: true, ...over,
})

describe('aislamiento entre empresas', () => {
  it('la descarga y el equipo de una empresa no traen nada de otra', async () => {
    const otra = await crearEmpresa()
    const vendA = await sesion('vendedor')
    const adminB = await sesion('administrador', 'tel-b', otra)
    const c = cliente({ nombre: `Sólo de A ${randomUUID().slice(0, 6)}` })
    assert.equal((await push(vendA, [op('clientes', c.id, c)])).body.resultados[0].estado, 'aplicada')

    const { body } = await pull(adminB)
    assert.equal(body.clientes.length, 0)
    assert.equal(body.productos.length, 0) // el catálogo inicial es de la primera empresa
    const { body: equipo } = await get(adminB, '/usuarios')
    assert.deepEqual(equipo.usuarios.map((u: { id: string }) => u.id), [adminB.id])
    // Una cuenta de otra empresa "no existe" para este administrador.
    const r = await app.inject({ method: 'PATCH', url: `/usuarios/${vendA.id}`, headers: { authorization: `Bearer ${adminB.token}` }, payload: { nombre: 'Robado' } })
    assert.equal(r.statusCode, 404)
    assert.equal((await db.query(`SELECT nombre FROM usuarios WHERE id_usuario = $1`, [vendA.id])).rows[0].nombre, 'Prueba vendedor')
  })

  it('no deja escribir sobre registros de otra empresa ni enlazarlos', async () => {
    const otra = await crearEmpresa()
    const vendA = await sesion('vendedor')
    const adminB = await sesion('administrador', 'tel-b', otra)
    const c = cliente({ nombre: 'Cliente de A' })
    await push(vendA, [op('clientes', c.id, c)])

    // Mismo id desde otra empresa: no pisa al cliente de A.
    const r1 = await push(adminB, [op('clientes', c.id, { ...c, nombre: 'Pisado por B' })])
    assert.notEqual(r1.body.resultados[0].estado, 'aplicada')
    assert.equal((await db.query(`SELECT nombre FROM clientes WHERE id_cliente = $1`, [c.id])).rows[0].nombre, 'Cliente de A')

    // Un pedido de B que apunta al cliente de A se rechaza.
    const s = sabor()
    assert.equal((await push(adminB, [op('productos', s.id, s)])).body.resultados[0].estado, 'aplicada')
    const p = pedido(c.id, s.id)
    const r2 = await push(adminB, [op('pedidos', p.id, p)])
    assert.notEqual(r2.body.resultados[0].estado, 'aplicada')
    assert.equal((await db.query(`SELECT 1 FROM pedidos WHERE id_pedido = $1`, [p.id])).rowCount, 0)
  })

  it('dos empresas pueden tener el mismo sabor', async () => {
    const adminB = await sesion('administrador', 'tel-b', await crearEmpresa())
    const { rows: [deA] } = await db.query(`SELECT sabor, presentacion_litros::float8 AS pres FROM productos LIMIT 1`)
    const s = sabor({ sabor: deA.sabor, presentacion: deA.pres })
    assert.equal((await push(adminB, [op('productos', s.id, s)])).body.resultados[0].estado, 'aplicada')
  })

  it('los borrados y la bitácora quedan en la empresa de quien los hizo', async () => {
    const otra = await crearEmpresa()
    const adminB = await sesion('administrador', 'tel-b', otra)
    const c = cliente()
    const { body } = await push(adminB, [op('clientes', c.id, c)])
    assert.equal((await push(adminB, [borrarOp('clientes', c.id, body.resultados[0].registro.version)])).body.resultados[0].estado, 'aplicada')
    const { rows: elim } = await db.query(`SELECT id_empresa FROM eliminaciones WHERE id_registro = $1`, [c.id])
    assert.deepEqual(elim, [{ id_empresa: otra }])
    const { rows: bitacora } = await db.query(`SELECT DISTINCT id_empresa FROM auditoria WHERE id_registro = $1`, [c.id])
    assert.deepEqual(bitacora, [{ id_empresa: otra }])
    // Y la otra empresa no recibe ese borrado.
    const vendA = await sesion('vendedor')
    assert.ok(!(await pull(vendA)).body.eliminados.some((e: { id: string }) => e.id === c.id))
  })
})

describe('empresa suspendida', () => {
  it('no deja entrar, ni seguir usando ni renovar la sesión', async () => {
    const otra = await crearEmpresa()
    const s = await sesion('vendedor', 'tel-b', otra)
    const u = await crearUsuario('administrador', { empresa: otra })
    await db.query(`UPDATE empresas SET activa = false WHERE id_empresa = $1`, [otra])

    const l = await login(u.correo)
    assert.equal(l.status, 403)
    assert.equal(l.body.codigo, 'EMPRESA_SUSPENDIDA')
    assert.equal((await pull(s)).status, 403)
    const r = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: s.refreshToken } })
    assert.equal(r.statusCode, 403)
    assert.equal(r.json().codigo, 'EMPRESA_SUSPENDIDA')
  })
})
