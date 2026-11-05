-- Privacidad y derechos ARCO (LFPDPPP): qué versión del aviso de privacidad y de los términos aceptó cada cuenta,
-- cuentas eliminadas por su dueño (se anonimizan, no se borran: sus ventas siguen en los libros de la empresa) y la
-- baja de una empresa (se bloquea al instante y sus datos se borran pasado el plazo, api/_lib/privacidad.ts).
-- De paso, el candado del cierre de mes mira sólo los meses cerrados de la misma empresa (antes, un mes cerrado de una
-- empresa bloqueaba los cambios de todas las que corren como dueño de la base: scripts, registro, borrar una empresa)
-- y anular un abono también cuenta como cambio de un mes cerrado.
-- Repetible:  npm run db:migrar   (o psql -d … -f 023_privacidad.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS legal_version varchar(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS legal_aceptado_en timestamptz;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS eliminado_en timestamptz;

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS baja_solicitada_en timestamptz;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS baja_borrar_en timestamptz;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS baja_motivo varchar(300);
CREATE INDEX IF NOT EXISTS empresas_baja ON empresas (baja_borrar_en) WHERE baja_borrar_en IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_revisar_mes_cerrado(empresa uuid, fechas date[]) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f date;
BEGIN
  FOREACH f IN ARRAY fechas LOOP
    IF EXISTS (SELECT 1 FROM cierres_mes WHERE id_empresa = empresa AND estado = 'cerrado' AND mes = date_trunc('month', f)::date) THEN
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
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_revisar_mes_cerrado(OLD.id_empresa, ARRAY[OLD.fecha]); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fn_revisar_mes_cerrado(NEW.id_empresa, ARRAY[NEW.fecha]); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE OR REPLACE FUNCTION fn_abonos_mes_cerrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.fecha, OLD.monto, OLD.id_cliente, OLD.anulado_en) IS NOT DISTINCT FROM (NEW.fecha, NEW.monto, NEW.id_cliente, NEW.anulado_en) THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_revisar_mes_cerrado(OLD.id_empresa, ARRAY[OLD.fecha]); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fn_revisar_mes_cerrado(NEW.id_empresa, ARRAY[NEW.fecha]); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
-- La versión sin empresa la vuelve a crear 020 en cada db:migrar; aquí se quita otra vez (ya nadie la llama).
DROP FUNCTION IF EXISTS fn_revisar_mes_cerrado(date[]);
