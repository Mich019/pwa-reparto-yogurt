-- Multiempresa (Fase 1): varias empresas en la misma base, cada una sólo ve lo suyo. Requiere PostgreSQL 15 o superior.
--  · empresas: una fila por negocio. Lo que ya había en la base pasa a la primera («Empresa principal», se renombra
--    después): no se duplica ni se reescribe nada (la columna nueva nace con su valor; no se disparan triggers).
--  · id_empresa en cada tabla del negocio. Su valor por omisión es la empresa de la petición (app.id_empresa, lo fija
--    la API), así que los INSERT de siempre no cambian.
--  · Llaves compuestas (id_empresa, id_…): un pedido no puede apuntar a un cliente o sabor de otra empresa.
--  · Rol reparto_app y reglas por filas (RLS): la API corre cada petición con ese rol y su empresa, y la base sólo le
--    deja ver y escribir filas de esa empresa aunque a una consulta se le olvide filtrar.
-- Repetible. Para bases creadas antes de este cambio:  npm run db:migrar   (o psql -d … -f 007_multiempresa.sql)

-- 1. Empresas -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresas (
  id_empresa     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         varchar(120) NOT NULL,
  zona_horaria   varchar(64) NOT NULL DEFAULT 'America/Mexico_City',
  color_marca    char(7),
  logo           text,
  activa         boolean NOT NULL DEFAULT true,          -- false = suspendida: nadie de ella entra
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresas_color_hex CHECK (color_marca IS NULL OR color_marca ~ '^#[0-9A-Fa-f]{6}$')
);
INSERT INTO empresas (nombre) SELECT 'Empresa principal' WHERE NOT EXISTS (SELECT 1 FROM empresas);

-- 2. id_empresa en cada tabla del negocio ---------------------------------------------------------------------------
DO $$
DECLARE
  primera uuid := (SELECT id_empresa FROM empresas ORDER BY creado_en, id_empresa LIMIT 1);
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios', 'clientes', 'productos', 'stock_diario', 'produccion_diaria', 'pedidos', 'detalle_pedido',
                           'recordatorios', 'auditoria', 'operaciones_sync', 'eliminaciones', 'retiros_vendedor',
                           'suscripciones_push', 'notificaciones'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = t AND column_name = 'id_empresa') THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN id_empresa uuid NOT NULL DEFAULT %L REFERENCES empresas (id_empresa) ON DELETE RESTRICT', t, primera);
    END IF;
    EXECUTE format($f$ALTER TABLE %I ALTER COLUMN id_empresa SET DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid$f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (id_empresa)', t || '_empresa', t);
  END LOOP;
END $$;

-- 3. Lo que era único en toda la base ahora es único dentro de cada empresa ------------------------------------------
DROP INDEX IF EXISTS productos_nombre_sabor_unico;
CREATE UNIQUE INDEX productos_nombre_sabor_unico ON productos (id_empresa, lower(nombre), lower(sabor), presentacion_litros);
DROP INDEX IF EXISTS clientes_nfc_unico;
CREATE UNIQUE INDEX clientes_nfc_unico ON clientes (id_empresa, nfc_uid) WHERE nfc_uid IS NOT NULL;

-- 4. Llaves compuestas: nada apunta a otra empresa -------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('usuarios',           'usuarios_empresa_id',            'UNIQUE (id_empresa, id_usuario)'),
    ('clientes',           'clientes_empresa_id',            'UNIQUE (id_empresa, id_cliente)'),
    ('productos',          'productos_empresa_id',           'UNIQUE (id_empresa, id_producto)'),
    ('pedidos',            'pedidos_empresa_id',             'UNIQUE (id_empresa, id_pedido)'),
    ('clientes',           'clientes_vendedor_misma_empresa',      'FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('pedidos',            'pedidos_cliente_misma_empresa',        'FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente)'),
    ('pedidos',            'pedidos_vendedor_misma_empresa',       'FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('detalle_pedido',     'detalle_pedido_misma_empresa',         'FOREIGN KEY (id_empresa, id_pedido) REFERENCES pedidos (id_empresa, id_pedido)'),
    ('detalle_pedido',     'detalle_producto_misma_empresa',       'FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)'),
    ('recordatorios',      'recordatorios_cliente_misma_empresa',  'FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente)'),
    ('stock_diario',       'stock_producto_misma_empresa',         'FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)'),
    ('stock_diario',       'stock_vendedor_misma_empresa',         'FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('produccion_diaria',  'produccion_producto_misma_empresa',    'FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)'),
    ('notificaciones',     'notificaciones_usuario_misma_empresa', 'FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('retiros_vendedor',   'retiros_vendedor_misma_empresa',       'FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('operaciones_sync',   'sync_usuario_misma_empresa',           'FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)'),
    ('suscripciones_push', 'suscripciones_usuario_misma_empresa',  'FOREIGN KEY (id_empresa, id_usuario) REFERENCES usuarios (id_empresa, id_usuario)')
  ) AS v(tabla, nombre, definicion) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.nombre AND connamespace = current_schema()::regnamespace) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', r.tabla, r.nombre, r.definicion);
    END IF;
  END LOOP;
END $$;

-- 5. Bitácora y borrados: la empresa sale de la fila que cambió (a veces no hay sesión, p. ej. al recuperar la
--    contraseña), no de la petición.
CREATE OR REPLACE FUNCTION fn_registrar_eliminacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fila jsonb := to_jsonb(OLD);
BEGIN
  INSERT INTO eliminaciones (id_empresa, tabla, id_registro) VALUES ((fila ->> 'id_empresa')::uuid, TG_TABLE_NAME, (fila ->> TG_ARGV[0])::uuid)
  ON CONFLICT (tabla, id_registro) DO UPDATE SET eliminado_en = now();
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger
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

-- 6. Rol de la API y reglas por filas -------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reparto_app') THEN
    CREATE ROLE reparto_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- Quien corre la API (el dueño de la base) debe poder cambiar a ese rol con SET ROLE. Desde PostgreSQL 16, quien crea
  -- un rol no lo puede «usar» si no se le da expresamente.
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT reparto_app TO %I WITH SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT reparto_app TO %I', current_user);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO reparto_app', current_schema());
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO reparto_app', current_schema());
  -- Las tablas de migraciones futuras también.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reparto_app', current_schema());
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO reparto_app', current_schema());
END $$;

DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas', 'usuarios', 'clientes', 'productos', 'stock_diario', 'produccion_diaria', 'pedidos',
                           'detalle_pedido', 'recordatorios', 'auditoria', 'operaciones_sync', 'eliminaciones',
                           'retiros_vendedor', 'suscripciones_push', 'notificaciones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS por_empresa ON %I', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;

-- 7. Vistas: con los permisos de quien consulta (si no, las vistas se saltarían las reglas por filas).
ALTER VIEW v_ruta_del_dia    SET (security_invoker = true);
ALTER VIEW v_ventas_diarias  SET (security_invoker = true);
ALTER VIEW v_ventas_por_sabor SET (security_invoker = true);
ALTER VIEW v_resumen_cliente SET (security_invoker = true);
