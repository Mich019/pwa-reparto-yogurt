-- Saldo de envases retornables.
-- Repetible:  npm run db:migrar   (o psql -d … -f 021_envases.sql)

-- Envases retornables: cuáles productos lo son y los envases que el cliente devuelve. Lo que tiene prestado un cliente de
-- un producto = lo entregado (pedidos entregados) − lo recogido (esta tabla, sin las anuladas).
ALTER TABLE productos ADD COLUMN IF NOT EXISTS retornable boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS envases_recogidos (
  id_recogida      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_cliente       uuid NOT NULL REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  id_producto      uuid NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  id_vendedor      uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  fecha            date NOT NULL,
  cantidad         integer NOT NULL,
  nota             varchar(200),
  anulado_en       timestamptz,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recogidos_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT recogidos_cliente_misma_empresa FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente),
  CONSTRAINT recogidos_producto_misma_empresa FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto),
  CONSTRAINT recogidos_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX IF NOT EXISTS envases_recogidos_cliente ON envases_recogidos (id_cliente, id_producto);

-- Reglas por empresa de las tablas nuevas (como las demás: ver «Multiempresa»).
DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['envases_recogidos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS por_empresa ON %I', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;
