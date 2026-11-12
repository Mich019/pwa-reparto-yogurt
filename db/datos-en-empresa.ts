// Datos de prueba DENTRO de una empresa que ya existe (la tuya), para ver el panel y la app con volumen y medir las
// consultas: vendedores de prueba, clientes en CDMX y pedidos con tus productos desde el primer día del mes siguiente
// al último mes cerrado (o 60 días atrás) hasta una semana adelante, más el stock de esos vendedores y recordatorios.
// No toca tus cuentas, clientes, productos ni producción.
//   npm run db:datos -- "Nombre de la empresa"            agrega los datos (si ya hay, no hace nada)
//   npm run db:datos -- "Nombre de la empresa" --quitar   quita sólo lo de prueba (también de los teléfonos: el borrado
//                                                          queda en `eliminaciones` y viaja en la sincronización)
// Lo de prueba se reconoce así: vendedores con correo @prueba.delisy.test y clientes con `nfc_uid` «prueba:N» (por eso
// esos clientes dicen «Tarjeta vinculada»). Los vendedores no pueden entrar: su contraseña es al azar y nadie la sabe.
// Si cierras un mes con pedidos de prueba, «--quitar» ya no podrá borrarlos (la base protege los meses cerrados):
// quítalos antes de cerrar.
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { leerConfig } from '../api/_lib/config.js'

const DOMINIO = 'prueba.delisy.test'
const VENDEDORES = 8
const CLIENTES = 400
const DIAS_ADELANTE = 7

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const quitar = process.argv.includes('--quitar')
const nombre = args[0]
if (!nombre) {
  console.error('Falta el nombre de la empresa: npm run db:datos -- "Mi empresa" [--quitar]')
  process.exit(1)
}

const config = leerConfig()
const cx = new pg.Client(config.conexion)
await cx.connect()

try {
  await cx.query('BEGIN')
  await cx.query(`SET LOCAL statement_timeout = 0`)
  const { rows: empresas } = await cx.query(`SELECT id_empresa, zona_horaria FROM empresas WHERE nombre = $1 AND NOT interna`, [nombre])
  if (empresas.length !== 1) throw new Error(empresas.length ? `Hay ${empresas.length} empresas «${nombre}»: no sé cuál.` : `No hay empresa «${nombre}».`)
  const { id_empresa: e, zona_horaria: zona } = empresas[0]
  await cx.query(`SELECT set_config('app.id_empresa', $1, true), set_config('app.permitir_correccion', 'on', true)`, [e])
  const hoy = `(now() AT TIME ZONE '${(zona ?? 'America/Mexico_City').replace(/'/g, '')}')::date`
  const vendedoresPrueba = `SELECT id_usuario FROM usuarios WHERE id_empresa = $1 AND correo LIKE '%@${DOMINIO}'`
  const clientesPrueba = `SELECT id_cliente FROM clientes WHERE id_empresa = $1 AND (nfc_uid LIKE 'prueba:%' OR id_vendedor IN (${vendedoresPrueba}))`

  if (quitar) {
    const borrar = async (sql: string) => (await cx.query(sql, [e])).rowCount ?? 0
    await borrar(`DELETE FROM recordatorios WHERE id_empresa = $1 AND id_cliente IN (${clientesPrueba})`)
    for (const t of ['abonos', 'envases_recogidos', 'precios_cliente']) {
      const { rows: [hay] } = await cx.query(`SELECT to_regclass($1) IS NOT NULL AS si`, [t])
      if (hay.si) await borrar(`DELETE FROM ${t} WHERE id_empresa = $1 AND id_cliente IN (${clientesPrueba})`)
    }
    await borrar(`DELETE FROM stock_diario WHERE id_empresa = $1 AND id_vendedor IN (${vendedoresPrueba})`)
    await borrar(`DELETE FROM cortes_dia WHERE id_empresa = $1 AND id_vendedor IN (${vendedoresPrueba})`)
    await borrar(`DELETE FROM detalle_pedido WHERE id_empresa = $1 AND id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_empresa = $1 AND id_cliente IN (${clientesPrueba}))`)
    const pedidos = await borrar(`DELETE FROM pedidos WHERE id_empresa = $1 AND id_cliente IN (${clientesPrueba})`)
    const clientes = await borrar(`DELETE FROM clientes WHERE id_empresa = $1 AND id_cliente IN (${clientesPrueba})`)
    await borrar(`DELETE FROM notificaciones WHERE id_empresa = $1 AND id_usuario IN (${vendedoresPrueba})`)
    const cuentas = await borrar(`DELETE FROM usuarios WHERE id_empresa = $1 AND correo LIKE '%@${DOMINIO}'`)
    await cx.query('COMMIT')
    console.log(`Quitado de «${nombre}»: ${cuentas} vendedores, ${clientes} clientes y ${pedidos} pedidos de prueba.`)
    process.exit()
  }

  const { rows: [ya] } = await cx.query(`SELECT count(*)::int n FROM (${vendedoresPrueba}) v`, [e])
  if (ya.n) {
    console.log(`«${nombre}» ya tiene datos de prueba. Para rehacerlos: npm run db:datos -- "${nombre}" --quitar`)
    await cx.query('ROLLBACK')
    process.exit()
  }
  const { rows: [prod] } = await cx.query(`SELECT count(*)::int n FROM productos WHERE id_empresa = $1 AND disponible`, [e])
  if (!prod.n) throw new Error('La empresa no tiene productos a la venta: agrega sus sabores primero.')

  // Desde el día siguiente al último mes cerrado (la base no deja escribir en meses cerrados), a lo más 60 días atrás.
  const { rows: [{ desde }] } = await cx.query(
    `SELECT greatest(${hoy} - 60, coalesce((SELECT max(mes) + interval '1 month' FROM cierres_mes WHERE id_empresa = $1 AND estado = 'cerrado')::date, ${hoy} - 60)) AS desde`, [e])

  // Vendedores de prueba (el último, dado de baja). Contraseña al azar que nadie conoce.
  const hash = await hashPassword(config, randomBytes(24).toString('base64url'))
  await cx.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password, telefono, activo, meta_mensual)
     SELECT (ARRAY['Luis','Ana','Pedro','Carmen','Jorge','Rosa','Miguel','Sofía','Raúl','Elena'])[1 + (g - 1) % 10]
            || ' ' || (ARRAY['García','Hernández','López','Martínez','Pérez','Sánchez','Ramírez','Torres'])[1 + (g * 3) % 8] || ' (prueba)',
            'vendedor' || lpad(g::text, 2, '0') || '@' || $1::text, $2::text, 'vendedor', true,
            '55' || lpad((20000000 + g * 7919)::text, 8, '0'), g <> $3, 15000 + g * 2500
       FROM generate_series(1, $3::int) g`, [DOMINIO, hash, VENDEDORES])

  // Clientes de esos vendedores (algunos dados de baja), marcados con nfc_uid «prueba:N».
  await cx.query(
    `INSERT INTO clientes (id_vendedor, nombre, direccion, colonia, referencias, latitud, longitud, telefono,
                           frecuencia_tipo, dias_semana, cada_dias, ventana_horario, activo, creado_en, nfc_uid)
     SELECT v.ids[1 + g % array_length(v.ids, 1)],
            (ARRAY['Tienda','Abarrotes','Fonda','Café','Cocina','Miscelánea','Familia','Sra.','Don','Gimnasio','Panadería','Cremería','Taquería','Oficina','Farmacia','Papelería'])[1 + floor(random() * 16)::int]
              || ' ' || (ARRAY['Lupita','La Esquina','Martha','El Portal','Hernández','Chuy','Sofi','Carmen','Fuerza','Mary','El Güero','La Pasadita','Doña Tere','San Juan','Los Arcos','Rosita','El Sol','La Luna','Don Pepe','Las Palmas','Pérez','Ramírez','Lulú','El Buen Gusto'])[1 + floor(random() * 24)::int]
              || CASE WHEN random() < 0.3 THEN ' ' || (2 + floor(random() * 8))::int ELSE '' END,
            (ARRAY['Av. Juárez','Calle Morelos','Hidalgo','Av. Reforma','Allende','Zaragoza','Independencia','Guerrero','Insurgentes Sur','Álvaro Obregón','Tlalpan','Revolución','Patriotismo','Durango','Orizaba','Medellín'])[1 + floor(random() * 16)::int]
              || ' ' || (1 + floor(random() * 900))::int,
            (ARRAY['Centro','Roma Norte','Condesa','Juárez','Del Valle','Narvarte','Escandón','Doctores','Portales','Santa María la Ribera','Coyoacán','San Rafael'])[1 + floor(random() * 12)::int],
            CASE WHEN random() < 0.35 THEN (ARRAY['Portón negro','Junto a la farmacia','Tocar fuerte','Frente al parque','Segundo piso','Local 3','Dejar con el portero'])[1 + floor(random() * 7)::int] END,
            round((19.34 + random() * 0.15)::numeric, 6), round((-99.21 + random() * 0.15)::numeric, 6),
            '55' || lpad(floor(random() * 1e8)::bigint::text, 8, '0'),
            CASE WHEN g % 9 = 0 THEN 'intervalo' ELSE 'dias_semana' END::tipo_frecuencia,
            CASE WHEN g % 9 = 0 THEN '{}'::smallint[] ELSE
              (SELECT array_agg(d ORDER BY d)::smallint[] FROM (SELECT d FROM generate_series(1, 6) d ORDER BY random() + g * 0 LIMIT 1 + g % 3) x) END,
            CASE WHEN g % 9 = 0 THEN (ARRAY[3, 5, 7, 10, 14])[1 + g % 5] END,
            CASE WHEN random() < 0.6 THEN 'manana' ELSE 'tarde' END::ventana_horario,
            g % 40 <> 0, $3::date - interval '10 days', 'prueba:' || g
       FROM generate_series(1, $1::int) g,
            (SELECT array_agg(id_usuario ORDER BY correo) ids FROM usuarios WHERE id_empresa = $2 AND correo LIKE '%@${DOMINIO}') v`,
    [CLIENTES, e, desde])

  // Pedidos en los días de cada cliente; los dados de baja dejaron de pedir hace dos semanas.
  await cx.query(
    `INSERT INTO pedidos (id_cliente, id_vendedor, fecha, creado_por, creado_en)
     SELECT c.id_cliente, c.id_vendedor, f, c.id_vendedor, f - interval '1 day'
       FROM clientes c, generate_series($1::date, ${hoy} + $2::int, interval '1 day') f
      WHERE c.id_empresa = $3 AND c.nfc_uid LIKE 'prueba:%' AND (c.activo OR f < ${hoy} - 14)
        AND CASE WHEN c.frecuencia_tipo = 'dias_semana' THEN extract(dow FROM f)::smallint = ANY (c.dias_semana)
                 ELSE (f::date - $1::date) % c.cada_dias = abs(hashtext(c.id_cliente::text)) % c.cada_dias END`,
    [desde, DIAS_ADELANTE, e])
  const dePrueba = `p.id_empresa = $1 AND p.id_cliente IN (SELECT id_cliente FROM clientes WHERE id_empresa = $1 AND nfc_uid LIKE 'prueba:%')`

  // De uno a tres de tus productos por pedido (precio y costo los pone el trigger con los del catálogo).
  await cx.query(
    `INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
     SELECT p.id_pedido, pr.id_producto,
            CASE pr.unidad WHEN 'pz' THEN 4 + floor(random() * 20) WHEN 'kg' THEN 1 + floor(random() * 3) ELSE 1 + floor(random() * 5) END
       FROM pedidos p
       CROSS JOIN LATERAL (SELECT id_producto, unidad FROM productos
                            WHERE id_empresa = $1 AND disponible AND p.id_pedido IS NOT NULL
                            ORDER BY random() LIMIT 1 + abs(hashtext(p.id_pedido::text)) % 3) pr
      WHERE ${dePrueba}`, [e])

  // Estados: lo pasado casi todo entregado (efectivo, transferencia y algo de fiado); hoy, la mañana repartida; lo que
  // viene, pendiente.
  await cx.query(
    `UPDATE pedidos p SET
       estado = x.estado::estado_pedido,
       metodo_pago = CASE WHEN x.estado = 'entregado' THEN (CASE WHEN x.r2 < 0.65 THEN 'efectivo' WHEN x.r2 < 0.9 THEN 'transferencia' ELSE 'credito' END)::metodo_pago END,
       fecha_entregado_real = CASE WHEN x.estado = 'entregado'
         THEN least(now(), (p.fecha + time '09:00' + x.r2 * interval '9 hours') AT TIME ZONE 'America/Mexico_City') END,
       motivo_omision = CASE WHEN x.estado = 'omitido' THEN (ARRAY['No estaba','Cerrado','No quiso esta vez','Tenía producto todavía','No tenía dinero'])[1 + floor(x.r2 * 5)::int] END,
       urgente = x.estado = 'pendiente' AND p.fecha = ${hoy} AND x.r < 0.04
     FROM (SELECT p2.id_pedido, r, random() r2,
                  CASE WHEN p2.fecha < ${hoy} THEN CASE WHEN r < 0.86 THEN 'entregado' WHEN r < 0.94 THEN 'omitido' ELSE 'cancelado' END
                       WHEN p2.fecha = ${hoy} THEN CASE WHEN c.ventana_horario = 'manana' AND r < 0.8 THEN 'entregado'
                                                      WHEN r < 0.12 THEN 'omitido' WHEN r < 0.3 THEN 'en_camino' ELSE 'pendiente' END
                       ELSE 'pendiente' END AS estado
             FROM (SELECT *, random() r FROM pedidos p WHERE ${dePrueba}) p2 JOIN clientes c USING (id_cliente)) x
    WHERE p.id_pedido = x.id_pedido`, [e])
  await cx.query(
    `UPDATE pedidos p SET orden_ruta = x.n FROM
       (SELECT p2.id_pedido, row_number() OVER (PARTITION BY p2.id_vendedor, p2.fecha ORDER BY c.ventana_horario, c.latitud) n
          FROM pedidos p2 JOIN clientes c USING (id_cliente) WHERE p2.id_empresa = $1 AND c.nfc_uid LIKE 'prueba:%') x
     WHERE p.id_pedido = x.id_pedido`, [e])

  // Stock de los vendedores de prueba en las últimas dos semanas y hoy (la producción de la empresa no se toca).
  await cx.query(
    `INSERT INTO stock_diario (fecha, id_producto, id_vendedor, cantidad_asignada, cantidad_devuelta)
     SELECT p.fecha, d.id_producto, p.id_vendedor, ceil(sum(d.cantidad) * 1.15) + 1,
            CASE WHEN p.fecha < ${hoy} THEN ceil(sum(d.cantidad) * 1.15) + 1 - coalesce(sum(d.cantidad) FILTER (WHERE p.estado = 'entregado'), 0) ELSE 0 END
       FROM pedidos p JOIN detalle_pedido d USING (id_pedido)
      WHERE ${dePrueba} AND p.fecha BETWEEN greatest($2::date, ${hoy} - 14) AND ${hoy} AND p.estado <> 'cancelado'
      GROUP BY p.fecha, d.id_producto, p.id_vendedor`, [e, desde])

  await cx.query(
    `INSERT INTO recordatorios (id_cliente, id_vendedor, nota, creado_en)
     SELECT id_cliente, id_vendedor, (ARRAY['Quiere probar otro sabor','Llamar para el pedido de la fiesta','Pidió precio por mayoreo','Pasar en la tarde'])[1 + floor(random() * 4)::int],
            now() - random() * interval '5 days'
       FROM clientes WHERE id_empresa = $1 AND nfc_uid LIKE 'prueba:%' AND activo ORDER BY random() LIMIT 30`, [e])

  const { rows: [t] } = await cx.query(
    `SELECT (SELECT count(*) FROM clientes WHERE id_empresa = $1 AND nfc_uid LIKE 'prueba:%') clientes,
            (SELECT count(*) FROM pedidos p WHERE ${dePrueba}) pedidos,
            (SELECT count(*) FROM pedidos p WHERE ${dePrueba} AND p.fecha = ${hoy}) hoy`, [e])
  await cx.query('COMMIT')
  console.log(`\nAgregado a «${nombre}» desde ${new Date(desde).toISOString().slice(0, 10)}: ${VENDEDORES} vendedores, ${t.clientes} clientes y ${t.pedidos} pedidos de prueba (${t.hoy} para hoy).`)
  console.log(`Para quitarlos: npm run db:datos -- "${nombre}" --quitar`)
} catch (err) {
  await cx.query('ROLLBACK').catch(() => {})
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await cx.end()
}
