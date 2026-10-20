import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { app, borrarOp, cliente, db, get, op, otroTelefono, pedido, pull, push, sabores, sesion } from './ayuda.ts'

after(async () => { await app.close(); await db.end() })

const estados = (r: any) => r.body.resultados.map((x: any) => x.estado)

describe('sincronización (RF-052)', () => {
  it('sube cliente, pedido y recordatorio creados sin conexión y los baja en otro teléfono', async () => {
    const admin = await sesion('administrador', 'tel-admin')
    const [fresa] = await sabores(admin)
    const c = cliente()
    const p = pedido(c.id, fresa.id)
    const rec = { id: randomUUID(), clienteId: c.id, creado: Date.now(), hecho: false }
    const r = await push(admin, [op('clientes', c.id, c), op('pedidos', p.id, p), op('recordatorios', rec.id, rec)])
    assert.deepEqual(estados(r), ['aplicada', 'aplicada', 'aplicada'])

    const pedidoGuardado = r.body.resultados[1].registro
    assert.equal(pedidoGuardado.total, 180) // 3 L × $60, calculado por el servidor
    assert.equal(pedidoGuardado.version >= 1, true)

    const otro = await sesion('administrador', 'tel-2')
    const bajada = await pull(otro)
    assert.ok(bajada.body.clientes.some((x: any) => x.id === c.id && x.nombre === 'Doña Lupita' && x.frecuencia.tipo === 'semana'))
    assert.ok(bajada.body.pedidos.some((x: any) => x.id === p.id && x.items[0].litros === 3 && x.estado === 'PENDIENTE'))
    assert.ok(bajada.body.recordatorios.some((x: any) => x.id === rec.id && x.hecho === false))
  })

  it('reenviar una operación no la aplica dos veces (RF-053)', async () => {
    const admin = await sesion('administrador')
    const c = cliente()
    const o = op('clientes', c.id, c)
    const a = await push(admin, [o])
    const b = await push(admin, [o])
    assert.equal(a.body.resultados[0].estado, 'aplicada')
    assert.equal(b.body.resultados[0].estado, 'aplicada')
    assert.equal(b.body.resultados[0].registro.version, a.body.resultados[0].registro.version)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM operaciones_sync WHERE id_operacion = $1`, [o.id])
    assert.equal(rows[0].n, 1)
  })

  it('una edición sobre la versión vigente se aplica y sube la versión', async () => {
    const admin = await sesion('administrador')
    const c = cliente()
    const a = await push(admin, [op('clientes', c.id, c)])
    const v1 = a.body.resultados[0].registro.version
    const b = await push(admin, [op('clientes', c.id, { ...c, nombre: 'Lupita B', actualizado: Date.now() }, v1)])
    assert.equal(b.body.resultados[0].estado, 'aplicada')
    assert.equal(b.body.resultados[0].registro.nombre, 'Lupita B')
    assert.ok(b.body.resultados[0].registro.version > v1)
  })

  it('pull con cursor trae sólo lo nuevo y los borrados', async () => {
    const admin = await sesion('administrador')
    const c = cliente()
    await push(admin, [op('clientes', c.id, c)])
    const primera = await pull(admin)
    assert.ok(primera.body.clientes.some((x: any) => x.id === c.id))
    const vacia = await pull(admin, Math.floor(primera.body.ahora) + 1000)
    assert.equal(vacia.body.clientes.length, 0)
    await push(admin, [borrarOp('clientes', c.id, 1)])
    const conBorrado = await pull(admin, primera.body.cursor)
    assert.ok(conBorrado.body.eliminados.some((x: any) => x.tabla === 'clientes' && x.id === c.id))
  })

  it('los datos inválidos se rechazan sin romper el resto del lote', async () => {
    const admin = await sesion('administrador')
    const c = cliente()
    const malo = cliente({ latitud: 999 })
    const r = await push(admin, [op('clientes', malo.id, malo), op('clientes', c.id, c)])
    assert.deepEqual(estados(r), ['rechazada', 'aplicada'])
    assert.match(r.body.resultados[0].error, /inválidos/)
  })

  it('una operación de otro usuario con el mismo id no se acepta', async () => {
    const a = await sesion('administrador')
    const b = await sesion('administrador')
    const c = cliente()
    const o = op('clientes', c.id, c)
    await push(a, [o])
    const r = await push(b, [o])
    assert.equal(r.body.resultados[0].estado, 'rechazada')
  })
})

describe('roles en la sincronización (RF-005)', () => {
  it('el vendedor no ve costos y sólo recibe su cartera', async () => {
    const admin = await sesion('administrador')
    const v1 = await sesion('vendedor')
    const v2 = await sesion('vendedor')
    const mio = cliente({ nombre: 'De v1' })
    const ajeno = cliente({ nombre: 'De v2' })
    await push(v1, [op('clientes', mio.id, mio)])
    await push(v2, [op('clientes', ajeno.id, ajeno)])

    const p1 = await pull(v1)
    assert.ok(p1.body.clientes.some((x: any) => x.id === mio.id))
    assert.ok(!p1.body.clientes.some((x: any) => x.id === ajeno.id))
    assert.ok(p1.body.productos.length > 0)
    assert.ok(p1.body.productos.every((x: any) => x.costo_litro === 0))

    const pa = await pull(admin)
    assert.ok(pa.body.clientes.some((x: any) => x.id === mio.id) && pa.body.clientes.some((x: any) => x.id === ajeno.id))
    assert.ok(pa.body.productos.some((x: any) => x.costo_litro > 0))
  })

  it('el vendedor no puede cambiar sabores ni precios', async () => {
    const v = await sesion('vendedor')
    const [fresa] = await sabores(v)
    const r = await push(v, [op('productos', fresa.id, { ...fresa, precio_litro: 1, disponible: true, color_hex: '#f472b6', costo_litro: 0 }, fresa.version)])
    assert.equal(r.body.resultados[0].estado, 'rechazada')
    const despues = await sabores(v)
    assert.equal(despues.find((p) => p.id === fresa.id)!.precio_litro, fresa.precio_litro)
  })

  it('el vendedor no puede tocar clientes ni pedidos de otro vendedor', async () => {
    const v1 = await sesion('vendedor')
    const v2 = await sesion('vendedor')
    const [fresa] = await sabores(v1)
    const c = cliente()
    const a = await push(v1, [op('clientes', c.id, c)])
    const version = a.body.resultados[0].registro.version
    const robo = await push(v2, [op('clientes', c.id, { ...c, nombre: 'Robado' }, version)])
    assert.equal(robo.body.resultados[0].estado, 'rechazada')
    assert.equal(robo.body.resultados[0].registro, undefined) // ni siquiera filtra el registro ajeno
    const p = pedido(c.id, fresa.id)
    const r = await push(v2, [op('pedidos', p.id, p)])
    assert.equal(r.body.resultados[0].estado, 'rechazada')
  })

  it('el vendedor no puede borrar clientes; el administrador sí', async () => {
    const v = await sesion('vendedor')
    const admin = await sesion('administrador')
    const c = cliente()
    const a = await push(v, [op('clientes', c.id, c)])
    const version = a.body.resultados[0].registro.version
    assert.equal((await push(v, [borrarOp('clientes', c.id, version)])).body.resultados[0].estado, 'rechazada')
    assert.equal((await push(admin, [borrarOp('clientes', c.id, version)])).body.resultados[0].estado, 'aplicada')
  })
})

describe('entregas y pedidos cerrados', () => {
  it('entregar un pedido nuevo en un solo envío deja venta, método de pago y total', async () => {
    const v = await sesion('vendedor')
    const [fresa, natural] = await sabores(v)
    const c = cliente()
    const p = pedido(c.id, fresa.id, { estado: 'ENTREGADO', metodo_pago: 'TRANSFERENCIA', fecha_entregado_real: Date.now(),
      items: [{ productoId: fresa.id, litros: 2, precio_litro: 60 }, { productoId: natural.id, litros: 1.5, precio_litro: 55 }] })
    const r = await push(v, [op('clientes', c.id, c), op('pedidos', p.id, p)])
    assert.deepEqual(estados(r), ['aplicada', 'aplicada'])
    const g = r.body.resultados[1].registro
    assert.equal(g.estado, 'ENTREGADO')
    assert.equal(g.metodo_pago, 'TRANSFERENCIA')
    assert.equal(g.total, 202.5)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM detalle_pedido WHERE id_pedido = $1 AND costo_unitario > 0`, [p.id])
    assert.equal(rows[0].n, 2) // el costo queda congelado para el margen
  })

  it('un pedido entregado no se puede editar desde el teléfono, pero un administrador sí lo corrige', async () => {
    const v = await sesion('vendedor')
    const admin = await sesion('administrador')
    const [fresa] = await sabores(v)
    const c = cliente()
    const p = pedido(c.id, fresa.id, { estado: 'ENTREGADO', fecha_entregado_real: Date.now() })
    const a = await push(v, [op('clientes', c.id, c), op('pedidos', p.id, p)])
    const version = a.body.resultados[1].registro.version
    const cambio = { ...p, items: [{ productoId: fresa.id, litros: 10, precio_litro: 60 }] }
    const r = await push(v, [op('pedidos', p.id, cambio, version)])
    assert.equal(r.body.resultados[0].estado, 'rechazada')
    assert.equal(r.body.resultados[0].registro.items[0].litros, 3)

    const corr = await push(admin, [op('pedidos', p.id, cambio, version)])
    assert.equal(corr.body.resultados[0].estado, 'aplicada')
    assert.equal(corr.body.resultados[0].registro.total, 600)
  })
})

describe('conflictos entre dispositivos (RF-053)', () => {
  async function base() {
    const admin = await sesion('administrador', 'tel-A')
    const otro = await otroTelefono(admin, 'tel-B')
    const c = cliente({ nombre: 'Original' })
    const a = await push(admin, [op('clientes', c.id, c)])
    return { admin, otro, c, v1: a.body.resultados[0].registro.version as number }
  }

  it('gana el cambio más reciente según la hora en que se hizo, no según cuándo llegó', async () => {
    const { admin, otro, c, v1 } = await base()
    const ahora = Date.now()
    // B editó primero (hace 5 s) pero sincroniza después de A, que editó más tarde (hace 1 s).
    const a = await push(admin, [op('clientes', c.id, { ...c, nombre: 'Edición de A' }, v1, ahora - 1000)], ahora)
    assert.equal(a.body.resultados[0].estado, 'aplicada')
    const b = await push(otro, [op('clientes', c.id, { ...c, nombre: 'Edición de B' }, v1, ahora - 5000)], ahora)
    assert.equal(b.body.resultados[0].estado, 'conflicto')
    assert.equal(b.body.resultados[0].registro.nombre, 'Edición de A')
  })

  it('el cambio más nuevo sobre una versión vieja reemplaza al del servidor', async () => {
    const { admin, otro, c, v1 } = await base()
    const ahora = Date.now()
    await push(admin, [op('clientes', c.id, { ...c, nombre: 'Edición de A' }, v1, ahora - 5000)], ahora)
    const b = await push(otro, [op('clientes', c.id, { ...c, nombre: 'Edición de B' }, v1, ahora - 1000)], ahora)
    assert.equal(b.body.resultados[0].estado, 'aplicada')
    assert.match(b.body.resultados[0].error, /Reemplazó/)
    assert.equal(b.body.resultados[0].registro.nombre, 'Edición de B')
  })

  it('corrige el desfase del reloj del teléfono', async () => {
    const { admin, otro, c, v1 } = await base()
    const ahora = Date.now()
    await push(admin, [op('clientes', c.id, { ...c, nombre: 'Edición de A' }, v1, ahora - 60_000)], ahora) // A editó hace un minuto
    // El teléfono B va 2 horas atrasado: su reloj y sus marcas están corridos, pero editó hace medio segundo, DESPUÉS que A.
    const reloj = ahora - 2 * 3600_000
    const b = await push(otro, [op('clientes', c.id, { ...c, nombre: 'Edición de B' }, v1, reloj - 500)], reloj)
    assert.equal(b.body.resultados[0].estado, 'aplicada')
    assert.equal(b.body.resultados[0].registro.nombre, 'Edición de B')
  })

  it('un cambio propio sobre una versión que él mismo subió no es conflicto (respuesta perdida)', async () => {
    const { admin, c } = await base()
    // El teléfono A manda la edición 2 pero pierde la respuesta; luego edita otra vez con la versión vieja.
    const t = Date.now()
    await push(admin, [op('clientes', c.id, { ...c, nombre: 'Edición 2' }, 1, t - 20)], t)
    const r = await push(admin, [op('clientes', c.id, { ...c, nombre: 'Edición 3' }, 1, t - 10)], t)
    assert.equal(r.body.resultados[0].estado, 'aplicada')
    assert.equal(r.body.resultados[0].registro.nombre, 'Edición 3')
  })

  it('un pedido entregado en un teléfono gana sobre la edición vieja de otro', async () => {
    const { admin, otro, c } = await base()
    const [fresa] = await sabores(admin)
    const p = pedido(c.id, fresa.id)
    const a = await push(admin, [op('pedidos', p.id, p)])
    const v1 = a.body.resultados[0].registro.version
    const t0 = Date.now()
    const entrega = await push(admin, [op('pedidos', p.id, { ...p, estado: 'ENTREGADO', fecha_entregado_real: t0 - 5000 }, v1, t0 - 5000)], t0)
    assert.equal(entrega.body.resultados[0].estado, 'aplicada')
    // El otro teléfono, sin conexión, ajustó los litros después (marca más nueva) sobre la versión vieja.
    const edicion = await push(otro, [op('pedidos', p.id, { ...p, items: [{ productoId: fresa.id, litros: 9, precio_litro: 60 }] }, v1, t0 - 1000)], t0)
    assert.equal(edicion.body.resultados[0].estado, 'conflicto')
    assert.equal(edicion.body.resultados[0].registro.estado, 'ENTREGADO')
    assert.equal(edicion.body.resultados[0].registro.items[0].litros, 3)
  })

  it('dos teléfonos que entregan el mismo pedido no duplican la venta', async () => {
    const { admin, otro, c } = await base()
    const [fresa] = await sabores(admin)
    const p = pedido(c.id, fresa.id)
    const a = await push(admin, [op('pedidos', p.id, p)])
    const v1 = a.body.resultados[0].registro.version
    const t0 = Date.now()
    const entregado = { ...p, estado: 'ENTREGADO', metodo_pago: 'EFECTIVO', fecha_entregado_real: t0 - 3000 }
    assert.equal((await push(admin, [op('pedidos', p.id, entregado, v1, t0 - 3000)], t0)).body.resultados[0].estado, 'aplicada')
    assert.equal((await push(otro, [op('pedidos', p.id, entregado, v1, t0 - 2000)], t0)).body.resultados[0].estado, 'conflicto')
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM detalle_pedido WHERE id_pedido = $1`, [p.id])
    assert.equal(rows[0].n, 1)
  })

  it('no se borra un registro que otro dispositivo modificó', async () => {
    const { admin, otro, c, v1 } = await base()
    await push(admin, [op('clientes', c.id, { ...c, nombre: 'Editado' }, v1)])
    const r = await push(otro, [borrarOp('clientes', c.id, v1)])
    assert.equal(r.body.resultados[0].estado, 'conflicto')
    assert.equal(r.body.resultados[0].registro.nombre, 'Editado')
  })

  it('editar algo que ya se borró en el servidor es conflicto y avisa que ya no existe', async () => {
    const { admin, otro, c, v1 } = await base()
    await push(admin, [borrarOp('clientes', c.id, v1)])
    const r = await push(otro, [op('clientes', c.id, { ...c, nombre: 'Fantasma' }, v1)])
    assert.equal(r.body.resultados[0].estado, 'conflicto')
    assert.equal(r.body.resultados[0].eliminado, true)
  })

  it('todo lo no aplicado queda registrado para el administrador', async () => {
    const { admin, otro, c, v1 } = await base()
    const t0 = Date.now()
    await push(admin, [op('clientes', c.id, { ...c, nombre: 'Gana' }, v1, t0 - 1000)], t0)
    await push(otro, [op('clientes', c.id, { ...c, nombre: 'Pierde' }, v1, t0 - 5000)], t0)
    const { body } = await get(admin, '/sync/conflictos')
    const fila = body.conflictos.find((x: any) => x.id_registro === c.id)
    assert.equal(fila.estado, 'conflicto')
    assert.equal(fila.datos.nombre, 'Pierde')
  })
})
