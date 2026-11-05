// Empresa de prueba con mucho movimiento, para probar el panel y la app con volumen: «Delisy Pruebas», con un
// administrador, 15 vendedores, ~480 clientes en CDMX, 12 productos (litros, kilos y piezas) y 4 meses de pedidos, más
// la ruta de hoy, la próxima semana, stock, producción y recordatorios. No toca ninguna otra empresa.
//   npm run db:prueba               crea la empresa (si ya existe, no hace nada)
//   npm run db:prueba -- --borrar   borra la empresa de prueba con todo lo suyo
// Todas las cuentas comparten una contraseña temporal (se muestra al final) y piden cambiarla al entrar.
import pg from 'pg'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { leerConfig } from '../api/_lib/config.js'
import { borrarEmpresa } from '../api/_lib/privacidad.js'
import { passwordTemporal } from '../api/_lib/seguridad.js'

const EMPRESA = 'Delisy Pruebas'
const DOMINIO = 'pruebas.delisy.test'
const VENDEDORES = 15
const CLIENTES = 480
const DIAS_ATRAS = 120
const DIAS_ADELANTE = 7

const config = leerConfig()
const cx = new pg.Client(config.conexion)
await cx.connect()

// El mismo borrado que la baja de una empresa (api/_lib/privacidad.ts).
const borrar = (idEmpresa: string) => borrarEmpresa(cx, idEmpresa)

try {
  await cx.query('BEGIN')
  await cx.query(`SET LOCAL statement_timeout = 0`)
  const { rows: [existe] } = await cx.query(`SELECT id_empresa FROM empresas WHERE nombre = $1`, [EMPRESA])

  if (process.argv.includes('--borrar')) {
    if (!existe) console.log(`No hay empresa «${EMPRESA}».`)
    else {
      await borrar(existe.id_empresa)
      console.log(`Empresa «${EMPRESA}» borrada con todo lo suyo.`)
    }
    await cx.query('COMMIT')
    process.exit()
  }
  if (existe) {
    console.log(`Ya existe «${EMPRESA}». Para empezar de cero: npm run db:prueba -- --borrar`)
    await cx.query('ROLLBACK')
    process.exit()
  }

  const { rows: [{ id_empresa: e }] } = await cx.query(
    `INSERT INTO empresas (nombre, exenta) VALUES ($1, true) RETURNING id_empresa`, [EMPRESA])
  await cx.query(`SELECT set_config('app.id_empresa', $1, true), set_config('app.permitir_correccion', 'on', true)`, [e])
  const hoy = `(now() AT TIME ZONE 'America/Mexico_City')::date`

  // Cuentas
  const temporal = passwordTemporal()
  const hash = await hashPassword(config, temporal)
  await cx.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password, telefono)
     VALUES ('Admin Pruebas', $1, $2, 'administrador', true, '5550000000')`, [`admin@${DOMINIO}`, hash])
  await cx.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password, telefono, activo)
     SELECT (ARRAY['Luis','Ana','Pedro','Carmen','Jorge','Rosa','Miguel','Sofía','Raúl','Elena','Toño','Lupita','Beto','Mónica','Iván','Paty','Hugo','Diana'])[1 + (g - 1) % 18]
            || ' ' || (ARRAY['García','Hernández','López','Martínez','Pérez','Sánchez','Ramírez','Torres','Flores','Rivera','Gómez','Díaz'])[1 + (g * 7) % 12],
            'vendedor' || lpad(g::text, 2, '0') || '@' || $1::text, $2::text, 'vendedor', true,
            '55' || lpad((10000000 + g * 7919)::text, 8, '0'), g <> $3
       FROM generate_series(1, $3::int) g`, [DOMINIO, hash, VENDEDORES])

  // Catálogo: yogurt por litro en frasco y garrafón, queso y crema por kilo, paletas por pieza.
  await cx.query(
    `INSERT INTO productos (nombre, sabor, presentacion_litros, unidad, envase, precio_unitario, costo_produccion, color_hex) VALUES
       ('Yogurt', 'Natural',   1, 'L', 'frasco', 70, 28, '#E8E1CF'), ('Yogurt', 'Fresa',  1, 'L', 'frasco', 75, 31, '#E5546B'),
       ('Yogurt', 'Mango',     1, 'L', 'frasco', 75, 31, '#F2B233'), ('Yogurt', 'Nuez',   1, 'L', 'frasco', 85, 38, '#9A6B3F'),
       ('Yogurt', 'Durazno',   1, 'L', 'frasco', 75, 31, '#F4A26B'), ('Yogurt', 'Zarzamora', 1, 'L', 'frasco', 80, 34, '#6B2D5C'),
       ('Yogurt', 'Natural',   4, 'L', 'cubeta', 250, 105, '#D9D0B8'), ('Yogurt', 'Fresa', 4, 'L', 'cubeta', 270, 118, '#C9405A'),
       ('Queso', 'Panela',     1, 'kg', 'charola', 160, 85, '#F5F0E1'), ('Crema', 'Ácida', 0.5, 'kg', 'bolsa', 55, 24, '#FFF7E0'),
       ('Paleta', 'Fresa con yogurt', 1, 'pz', 'pieza', 18, 6, '#F28FA6'), ('Paleta', 'Mango con chile', 1, 'pz', 'pieza', 18, 6, '#F6A21A')`)
  await cx.query(`UPDATE productos SET disponible = false WHERE sabor = 'Durazno' AND id_empresa = $1`, [e])

  // Clientes repartidos entre los vendedores (unos cuantos sin vendedor y algunos dados de baja).
  await cx.query(
    `INSERT INTO clientes (id_vendedor, nombre, direccion, colonia, referencias, latitud, longitud, telefono,
                           frecuencia_tipo, dias_semana, cada_dias, ventana_horario, activo, creado_en)
     SELECT CASE WHEN g % 60 = 0 THEN NULL ELSE v.ids[1 + g % array_length(v.ids, 1)] END,
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
            g % 40 <> 0, now() - interval '130 days'
       FROM generate_series(1, $1::int) g,
            (SELECT array_agg(id_usuario ORDER BY correo) ids FROM usuarios WHERE id_empresa = $2 AND rol = 'vendedor') v`,
    [CLIENTES, e])

  // Pedidos de cada cliente en sus días; los dados de baja dejan de pedir hace un mes.
  await cx.query(
    `INSERT INTO pedidos (id_cliente, id_vendedor, fecha, creado_por, creado_en)
     SELECT c.id_cliente, c.id_vendedor, f, c.id_vendedor, f - interval '1 day'
       FROM clientes c, generate_series(${hoy} - $1::int, ${hoy} + $2::int, interval '1 day') f
      WHERE c.id_empresa = $3 AND c.id_vendedor IS NOT NULL AND (c.activo OR f < ${hoy} - 30)
        AND CASE WHEN c.frecuencia_tipo = 'dias_semana' THEN extract(dow FROM f)::smallint = ANY (c.dias_semana)
                 ELSE (f::date - (${hoy} - $1::int)) % c.cada_dias = abs(hashtext(c.id_cliente::text)) % c.cada_dias END`,
    [DIAS_ATRAS, DIAS_ADELANTE, e])

  // Detalle: de uno a tres productos por pedido (precio y costo los pone el trigger con los del catálogo).
  await cx.query(
    `INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
     SELECT p.id_pedido, pr.id_producto,
            CASE pr.unidad WHEN 'pz' THEN 4 + floor(random() * 20) WHEN 'kg' THEN 1 + floor(random() * 3) ELSE 1 + floor(random() * 5) END
       FROM pedidos p
       CROSS JOIN LATERAL (SELECT id_producto, unidad FROM productos
                            WHERE id_empresa = $1 AND (disponible OR p.fecha < ${hoy} - 20) AND p.id_pedido IS NOT NULL
                            ORDER BY random() LIMIT 1 + abs(hashtext(p.id_pedido::text)) % 3) pr
      WHERE p.id_empresa = $1`, [e])

  // Estados: lo pasado casi todo entregado; hoy, la mañana ya repartida y la tarde en curso; lo que viene, pendiente.
  await cx.query(
    `UPDATE pedidos p SET
       estado = x.estado::estado_pedido,
       metodo_pago = CASE WHEN x.estado = 'entregado' THEN (CASE WHEN x.r2 < 0.75 THEN 'efectivo' ELSE 'transferencia' END)::metodo_pago END,
       fecha_entregado_real = CASE WHEN x.estado = 'entregado'
         THEN least(now(), (p.fecha + time '09:00' + x.r2 * interval '9 hours') AT TIME ZONE 'America/Mexico_City') END,
       motivo_omision = CASE WHEN x.estado = 'omitido' THEN (ARRAY['No estaba','Cerrado','No quiso esta vez','Tenía producto todavía','No tenía dinero'])[1 + floor(x.r2 * 5)::int] END,
       urgente = x.estado = 'pendiente' AND p.fecha = ${hoy} AND x.r < 0.04
     FROM (SELECT p2.id_pedido, r, random() r2,
                  CASE WHEN p2.fecha < ${hoy} THEN CASE WHEN r < 0.86 THEN 'entregado' WHEN r < 0.94 THEN 'omitido' ELSE 'cancelado' END
                       WHEN p2.fecha = ${hoy} THEN CASE WHEN c.ventana_horario = 'manana' AND r < 0.8 THEN 'entregado'
                                                      WHEN r < 0.12 THEN 'omitido' WHEN r < 0.3 THEN 'en_camino' ELSE 'pendiente' END
                       ELSE 'pendiente' END AS estado
             FROM (SELECT *, random() r FROM pedidos WHERE id_empresa = $1) p2 JOIN clientes c USING (id_cliente)) x
    WHERE p.id_pedido = x.id_pedido`, [e])
  await cx.query(
    `UPDATE pedidos p SET orden_ruta = x.n FROM
       (SELECT p2.id_pedido, row_number() OVER (PARTITION BY p2.id_vendedor, p2.fecha ORDER BY c.ventana_horario, c.latitud) n
          FROM pedidos p2 JOIN clientes c USING (id_cliente) WHERE p2.id_empresa = $1) x
     WHERE p.id_pedido = x.id_pedido`, [e])

  // Stock de las últimas tres semanas y de hoy: lo que se llevó cada vendedor y lo que regresó.
  await cx.query(
    `INSERT INTO stock_diario (fecha, id_producto, id_vendedor, cantidad_asignada, cantidad_devuelta)
     SELECT p.fecha, d.id_producto, p.id_vendedor, ceil(sum(d.cantidad) * 1.15) + 1,
            CASE WHEN p.fecha < ${hoy} THEN ceil(sum(d.cantidad) * 1.15) + 1 - coalesce(sum(d.cantidad) FILTER (WHERE p.estado = 'entregado'), 0) ELSE 0 END
       FROM pedidos p JOIN detalle_pedido d USING (id_pedido)
      WHERE p.id_empresa = $1 AND p.fecha BETWEEN ${hoy} - 21 AND ${hoy} AND p.estado <> 'cancelado'
      GROUP BY p.fecha, d.id_producto, p.id_vendedor`, [e])
  await cx.query(
    `INSERT INTO produccion_diaria (fecha, id_producto, litros)
     SELECT fecha, id_producto, sum(cantidad_asignada) + floor(random() * 6) FROM stock_diario WHERE id_empresa = $1 GROUP BY fecha, id_producto`, [e])

  // «Recordar más tarde» pendientes.
  await cx.query(
    `INSERT INTO recordatorios (id_cliente, id_vendedor, nota, creado_en)
     SELECT id_cliente, id_vendedor, (ARRAY['Quiere probar la paleta de mango','Llamar para el pedido de la fiesta','Pidió precio de la cubeta','Pasar en la tarde'])[1 + floor(random() * 4)::int],
            now() - random() * interval '5 days'
       FROM clientes WHERE id_empresa = $1 AND activo AND id_vendedor IS NOT NULL ORDER BY random() LIMIT 40`, [e])

  const { rows: [t] } = await cx.query(
    `SELECT (SELECT count(*) FROM usuarios WHERE id_empresa = $1) usuarios, (SELECT count(*) FROM clientes WHERE id_empresa = $1) clientes,
            (SELECT count(*) FROM pedidos WHERE id_empresa = $1) pedidos, (SELECT count(*) FROM detalle_pedido WHERE id_empresa = $1) renglones,
            (SELECT count(*) FROM pedidos WHERE id_empresa = $1 AND fecha = ${hoy}) hoy`, [e])
  await cx.query('COMMIT')
  console.log(`\nEmpresa «${EMPRESA}» creada: ${t.usuarios} cuentas, ${t.clientes} clientes, ${t.pedidos} pedidos (${t.renglones} renglones), ${t.hoy} para hoy.`)
  console.log(`Administrador: admin@${DOMINIO}   Vendedores: vendedor01@${DOMINIO} … vendedor${String(VENDEDORES).padStart(2, '0')}@${DOMINIO} (el último, dado de baja)`)
  console.log(`Contraseña temporal de todas: ${temporal}   (se pide cambiarla al entrar)`)
} catch (err) {
  await cx.query('ROLLBACK').catch(() => {})
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await cx.end()
}
