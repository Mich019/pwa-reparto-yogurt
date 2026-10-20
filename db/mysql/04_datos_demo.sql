-- =============================================================================
-- Reparto Yogurt · Datos de prueba (SÓLO para desarrollo local)
-- 1 administrador, 1 vendedor, 10 clientes en CDMX, 4 semanas de historial,
-- la ruta de hoy y algunos pedidos de la próxima semana.
--
-- Usuarios (sin contraseña utilizable: las contraseñas se generan con el secreto del servidor, ver db/migrar.ts):
--   admin@yogurt.local     · administrador
--   vendedor@yogurt.local  · vendedor
-- Uso (desde esta carpeta):  mysql -u root -p reparto_yogurt -e "source 04_datos_demo.sql"
-- =============================================================================

SET NAMES utf8mb4;

DELIMITER //
CREATE PROCEDURE sp_cargar_demo()
BEGIN
  DECLARE v_hash   VARCHAR(255) DEFAULT '$argon2id$sin-contrasena';  -- ninguna contraseña coincide con esto
  DECLARE v_admin  CHAR(36) DEFAULT UUID();
  DECLARE v_vend   CHAR(36) DEFAULT UUID();
  DECLARE v_cli    CHAR(36);
  DECLARE v_ped    CHAR(36);
  DECLARE v_tipo   VARCHAR(20);
  DECLARE v_dias   VARCHAR(20);
  DECLARE v_cada   INT;
  DECLARE k        INT DEFAULT 1;
  DECLARE s        INT;
  DECLARE n_prod   INT;
  DECLARE dia      DATE;
  DECLARE ultima   DATE;
  DECLARE nombres  JSON DEFAULT JSON_ARRAY('Doña Lupita', 'Tienda La Esquina', 'Sra. Martha Ruiz', 'Café El Portal',
                                           'Familia Hernández', 'Don Chuy', 'Abarrotes Sofi', 'Sra. Carmen López',
                                           'Gimnasio Fuerza', 'Fonda Mary');
  DECLARE calles   JSON DEFAULT JSON_ARRAY('Av. Juárez', 'Calle Morelos', 'Hidalgo', 'Av. Reforma', 'Allende',
                                           'Zaragoza', 'Independencia', 'Guerrero');
  DECLARE colonias JSON DEFAULT JSON_ARRAY('Centro', 'Roma Norte', 'Condesa', 'Juárez');

  DO RAND(42);

  INSERT INTO usuarios (id_usuario, nombre, correo, password_hash, rol, debe_cambiar_password)
  VALUES (v_admin, 'Administrador', 'admin@yogurt.local', v_hash, 'administrador', TRUE);
  INSERT INTO usuarios (id_usuario, nombre, correo, telefono, password_hash, rol, debe_cambiar_password)
  VALUES (v_vend, 'Vendedor Demo', 'vendedor@yogurt.local', '5512345678', v_hash, 'vendedor', TRUE);

  DROP TEMPORARY TABLE IF EXISTS tmp_prod;
  CREATE TEMPORARY TABLE tmp_prod (n INT PRIMARY KEY, id CHAR(36));
  INSERT INTO tmp_prod SELECT ROW_NUMBER() OVER (ORDER BY sabor) - 1, id_producto FROM productos WHERE disponible;
  SELECT COUNT(*) INTO n_prod FROM tmp_prod;

  WHILE k <= 10 DO
    SET v_cli  = UUID();
    SET v_tipo = IF(k % 3 = 0, 'intervalo', 'dias_semana');
    SET v_dias = ELT(k % 3 + 1, '', 'mar,vie', 'mie,sab');
    SET v_cada = IF(k % 3 = 0, 7, NULL);

    INSERT INTO clientes (id_cliente, id_vendedor, nombre, direccion, colonia, telefono, latitud, longitud,
                          frecuencia_tipo, dias_semana, cada_dias, ventana_horario)
    VALUES (v_cli, v_vend,
            JSON_UNQUOTE(JSON_EXTRACT(nombres, CONCAT('$[', k - 1, ']'))),
            CONCAT(JSON_UNQUOTE(JSON_EXTRACT(calles, CONCAT('$[', FLOOR(RAND() * 8), ']'))), ' ', 100 + FLOOR(RAND() * 900)),
            JSON_UNQUOTE(JSON_EXTRACT(colonias, CONCAT('$[', k % 4, ']'))),
            CONCAT('55', 10000000 + FLOOR(RAND() * 89999999)),
            19.4326 + (RAND() - 0.5) * 0.04,
            -99.1332 + (RAND() - 0.5) * 0.04,
            v_tipo, v_dias, v_cada, IF(k % 2 = 0, 'tarde', 'manana'));

    -- Historial de las últimas 4 semanas según su frecuencia
    SET ultima = CURRENT_DATE - INTERVAL 28 DAY;
    SET dia = CURRENT_DATE - INTERVAL 27 DAY;
    WHILE dia < CURRENT_DATE DO
      IF (v_tipo = 'dias_semana' AND FIND_IN_SET(ELT(DAYOFWEEK(dia), 'dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'), v_dias) > 0)
         OR (v_tipo = 'intervalo' AND MOD(DATEDIFF(dia, ultima), v_cada) = 0) THEN
        SET v_ped = UUID();
        INSERT INTO pedidos (id_pedido, id_cliente, id_vendedor, fecha, estado, metodo_pago, fecha_entregado_real, creado_por)
        VALUES (v_ped, v_cli, v_vend, dia, 'entregado', IF(RAND() < 0.7, 'efectivo', 'transferencia'),
                TIMESTAMP(dia, '10:00:00') + INTERVAL FLOOR(RAND() * 25200) SECOND, v_vend);
        SET s = 0;
        WHILE s <= k % 2 DO
          INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
          SELECT v_ped, id, 1 + FLOOR(RAND() * 3) FROM tmp_prod WHERE n = (k + s) % n_prod;
          SET s = s + 1;
        END WHILE;
        SET ultima = dia;
      END IF;
      SET dia = dia + INTERVAL 1 DAY;
    END WHILE;

    -- Ruta de hoy: 7 clientes
    IF k <= 7 THEN
      SET v_ped = UUID();
      INSERT INTO pedidos (id_pedido, id_cliente, id_vendedor, fecha, creado_por)
      VALUES (v_ped, v_cli, v_vend, CURRENT_DATE, v_vend);
      INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
      SELECT v_ped, id, 1 + FLOOR(RAND() * 3) FROM tmp_prod WHERE n IN ((k) % n_prod, (k + 1) % n_prod);
    END IF;

    -- Pedidos ya agendados para la próxima semana: 4 clientes
    IF k % 3 = 1 THEN
      SET v_ped = UUID();
      INSERT INTO pedidos (id_pedido, id_cliente, id_vendedor, fecha, creado_por)
      VALUES (v_ped, v_cli, v_vend, CURRENT_DATE + INTERVAL (1 + k % 5) DAY, v_vend);
      INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
      SELECT v_ped, id, 2 FROM tmp_prod WHERE n = k % n_prod;
    END IF;

    SET k = k + 1;
  END WHILE;

  -- Un recordatorio pendiente
  INSERT INTO recordatorios (id_cliente, id_vendedor, nota)
  SELECT id_cliente, v_vend, 'Confirmar sabores para la próxima vuelta' FROM clientes ORDER BY nombre DESC LIMIT 1;

  -- Stock asignado hoy
  INSERT INTO stock_diario (id_producto, id_vendedor, cantidad_asignada)
  SELECT id, v_vend, 10 FROM tmp_prod;

  DROP TEMPORARY TABLE tmp_prod;
END//
DELIMITER ;

SET @app_permitir_correccion = 1;   -- permite cargar pedidos ya entregados con su detalle
CALL sp_cargar_demo();
SET @app_permitir_correccion = NULL;
DROP PROCEDURE sp_cargar_demo;
