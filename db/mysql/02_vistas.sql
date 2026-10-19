-- =============================================================================
-- Reparto Yogurt · Vistas de reportes y pronóstico de producción (MySQL 8.0)
-- Uso (desde esta carpeta):  mysql -u root -p reparto_yogurt -e "source 02_vistas.sql"
-- =============================================================================

SET NAMES utf8mb4;

-- RF-027 / RF-029: entregas pendientes de hoy, con lo necesario para el ruteo.
CREATE VIEW v_ruta_del_dia AS
SELECT pe.id_pedido, pe.id_vendedor, pe.orden_ruta, pe.estado, pe.total,
       c.id_cliente, c.nombre, c.direccion, c.telefono, c.latitud, c.longitud, c.ventana_horario, c.referencias,
       CAST((SELECT SUM(d.cantidad * pr.presentacion_litros)
               FROM detalle_pedido d JOIN productos pr ON pr.id_producto = d.id_producto
              WHERE d.id_pedido = pe.id_pedido) AS DECIMAL(10, 2)) AS litros
  FROM pedidos pe
  JOIN clientes c ON c.id_cliente = pe.id_cliente
 WHERE pe.fecha = CURRENT_DATE
   AND pe.estado IN ('pendiente', 'en_camino')
   AND c.activo;

-- RF-043, RF-044, RF-047: ventas por día y vendedor.
CREATE VIEW v_ventas_diarias AS
SELECT pe.fecha,
       pe.id_vendedor,
       u.nombre                                                              AS vendedor,
       COUNT(DISTINCT pe.id_pedido)                                          AS pedidos,
       COUNT(DISTINCT pe.id_cliente)                                         AS clientes_atendidos,
       CAST(SUM(d.cantidad * pr.presentacion_litros) AS DECIMAL(12, 2))       AS litros,
       CAST(SUM(d.subtotal) AS DECIMAL(12, 2))                                AS ingreso,
       CAST(SUM(d.cantidad * d.costo_unitario) AS DECIMAL(12, 2))             AS costo,
       CAST(SUM(d.subtotal - d.cantidad * d.costo_unitario) AS DECIMAL(12, 2)) AS margen
  FROM pedidos pe
  JOIN detalle_pedido d ON d.id_pedido = pe.id_pedido
  JOIN productos pr ON pr.id_producto = d.id_producto
  LEFT JOIN usuarios u ON u.id_usuario = pe.id_vendedor
 WHERE pe.estado = 'entregado'
 GROUP BY pe.fecha, pe.id_vendedor, u.nombre;

-- RF-045, RF-046: ventas y margen por sabor y día.
CREATE VIEW v_ventas_por_sabor AS
SELECT pe.fecha,
       pr.id_producto,
       pr.sabor,
       pr.color_hex,
       CAST(SUM(d.cantidad * pr.presentacion_litros) AS DECIMAL(12, 2))       AS litros,
       CAST(SUM(d.subtotal) AS DECIMAL(12, 2))                                AS ingreso,
       CAST(SUM(d.cantidad * d.costo_unitario) AS DECIMAL(12, 2))             AS costo,
       CAST(SUM(d.subtotal - d.cantidad * d.costo_unitario) AS DECIMAL(12, 2)) AS margen
  FROM pedidos pe
  JOIN detalle_pedido d ON d.id_pedido = pe.id_pedido
  JOIN productos pr ON pr.id_producto = d.id_producto
 WHERE pe.estado = 'entregado'
 GROUP BY pe.fecha, pr.id_producto, pr.sabor, pr.color_hex;

-- RF-012, RF-013: perfil del cliente (litros acumulados, última visita, sabor favorito).
CREATE VIEW v_resumen_cliente AS
SELECT c.id_cliente,
       c.nombre,
       CAST(COALESCE(h.litros, 0) AS DECIMAL(12, 2)) AS litros_acumulados,
       COALESCE(h.pedidos, 0)                        AS pedidos_entregados,
       h.ultima_visita,
       (SELECT MIN(x.fecha) FROM pedidos x
         WHERE x.id_cliente = c.id_cliente AND x.estado IN ('pendiente', 'en_camino')) AS proxima_entrega,
       (SELECT pr.sabor
          FROM pedidos x
          JOIN detalle_pedido d ON d.id_pedido = x.id_pedido
          JOIN productos pr ON pr.id_producto = d.id_producto
         WHERE x.id_cliente = c.id_cliente AND x.estado = 'entregado'
         GROUP BY pr.sabor
         ORDER BY SUM(d.cantidad * pr.presentacion_litros) DESC, pr.sabor
         LIMIT 1) AS sabor_favorito
  FROM clientes c
  LEFT JOIN (
    SELECT x.id_cliente,
           SUM(d.cantidad * pr.presentacion_litros) AS litros,
           COUNT(DISTINCT x.id_pedido)              AS pedidos,
           MAX(x.fecha)                             AS ultima_visita
      FROM pedidos x
      JOIN detalle_pedido d ON d.id_pedido = x.id_pedido
      JOIN productos pr ON pr.id_producto = d.id_producto
     WHERE x.estado = 'entregado'
     GROUP BY x.id_cliente
  ) h ON h.id_cliente = c.id_cliente;

-- Producción requerida en litros por sabor para los próximos p_dias días.
--   confirmados = pedidos ya agendados (pendiente / en camino)
--   estimados   = clientes a los que les toca visita según su frecuencia y aún no
--                 tienen pedido ese día, con el promedio de sus últimas 8 entregas.
-- Uso:  CALL sp_pronostico_produccion(NULL, 7);   -- NULL = a partir de mañana
DELIMITER //
CREATE PROCEDURE sp_pronostico_produccion(IN p_desde DATE, IN p_dias INT)
READS SQL DATA
BEGIN
  DECLARE v_desde DATE DEFAULT COALESCE(p_desde, CURRENT_DATE + INTERVAL 1 DAY);
  DECLARE v_hasta DATE DEFAULT v_desde + INTERVAL (COALESCE(p_dias, 7) - 1) DAY;

  WITH RECURSIVE dias AS (
    SELECT v_desde AS dia
    UNION ALL
    SELECT dia + INTERVAL 1 DAY FROM dias WHERE dia < v_hasta
  ),
  confirmado AS (
    SELECT d.id_producto, SUM(d.cantidad * pr.presentacion_litros) AS litros
      FROM pedidos pe
      JOIN detalle_pedido d ON d.id_pedido = pe.id_pedido
      JOIN productos pr ON pr.id_producto = d.id_producto
     WHERE pe.estado IN ('pendiente', 'en_camino')
       AND pe.fecha BETWEEN v_desde AND v_hasta
     GROUP BY d.id_producto
  ),
  historial AS (
    SELECT pe.id_cliente, pe.id_pedido, pe.fecha,
           ROW_NUMBER() OVER (PARTITION BY pe.id_cliente ORDER BY pe.fecha DESC) AS n
      FROM pedidos pe
     WHERE pe.estado = 'entregado'
  ),
  por_cliente AS (
    SELECT id_cliente, MAX(fecha) AS ultima, SUM(n <= 8) AS pedidos
      FROM historial
     GROUP BY id_cliente
  ),
  promedio AS (
    SELECT h.id_cliente, d.id_producto,
           SUM(d.cantidad * pr.presentacion_litros) / pc.pedidos AS litros
      FROM historial h
      JOIN por_cliente pc ON pc.id_cliente = h.id_cliente
      JOIN detalle_pedido d ON d.id_pedido = h.id_pedido
      JOIN productos pr ON pr.id_producto = d.id_producto
     WHERE h.n <= 8
     GROUP BY h.id_cliente, d.id_producto, pc.pedidos
  ),
  visitas AS (
    SELECT c.id_cliente, dias.dia
      FROM clientes c
      JOIN por_cliente pc ON pc.id_cliente = c.id_cliente
      CROSS JOIN dias
     WHERE c.activo
       AND (   (c.frecuencia_tipo = 'dias_semana'
                AND FIND_IN_SET(ELT(DAYOFWEEK(dias.dia), 'dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'), c.dias_semana) > 0)
            OR (c.frecuencia_tipo = 'intervalo'
                AND dias.dia > pc.ultima AND MOD(DATEDIFF(dias.dia, pc.ultima), c.cada_dias) = 0))
       AND NOT EXISTS (SELECT 1 FROM pedidos x
                        WHERE x.id_cliente = c.id_cliente AND x.fecha = dias.dia
                          AND x.estado IN ('pendiente', 'en_camino', 'entregado'))
  ),
  estimado AS (
    SELECT pm.id_producto, SUM(pm.litros) AS litros
      FROM visitas v JOIN promedio pm ON pm.id_cliente = v.id_cliente
     GROUP BY pm.id_producto
  )
  SELECT pr.id_producto, pr.sabor, pr.color_hex,
         CAST(COALESCE(c.litros, 0) AS DECIMAL(10, 1))               AS litros_confirmados,
         CAST(COALESCE(e.litros, 0) AS DECIMAL(10, 1))               AS litros_estimados,
         CEIL(COALESCE(c.litros, 0) + COALESCE(e.litros, 0))         AS litros_totales
    FROM productos pr
    LEFT JOIN confirmado c ON c.id_producto = pr.id_producto
    LEFT JOIN estimado e ON e.id_producto = pr.id_producto
   WHERE COALESCE(c.litros, 0) + COALESCE(e.litros, 0) > 0
   ORDER BY litros_totales DESC, pr.sabor;
END//
DELIMITER ;
