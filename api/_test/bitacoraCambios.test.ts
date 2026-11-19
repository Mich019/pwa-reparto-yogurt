import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { app, crearEmpresa, db, op, push, sesion } from './ayuda.js'

// Bitácora de cambios del administrador (Configuración → Bitácora): quién cambió qué, con nivel leve/moderado/alto.

after(async () => { await app.close(); await db.end() })

type S = { token: string; id: string }
async function llamar(s: S, method: 'GET' | 'PATCH', url: string, payload?: unknown) {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${s.token}` }, payload: payload as never })
  return { status: r.statusCode, body: r.body ? r.json() : null }
}
type Evento = { id: string; nivel: string; area: string; texto: string; quien: { id: string | null; nombre: string }; veces: number }
const bitacora = async (s: S, q = '') => (await llamar(s, 'GET', `/bitacora${q}`)).body as { eventos: Evento[]; siguiente: string | null }
const producto = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), sabor: 'Fresa', descripcion: '', presentacion: 1, unidad: 'L', envase: null, precio_litro: 40, costo_litro: 20, color_hex: '#f05a7e', disponible: true, ...over })

describe('bitácora de cambios', () => {
  it('cuenta quién cambió qué, con su nivel, y sólo al administrador de esa empresa', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'pc', empresa)
    const ana = await sesion('vendedor', 'tel', empresa)
    const p = producto()
    await push(admin, [op('productos', p.id, p)])
    await push(admin, [op('productos', p.id, { ...p, precio_litro: 45 }, 1)])
    assert.equal((await llamar(admin, 'PATCH', '/empresa', { codigoFiado: '4321' })).status, 200)

    const { eventos } = await bitacora(admin)
    const { rows: [{ nombre }] } = await db.query(`SELECT nombre FROM usuarios WHERE id_usuario = $1`, [admin.id])
    const [codigo, precio, alta] = eventos
    assert.deepEqual([codigo.nivel, codigo.texto], ['alto', 'Puso un código para fiar de más'])
    assert.equal(precio.nivel, 'moderado')
    assert.match(precio.texto, /precio de «Fresa» de \$40 a \$45/)
    assert.deepEqual([alta.nivel, alta.texto], ['leve', 'Agregó el producto «Fresa»'])
    // Quién: también en lo que llegó por la sincronización y en la consulta suelta de PATCH /empresa.
    for (const e of [codigo, precio, alta]) assert.deepEqual(e.quien, { id: admin.id, nombre })
    // El código nunca queda escrito en la bitácora.
    const { rows } = await db.query(`SELECT datos_despues FROM auditoria WHERE tabla = 'empresas' AND id_registro = $1`, [empresa])
    assert.ok(rows.every((r) => !JSON.stringify(r.datos_despues).includes('4321')))

    assert.deepEqual((await bitacora(admin, '?nivel=alto')).eventos.map((e) => e.texto), ['Puso un código para fiar de más'])
    assert.equal((await llamar(ana, 'GET', '/bitacora')).status, 403)
    const otra = await sesion('administrador', 'pc', await crearEmpresa())
    assert.equal((await bitacora(otra)).eventos.some((e) => e.texto.includes('Fresa')), false)
  })

  it('pasa por páginas y junta los cambios repetidos de un tirón', async () => {
    const empresa = await crearEmpresa()
    const admin = await sesion('administrador', 'pc', empresa)
    const ana = await sesion('vendedor', 'tel-1', empresa)
    const beto = await sesion('vendedor', 'tel-2', empresa)
    // 3 clientes de Ana que pasan a Beto: un solo renglón.
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const { rows: [c] } = await db.query(
        `INSERT INTO clientes (id_empresa, id_vendedor, nombre, direccion) VALUES ($1, $2, $3, 'Centro') RETURNING id_cliente`,
        [empresa, ana.id, `Tienda ${i}`],
      )
      ids.push(c.id_cliente)
    }
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.id_usuario', $1, true)`, [admin.id])
      await c.query(`UPDATE clientes SET id_vendedor = $1 WHERE id_cliente = ANY($2::uuid[])`, [beto.id, ids])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const { eventos } = await bitacora(admin)
    const grupo = eventos.find((e) => e.texto.startsWith('Pasó 3 clientes'))
    assert.ok(grupo, JSON.stringify(eventos.map((e) => e.texto)))
    assert.equal(grupo.veces, 3)
    assert.equal(grupo.nivel, 'leve')

    // 45 productos: la primera página trae 40 y dice desde dónde seguir.
    await push(admin, Array.from({ length: 45 }, (_, i) => { const p = producto({ sabor: `Sabor ${i}` }); return op('productos', p.id, p) }))
    const uno = await bitacora(admin)
    assert.equal(uno.eventos.length, 40)
    assert.ok(uno.siguiente)
    const dos = await bitacora(admin, `?antes=${uno.siguiente}`)
    const todos = [...uno.eventos, ...dos.eventos]
    assert.equal(new Set(todos.map((e) => e.id)).size, todos.length)
    assert.equal(todos.filter((e) => e.texto.startsWith('Agregó el producto «Sabor')).length, 45)
  })
})
