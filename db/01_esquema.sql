-- =============================================================================
-- Reparto Yogurt · Base de datos PostgreSQL (15 o superior)
-- Parte del esquema base (Clientes, Productos, Pedidos, Detalle_Pedido) y lo
-- completa para cubrir RF-001 a RF-055. Ver db/README.md para el análisis.
--
-- Multiempresa: varias empresas comparten la base. Cada tabla del negocio lleva
-- id_empresa (por omisión, la empresa de la petición: app.id_empresa, que fija
-- la API) y una regla por filas que sólo deja ver lo de esa empresa al rol de la
-- API (reparto_app). Ver la sección «Multiempresa» al final.
--
-- Uso:  psql -U postgres -d reparto_yogurt -f 01_esquema.sql
-- =============================================================================

SET client_encoding = 'UTF8';

BEGIN;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
CREATE TYPE rol_usuario      AS ENUM ('administrador', 'vendedor');
CREATE TYPE ventana_horario  AS ENUM ('manana', 'tarde');
CREATE TYPE tipo_frecuencia  AS ENUM ('dias_semana', 'intervalo');
CREATE TYPE estado_pedido    AS ENUM ('pendiente', 'en_camino', 'entregado', 'omitido', 'cancelado');
CREATE TYPE metodo_pago      AS ENUM ('efectivo', 'transferencia');
CREATE TYPE estado_recordatorio AS ENUM ('pendiente', 'atendido', 'descartado');
CREATE TYPE estado_sync      AS ENUM ('aplicada', 'conflicto', 'rechazada');

-- -----------------------------------------------------------------------------
-- Funciones comunes
-- -----------------------------------------------------------------------------

-- Sella actualizado_en y sube la versión en cada UPDATE (base de la sincronización).
CREATE FUNCTION fn_marcar_actualizacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

-- =============================================================================
-- Multiempresa · Empresas
-- =============================================================================
CREATE TABLE empresas (
  id_empresa     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         varchar(120) NOT NULL,
  zona_horaria   varchar(64) NOT NULL DEFAULT 'America/Mexico_City',
  color_marca    char(7),
  logo           text,
  giros          text[] NOT NULL DEFAULT '{}',           -- qué vende, según el registro (/registro)
  control_retornables boolean NOT NULL DEFAULT false,    -- lleva la cuenta de envases prestados
  -- Cobro (api/_lib/suscripcion.ts): acceso si está exenta, en prueba o con la suscripción de Mercado Pago autorizada.
  exenta         boolean NOT NULL DEFAULT false,         -- no paga (p. ej. la primera empresa de una instalación propia)
  prueba_hasta   timestamptz NOT NULL DEFAULT now() + interval '14 days',
  suscripcion_estado varchar(20),                        -- pending, authorized, paused, cancelled (Mercado Pago)
  mp_preapproval_id  varchar(64),
  suscripcion_actualizada timestamptz,
  activa         boolean NOT NULL DEFAULT true,          -- false = suspendida: nadie de ella entra
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresas_color_hex CHECK (color_marca IS NULL OR color_marca ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE UNIQUE INDEX empresas_mp_preapproval ON empresas (mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;

-- =============================================================================
-- M01 · Autenticación y seguridad
-- =============================================================================
CREATE TABLE usuarios (
  id_usuario            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa            uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  nombre                varchar(100) NOT NULL,
  correo                varchar(150) NOT NULL,
  telefono              varchar(20),
  password_hash         text NOT NULL,                      -- RF-004: hash Argon2id generado por la API
  rol                   rol_usuario NOT NULL DEFAULT 'vendedor', -- RF-005
  activo                boolean NOT NULL DEFAULT true,      -- RF-040
  debe_cambiar_password boolean NOT NULL DEFAULT false,     -- RF-039 restablecimiento manual
  password_cambiado_en  timestamptz NOT NULL DEFAULT now(), -- RF-003: los intentos fallidos de antes ya no cuentan
  ultimo_acceso         timestamptz,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT usuarios_correo_formato CHECK (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT usuarios_password_argon2 CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT usuarios_empresa_id UNIQUE (id_empresa, id_usuario)
);
-- Único en todo el sistema: el correo dice a qué empresa se entra (cada cuenta es de una sola empresa).
CREATE UNIQUE INDEX usuarios_correo_unico ON usuarios (lower(correo));
CREATE INDEX usuarios_empresa ON usuarios (id_empresa);

-- RF-006: sesiones con refresh token; cerrar sesión = revocar.
CREATE TABLE sesiones (
  id_sesion          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario         uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  dispositivo        varchar(200),
  ip                 inet,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  expira_en          timestamptz NOT NULL,
  revocado_en        timestamptz,
  CONSTRAINT sesiones_expira_despues CHECK (expira_en > creado_en)
);
CREATE INDEX sesiones_usuario_activas ON sesiones (id_usuario) WHERE revocado_en IS NULL;

-- RF-002: códigos de recuperación de contraseña (se guarda sólo el hash).
CREATE TABLE recuperaciones_password (
  id_recuperacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario      uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  codigo_hash     text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  expira_en       timestamptz NOT NULL,
  usado_en        timestamptz,
  intentos        smallint NOT NULL DEFAULT 0,                 -- códigos incorrectos; a los 5 se invalida
  ip              inet                                         -- topes de códigos por conexión
);
CREATE INDEX recuperaciones_usuario ON recuperaciones_password (id_usuario) WHERE usado_en IS NULL;
CREATE INDEX recuperaciones_ip ON recuperaciones_password (ip, creado_en DESC);

-- Registro de una empresa nueva: el código que confirma el correo antes de crear la cuenta (aún no hay empresa).
CREATE TABLE verificaciones_correo (
  id_verificacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correo          varchar(150) NOT NULL,
  codigo_hash     text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  expira_en       timestamptz NOT NULL,
  usado_en        timestamptz,
  intentos        smallint NOT NULL DEFAULT 0,                 -- códigos incorrectos; a los 5 se invalida
  ip              inet
);
CREATE INDEX verificaciones_correo_abiertas ON verificaciones_correo (lower(correo), creado_en DESC);
CREATE INDEX verificaciones_correo_ip ON verificaciones_correo (ip, creado_en DESC);

-- El enlace con el que un repartidor invitado crea su cuenta. Sólo se guarda un HMAC del enlace.
CREATE TABLE invitaciones (
  id_invitacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa    uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE CASCADE,
  correo        varchar(150) NOT NULL,
  rol           rol_usuario NOT NULL DEFAULT 'vendedor',
  token_hash    text NOT NULL UNIQUE,
  id_invitador  uuid,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  usado_en      timestamptz,
  CONSTRAINT invitaciones_invitador_misma_empresa FOREIGN KEY (id_empresa, id_invitador) REFERENCES usuarios (id_empresa, id_usuario) ON DELETE SET NULL (id_invitador)
);
CREATE INDEX invitaciones_empresa ON invitaciones (id_empresa);

-- RF-003: registro de intentos de inicio de sesión. Los límites cuentan por cuenta + IP y por IP (api/_lib/auth.ts):
-- así nadie bloquea la cuenta de otro desde fuera ni prueba contraseñas en muchas cuentas.
CREATE TABLE intentos_login (
  id_intento  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correo      varchar(150) NOT NULL,
  id_usuario  uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  exitoso     boolean NOT NULL,
  ip          inet,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intentos_login_correo ON intentos_login (lower(correo), creado_en DESC);
CREATE INDEX intentos_login_ip ON intentos_login (ip, creado_en DESC);

-- Verificación en dos pasos (TOTP). Aparte de usuarios: su bitácora copia la fila entera y guardaría el secreto.
-- El secreto va cifrado con una clave derivada de AUTH_PEPPER_SECRET (api/_lib/dosPasos.ts).
CREATE TABLE dos_pasos (
  id_usuario   uuid PRIMARY KEY REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  secreto      text NOT NULL,                 -- cifrado con AES-256-GCM
  activado_en  timestamptz,                   -- null = se está configurando: todavía no se pide al entrar
  ultimo_paso  bigint NOT NULL DEFAULT 0,     -- ventana de 30 s del último código aceptado: no se acepta dos veces
  respaldo     text[] NOT NULL DEFAULT '{}',  -- HMAC de los códigos de respaldo que quedan sin usar
  creado_en    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- M02 / M03 · Clientes, frecuencia, QR y NFC
-- =============================================================================
CREATE TABLE clientes (
  id_cliente       uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- UUID: se crean sin conexión en el teléfono
  id_empresa       uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_vendedor      uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL, -- RF-041 cartera
  nombre           varchar(100) NOT NULL,
  direccion        text NOT NULL,
  colonia          varchar(100),                                -- RF-011 filtro
  referencias      text,                                        -- RF-007 notas de referencia
  latitud          numeric(10, 8),                              -- RF-008
  longitud         numeric(11, 8),
  telefono         varchar(20),
  frecuencia_tipo  tipo_frecuencia NOT NULL DEFAULT 'dias_semana', -- RF-014
  dias_semana      smallint[] NOT NULL DEFAULT '{}',            -- 0 = domingo … 6 = sábado
  cada_dias        smallint,                                    -- para frecuencia 'intervalo'
  ventana_horario  ventana_horario NOT NULL DEFAULT 'manana',   -- RF-029
  qr_uuid          uuid NOT NULL DEFAULT gen_random_uuid(),     -- RF-015 / RF-018 (regenerable)
  nfc_uid          varchar(64),                                 -- RF-019
  activo           boolean NOT NULL DEFAULT true,               -- RF-010 baja lógica
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT clientes_latitud_rango  CHECK (latitud  BETWEEN -90  AND 90),
  CONSTRAINT clientes_longitud_rango CHECK (longitud BETWEEN -180 AND 180),
  CONSTRAINT clientes_coordenadas_juntas CHECK ((latitud IS NULL) = (longitud IS NULL)),
  CONSTRAINT clientes_dias_validos CHECK (dias_semana <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CONSTRAINT clientes_frecuencia_coherente CHECK (
    (frecuencia_tipo = 'intervalo'   AND cada_dias IS NOT NULL AND cada_dias BETWEEN 1 AND 90) OR
    (frecuencia_tipo = 'dias_semana' AND cada_dias IS NULL)
  ),
  CONSTRAINT clientes_empresa_id UNIQUE (id_empresa, id_cliente),
  CONSTRAINT clientes_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE UNIQUE INDEX clientes_qr_unico  ON clientes (qr_uuid);
CREATE UNIQUE INDEX clientes_nfc_unico ON clientes (id_empresa, nfc_uid) WHERE nfc_uid IS NOT NULL;
CREATE INDEX clientes_empresa    ON clientes (id_empresa);
CREATE INDEX clientes_vendedor   ON clientes (id_vendedor) WHERE activo;
CREATE INDEX clientes_nombre     ON clientes (lower(nombre));
CREATE INDEX clientes_telefono   ON clientes (telefono);
CREATE INDEX clientes_colonia    ON clientes (lower(colonia));
CREATE INDEX clientes_sync       ON clientes (actualizado_en);

-- =============================================================================
-- M06 · Catálogo de sabores
-- =============================================================================
CREATE TABLE productos (
  id_producto         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa          uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  nombre              varchar(100) NOT NULL DEFAULT 'Yogurt',   -- producto base
  sabor               varchar(100) NOT NULL,
  descripcion         text,
  presentacion_litros numeric(5, 2) NOT NULL DEFAULT 1,         -- RF-032: contenido de cada envase, en `unidad`
  unidad              varchar(10) NOT NULL DEFAULT 'L',         -- L, kg, pz… (catálogo flexible)
  envase              varchar(30),                              -- frasco, garrafon, bolsa…; vacío = sin envase propio
  precio_unitario     numeric(10, 2) NOT NULL,                  -- RF-033 precio por presentación
  costo_produccion    numeric(10, 2) NOT NULL DEFAULT 0,        -- RF-034
  color_hex           char(7) NOT NULL DEFAULT '#f472b6',       -- color de la tarjeta en la app
  disponible          boolean NOT NULL DEFAULT true,            -- RF-035
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT productos_precio_positivo CHECK (precio_unitario > 0),
  CONSTRAINT productos_costo_no_negativo CHECK (costo_produccion >= 0),
  CONSTRAINT productos_presentacion_positiva CHECK (presentacion_litros > 0),
  CONSTRAINT productos_color_hex CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT productos_unidad_valida CHECK (btrim(unidad) <> ''),
  CONSTRAINT productos_empresa_id UNIQUE (id_empresa, id_producto)
);
-- Dos empresas pueden tener su propio «Fresa», y el mismo sabor puede venir en botella y en frasco del mismo tamaño.
CREATE UNIQUE INDEX productos_nombre_sabor_unico ON productos (id_empresa, lower(nombre), lower(sabor), presentacion_litros, unidad, coalesce(envase, ''));
CREATE INDEX productos_empresa ON productos (id_empresa);

-- RF-037: litros producidos y asignados a cada vendedor al iniciar la jornada.
CREATE TABLE stock_diario (
  id_stock          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa        uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  fecha             date NOT NULL DEFAULT current_date,
  id_producto       uuid NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  id_vendedor       uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  cantidad_asignada numeric(8, 2) NOT NULL,
  cantidad_devuelta numeric(8, 2) NOT NULL DEFAULT 0,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_cantidades_validas CHECK (cantidad_asignada >= 0 AND cantidad_devuelta BETWEEN 0 AND cantidad_asignada),
  CONSTRAINT stock_unico_por_dia UNIQUE (fecha, id_producto, id_vendedor),
  CONSTRAINT stock_producto_misma_empresa FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto),
  CONSTRAINT stock_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX stock_sync ON stock_diario (actualizado_en);
CREATE INDEX stock_diario_empresa ON stock_diario (id_empresa);

-- RF-037: litros producidos de cada sabor en el día; lo que no se asigna a un vendedor queda en el almacén.
CREATE TABLE produccion_diaria (
  fecha          date NOT NULL,
  id_empresa     uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_producto    uuid NOT NULL REFERENCES productos (id_producto) ON DELETE CASCADE,
  litros         numeric(8, 2) NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, id_producto),
  CONSTRAINT produccion_litros_validos CHECK (litros >= 0),
  CONSTRAINT produccion_producto_misma_empresa FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)
);
CREATE INDEX produccion_diaria_empresa ON produccion_diaria (id_empresa);

-- =============================================================================
-- M04 / M05 · Pedidos, detalle y ruta
-- =============================================================================
CREATE TABLE pedidos (
  id_pedido            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa           uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_cliente           uuid NOT NULL REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  id_vendedor          uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  id_pedido_origen     uuid REFERENCES pedidos (id_pedido) ON DELETE SET NULL, -- "tomar como base el pedido anterior"
  fecha                date NOT NULL DEFAULT current_date,     -- fecha programada de entrega (RF-024, RF-027)
  estado               estado_pedido NOT NULL DEFAULT 'pendiente',
  total                numeric(10, 2) NOT NULL DEFAULT 0,      -- lo mantiene un trigger con el detalle
  metodo_pago          metodo_pago,                            -- RF-023
  orden_ruta           smallint,                               -- RF-030
  fecha_entregado_real timestamptz,                            -- RF-023
  motivo_omision       varchar(200),                           -- RF-026 visita sin venta
  notas                text,
  urgente              boolean NOT NULL DEFAULT false,         -- RF-054: el administrador lo marcó para ya
  creado_por           uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT pedidos_total_no_negativo CHECK (total >= 0),
  CONSTRAINT pedidos_entregado_completo CHECK (
    estado <> 'entregado' OR (fecha_entregado_real IS NOT NULL AND metodo_pago IS NOT NULL)
  ),
  CONSTRAINT pedidos_no_es_su_origen CHECK (id_pedido_origen IS DISTINCT FROM id_pedido),
  CONSTRAINT pedidos_empresa_id UNIQUE (id_empresa, id_pedido),
  CONSTRAINT pedidos_cliente_misma_empresa FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente),
  CONSTRAINT pedidos_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX pedidos_empresa      ON pedidos (id_empresa);
CREATE INDEX pedidos_ruta_del_dia ON pedidos (id_vendedor, fecha, estado);       -- RF-027
CREATE INDEX pedidos_fecha_estado ON pedidos (fecha, estado);                     -- pronóstico y reportes
CREATE INDEX pedidos_cliente      ON pedidos (id_cliente, fecha DESC);            -- RF-012 historial
CREATE INDEX pedidos_sync         ON pedidos (actualizado_en);

CREATE TABLE detalle_pedido (
  id_detalle_pedido uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa        uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_pedido         uuid NOT NULL REFERENCES pedidos (id_pedido) ON DELETE CASCADE,
  id_producto       uuid NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT, -- RF-036
  cantidad          numeric(8, 2) NOT NULL,              -- unidades de la presentación (1 L por defecto)
  precio_unitario   numeric(10, 2) NOT NULL,             -- precio congelado al momento del pedido
  costo_unitario    numeric(10, 2) NOT NULL,             -- costo congelado, para márgenes exactos (RF-045)
  subtotal          numeric(12, 2) GENERATED ALWAYS AS (round(cantidad * precio_unitario, 2)) STORED,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT detalle_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT detalle_precio_no_negativo CHECK (precio_unitario >= 0 AND costo_unitario >= 0),
  CONSTRAINT detalle_producto_unico UNIQUE (id_pedido, id_producto),
  CONSTRAINT detalle_pedido_misma_empresa FOREIGN KEY (id_empresa, id_pedido) REFERENCES pedidos (id_empresa, id_pedido),
  CONSTRAINT detalle_producto_misma_empresa FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)
);
CREATE INDEX detalle_producto ON detalle_pedido (id_producto);
CREATE INDEX detalle_pedido_empresa ON detalle_pedido (id_empresa);

-- "Recordar más tarde" del flujo post-entrega.
CREATE TABLE recordatorios (
  id_recordatorio  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa       uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_cliente       uuid NOT NULL REFERENCES clientes (id_cliente) ON DELETE CASCADE,
  id_vendedor      uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  id_pedido_origen uuid REFERENCES pedidos (id_pedido) ON DELETE SET NULL,
  estado           estado_recordatorio NOT NULL DEFAULT 'pendiente',
  nota             text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  atendido_en      timestamptz,
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT recordatorios_cliente_misma_empresa FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente)
);
CREATE INDEX recordatorios_pendientes ON recordatorios (id_vendedor) WHERE estado = 'pendiente';
CREATE INDEX recordatorios_empresa ON recordatorios (id_empresa);

-- =============================================================================
-- M07 · Auditoría (RF-042)
-- =============================================================================
CREATE TABLE auditoria (
  id_auditoria  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empresa    uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_usuario    uuid,          -- quién (lo pasa la API con SET LOCAL app.id_usuario)
  accion        varchar(10) NOT NULL,
  tabla         varchar(50) NOT NULL,
  id_registro   uuid,
  datos_antes   jsonb,
  datos_despues jsonb,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_tabla_registro ON auditoria (tabla, id_registro);
CREATE INDEX auditoria_fecha ON auditoria (creado_en DESC);
CREATE INDEX auditoria_empresa ON auditoria (id_empresa);

-- =============================================================================
-- M09 · Sincronización offline (RF-051 a RF-053)
-- =============================================================================
-- Cada cambio que el teléfono hizo sin conexión llega con su propio UUID: si se
-- reenvía, la llave primaria evita aplicarlo dos veces.
CREATE TABLE operaciones_sync (
  id_operacion      uuid PRIMARY KEY,
  id_empresa        uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_usuario        uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  dispositivo       varchar(200),
  tabla             varchar(50) NOT NULL,
  id_registro       uuid NOT NULL,
  operacion         varchar(10) NOT NULL,
  version_cliente   integer,     -- versión que el teléfono tenía al editar
  datos             jsonb NOT NULL,
  creado_en_cliente timestamptz NOT NULL,
  recibido_en       timestamptz NOT NULL DEFAULT now(),
  estado            estado_sync NOT NULL,
  detalle_error     text,
  CONSTRAINT sync_operacion_valida CHECK (operacion IN ('insert', 'update', 'delete')),
  CONSTRAINT sync_tabla_valida CHECK (tabla IN ('clientes', 'pedidos', 'detalle_pedido', 'recordatorios', 'productos', 'stock_diario')),
  CONSTRAINT sync_usuario_misma_empresa FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX operaciones_sync_empresa ON operaciones_sync (id_empresa);
CREATE INDEX sync_usuario_fecha ON operaciones_sync (id_usuario, recibido_en DESC);
CREATE INDEX sync_conflictos ON operaciones_sync (recibido_en) WHERE estado = 'conflicto';
CREATE INDEX sync_registro ON operaciones_sync (tabla, id_registro, recibido_en DESC);  -- quién cambió por última vez un registro (RF-053)

-- Registros borrados, para que los teléfonos también los borren al sincronizar.
CREATE TABLE eliminaciones (
  tabla       varchar(50) NOT NULL,
  id_registro uuid NOT NULL,
  eliminado_en timestamptz NOT NULL DEFAULT now(),
  id_empresa  uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  PRIMARY KEY (tabla, id_registro)
);
CREATE INDEX eliminaciones_fecha ON eliminaciones (eliminado_en);
CREATE INDEX eliminaciones_empresa ON eliminaciones (id_empresa);

-- Registros que salieron de la cartera de un vendedor (RF-041). No son borrados (el registro sigue existiendo para
-- los demás): al sincronizar, el teléfono del vendedor anterior sólo quita su copia.
CREATE TABLE retiros_vendedor (
  id_vendedor uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  tabla       varchar(50) NOT NULL,
  id_registro uuid NOT NULL,
  retirado_en timestamptz NOT NULL DEFAULT now(),
  id_empresa  uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  PRIMARY KEY (id_vendedor, tabla, id_registro),
  CONSTRAINT retiros_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX retiros_vendedor_fecha ON retiros_vendedor (id_vendedor, retirado_en);
CREATE INDEX retiros_vendedor_empresa ON retiros_vendedor (id_empresa);

-- =============================================================================
-- M10 · Notificaciones (RF-054, RF-055)
-- =============================================================================
CREATE TABLE suscripciones_push (
  id_suscripcion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario     uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  endpoint       text NOT NULL UNIQUE,
  clave_p256dh   text NOT NULL,
  clave_auth     text NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  id_empresa     uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  CONSTRAINT suscripciones_usuario_misma_empresa FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX suscripciones_push_empresa ON suscripciones_push (id_empresa);

CREATE TABLE notificaciones (
  id_notificacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario      uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  tipo            varchar(30) NOT NULL,   -- pedido_urgente, ruta_modificada, stock_asignado (stock bajo y ventas sin enviar, RF-055, los genera la app)
  titulo          varchar(120) NOT NULL,
  cuerpo          text,
  datos           jsonb,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  leida_en        timestamptz,
  id_empresa      uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  CONSTRAINT notificaciones_usuario_misma_empresa FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX notificaciones_empresa ON notificaciones (id_empresa);
CREATE INDEX notificaciones_no_leidas ON notificaciones (id_usuario, creado_en DESC) WHERE leida_en IS NULL;
CREATE INDEX notificaciones_usuario ON notificaciones (id_usuario, creado_en DESC);

-- =============================================================================
-- Triggers
-- =============================================================================

-- actualizado_en + versión
CREATE TRIGGER usuarios_actualizacion        BEFORE UPDATE ON usuarios        FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER clientes_actualizacion        BEFORE UPDATE ON clientes        FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER productos_actualizacion       BEFORE UPDATE ON productos       FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER stock_actualizacion           BEFORE UPDATE ON stock_diario    FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER pedidos_actualizacion         BEFORE UPDATE ON pedidos         FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER detalle_actualizacion         BEFORE UPDATE ON detalle_pedido  FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();
CREATE TRIGGER recordatorios_actualizacion   BEFORE UPDATE ON recordatorios   FOR EACH ROW EXECUTE FUNCTION fn_marcar_actualizacion();

-- El detalle toma precio y costo del catálogo si no se mandan.
CREATE FUNCTION fn_detalle_precios() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.precio_unitario, p.precio_unitario),
         coalesce(NEW.costo_unitario, p.costo_produccion)
    INTO NEW.precio_unitario, NEW.costo_unitario
    FROM productos p WHERE p.id_producto = NEW.id_producto;
  RETURN NEW;
END $$;
CREATE TRIGGER detalle_precios BEFORE INSERT ON detalle_pedido
  FOR EACH ROW EXECUTE FUNCTION fn_detalle_precios();

-- pedidos.total = suma de subtotales.
CREATE FUNCTION fn_recalcular_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids uuid[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN ids := array_append(ids, NEW.id_pedido); END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN ids := array_append(ids, OLD.id_pedido); END IF;
  UPDATE pedidos p
     SET total = coalesce((SELECT sum(d.subtotal) FROM detalle_pedido d WHERE d.id_pedido = p.id_pedido), 0)
   WHERE p.id_pedido = ANY (ids)
     AND p.total IS DISTINCT FROM coalesce((SELECT sum(d.subtotal) FROM detalle_pedido d WHERE d.id_pedido = p.id_pedido), 0);
  RETURN NULL;
END $$;
CREATE TRIGGER detalle_total AFTER INSERT OR UPDATE OR DELETE ON detalle_pedido
  FOR EACH ROW EXECUTE FUNCTION fn_recalcular_total();

-- Un pedido entregado u omitido ya no se edita (sólo un administrador puede corregirlo vía API).
CREATE FUNCTION fn_detalle_bloqueado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  est estado_pedido;
BEGIN
  SELECT estado INTO est FROM pedidos WHERE id_pedido = coalesce(NEW.id_pedido, OLD.id_pedido);
  IF est IN ('entregado', 'omitido', 'cancelado') AND current_setting('app.permitir_correccion', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'El pedido ya está %, no se puede cambiar su detalle', est;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER detalle_bloqueado BEFORE INSERT OR UPDATE OR DELETE ON detalle_pedido
  FOR EACH ROW EXECUTE FUNCTION fn_detalle_bloqueado();

-- Registro de borrados para la sincronización. La empresa sale de la fila borrada, no de la petición.
CREATE FUNCTION fn_registrar_eliminacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fila jsonb := to_jsonb(OLD);
BEGIN
  INSERT INTO eliminaciones (id_empresa, tabla, id_registro) VALUES ((fila ->> 'id_empresa')::uuid, TG_TABLE_NAME, (fila ->> TG_ARGV[0])::uuid)
  ON CONFLICT (tabla, id_registro) DO UPDATE SET eliminado_en = now();
  RETURN OLD;
END $$;
CREATE TRIGGER clientes_eliminacion      AFTER DELETE ON clientes       FOR EACH ROW EXECUTE FUNCTION fn_registrar_eliminacion('id_cliente');
CREATE TRIGGER productos_eliminacion     AFTER DELETE ON productos      FOR EACH ROW EXECUTE FUNCTION fn_registrar_eliminacion('id_producto');
CREATE TRIGGER pedidos_eliminacion       AFTER DELETE ON pedidos        FOR EACH ROW EXECUTE FUNCTION fn_registrar_eliminacion('id_pedido');
CREATE TRIGGER detalle_eliminacion       AFTER DELETE ON detalle_pedido FOR EACH ROW EXECUTE FUNCTION fn_registrar_eliminacion('id_detalle_pedido');
CREATE TRIGGER recordatorios_eliminacion AFTER DELETE ON recordatorios  FOR EACH ROW EXECUTE FUNCTION fn_registrar_eliminacion('id_recordatorio');

-- Auditoría de cambios críticos (precios, usuarios, cartera, borrados). La empresa sale de la fila que cambió: a veces
-- no hay sesión (p. ej. al recuperar la contraseña).
CREATE FUNCTION fn_auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  antes   jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  despues jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- Nunca guardar contraseñas en la bitácora.
  antes   := antes   - 'password_hash';
  despues := despues - 'password_hash';
  -- Ignora cambios de rutina (marcas de tiempo del último acceso).
  IF TG_OP = 'UPDATE' AND antes - ARRAY['actualizado_en', 'version', 'ultimo_acceso']
                        = despues - ARRAY['actualizado_en', 'version', 'ultimo_acceso'] THEN
    RETURN NULL;
  END IF;
  INSERT INTO auditoria (id_empresa, id_usuario, accion, tabla, id_registro, datos_antes, datos_despues)
  VALUES ((coalesce(despues, antes) ->> 'id_empresa')::uuid, nullif(current_setting('app.id_usuario', true), '')::uuid,
          TG_OP, TG_TABLE_NAME, (coalesce(despues, antes) ->> TG_ARGV[0])::uuid, antes, despues);
  RETURN NULL;
END $$;
CREATE TRIGGER productos_auditoria AFTER INSERT OR UPDATE OR DELETE ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_producto');
CREATE TRIGGER usuarios_auditoria AFTER INSERT OR UPDATE OR DELETE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_usuario');
CREATE TRIGGER clientes_auditoria AFTER UPDATE OF id_vendedor, activo OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_cliente');
CREATE TRIGGER pedidos_auditoria AFTER DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_pedido');

-- =============================================================================
-- Multiempresa · Rol de la API y reglas por filas (RLS)
-- =============================================================================
-- La API corre cada petición con sesión con el rol reparto_app (SET LOCAL ROLE) y app.id_empresa fijado
-- (api/_lib/db.ts). Ese rol no se salta las reglas, así que sólo ve y escribe filas de su empresa. El dueño de la
-- base (con quien corren los scripts y lo que pasa antes de saber la empresa, como iniciar sesión) no tiene reglas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reparto_app') THEN
    CREATE ROLE reparto_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- Quien corre la API debe poder cambiar a ese rol. Desde PostgreSQL 16, crear un rol no basta para «usarlo».
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT reparto_app TO %I WITH SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT reparto_app TO %I', current_user);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO reparto_app', current_schema());
  -- Lo que creen 02_vistas.sql y las migraciones futuras también.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reparto_app', current_schema());
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO reparto_app', current_schema());
  -- No es de ninguna empresa: sólo la usa el registro, antes de que la empresa exista.
  REVOKE ALL ON verificaciones_correo FROM reparto_app;
END $$;

DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas', 'usuarios', 'clientes', 'productos', 'stock_diario', 'produccion_diaria', 'pedidos',
                           'detalle_pedido', 'recordatorios', 'auditoria', 'operaciones_sync', 'eliminaciones',
                           'retiros_vendedor', 'suscripciones_push', 'notificaciones', 'invitaciones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;

COMMIT;
