import assert from 'node:assert/strict'
import { crc32, inflateRawSync } from 'node:zlib'
import { after, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { app, db, enBaseAislada } from './ayuda.js'

after(async () => { await app.close(); await db.end() })

type S = { token: string }
async function pedir(srv: FastifyInstance, s: S | null, url: string) {
  const r = await srv.inject({ method: 'GET', url, headers: s ? { authorization: `Bearer ${s.token}` } : {} })
  return r
}
const json = async (srv: FastifyInstance, s: S | null, url: string) => {
  const r = await pedir(srv, s, url)
  return { status: r.statusCode, body: r.json() }
}

// ---- datos de prueba: una pequeña distribuidora con ventas en dos periodos --------------------------------------

interface Linea { producto: string; litros: number; precio: number; costo: number }
async function vender(pool: pg.Pool, d: { vendedor: string | null; cliente: string; fecha: string; estado?: string; pago?: 'efectivo' | 'transferencia'; lineas: Linea[] }) {
  // El detalle se captura con el pedido pendiente; al entregarse ya no se puede tocar.
  const { rows } = await pool.query(`INSERT INTO pedidos (id_cliente, id_vendedor, fecha) VALUES ($1, $2, $3) RETURNING id_pedido`, [d.cliente, d.vendedor, d.fecha])
  for (const l of d.lineas) {
    await pool.query(`INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, costo_unitario) VALUES ($1, $2, $3, $4, $5)`, [rows[0].id_pedido, l.producto, l.litros, l.precio, l.costo])
  }
  const estado = d.estado ?? 'entregado'
  if (estado === 'entregado') {
    await pool.query(`UPDATE pedidos SET estado = 'entregado', metodo_pago = $2, fecha_entregado_real = now() WHERE id_pedido = $1`, [rows[0].id_pedido, d.pago ?? 'efectivo'])
  } else if (estado === 'omitido') {
    await pool.query(`UPDATE pedidos SET estado = 'omitido', motivo_omision = 'No estaba' WHERE id_pedido = $1`, [rows[0].id_pedido])
  } else if (estado !== 'pendiente') {
    await pool.query(`UPDATE pedidos SET estado = $2 WHERE id_pedido = $1`, [rows[0].id_pedido, estado])
  }
}

async function escenario(prueba: (x: Awaited<ReturnType<typeof preparar>> & { srv: FastifyInstance; pool: pg.Pool }) => Promise<void>) {
  await enBaseAislada(async ({ srv, pool, usuario }) => {
    await prueba({ srv, pool, ...(await preparar(pool, usuario)) })
  })
}

async function preparar(pool: pg.Pool, usuario: (n: string, r: 'administrador' | 'vendedor') => Promise<S & { id: string }>) {
  const admin = await usuario('admin', 'administrador')
  const ana = await usuario('Ana', 'vendedor')
  const beto = await usuario('Beto', 'vendedor')
  const carlos = await usuario('Carlos', 'vendedor')
  await pool.query(`UPDATE usuarios SET activo = false WHERE id_usuario = $1`, [carlos.id]) // dado de baja, con historial

  const prod = async (sabor: string, precio: number, costo: number, disponible = true) =>
    (await pool.query(`INSERT INTO productos (sabor, precio_unitario, costo_produccion, disponible) VALUES ($1, $2, $3, $4) RETURNING id_producto`, [sabor, precio, costo, disponible])).rows[0].id_producto as string
  const fresa = await prod('Fresa', 60, 25)
  const vainilla = await prod('Vainilla', 55, 20)
  const mango = await prod('Mango', 70, 0) // sin costo capturado
  await prod('Durazno', 50, 20, false) // fuera de catálogo y sin ventas: no aparece
  const nuez = await prod('Nuez', 65, 30) // en catálogo pero no se vendió

  const cli = async (nombre: string) =>
    (await pool.query(`INSERT INTO clientes (nombre, direccion) VALUES ($1, 'Calle 1') RETURNING id_cliente`, [nombre])).rows[0].id_cliente as string
  const c1 = await cli('Doña Lupita')
  const c2 = await cli('Tienda "El Sol", Centro')
  const c3 = await cli('=HYPERLINK("http://malo.example","clic")')

  const L = (producto: string, litros: number, precio: number, costo: number): Linea => ({ producto, litros, precio, costo })
  // Periodo anterior (16 al 30 de septiembre)
  await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-09-20', lineas: [L(fresa, 1, 60, 25)] })
  // Octubre (1 al 15)
  await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-10-05', pago: 'efectivo', lineas: [L(fresa, 4, 60, 25), L(vainilla, 2, 55, 20)] })
  await vender(pool, { vendedor: ana.id, cliente: c2, fecha: '2026-10-06', pago: 'transferencia', lineas: [L(fresa, 3, 60, 25)] })
  await vender(pool, { vendedor: carlos.id, cliente: c3, fecha: '2026-10-06', pago: 'efectivo', lineas: [L(mango, 2, 70, 0)] })
  await vender(pool, { vendedor: null, cliente: c2, fecha: '2026-10-08', pago: 'efectivo', lineas: [L(vainilla, 1, 55, 20)] })
  await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-10-14', pago: 'efectivo', lineas: [L(vainilla, 5, 55, 20)] })
  // Lo que no cuenta como venta
  await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-10-06', estado: 'pendiente', lineas: [L(fresa, 9, 60, 25)] })
  await vender(pool, { vendedor: ana.id, cliente: c2, fecha: '2026-10-07', estado: 'cancelado', lineas: [L(fresa, 9, 60, 25)] })
  await vender(pool, { vendedor: ana.id, cliente: c3, fecha: '2026-10-07', estado: 'omitido', lineas: [L(fresa, 9, 60, 25)] })
  await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-10-16', lineas: [L(fresa, 9, 60, 25)] }) // después del rango
  // El costo del sabor sube después de vender: lo ya vendido conserva el costo de ese día.
  await pool.query(`UPDATE productos SET costo_produccion = 99 WHERE id_producto = $1`, [fresa])
  return { admin, ana, beto, carlos, fresa, vainilla, mango, nuez, c1, c2, c3 }
}

const OCTUBRE = 'desde=2026-10-01&hasta=2026-10-15'

describe('reportes de ventas (RF-043 a RF-047)', () => {
  it('resume el periodo: recaudado, litros, clientes, utilidad y forma de pago', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.equal(r.status, 200)
      assert.deepEqual(r.body.resumen, {
        ingreso: 1000, costo: 335, utilidad: 665, margenPct: 66.5, litros: 17, porUnidad: { L: 17 }, pedidos: 5, clientes: 3, ticketPromedio: 200, efectivo: 820, transferencia: 180,
      })
      assert.deepEqual(r.body.unidades, ['L'])
      // El corte de un solo día
      const dia = await json(srv, admin, '/reportes/ventas?desde=2026-10-06&hasta=2026-10-06')
      assert.equal(dia.body.resumen.ingreso, 320)
      assert.equal(dia.body.resumen.pedidos, 2)
      assert.equal(dia.body.resumen.clientes, 2)
      assert.equal(dia.body.periodos.length, 1)
    })
  })

  it('compara con el periodo anterior de la misma duración; sin ventas antes, no hay comparación', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.equal(r.body.anterior.desde, '2026-09-16')
      assert.equal(r.body.anterior.hasta, '2026-09-30')
      assert.equal(r.body.anterior.resumen.ingreso, 60)
      const sin = await json(srv, admin, '/reportes/ventas?desde=2026-08-01&hasta=2026-08-31')
      assert.equal(sin.body.anterior, null)
      assert.equal(sin.body.resumen.ingreso, 0)
      assert.equal(sin.body.resumen.margenPct, null)
      assert.equal(sin.body.resumen.ticketPromedio, null)
    })
  })

  it('puede compararse con otro periodo, por ejemplo el mes anterior completo', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await json(srv, admin, `/reportes/ventas?${OCTUBRE}&compararDesde=2026-09-01&compararHasta=2026-09-30`)
      assert.deepEqual([r.body.anterior.desde, r.body.anterior.hasta, r.body.anterior.resumen.ingreso], ['2026-09-01', '2026-09-30', 60])
      for (const mal of ['compararDesde=2026-09-01', 'compararDesde=2026-09-30&compararHasta=2026-09-01', 'compararDesde=2026-09-01&compararHasta=2026-10-01']) {
        assert.equal((await json(srv, admin, `/reportes/ventas?${OCTUBRE}&${mal}`)).status, 400, mal)
      }
    })
  })

  it('agrupa por día rellenando los días sin ventas', async () => {
    await escenario(async ({ srv, admin }) => {
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}&agrupar=dia`)
      assert.equal(body.periodos.length, 15)
      const por = Object.fromEntries(body.periodos.map((p: any) => [p.periodo, p]))
      assert.equal(por['2026-10-05'].ingreso, 350)
      assert.equal(por['2026-10-05'].litros, 6)
      assert.equal(por['2026-10-06'].ingreso, 320)
      assert.equal(por['2026-10-07'].ingreso, 0)
      assert.equal(por['2026-10-07'].inicio, '2026-10-07')
      assert.equal(por['2026-10-07'].fin, '2026-10-07')
      assert.equal(body.periodos.reduce((s: number, p: any) => s + p.ingreso, 0), 1000)
    })
  })

  it('agrupa por semana (de lunes a domingo) recortando las puntas al rango pedido', async () => {
    await escenario(async ({ srv, admin }) => {
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}&agrupar=semana`)
      assert.deepEqual(
        body.periodos.map((p: any) => [p.periodo, p.inicio, p.fin, p.ingreso, p.litros]),
        [
          ['2026-09-28', '2026-10-01', '2026-10-04', 0, 0],
          ['2026-10-05', '2026-10-05', '2026-10-11', 725, 12],
          ['2026-10-12', '2026-10-12', '2026-10-15', 275, 5],
        ],
      )
    })
  })

  it('agrupa por mes, también cuando el rango cruza de un mes a otro', async () => {
    await escenario(async ({ srv, admin }) => {
      const { body } = await json(srv, admin, '/reportes/ventas?desde=2026-09-16&hasta=2026-10-15&agrupar=mes')
      assert.deepEqual(
        body.periodos.map((p: any) => [p.periodo, p.inicio, p.fin, p.ingreso]),
        [
          ['2026-09-01', '2026-09-16', '2026-09-30', 60],
          ['2026-10-01', '2026-10-01', '2026-10-15', 1000],
        ],
      )
    })
  })

  it('calcula la utilidad por sabor con el costo de cuando se vendió, y marca lo vendido sin costo', async () => {
    await escenario(async ({ srv, admin, fresa }) => {
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      const fresas = body.sabores.find((s: any) => s.sabor === 'Fresa')
      // Aunque Fresa ahora cueste 99 producirla, las 7 L vendidas costaron 25 cada una.
      assert.deepEqual([fresas.litros, fresas.ingreso, fresas.costo, fresas.utilidad, fresas.margenPct, fresas.sinCosto], [7, 420, 175, 245, 58.3, false])
      assert.equal(fresas.id, fresa)
      const mango = body.sabores.find((s: any) => s.sabor === 'Mango')
      assert.deepEqual([mango.utilidad, mango.margenPct, mango.sinCosto], [140, 100, true])
      // El total de los sabores es el de todo el periodo
      assert.equal(body.sabores.reduce((s: number, x: any) => s + x.utilidad, 0), body.resumen.utilidad)
    })
  })

  it('ordena los sabores de más a menos vendido: estrella al frente, menor rotación al final (incluye lo que no se vendió)', async () => {
    await escenario(async ({ srv, admin, vainilla, nuez }) => {
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.deepEqual(body.sabores.map((s: any) => [s.sabor, s.litros]), [['Vainilla', 8], ['Fresa', 7], ['Mango', 2], ['Nuez', 0]]) // Durazno está fuera de catálogo
      assert.equal(body.ranking.estrella, vainilla)
      assert.equal(body.ranking.menorRotacion, nuez)
      // Un periodo sin ventas: nadie es estrella
      const vacio = await json(srv, admin, '/reportes/ventas?desde=2026-08-01&hasta=2026-08-31')
      assert.equal(vacio.body.ranking.estrella, null)
    })
  })

  it('mide a cada vendedor: ventas, ingresos, utilidad, visitas sin venta; incluye al que no vendió y al dado de baja', async () => {
    await escenario(async ({ srv, admin, ana, beto, carlos }) => {
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.deepEqual(
        body.vendedores.map((v: any) => [v.nombre, v.id, v.activo, v.pedidos, v.clientes, v.litros, v.ingreso, v.utilidad, v.ticketPromedio, v.omitidos]),
        [
          ['Ana', ana.id, true, 3, 2, 14, 805, 490, 268.33, 1],
          ['Carlos', carlos.id, false, 1, 1, 2, 140, 140, 140, 0],
          ['Sin vendedor', null, false, 1, 1, 1, 55, 35, 55, 0],
          ['Beto', beto.id, true, 0, 0, 0, 0, 0, null, 0],
        ],
      )
      assert.equal(body.vendedores.reduce((s: number, v: any) => s + v.ingreso, 0), body.resumen.ingreso)
    })
  })

  it('un cliente que compra a dos vendedores cuenta una sola vez en el total del periodo', async () => {
    await escenario(async ({ srv, pool, admin, beto, c1, vainilla }) => {
      await vender(pool, { vendedor: beto.id, cliente: c1, fecha: '2026-10-09', lineas: [{ producto: vainilla, litros: 1, precio: 55, costo: 20 }] })
      const { body } = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.equal(body.resumen.clientes, 3)
      assert.equal(body.vendedores.find((v: any) => v.nombre === 'Beto').clientes, 1)
    })
  })
})

describe('permisos y validación de los reportes', () => {
  it('sólo el administrador ve reportes: un vendedor o sin sesión no pasa', async () => {
    await escenario(async ({ srv, ana }) => {
      for (const url of [`/reportes/ventas?${OCTUBRE}`, `/reportes/exportar?${OCTUBRE}`]) {
        const v = await json(srv, ana, url)
        assert.equal(v.status, 403)
        assert.equal(v.body.codigo, 'SIN_PERMISO')
        assert.equal((await json(srv, null, url)).status, 401)
      }
    })
  })

  it('rechaza periodos mal pedidos', async () => {
    await escenario(async ({ srv, admin }) => {
      const mal = [
        '/reportes/ventas',
        '/reportes/ventas?desde=2026-10-01',
        '/reportes/ventas?desde=ayer&hasta=hoy',
        '/reportes/ventas?desde=2026-10-15&hasta=2026-10-01',
        `/reportes/ventas?${OCTUBRE}&agrupar=siglo`,
        '/reportes/ventas?desde=2025-01-01&hasta=2026-10-01&agrupar=dia', // más de un año por día
        '/reportes/ventas?desde=2020-01-01&hasta=2026-10-01&agrupar=mes', // más de tres años
        `/reportes/exportar?${OCTUBRE}&formato=pdf`,
      ]
      for (const url of mal) assert.equal((await json(srv, admin, url)).status, 400, url)
      // Más de un año sí se puede por semana o por mes
      assert.equal((await json(srv, admin, '/reportes/ventas?desde=2025-01-01&hasta=2026-10-01&agrupar=mes')).status, 200)
    })
  })
})

// ---- archivos ------------------------------------------------------------------------------------------------

// Lee un .xlsx sin librerías: directorio central del zip → cada archivo, con su CRC comprobado.
function leerZip(buf: Buffer) {
  const fin = buf.length - 22
  assert.equal(buf.readUInt32LE(fin), 0x06054b50, 'el zip termina con su registro final')
  const n = buf.readUInt16LE(fin + 10)
  let p = buf.readUInt32LE(fin + 16)
  const archivos: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50)
    const crc = buf.readUInt32LE(p + 16)
    const comprimido = buf.readUInt32LE(p + 20)
    const tam = buf.readUInt32LE(p + 24)
    const largoNombre = buf.readUInt16LE(p + 28)
    const local = buf.readUInt32LE(p + 42)
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre)
    assert.equal(buf.readUInt32LE(local), 0x04034b50)
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const datos = inflateRawSync(buf.subarray(inicio, inicio + comprimido))
    assert.equal(datos.length, tam)
    assert.equal(crc32(datos), crc, `CRC de ${nombre}`)
    archivos[nombre] = datos.toString('utf8')
    p += 46 + largoNombre + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return archivos
}

describe('exportar reportes a Excel y CSV (RF-048)', () => {
  it('el CSV del historial lleva una fila por renglón vendido, con BOM, acentos y comillas bien escapadas', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=ventas`)
      assert.equal(r.statusCode, 200)
      assert.match(r.headers['content-type'] as string, /^text\/csv/)
      assert.equal(r.headers['content-disposition'], 'attachment; filename="reporte-ventas-2026-10-01_2026-10-15.csv"')
      assert.equal(r.headers['cache-control'], 'no-store')
      const texto = r.rawPayload.toString('utf8')
      assert.ok(texto.startsWith('﻿Fecha,Vendedor,Cliente,Sabor,Litros,Importe,Costo,Utilidad,Pago\r\n'))
      const lineas = texto.slice(1).trim().split('\r\n')
      assert.equal(lineas.length, 1 + 6) // encabezado + 6 renglones entregados del rango
      assert.equal(lineas[1], '2026-10-05,Ana,Doña Lupita,Fresa,4,240,100,140,efectivo')
      assert.ok(lineas.some((l) => l.includes('"Tienda ""El Sol"", Centro"')), 'comillas y comas dentro de un nombre se escapan')
      assert.ok(lineas.some((l) => l.includes('Sin vendedor')))
    })
  })

  it('un nombre que parece fórmula no se ejecuta al abrir el CSV en Excel', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=ventas`)
      const texto = r.rawPayload.toString('utf8')
      assert.ok(texto.includes(`"'=HYPERLINK(""http://malo.example"",""clic"")"`))
      assert.ok(!/(^|,)=HYPERLINK/m.test(texto))
    })
  })

  it('el CSV puede ser cualquiera de las tablas del reporte', async () => {
    await escenario(async ({ srv, admin }) => {
      const sab = (await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=sabores`)).rawPayload.toString('utf8').slice(1).trim().split('\r\n')
      assert.equal(sab[0], 'Lugar,Sabor,Litros,Ingresos,Costos,Utilidad,Margen (%),Nota')
      assert.equal(sab[1], '1,Vainilla,8,440,160,280,63.6,Sabor estrella')
      assert.equal(sab.at(-1), '4,Nuez,0,0,0,0,,Menor rotación')
      assert.ok(sab.some((l) => l.endsWith('Sin costo capturado')))

      const ven = (await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=vendedores`)).rawPayload.toString('utf8').slice(1).trim().split('\r\n')
      assert.equal(ven[0], 'Vendedor,Pedidos,Clientes,Litros,Ingresos,Utilidad,Ticket promedio,Visitas sin venta')
      assert.equal(ven[1], 'Ana,3,2,14,805,490,268.33,1')
      assert.ok(ven.some((l) => l.startsWith('Carlos (baja),')))

      const per = (await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=periodos&agrupar=semana`)).rawPayload.toString('utf8').slice(1).trim().split('\r\n')
      assert.equal(per.length, 1 + 3)
      assert.equal(per[2], '2026-10-05,2026-10-11,4,12,725,235,490,67.6')
    })
  })

  it('el Excel es un .xlsx válido con las cinco hojas y los números como números', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=xlsx&agrupar=semana`)
      assert.equal(r.statusCode, 200)
      assert.equal(r.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      assert.equal(r.headers['content-disposition'], 'attachment; filename="reporte-ventas-2026-10-01_2026-10-15.xlsx"')
      const z = leerZip(r.rawPayload)
      assert.deepEqual(Object.keys(z).sort(), [
        '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml',
        'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml', 'xl/worksheets/sheet5.xml',
      ])
      assert.deepEqual([...z['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), ['Resumen', 'Por periodo', 'Por sabor', 'Por vendedor', 'Ventas'])

      // Título (fila 1), periodo (fila 2), encabezados (fila 4) y datos desde la fila 5.
      // Estilos: 4 + variante × 6 + tipo (texto, fecha, entero, litros, dinero, porcentaje); variante 0 normal, 1 alterna, 2 totales.
      const resumen = z['xl/worksheets/sheet1.xml']
      assert.ok(resumen.includes('<t xml:space="preserve">Reporte de ventas · Resumen</t>'))
      assert.ok(resumen.includes('Del 01/10/2026 al 15/10/2026'))
      assert.match(resumen, /<c r="B5" s="8"><v>1000<\/v><\/c>/) // ingresos, con formato de dinero
      assert.match(resumen, /<c r="B8" s="15"><v>66.5<\/v><\/c>/) // margen, en renglón alterno
      assert.match(resumen, /<c r="B9" s="7"><v>17<\/v><\/c>/) // litros

      const ventas = z['xl/worksheets/sheet5.xml']
      assert.equal((ventas.match(/<row /g) ?? []).length, 3 + 6 + 1) // título, periodo, encabezados, 6 renglones y totales
      assert.match(ventas, /<c r="A5" s="5"><v>46300<\/v><\/c>/) // 2026-10-05 como fecha de Excel
      assert.match(ventas, /<autoFilter ref="A4:I10"\/>/) // el filtro no incluye los totales
      assert.match(ventas, /<c r="A11" s="16" t="inlineStr"><is><t xml:space="preserve">Total<\/t><\/is><\/c>/)
      assert.match(ventas, /<c r="F11" s="20"><v>1000<\/v><\/c>/) // suma de importes = ingresos del periodo
      assert.ok(z['xl/workbook.xml'].includes(`<definedName name="_xlnm.Print_Titles" localSheetId="4">'Ventas'!$4:$4</definedName>`))
      // El nombre con forma de fórmula queda como texto, nunca como <f>
      assert.ok(ventas.includes('=HYPERLINK(&quot;http://malo.example&quot;,&quot;clic&quot;)'))
      assert.ok(!ventas.includes('<f>'))
    })
  })

  it('el Excel de un periodo sin ventas se abre igual, con las hojas vacías', async () => {
    await escenario(async ({ srv, admin }) => {
      const r = await pedir(srv, admin, '/reportes/exportar?desde=2026-08-01&hasta=2026-08-03&formato=xlsx')
      assert.equal(r.statusCode, 200)
      const z = leerZip(r.rawPayload)
      assert.equal((z['xl/worksheets/sheet5.xml'].match(/<row /g) ?? []).length, 3) // título, periodo y encabezados; sin totales
      assert.ok(!z['xl/worksheets/sheet5.xml'].includes('autoFilter'))
    })
  })
})

describe('libreta de clientes', () => {
  it('sólo el administrador la descarga', async () => {
    await escenario(async ({ srv, ana }) => {
      assert.equal((await json(srv, ana, '/reportes/clientes')).status, 403)
      assert.equal((await json(srv, null, '/reportes/clientes')).status, 401)
      assert.equal((await json(srv, ana, '/reportes/clientes?formato=xlsx')).status, 403)
    })
  })

  it('lista la cartera activa con contacto, días de visita y lo que ha comprado cada cliente', async () => {
    await escenario(async ({ srv, pool, admin, ana, c2, c3 }) => {
      await pool.query(`UPDATE clientes SET dias_semana = '{5,1}', ventana_horario = 'tarde', id_vendedor = $2 WHERE id_cliente = $1`, [c2, ana.id])
      await pool.query(`UPDATE clientes SET frecuencia_tipo = 'intervalo', cada_dias = 7 WHERE id_cliente = $1`, [c3])
      await pool.query(`INSERT INTO clientes (nombre, direccion, activo) VALUES ('Archivado', 'Calle 2', false)`)
      const { status, body } = await json(srv, admin, '/reportes/clientes')
      assert.equal(status, 200)
      assert.deepEqual(body.clientes.map((c: any) => c.nombre).sort(), ['=HYPERLINK("http://malo.example","clic")', 'Doña Lupita', 'Tienda "El Sol", Centro'])
      assert.equal(body.clientes[0].vendedor, 'Ana') // primero los que tienen vendedor; «Sin vendedor» al final

      const lupita = body.clientes.find((c: any) => c.nombre === 'Doña Lupita')
      assert.equal(lupita.vendedor, 'Sin vendedor')
      assert.equal(lupita.visita, 'Sin días fijos')
      assert.equal(lupita.horario, 'Mañana')
      // Cuentan sólo los pedidos entregados, de cualquier fecha
      assert.equal(lupita.pedidos, 4)
      assert.equal(lupita.litros, 21)
      assert.equal(lupita.comprado, 1225)
      assert.equal(lupita.ultimaCompra, '2026-10-16')
      assert.equal(lupita.proximaEntrega, '2026-10-06') // el pedido pendiente
      assert.equal(lupita.saborFavorito, 'Fresa')

      const sol = body.clientes.find((c: any) => c.nombre.startsWith('Tienda'))
      assert.equal(sol.visita, 'Lun, Vie') // la semana empieza en lunes
      assert.equal(sol.horario, 'Tarde')
      assert.equal(body.clientes.find((c: any) => c.nombre.startsWith('=')).visita, 'Cada 7 días')
    })
  })

  it('se exporta a Excel con una hoja y totales, y a CSV sin fórmulas', async () => {
    await escenario(async ({ srv, admin }) => {
      const x = await pedir(srv, admin, '/reportes/clientes?formato=xlsx')
      assert.equal(x.statusCode, 200)
      assert.match(x.headers['content-disposition'] as string, /^attachment; filename="libreta-clientes-\d{4}-\d{2}-\d{2}\.xlsx"$/)
      const z = leerZip(x.rawPayload)
      assert.deepEqual([...z['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), ['Directorio'])
      const hoja = z['xl/worksheets/sheet1.xml']
      assert.ok(hoja.includes('Libreta de clientes · Directorio'))
      assert.match(hoja, /<c r="A8" s="16" t="inlineStr"><is><t xml:space="preserve">3 clientes<\/t><\/is><\/c>/) // 3 clientes en filas 5 a 7 y el total
      assert.ok(!hoja.includes('<f>'))

      const csv = (await pedir(srv, admin, '/reportes/clientes?formato=csv')).rawPayload.toString('utf8')
      assert.ok(csv.startsWith('﻿Vendedor,Cliente,Teléfono,Dirección'))
      assert.ok(csv.includes(`"'=HYPERLINK(""http://malo.example"",""clic"")"`))
      assert.equal((await json(srv, admin, '/reportes/clientes?formato=pdf')).status, 400) // el PDF lo arma la app
    })
  })

  it('con productos en varias unidades no suma litros con kilos (catálogo flexible)', async () => {
    await escenario(async ({ srv, pool, admin, ana, c1 }) => {
      const { rows: [hielo] } = await pool.query(
        `INSERT INTO productos (sabor, precio_unitario, costo_produccion, presentacion_litros, unidad, envase) VALUES ('Hielo', 35, 10, 5, 'kg', 'bolsa_nylon') RETURNING id_producto`,
      )
      await vender(pool, { vendedor: ana.id, cliente: c1, fecha: '2026-10-07', lineas: [{ producto: hielo.id_producto, litros: 2, precio: 35, costo: 10 }] }) // 2 bolsas de 5 kg
      const r = await json(srv, admin, `/reportes/ventas?${OCTUBRE}`)
      assert.deepEqual(r.body.unidades, ['L', 'kg'])
      assert.deepEqual(r.body.resumen.porUnidad, { L: 17, kg: 10 })
      assert.deepEqual(r.body.periodos.find((p: { periodo: string }) => p.periodo === '2026-10-07').porUnidad.kg, 10)
      assert.deepEqual(r.body.vendedores.find((v: { id: string }) => v.id === ana.id).porUnidad.kg, 10)
      assert.equal(r.body.sabores.find((s: { sabor: string }) => s.sabor === 'Hielo').unidad, 'kg')
      // En el Excel/CSV, una columna por unidad.
      const per = (await pedir(srv, admin, `/reportes/exportar?${OCTUBRE}&formato=csv&tabla=periodos`)).rawPayload.toString('utf8')
      assert.match(per.split('\r\n')[0], /Litros.*Kilos/)
      const lib = await json(srv, admin, '/reportes/clientes')
      assert.equal(lib.body.clientes.find((c: { porUnidad: Record<string, number> }) => c.porUnidad.kg).porUnidad.kg, 10)
    })
  })
})
