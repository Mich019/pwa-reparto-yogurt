-- Un mes cerrado tampoco admite cambios a sus cortes del día (entregar, corregir o confirmar), como ya pasaba con sus
-- ventas y sus abonos: las cifras del cierre incluyen los cortes.
-- Repetible:  npm run db:migrar   (o psql -d … -f 024_cortes_mes_cerrado.sql)

CREATE OR REPLACE FUNCTION fn_cortes_mes_cerrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM fn_revisar_mes_cerrado(OLD.id_empresa, ARRAY[OLD.fecha]); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN PERFORM fn_revisar_mes_cerrado(NEW.id_empresa, ARRAY[NEW.fecha]); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS cortes_mes_cerrado ON cortes_dia;
CREATE TRIGGER cortes_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON cortes_dia FOR EACH ROW EXECUTE FUNCTION fn_cortes_mes_cerrado();
