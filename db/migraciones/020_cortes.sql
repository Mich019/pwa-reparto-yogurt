-- Corte del día por vendedor y cierre de mes (con su bloqueo de correcciones).
-- Repetible:  npm run db:migrar   (o psql -d … -f 020_cortes.sql)

-- Corte del día: cuánto efectivo debía entregar cada vendedor (lo cobrado en efectivo: ventas y abonos) contra lo que dice
-- que entrega; el administrador lo confirma. La diferencia queda a la vista. Uno por vendedor y día; mientras esté
-- pendiente el vendedor lo puede corregir.
CREATE TABLE IF NOT EXISTS cortes_dia (
  id_corte           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  fecha              date NOT NULL,
  id_vendedor        uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  efectivo_esperado  numeric(12, 2) NOT NULL,
  transferencias     numeric(12, 2) NOT NULL DEFAULT 0,
  credito            numeric(12, 2) NOT NULL DEFAULT 0,
  efectivo_entregado numeric(12, 2) NOT NULL,
  diferencia         numeric(12, 2) GENERATED ALWAYS AS (efectivo_entregado - efectivo_esperado) STORED,
  nota               varchar(300),
  estado             varchar(12) NOT NULL DEFAULT 'pendiente',
  confirmado_por     uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  confirmado_en      timestamptz,
  nota_admin         varchar(300),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cortes_estado_valido CHECK (estado IN ('pendiente', 'confirmado')),
  CONSTRAINT cortes_entregado_no_negativo CHECK (efectivo_entregado >= 0 AND efectivo_esperado >= 0),
  CONSTRAINT cortes_unico_por_dia UNIQUE (id_empresa, fecha, id_vendedor),
  CONSTRAINT cortes_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX IF NOT EXISTS cortes_dia_fecha ON cortes_dia (id_empresa, fecha);

-- Cierre de mes: congela las cifras del mes (cifras = foto al cerrar) y bloquea sus correcciones. Reabrirlo exige un
-- motivo; todo queda en historial. Una fila por mes (mes = primer día).
CREATE TABLE IF NOT EXISTS cierres_mes (
  id_cierre         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  mes               date NOT NULL,
  estado            varchar(10) NOT NULL,
  cifras            jsonb NOT NULL,
  cerrado_por       uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  cerrado_en        timestamptz NOT NULL DEFAULT now(),
  historial         jsonb NOT NULL DEFAULT '[]',
  CONSTRAINT cierres_estado_valido CHECK (estado IN ('cerrado', 'reabierto')),
  CONSTRAINT cierres_mes_primer_dia CHECK (mes = date_trunc('month', mes)::date),
  CONSTRAINT cierres_unico_por_mes UNIQUE (id_empresa, mes)
);

-- Un mes cerrado no admite cambios a sus ventas ni a sus abonos (hasta reabrirlo). En los pedidos sólo cuentan los
-- cambios que mueven cifras (cliente, fecha, estado, total, forma de pago): reasignar al vendedor no.
CREATE OR REPLACE FUNCTION fn_revisar_mes_cerrado(fechas date[]) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f date;
BEGIN
  FOREACH f IN ARRAY fechas LOOP
    IF EXISTS (SELECT 1 FROM cierres_mes WHERE estado = 'cerrado' AND mes = date_trunc('month', f)::date) THEN
      RAISE EXCEPTION 'El mes de % ya está cerrado: reábrelo para corregirlo', to_char(f, 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION fn_pedidos_mes_cerrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.fecha, OLD.estado, OLD.total, OLD.metodo_pago, OLD.id_cliente) IS NOT DISTINCT FROM (NEW.fecha, NEW.estado, NEW.total, NEW.metodo_pago, NEW.id_cliente) THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_revisar_mes_cerrado(ARRAY[OLD.fecha]); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fn_revisar_mes_cerrado(ARRAY[NEW.fecha]); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE OR REPLACE FUNCTION fn_abonos_mes_cerrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.fecha, OLD.monto, OLD.id_cliente) IS NOT DISTINCT FROM (NEW.fecha, NEW.monto, NEW.id_cliente) THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_revisar_mes_cerrado(ARRAY[OLD.fecha]); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fn_revisar_mes_cerrado(ARRAY[NEW.fecha]); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS pedidos_mes_cerrado ON pedidos;
CREATE TRIGGER pedidos_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON pedidos FOR EACH ROW EXECUTE FUNCTION fn_pedidos_mes_cerrado();
DROP TRIGGER IF EXISTS abonos_mes_cerrado ON abonos;
CREATE TRIGGER abonos_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON abonos FOR EACH ROW EXECUTE FUNCTION fn_abonos_mes_cerrado();

-- Reglas por empresa de las tablas nuevas (como las demás: ver «Multiempresa»).
DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['cortes_dia', 'cierres_mes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS por_empresa ON %I', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;
