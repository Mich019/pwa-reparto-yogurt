-- Precio especial por cliente y comisión/meta por vendedor.
-- Repetible:  npm run db:migrar   (o psql -d … -f 022_precios_y_metas.sql)

-- Precio especial por cliente (p. ej. mayoreo): reemplaza al del catálogo en sus pedidos nuevos. Por envase, igual que
-- detalle_pedido.precio_unitario. Metas y comisión por vendedor: meta de venta del mes y % sobre lo vendido.
CREATE TABLE IF NOT EXISTS precios_cliente (
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_cliente      uuid NOT NULL REFERENCES clientes (id_cliente) ON DELETE CASCADE,
  id_producto     uuid NOT NULL REFERENCES productos (id_producto) ON DELETE CASCADE,
  precio_unitario numeric(10, 2) NOT NULL,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_cliente, id_producto),
  CONSTRAINT precios_cliente_positivo CHECK (precio_unitario > 0),
  CONSTRAINT precios_cliente_misma_empresa FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente),
  CONSTRAINT precios_producto_misma_empresa FOREIGN KEY (id_empresa, id_producto) REFERENCES productos (id_empresa, id_producto)
);
CREATE INDEX IF NOT EXISTS precios_cliente_empresa ON precios_cliente (id_empresa);

CREATE OR REPLACE FUNCTION fn_detalle_precios() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT coalesce(NEW.precio_unitario, pc.precio_unitario, p.precio_unitario),
         coalesce(NEW.costo_unitario, p.costo_produccion)
    INTO NEW.precio_unitario, NEW.costo_unitario
    FROM productos p
    LEFT JOIN pedidos pe ON pe.id_pedido = NEW.id_pedido
    LEFT JOIN precios_cliente pc ON pc.id_cliente = pe.id_cliente AND pc.id_producto = p.id_producto
   WHERE p.id_producto = NEW.id_producto;
  RETURN NEW;
END $$;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS comision_pct numeric(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS meta_mensual numeric(12, 2);
DO $$ BEGIN
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_comision_rango CHECK (comision_pct BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_meta_positiva CHECK (meta_mensual IS NULL OR meta_mensual > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reglas por empresa de las tablas nuevas (como las demás: ver «Multiempresa»).
DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['precios_cliente'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS por_empresa ON %I', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;
