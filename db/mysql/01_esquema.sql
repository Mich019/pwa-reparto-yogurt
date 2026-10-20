-- =============================================================================
-- Reparto Yogurt · Base de datos MySQL 8.0 (8.0.16 o superior)
-- Misma estructura que la versión PostgreSQL de db/: cubre RF-001 a RF-055.
-- Compatible con MySQL administrado en la nube (AWS RDS, Azure, Google Cloud SQL).
--
-- Uso (desde esta carpeta):  mysql -u root -p reparto_yogurt -e "source 01_esquema.sql"
-- =============================================================================

SET NAMES utf8mb4;

-- Convenciones:
--   * Llaves CHAR(36) con UUID: el teléfono crea registros sin conexión.
--   * Fechas y horas DATETIME(3) en hora del centro de México: toda conexión usa
--     time_zone = '-06:00' para que CURRENT_DATE sea el día local de la ruta.
--   * actualizado_en se sella solo; version sube con un trigger en cada cambio.

-- =============================================================================
-- M01 · Autenticación y seguridad
-- =============================================================================
CREATE TABLE usuarios (
  id_usuario            CHAR(36)     NOT NULL DEFAULT (UUID()),
  nombre                VARCHAR(100) NOT NULL,
  correo                VARCHAR(150) NOT NULL,                  -- único sin importar mayúsculas (collation _ci)
  telefono              VARCHAR(20),
  password_hash         VARCHAR(255) NOT NULL,                  -- RF-004: hash Argon2id generado por la API
  rol                   ENUM('administrador', 'vendedor') NOT NULL DEFAULT 'vendedor', -- RF-005
  activo                BOOLEAN      NOT NULL DEFAULT TRUE,     -- RF-040
  debe_cambiar_password BOOLEAN      NOT NULL DEFAULT FALSE,    -- RF-039
  password_cambiado_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3), -- RF-003: los fallidos de antes ya no cuentan
  ultimo_acceso         DATETIME(3),
  creado_en             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version               INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY usuarios_correo_unico (correo),
  CONSTRAINT usuarios_correo_formato CHECK (correo REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
  CONSTRAINT usuarios_password_argon2 CHECK (password_hash LIKE '$argon2id$%')
) ENGINE = InnoDB;

-- RF-006: sesiones con refresh token; cerrar sesión = revocar.
CREATE TABLE sesiones (
  id_sesion          CHAR(36)     NOT NULL DEFAULT (UUID()),
  id_usuario         CHAR(36)     NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  dispositivo        VARCHAR(200),
  ip                 VARCHAR(45),
  creado_en          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_en          DATETIME(3)  NOT NULL,
  revocado_en        DATETIME(3),
  PRIMARY KEY (id_sesion),
  UNIQUE KEY sesiones_token_unico (refresh_token_hash),
  KEY sesiones_usuario (id_usuario, revocado_en),
  CONSTRAINT sesiones_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  CONSTRAINT sesiones_expira_despues CHECK (expira_en > creado_en)
) ENGINE = InnoDB;

-- RF-002: códigos de recuperación de contraseña (sólo el hash).
CREATE TABLE recuperaciones_password (
  id_recuperacion CHAR(36)     NOT NULL DEFAULT (UUID()),
  id_usuario      CHAR(36)     NOT NULL,
  codigo_hash     VARCHAR(255) NOT NULL,
  creado_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_en       DATETIME(3)  NOT NULL,
  usado_en        DATETIME(3),
  ip              VARCHAR(45),                                -- topes de códigos por conexión
  PRIMARY KEY (id_recuperacion),
  KEY recuperaciones_usuario (id_usuario, usado_en),
  KEY recuperaciones_ip (ip, creado_en),
  CONSTRAINT recuperaciones_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE
) ENGINE = InnoDB;

-- RF-003: registro de intentos de inicio de sesión.
CREATE TABLE intentos_login (
  id_intento BIGINT       NOT NULL AUTO_INCREMENT,
  correo     VARCHAR(150) NOT NULL,
  id_usuario CHAR(36),
  exitoso    BOOLEAN      NOT NULL,
  ip         VARCHAR(45),
  creado_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_intento),
  KEY intentos_login_correo (correo, creado_en),
  KEY intentos_login_ip (ip, creado_en),
  CONSTRAINT intentos_login_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE SET NULL
) ENGINE = InnoDB;

-- =============================================================================
-- M02 / M03 · Clientes, frecuencia, QR y NFC
-- =============================================================================
CREATE TABLE clientes (
  id_cliente      CHAR(36)     NOT NULL DEFAULT (UUID()),
  id_vendedor     CHAR(36),                                   -- RF-041 cartera
  nombre          VARCHAR(100) NOT NULL,
  direccion       TEXT         NOT NULL,
  colonia         VARCHAR(100),                               -- RF-011
  referencias     TEXT,                                       -- RF-007
  latitud         DECIMAL(10, 8),                             -- RF-008
  longitud        DECIMAL(11, 8),
  telefono        VARCHAR(20),
  frecuencia_tipo ENUM('dias_semana', 'intervalo') NOT NULL DEFAULT 'dias_semana', -- RF-014
  dias_semana     SET('dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab') NOT NULL DEFAULT '',
  cada_dias       SMALLINT,                                   -- para frecuencia 'intervalo'
  ventana_horario ENUM('manana', 'tarde') NOT NULL DEFAULT 'manana', -- RF-029
  qr_uuid         CHAR(36)     NOT NULL DEFAULT (UUID()),     -- RF-015 / RF-018
  nfc_uid         VARCHAR(64),                                -- RF-019
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,         -- RF-010 baja lógica
  creado_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version         INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id_cliente),
  UNIQUE KEY clientes_qr_unico (qr_uuid),
  UNIQUE KEY clientes_nfc_unico (nfc_uid),                    -- varios NULL permitidos
  KEY clientes_vendedor (id_vendedor, activo),
  KEY clientes_nombre (nombre),
  KEY clientes_telefono (telefono),
  KEY clientes_colonia (colonia),
  KEY clientes_sync (actualizado_en),
  CONSTRAINT clientes_vendedor_fk FOREIGN KEY (id_vendedor) REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  CONSTRAINT clientes_latitud_rango  CHECK (latitud  BETWEEN -90  AND 90),
  CONSTRAINT clientes_longitud_rango CHECK (longitud BETWEEN -180 AND 180),
  CONSTRAINT clientes_coordenadas_juntas CHECK ((latitud IS NULL) = (longitud IS NULL)),
  CONSTRAINT clientes_frecuencia_coherente CHECK (
    (frecuencia_tipo = 'intervalo'   AND cada_dias IS NOT NULL AND cada_dias BETWEEN 1 AND 90) OR
    (frecuencia_tipo = 'dias_semana' AND cada_dias IS NULL)
  )
) ENGINE = InnoDB;

-- =============================================================================
-- M06 · Catálogo de sabores
-- =============================================================================
CREATE TABLE productos (
  id_producto         CHAR(36)      NOT NULL DEFAULT (UUID()),
  nombre              VARCHAR(100)  NOT NULL DEFAULT 'Yogurt',
  sabor               VARCHAR(100)  NOT NULL,
  descripcion         TEXT,
  presentacion_litros DECIMAL(5, 2) NOT NULL DEFAULT 1,       -- RF-032
  precio_unitario     DECIMAL(10, 2) NOT NULL,                -- RF-033
  costo_produccion    DECIMAL(10, 2) NOT NULL DEFAULT 0,      -- RF-034
  color_hex           CHAR(7)       NOT NULL DEFAULT '#f472b6',
  disponible          BOOLEAN       NOT NULL DEFAULT TRUE,    -- RF-035
  creado_en           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version             INT           NOT NULL DEFAULT 1,
  PRIMARY KEY (id_producto),
  UNIQUE KEY productos_nombre_sabor_unico (nombre, sabor, presentacion_litros),
  CONSTRAINT productos_precio_positivo CHECK (precio_unitario > 0),
  CONSTRAINT productos_costo_no_negativo CHECK (costo_produccion >= 0),
  CONSTRAINT productos_presentacion_positiva CHECK (presentacion_litros > 0),
  CONSTRAINT productos_color_hex CHECK (color_hex REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE = InnoDB;

-- RF-037: litros producidos y asignados a cada vendedor al iniciar la jornada.
CREATE TABLE stock_diario (
  id_stock          CHAR(36)      NOT NULL DEFAULT (UUID()),
  fecha             DATE          NOT NULL DEFAULT (CURRENT_DATE),
  id_producto       CHAR(36)      NOT NULL,
  id_vendedor       CHAR(36)      NOT NULL,
  cantidad_asignada DECIMAL(8, 2) NOT NULL,
  cantidad_devuelta DECIMAL(8, 2) NOT NULL DEFAULT 0,
  creado_en         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version           INT           NOT NULL DEFAULT 1,
  PRIMARY KEY (id_stock),
  UNIQUE KEY stock_unico_por_dia (fecha, id_producto, id_vendedor),
  CONSTRAINT stock_producto_fk FOREIGN KEY (id_producto) REFERENCES productos (id_producto) ON DELETE RESTRICT,
  CONSTRAINT stock_vendedor_fk FOREIGN KEY (id_vendedor) REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT stock_cantidades_validas CHECK (cantidad_asignada >= 0 AND cantidad_devuelta BETWEEN 0 AND cantidad_asignada)
) ENGINE = InnoDB;

-- =============================================================================
-- M04 / M05 · Pedidos, detalle y ruta
-- =============================================================================
CREATE TABLE pedidos (
  id_pedido            CHAR(36)      NOT NULL DEFAULT (UUID()),
  id_cliente           CHAR(36)      NOT NULL,
  id_vendedor          CHAR(36),
  id_pedido_origen     CHAR(36),                              -- "tomar como base el pedido anterior"
  fecha                DATE          NOT NULL DEFAULT (CURRENT_DATE), -- fecha programada de entrega
  estado               ENUM('pendiente', 'en_camino', 'entregado', 'omitido', 'cancelado') NOT NULL DEFAULT 'pendiente',
  total                DECIMAL(10, 2) NOT NULL DEFAULT 0,     -- lo mantiene un trigger con el detalle
  metodo_pago          ENUM('efectivo', 'transferencia'),     -- RF-023
  orden_ruta           SMALLINT,                              -- RF-030
  fecha_entregado_real DATETIME(3),                           -- RF-023
  motivo_omision       VARCHAR(200),                          -- RF-026
  notas                TEXT,
  creado_por           CHAR(36),
  creado_en            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version              INT           NOT NULL DEFAULT 1,
  PRIMARY KEY (id_pedido),
  KEY pedidos_ruta_del_dia (id_vendedor, fecha, estado),     -- RF-027
  KEY pedidos_fecha_estado (fecha, estado),
  KEY pedidos_cliente (id_cliente, fecha),                   -- RF-012
  KEY pedidos_sync (actualizado_en),
  CONSTRAINT pedidos_cliente_fk  FOREIGN KEY (id_cliente)       REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  CONSTRAINT pedidos_vendedor_fk FOREIGN KEY (id_vendedor)      REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  CONSTRAINT pedidos_origen_fk   FOREIGN KEY (id_pedido_origen) REFERENCES pedidos (id_pedido)   ON DELETE SET NULL,
  CONSTRAINT pedidos_creador_fk  FOREIGN KEY (creado_por)       REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  CONSTRAINT pedidos_total_no_negativo CHECK (total >= 0),
  CONSTRAINT pedidos_entregado_completo CHECK (
    estado <> 'entregado' OR (fecha_entregado_real IS NOT NULL AND metodo_pago IS NOT NULL)
  )
) ENGINE = InnoDB;

CREATE TABLE detalle_pedido (
  id_detalle_pedido CHAR(36)       NOT NULL DEFAULT (UUID()),
  id_pedido         CHAR(36)       NOT NULL,
  id_producto       CHAR(36)       NOT NULL,
  cantidad          DECIMAL(8, 2)  NOT NULL,                   -- unidades de la presentación (1 L por defecto)
  precio_unitario   DECIMAL(10, 2) NOT NULL,                   -- precio congelado al momento del pedido
  costo_unitario    DECIMAL(10, 2) NOT NULL,                   -- costo congelado (RF-045)
  subtotal          DECIMAL(12, 2) AS (ROUND(cantidad * precio_unitario, 2)) STORED,
  creado_en         DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version           INT            NOT NULL DEFAULT 1,
  PRIMARY KEY (id_detalle_pedido),
  UNIQUE KEY detalle_producto_unico (id_pedido, id_producto),
  KEY detalle_producto (id_producto),
  CONSTRAINT detalle_pedido_fk   FOREIGN KEY (id_pedido)   REFERENCES pedidos (id_pedido)     ON DELETE CASCADE,
  CONSTRAINT detalle_producto_fk FOREIGN KEY (id_producto) REFERENCES productos (id_producto) ON DELETE RESTRICT, -- RF-036
  CONSTRAINT detalle_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT detalle_precio_no_negativo CHECK (precio_unitario >= 0 AND costo_unitario >= 0)
) ENGINE = InnoDB;

-- "Recordar más tarde" del flujo post-entrega.
CREATE TABLE recordatorios (
  id_recordatorio  CHAR(36)    NOT NULL DEFAULT (UUID()),
  id_cliente       CHAR(36)    NOT NULL,
  id_vendedor      CHAR(36),
  id_pedido_origen CHAR(36),
  estado           ENUM('pendiente', 'atendido', 'descartado') NOT NULL DEFAULT 'pendiente',
  nota             TEXT,
  creado_en        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atendido_en      DATETIME(3),
  actualizado_en   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version          INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (id_recordatorio),
  KEY recordatorios_pendientes (id_vendedor, estado),
  CONSTRAINT recordatorios_cliente_fk  FOREIGN KEY (id_cliente)       REFERENCES clientes (id_cliente) ON DELETE CASCADE,
  CONSTRAINT recordatorios_vendedor_fk FOREIGN KEY (id_vendedor)      REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  CONSTRAINT recordatorios_pedido_fk   FOREIGN KEY (id_pedido_origen) REFERENCES pedidos (id_pedido)   ON DELETE SET NULL
) ENGINE = InnoDB;

-- =============================================================================
-- M07 · Auditoría (RF-042)
-- =============================================================================
CREATE TABLE auditoria (
  id_auditoria  BIGINT      NOT NULL AUTO_INCREMENT,
  id_usuario    CHAR(36),            -- quién (la API hace SET @app_id_usuario = '<uuid>')
  accion        VARCHAR(10) NOT NULL,
  tabla         VARCHAR(50) NOT NULL,
  id_registro   CHAR(36),
  datos_antes   JSON,
  datos_despues JSON,
  creado_en     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_auditoria),
  KEY auditoria_tabla_registro (tabla, id_registro),
  KEY auditoria_fecha (creado_en)
) ENGINE = InnoDB;

-- =============================================================================
-- M09 · Sincronización offline (RF-051 a RF-053)
-- =============================================================================
-- Cada cambio hecho sin conexión trae su propio UUID: si se reenvía, la llave
-- primaria evita aplicarlo dos veces.
CREATE TABLE operaciones_sync (
  id_operacion      CHAR(36)    NOT NULL,
  id_usuario        CHAR(36)    NOT NULL,
  dispositivo       VARCHAR(200),
  tabla             ENUM('clientes', 'pedidos', 'detalle_pedido', 'recordatorios', 'productos', 'stock_diario') NOT NULL,
  id_registro       CHAR(36)    NOT NULL,
  operacion         ENUM('insert', 'update', 'delete') NOT NULL,
  version_cliente   INT,
  datos             JSON        NOT NULL,
  creado_en_cliente DATETIME(3) NOT NULL,
  recibido_en       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  estado            ENUM('aplicada', 'conflicto', 'rechazada') NOT NULL,
  detalle_error     TEXT,
  PRIMARY KEY (id_operacion),
  KEY sync_usuario_fecha (id_usuario, recibido_en),
  KEY sync_estado (estado, recibido_en),
  CONSTRAINT sync_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Registros borrados, para que los teléfonos también los borren al sincronizar.
CREATE TABLE eliminaciones (
  tabla        VARCHAR(50) NOT NULL,
  id_registro  CHAR(36)    NOT NULL,
  eliminado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tabla, id_registro),
  KEY eliminaciones_fecha (eliminado_en)
) ENGINE = InnoDB;

-- =============================================================================
-- M10 · Notificaciones (RF-054, RF-055)
-- =============================================================================
CREATE TABLE suscripciones_push (
  id_suscripcion CHAR(36)     NOT NULL DEFAULT (UUID()),
  id_usuario     CHAR(36)     NOT NULL,
  endpoint       VARCHAR(500) NOT NULL,
  clave_p256dh   VARCHAR(255) NOT NULL,
  clave_auth     VARCHAR(255) NOT NULL,
  creado_en      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id_suscripcion),
  UNIQUE KEY suscripciones_endpoint_unico (endpoint),
  CONSTRAINT suscripciones_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE notificaciones (
  id_notificacion CHAR(36)     NOT NULL DEFAULT (UUID()),
  id_usuario      CHAR(36)     NOT NULL,
  tipo            VARCHAR(30)  NOT NULL,   -- pedido_urgente, ruta_modificada, stock_bajo, sync_pendiente
  titulo          VARCHAR(120) NOT NULL,
  cuerpo          TEXT,
  datos           JSON,
  creado_en       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  leida_en        DATETIME(3),
  PRIMARY KEY (id_notificacion),
  KEY notificaciones_usuario (id_usuario, leida_en, creado_en),
  CONSTRAINT notificaciones_usuario_fk FOREIGN KEY (id_usuario) REFERENCES usuarios (id_usuario) ON DELETE CASCADE
) ENGINE = InnoDB;

-- =============================================================================
-- Triggers
-- Variables de sesión que usa la API:
--   @app_id_usuario            quién hace el cambio (para la auditoría)
--   @app_permitir_correccion=1 permite corregir el detalle de un pedido cerrado
--   @app_importando=1          al importar datos: no audita ni bloquea
-- Nota: MySQL no dispara triggers en borrados en cascada (ON DELETE CASCADE);
-- al borrar un pedido la API registra también sus detalles en `eliminaciones`.
-- =============================================================================
DELIMITER //

CREATE PROCEDURE sp_auditar(IN p_accion VARCHAR(10), IN p_tabla VARCHAR(50), IN p_id CHAR(36),
                            IN p_antes JSON, IN p_despues JSON)
BEGIN
  IF NOT (@app_importando <=> 1) THEN
    INSERT INTO auditoria (id_usuario, accion, tabla, id_registro, datos_antes, datos_despues)
    VALUES (@app_id_usuario, p_accion, p_tabla, p_id, p_antes, p_despues);
  END IF;
END//

CREATE PROCEDURE sp_registrar_eliminacion(IN p_tabla VARCHAR(50), IN p_id CHAR(36))
BEGIN
  INSERT INTO eliminaciones (tabla, id_registro) VALUES (p_tabla, p_id)
    ON DUPLICATE KEY UPDATE eliminado_en = CURRENT_TIMESTAMP(3);
END//

-- version + 1 en cada UPDATE
CREATE TRIGGER usuarios_version      BEFORE UPDATE ON usuarios      FOR EACH ROW SET NEW.version = OLD.version + 1//
CREATE TRIGGER clientes_version      BEFORE UPDATE ON clientes      FOR EACH ROW SET NEW.version = OLD.version + 1//
CREATE TRIGGER productos_version     BEFORE UPDATE ON productos     FOR EACH ROW SET NEW.version = OLD.version + 1//
CREATE TRIGGER stock_version         BEFORE UPDATE ON stock_diario  FOR EACH ROW SET NEW.version = OLD.version + 1//
CREATE TRIGGER pedidos_version       BEFORE UPDATE ON pedidos       FOR EACH ROW SET NEW.version = OLD.version + 1//
CREATE TRIGGER recordatorios_version BEFORE UPDATE ON recordatorios FOR EACH ROW SET NEW.version = OLD.version + 1//

-- Un pedido entregado, omitido o cancelado no cambia su detalle.
CREATE PROCEDURE sp_validar_detalle_editable(IN p_id_pedido CHAR(36))
BEGIN
  DECLARE est VARCHAR(20);
  IF NOT (@app_permitir_correccion <=> 1 OR @app_importando <=> 1) THEN
    SELECT estado INTO est FROM pedidos WHERE id_pedido = p_id_pedido;
    IF est IN ('entregado', 'omitido', 'cancelado') THEN
      SET @mensaje = CONCAT('El pedido ya está ', est, ', no se puede cambiar su detalle');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @mensaje;
    END IF;
  END IF;
END//

-- Detalle: precio y costo del catálogo si no se mandan.
CREATE TRIGGER detalle_antes_insertar BEFORE INSERT ON detalle_pedido FOR EACH ROW
BEGIN
  CALL sp_validar_detalle_editable(NEW.id_pedido);
  IF NEW.precio_unitario IS NULL OR NEW.costo_unitario IS NULL THEN
    SELECT COALESCE(NEW.precio_unitario, p.precio_unitario), COALESCE(NEW.costo_unitario, p.costo_produccion)
      INTO @precio, @costo
      FROM productos p WHERE p.id_producto = NEW.id_producto;
    SET NEW.precio_unitario = @precio, NEW.costo_unitario = @costo;
  END IF;
END//

CREATE TRIGGER detalle_antes_actualizar BEFORE UPDATE ON detalle_pedido FOR EACH ROW
BEGIN
  CALL sp_validar_detalle_editable(OLD.id_pedido);
  SET NEW.version = OLD.version + 1;
END//

CREATE TRIGGER detalle_antes_borrar BEFORE DELETE ON detalle_pedido FOR EACH ROW
  CALL sp_validar_detalle_editable(OLD.id_pedido)//

-- pedidos.total = suma de subtotales (al importar, el total ya viene en los datos)
CREATE PROCEDURE sp_recalcular_total(IN p_id_pedido CHAR(36))
BEGIN
  DECLARE nuevo DECIMAL(10, 2);
  IF NOT (@app_importando <=> 1) THEN
    SELECT COALESCE(SUM(subtotal), 0) INTO nuevo FROM detalle_pedido WHERE id_pedido = p_id_pedido;
    UPDATE pedidos SET total = nuevo WHERE id_pedido = p_id_pedido AND total <> nuevo;
  END IF;
END//

CREATE TRIGGER detalle_despues_insertar AFTER INSERT ON detalle_pedido FOR EACH ROW
  CALL sp_recalcular_total(NEW.id_pedido)//

CREATE TRIGGER detalle_despues_actualizar AFTER UPDATE ON detalle_pedido FOR EACH ROW
BEGIN
  CALL sp_recalcular_total(NEW.id_pedido);
  IF NEW.id_pedido <> OLD.id_pedido THEN CALL sp_recalcular_total(OLD.id_pedido); END IF;
END//

CREATE TRIGGER detalle_despues_borrar AFTER DELETE ON detalle_pedido FOR EACH ROW
BEGIN
  CALL sp_recalcular_total(OLD.id_pedido);
  CALL sp_registrar_eliminacion('detalle_pedido', OLD.id_detalle_pedido);
END//

-- Borrados para sincronizar (y auditoría de los importantes)
CREATE TRIGGER clientes_despues_borrar AFTER DELETE ON clientes FOR EACH ROW
BEGIN
  CALL sp_registrar_eliminacion('clientes', OLD.id_cliente);
  CALL sp_auditar('DELETE', 'clientes', OLD.id_cliente,
                  JSON_OBJECT('nombre', OLD.nombre, 'id_vendedor', OLD.id_vendedor, 'activo', OLD.activo), NULL);
END//

CREATE TRIGGER pedidos_despues_borrar AFTER DELETE ON pedidos FOR EACH ROW
BEGIN
  CALL sp_registrar_eliminacion('pedidos', OLD.id_pedido);
  CALL sp_auditar('DELETE', 'pedidos', OLD.id_pedido,
                  JSON_OBJECT('id_cliente', OLD.id_cliente, 'fecha', OLD.fecha, 'estado', OLD.estado, 'total', OLD.total), NULL);
END//

CREATE TRIGGER recordatorios_despues_borrar AFTER DELETE ON recordatorios FOR EACH ROW
  CALL sp_registrar_eliminacion('recordatorios', OLD.id_recordatorio)//

-- Auditoría de productos (precios y costos)
CREATE TRIGGER productos_despues_insertar AFTER INSERT ON productos FOR EACH ROW
  CALL sp_auditar('INSERT', 'productos', NEW.id_producto, NULL,
                  JSON_OBJECT('sabor', NEW.sabor, 'precio_unitario', NEW.precio_unitario,
                              'costo_produccion', NEW.costo_produccion, 'disponible', NEW.disponible))//

CREATE TRIGGER productos_despues_actualizar AFTER UPDATE ON productos FOR EACH ROW
BEGIN
  IF NOT (NEW.sabor <=> OLD.sabor AND NEW.nombre <=> OLD.nombre AND NEW.precio_unitario <=> OLD.precio_unitario
          AND NEW.costo_produccion <=> OLD.costo_produccion AND NEW.disponible <=> OLD.disponible
          AND NEW.presentacion_litros <=> OLD.presentacion_litros AND NEW.color_hex <=> OLD.color_hex) THEN
    CALL sp_auditar('UPDATE', 'productos', NEW.id_producto,
      JSON_OBJECT('sabor', OLD.sabor, 'precio_unitario', OLD.precio_unitario, 'costo_produccion', OLD.costo_produccion,
                  'disponible', OLD.disponible, 'presentacion_litros', OLD.presentacion_litros, 'color_hex', OLD.color_hex),
      JSON_OBJECT('sabor', NEW.sabor, 'precio_unitario', NEW.precio_unitario, 'costo_produccion', NEW.costo_produccion,
                  'disponible', NEW.disponible, 'presentacion_litros', NEW.presentacion_litros, 'color_hex', NEW.color_hex));
  END IF;
END//

CREATE TRIGGER productos_despues_borrar AFTER DELETE ON productos FOR EACH ROW
BEGIN
  CALL sp_registrar_eliminacion('productos', OLD.id_producto);
  CALL sp_auditar('DELETE', 'productos', OLD.id_producto,
                  JSON_OBJECT('sabor', OLD.sabor, 'precio_unitario', OLD.precio_unitario,
                              'costo_produccion', OLD.costo_produccion), NULL);
END//

-- Auditoría de usuarios (nunca guarda la contraseña; ignora contadores de login)
CREATE TRIGGER usuarios_despues_insertar AFTER INSERT ON usuarios FOR EACH ROW
  CALL sp_auditar('INSERT', 'usuarios', NEW.id_usuario, NULL,
                  JSON_OBJECT('nombre', NEW.nombre, 'correo', NEW.correo, 'rol', NEW.rol, 'activo', NEW.activo))//

CREATE TRIGGER usuarios_despues_actualizar AFTER UPDATE ON usuarios FOR EACH ROW
BEGIN
  IF NOT (NEW.nombre <=> OLD.nombre AND NEW.correo <=> OLD.correo AND NEW.telefono <=> OLD.telefono
          AND NEW.rol <=> OLD.rol AND NEW.activo <=> OLD.activo AND NEW.password_hash <=> OLD.password_hash
          AND NEW.debe_cambiar_password <=> OLD.debe_cambiar_password) THEN
    CALL sp_auditar('UPDATE', 'usuarios', NEW.id_usuario,
      JSON_OBJECT('nombre', OLD.nombre, 'correo', OLD.correo, 'telefono', OLD.telefono, 'rol', OLD.rol, 'activo', OLD.activo),
      JSON_OBJECT('nombre', NEW.nombre, 'correo', NEW.correo, 'telefono', NEW.telefono, 'rol', NEW.rol, 'activo', NEW.activo,
                  'password_cambiada', NOT (NEW.password_hash <=> OLD.password_hash)));
  END IF;
END//

CREATE TRIGGER usuarios_despues_borrar AFTER DELETE ON usuarios FOR EACH ROW
  CALL sp_auditar('DELETE', 'usuarios', OLD.id_usuario,
                  JSON_OBJECT('nombre', OLD.nombre, 'correo', OLD.correo, 'rol', OLD.rol), NULL)//

-- Auditoría de cartera: reasignación de vendedor o baja/alta del cliente (RF-010, RF-041)
CREATE TRIGGER clientes_despues_actualizar AFTER UPDATE ON clientes FOR EACH ROW
BEGIN
  IF NOT (NEW.id_vendedor <=> OLD.id_vendedor AND NEW.activo <=> OLD.activo) THEN
    CALL sp_auditar('UPDATE', 'clientes', NEW.id_cliente,
                    JSON_OBJECT('id_vendedor', OLD.id_vendedor, 'activo', OLD.activo),
                    JSON_OBJECT('id_vendedor', NEW.id_vendedor, 'activo', NEW.activo));
  END IF;
END//

DELIMITER ;
