-- =============================================================================
-- Reparto Yogurt · Vistas de reportes y pronóstico de producción
-- Uso:  psql -U postgres -d reparto_yogurt -f 02_vistas.sql
-- =============================================================================

SET client_encoding = 'UTF8';

BEGIN;

-- Multiempresa: las vistas corren con los permisos de quien consulta (security_invoker, PostgreSQL 15+), así respetan
-- las reglas por filas de 01_esquema.sql y cada empresa sólo ve lo suyo.

-- RF-027 / RF-029: entregas pendientes de hoy, con lo necesario para el ruteo.
CREATE VIEW v_ruta_del_dia WITH (security_invoker = true) AS
SELECT pe.id_pedido, pe.id_vendedor, pe.orden_ruta, pe.estado, pe.total,
       c.id_cliente, c.nombre, c.direccion, c.telefono, c.latitud, c.longitud, c.ventana_horario, c.referencias,
       (SELECT sum(d.cantidad * pr.presentacion_litros)
          FROM detalle_pedido d JOIN productos pr USING (id_producto)
         WHERE d.id_pedido = pe.id_pedido)::numeric(10, 2) AS litros
  FROM pedidos pe
  JOIN clientes c USING (id_cliente)
 WHERE pe.fecha = current_date
   AND pe.estado IN ('pendiente', 'en_camino')
   AND c.activo;

-- RF-043, RF-044, RF-047: ventas por día y vendedor (agrupar por semana/mes desde la API).
CREATE VIEW v_ventas_diarias WITH (security_invoker = true) AS
SELECT pe.fecha,
       pe.id_vendedor,
       u.nombre                                         AS vendedor,
       count(DISTINCT pe.id_pedido)                     AS pedidos,
       count(DISTINCT pe.id_cliente)                    AS clientes_atendidos,
       sum(d.cantidad * pr.presentacion_litros)::numeric(12, 2)        AS litros,
       sum(d.subtotal)::numeric(12, 2)                                 AS ingreso,
       sum(d.cantidad * d.costo_unitario)::numeric(12, 2)              AS costo,
       sum(d.subtotal - d.cantidad * d.costo_unitario)::numeric(12, 2) AS margen
  FROM pedidos pe
  JOIN detalle_pedido d USING (id_pedido)
  JOIN productos pr USING (id_producto)
  LEFT JOIN usuarios u ON u.id_usuario = pe.id_vendedor
 WHERE pe.estado = 'entregado'
 GROUP BY pe.fecha, pe.id_vendedor, u.nombre;

-- RF-045, RF-046: ventas y margen por sabor y día.
CREATE VIEW v_ventas_por_sabor WITH (security_invoker = true) AS
SELECT pe.fecha,
       pr.id_producto,
       pr.sabor,
       pr.color_hex,
       sum(d.cantidad * pr.presentacion_litros)::numeric(12, 2)        AS litros,
       sum(d.subtotal)::numeric(12, 2)                                 AS ingreso,
       sum(d.cantidad * d.costo_unitario)::numeric(12, 2)              AS costo,
       sum(d.subtotal - d.cantidad * d.costo_unitario)::numeric(12, 2) AS margen
  FROM pedidos pe
  JOIN detalle_pedido d USING (id_pedido)
  JOIN productos pr USING (id_producto)
 WHERE pe.estado = 'entregado'
 GROUP BY pe.fecha, pr.id_producto, pr.sabor, pr.color_hex;

-- RF-012, RF-013: perfil del cliente (litros acumulados, última visita, sabor favorito).
CREATE VIEW v_resumen_cliente WITH (security_invoker = true) AS
SELECT c.id_cliente,
       c.nombre,
       coalesce(h.litros, 0)::numeric(12, 2) AS litros_acumulados,
       coalesce(h.pedidos, 0)      AS pedidos_entregados,
       h.ultima_visita,
       (SELECT min(x.fecha) FROM pedidos x
         WHERE x.id_cliente = c.id_cliente AND x.estado IN ('pendiente', 'en_camino')) AS proxima_entrega,
       (SELECT pr.sabor
          FROM pedidos x JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
         WHERE x.id_cliente = c.id_cliente AND x.estado = 'entregado'
         GROUP BY pr.sabor
         ORDER BY sum(d.cantidad * pr.presentacion_litros) DESC, pr.sabor
         LIMIT 1) AS sabor_favorito
  FROM clientes c
  LEFT JOIN (
    SELECT x.id_cliente,
           sum(d.cantidad * pr.presentacion_litros) AS litros,
           count(DISTINCT x.id_pedido)              AS pedidos,
           max(x.fecha)                             AS ultima_visita
      FROM pedidos x JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
     WHERE x.estado = 'entregado'
     GROUP BY x.id_cliente
  ) h USING (id_cliente);

-- Producción requerida en litros por sabor para los próximos p_dias días.
--   confirmados = pedidos ya agendados (pendiente / en camino)
--   estimados   = clientes a los que les toca visita según su frecuencia y aún no
--                 tienen pedido ese día, con su promedio de sus últimas 8 entregas.
CREATE FUNCTION fn_pronostico_produccion(p_desde date DEFAULT current_date + 1, p_dias integer DEFAULT 7)
RETURNS TABLE (id_producto uuid, sabor varchar, color_hex char(7),
               litros_confirmados numeric, litros_estimados numeric, litros_totales numeric)
LANGUAGE sql STABLE AS $$
WITH rango AS (
  SELECT p_desde AS desde, p_desde + p_dias - 1 AS hasta
),
confirmado AS (
  SELECT d.id_producto, sum(d.cantidad * pr.presentacion_litros) AS litros
    FROM pedidos pe
    JOIN detalle_pedido d USING (id_pedido)
    JOIN productos pr USING (id_producto)
    CROSS JOIN rango
   WHERE pe.estado IN ('pendiente', 'en_camino')
     AND pe.fecha BETWEEN rango.desde AND rango.hasta
   GROUP BY d.id_producto
),
historial AS (
  SELECT pe.id_cliente, pe.id_pedido, pe.fecha,
         row_number() OVER (PARTITION BY pe.id_cliente ORDER BY pe.fecha DESC) AS n
    FROM pedidos pe
   WHERE pe.estado = 'entregado'
),
por_cliente AS (
  SELECT h.id_cliente, max(h.fecha) AS ultima, count(*) FILTER (WHERE h.n <= 8) AS pedidos
    FROM historial h
   GROUP BY h.id_cliente
),
promedio AS (
  SELECT h.id_cliente, d.id_producto,
         sum(d.cantidad * pr.presentacion_litros) / pc.pedidos AS litros
    FROM historial h
    JOIN por_cliente pc USING (id_cliente)
    JOIN detalle_pedido d USING (id_pedido)
    JOIN productos pr USING (id_producto)
   WHERE h.n <= 8
   GROUP BY h.id_cliente, d.id_producto, pc.pedidos
),
visitas AS (
  SELECT c.id_cliente, dia::date AS dia
    FROM clientes c
    JOIN por_cliente pc USING (id_cliente)
    CROSS JOIN rango
    CROSS JOIN generate_series(rango.desde, rango.hasta, interval '1 day') AS dia
   WHERE c.activo
     AND (   (c.frecuencia_tipo = 'dias_semana' AND extract(dow FROM dia)::smallint = ANY (c.dias_semana))
          OR (c.frecuencia_tipo = 'intervalo'   AND dia::date > pc.ultima AND (dia::date - pc.ultima) % c.cada_dias = 0))
     AND NOT EXISTS (SELECT 1 FROM pedidos x
                      WHERE x.id_cliente = c.id_cliente AND x.fecha = dia::date
                        AND x.estado IN ('pendiente', 'en_camino', 'entregado'))
),
estimado AS (
  SELECT pm.id_producto, sum(pm.litros) AS litros
    FROM visitas v JOIN promedio pm USING (id_cliente)
   GROUP BY pm.id_producto
)
SELECT pr.id_producto, pr.sabor, pr.color_hex,
       coalesce(c.litros, 0)::numeric(10, 1)              AS litros_confirmados,
       coalesce(e.litros, 0)::numeric(10, 1)              AS litros_estimados,
       ceil(coalesce(c.litros, 0) + coalesce(e.litros, 0)) AS litros_totales
  FROM productos pr
  LEFT JOIN confirmado c USING (id_producto)
  LEFT JOIN estimado e USING (id_producto)
 WHERE coalesce(c.litros, 0) + coalesce(e.litros, 0) > 0
 ORDER BY litros_totales DESC, pr.sabor;
$$;

COMMIT;
