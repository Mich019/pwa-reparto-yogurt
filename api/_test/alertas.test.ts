import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { avisosQueToca, calcularStock, pendientesTexto, textoNivel } from '../../src/lib/stock-calculo.js'

// RF-037 y RF-055 · las cuentas del stock y los avisos locales de la app (src/lib/stock-calculo.ts). Sin base de datos.

const HOY = '2026-10-20'
const FRESA = 'p-fresa'
const MANGO = 'p-mango'
const stock = (productoId: string, asignada: number, over: Record<string, unknown> = {}) => ({ fecha: HOY, productoId, asignada, devuelta: 0, ...over })
const pedido = (estado: string, litros: number, productoId = FRESA, fecha = HOY) => ({ fecha, estado, items: [{ productoId, litros }] })
const de = (filas: ReturnType<typeof calcularStock>, id: string) => filas.find((f) => f.productoId === id)!

describe('cuánto stock le queda al vendedor (RF-037)', () => {
  it('le resta a lo asignado lo que ya entregó hoy, y cuenta lo que le falta por entregar', () => {
    const filas = calcularStock(HOY, [stock(FRESA, 20)], [pedido('ENTREGADO', 6), pedido('ENTREGADO', 2.5), pedido('PENDIENTE', 4)])
    assert.deepEqual(de(filas, FRESA), { productoId: FRESA, asignada: 20, entregado: 8.5, devuelta: 0, restante: 11.5, pendiente: 4, nivel: 'ok' })
  })

  it('sólo cuenta los pedidos de hoy y de ese sabor; omitidos y por confirmar no restan ni piden', () => {
    const filas = calcularStock(HOY, [stock(FRESA, 10), stock(MANGO, 5)], [
      pedido('ENTREGADO', 3, FRESA, '2026-10-19'), // de ayer
      pedido('ENTREGADO', 2, MANGO), // otro sabor
      pedido('OMITIDO', 4), pedido('RECORDAR_MAS_TARDE', 4),
    ])
    assert.equal(de(filas, FRESA).entregado, 0)
    assert.equal(de(filas, FRESA).pendiente, 0)
    assert.equal(de(filas, MANGO).entregado, 2)
    assert.equal(de(filas, MANGO).restante, 3)
  })

  it('suma varios renglones del mismo sabor y no resta decimales mal', () => {
    const p = { fecha: HOY, estado: 'ENTREGADO', items: [{ productoId: FRESA, litros: 0.1 }, { productoId: FRESA, litros: 0.2 }] }
    assert.equal(de(calcularStock(HOY, [stock(FRESA, 1)], [p]), FRESA).restante, 0.7) // no 0.7000000000000001
  })

  it('sin carga asignada hoy no hay nada que vigilar (quien no usa el control de stock no recibe avisos)', () => {
    assert.deepEqual(calcularStock(HOY, [], [pedido('PENDIENTE', 50)]), [])
    assert.deepEqual(calcularStock(HOY, [stock(FRESA, 0)], [pedido('PENDIENTE', 50)]), [])
    assert.deepEqual(calcularStock(HOY, [stock(FRESA, 10, { fecha: '2026-10-19' })], [pedido('PENDIENTE', 5)]), []) // la carga era de ayer
  })

  it('niveles: bajo cuando queda menos de 2 L o de la quinta parte; agotado en cero; falta si no alcanza para los pedidos', () => {
    const nivel = (asignada: number, entregado: number, pendiente = 0) =>
      de(calcularStock(HOY, [stock(FRESA, asignada)], [pedido('ENTREGADO', entregado), ...(pendiente ? [pedido('PENDIENTE', pendiente)] : [])].filter((p) => p.items[0].litros > 0)), FRESA).nivel
    assert.equal(nivel(20, 10), 'ok') // quedan 10
    assert.equal(nivel(20, 15.5), 'ok') // quedan 4.5, más de la quinta parte
    assert.equal(nivel(20, 16), 'bajo') // quedan 4 = la quinta parte: el límite cuenta
    assert.equal(nivel(20, 16.5), 'bajo') // quedan 3.5
    assert.equal(nivel(5, 3.5), 'bajo') // quedan 1.5 < 2 L
    assert.equal(nivel(5, 3), 'bajo') // quedan 2 L: el límite cuenta
    assert.equal(nivel(5, 2), 'ok') // quedan 3
    assert.equal(nivel(10, 10), 'agotado')
    assert.equal(nivel(10, 12), 'agotado') // entregó más de lo que llevaba
    assert.equal(nivel(20, 10, 12), 'falta') // quedan 10 y le piden 12
    assert.equal(nivel(20, 10, 10), 'ok') // justo alcanza
    assert.equal(nivel(10, 10, 3), 'agotado') // agotado pesa más que «falta»
  })

  it('un sabor con pedidos pendientes y sin carga asignada (habiendo carga de otros) es «falta»', () => {
    const filas = calcularStock(HOY, [stock(FRESA, 10)], [pedido('PENDIENTE', 3, MANGO)])
    assert.deepEqual(de(filas, MANGO), { productoId: MANGO, asignada: 0, entregado: 0, devuelta: 0, restante: 0, pendiente: 3, nivel: 'falta' })
  })

  it('lo devuelto al cerrar el día se muestra pero no cambia lo que le quedaba', () => {
    const f = de(calcularStock(HOY, [stock(FRESA, 10, { devuelta: 4 })], [pedido('ENTREGADO', 6)]), FRESA)
    assert.equal(f.devuelta, 4)
    assert.equal(f.restante, 4)
  })
})

describe('qué avisos locales tocan (RF-055)', () => {
  const productos = [{ id: FRESA, sabor: 'Fresa' }, { id: MANGO, sabor: 'Mango' }]
  const entrada = (over: Record<string, unknown> = {}) => ({ fecha: HOY, hora: 10, horaCierre: 18, filas: [], productos, cola: [], ...over }) as Parameters<typeof avisosQueToca>[0]
  const enCola = (tabla: string, registroId: string) => ({ tabla, op: 'put', registroId })

  it('no avisa cuando todo va bien', () => {
    const filas = calcularStock(HOY, [stock(FRESA, 20)], [pedido('ENTREGADO', 4)])
    assert.deepEqual(avisosQueToca(entrada({ filas })), [])
  })

  it('avisa del sabor que está por agotarse, con un id por día, sabor y nivel (así sale una sola vez)', () => {
    const filas = calcularStock(HOY, [stock(FRESA, 10), stock(MANGO, 10)], [pedido('ENTREGADO', 9)])
    const avisos = avisosQueToca(entrada({ filas }))
    assert.equal(avisos.length, 1)
    assert.deepEqual(avisos[0], {
      id: `stock:${HOY}:${FRESA}:bajo`, tipo: 'stock_bajo', titulo: 'Queda poco Fresa', cuerpo: 'Te quedan 1 L de los 10 L que llevabas.', pestana: 'stock',
    })
    // Igual en la siguiente revisión: mismo id, la app no lo repite.
    assert.equal(avisosQueToca(entrada({ filas }))[0].id, avisos[0].id)
    // Si empeora, es otro aviso.
    const peor = calcularStock(HOY, [stock(FRESA, 10), stock(MANGO, 10)], [pedido('ENTREGADO', 10)])
    assert.equal(avisosQueToca(entrada({ filas: peor }))[0].id, `stock:${HOY}:${FRESA}:agotado`)
  })

  it('los textos dicen qué pasa en cada caso', () => {
    const t = (asignada: number, entregado: number, pendiente: number) =>
      textoNivel(de(calcularStock(HOY, [stock(FRESA, asignada)], [pedido('ENTREGADO', entregado), pedido('PENDIENTE', pendiente)]), FRESA), 'Fresa')
    assert.deepEqual(t(10, 10, 3), { titulo: 'Se agotó Fresa', cuerpo: 'Te piden 3 L de Fresa hoy y ya no te queda.' })
    assert.deepEqual(t(10, 10, 0), { titulo: 'Se agotó Fresa', cuerpo: 'Ya entregaste los 10 L que llevabas.' })
    assert.deepEqual(t(20, 10, 12), { titulo: 'No te alcanza Fresa', cuerpo: 'Te quedan 10 L y tus pedidos de hoy piden 12 L.' })
    assert.deepEqual(t(20, 17, 0), { titulo: 'Queda poco Fresa', cuerpo: 'Te quedan 3 L de los 20 L que llevabas.' })
  })

  it('avisa de lo que falta por sincronizar sólo a partir de la hora de cierre', () => {
    const cola = [enCola('pedidos', 'a'), enCola('pedidos', 'a'), enCola('pedidos', 'b'), enCola('clientes', 'c')]
    assert.deepEqual(avisosQueToca(entrada({ cola, hora: 17 })), [])
    const [aviso] = avisosQueToca(entrada({ cola, hora: 18 }))
    assert.equal(aviso.id, `sync:${HOY}`)
    assert.equal(aviso.tipo, 'sync_pendiente')
    assert.equal(aviso.pestana, 'cuenta')
    assert.match(aviso.cuerpo, /^2 pedidos y 1 cambio por sincronizar\./) // el mismo pedido editado dos veces cuenta una
    assert.deepEqual(avisosQueToca(entrada({ cola: [], hora: 22 })), []) // con todo enviado no hay aviso
    assert.equal(avisosQueToca(entrada({ cola, hora: 9, horaCierre: 8 })).length, 1) // la hora la elige cada quien
  })

  it('el texto de lo pendiente usa singular y plural', () => {
    assert.equal(pendientesTexto([enCola('pedidos', 'a')]), '1 pedido')
    assert.equal(pendientesTexto([enCola('clientes', 'a')]), '1 cambio')
    assert.equal(pendientesTexto([enCola('pedidos', 'a'), enCola('pedidos', 'b'), enCola('recordatorios', 'c'), enCola('clientes', 'd')]), '2 pedidos y 2 cambios')
  })
})
