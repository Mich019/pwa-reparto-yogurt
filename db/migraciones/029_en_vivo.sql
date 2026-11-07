-- Cambios en vivo (api/_lib/envivo.ts, GET /eventos): un contador por empresa y área que sube cuando cambia algo de
-- esa área. Quien tiene la app o el panel abiertos lo escucha y vuelve a pedir sólo lo suyo, sin recargar la página.
--   datos    → lo que baja la sincronización (pedidos, clientes, sabores, stock, avisos…)
--   cobranza → abonos, envases, cortes, cierres de mes (y los pedidos, por el fiado y el efectivo)
--   equipo   → las cuentas de la empresa (no cuenta el último acceso)
-- El disparador es diferido (corre al confirmar) y sube cada contador una sola vez por transacción: así el candado de
-- la fila dura casi nada aunque una sincronización traiga muchos cambios.
-- Repetible:  npm run db:migrar   (o psql -d … -f 029_en_vivo.sql)

CREATE TABLE IF NOT EXISTS cambios (
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE CASCADE,
  area       varchar(20) NOT NULL,
  version    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (id_empresa, area)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON cambios TO reparto_app;
ALTER TABLE cambios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS por_empresa ON cambios;
CREATE POLICY por_empresa ON cambios TO reparto_app
  USING (id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid)
  WITH CHECK (id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid);

CREATE OR REPLACE FUNCTION fn_marcar_cambio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id_empresa ELSE NEW.id_empresa END;
  marca text;
BEGIN
  IF e IS NULL THEN RETURN NULL; END IF;
  marca := 'app.cambio_' || TG_ARGV[0] || '_' || replace(e::text, '-', '');
  IF current_setting(marca, true) = 'on' THEN RETURN NULL; END IF; -- ya se subió en esta transacción
  PERFORM set_config(marca, 'on', true);
  -- Al borrar una empresa entera (privacidad.ts, borrarEmpresa) ya no hay a quién avisar.
  INSERT INTO cambios (id_empresa, area, version) SELECT e, TG_ARGV[0], 1 WHERE EXISTS (SELECT 1 FROM empresas WHERE id_empresa = e)
  ON CONFLICT (id_empresa, area) DO UPDATE SET version = cambios.version + 1;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION fn_marcar_cambio() TO reparto_app;

DO $$
DECLARE
  par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[
    ['clientes', 'datos'], ['productos', 'datos'], ['stock_diario', 'datos'], ['pedidos', 'datos'], ['detalle_pedido', 'datos'],
    ['recordatorios', 'datos'], ['eliminaciones', 'datos'], ['retiros_vendedor', 'datos'], ['precios_cliente', 'datos'],
    ['pedidos', 'cobranza'], ['abonos', 'cobranza'], ['cortes_dia', 'cobranza'], ['cierres_mes', 'cobranza'], ['envases_recogidos', 'cobranza']
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'cambio_' || par[2], par[1]);
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW EXECUTE FUNCTION fn_marcar_cambio(%L)', 'cambio_' || par[2], par[1], par[2]);
  END LOOP;
END $$;

-- Un aviso nuevo, sí; marcarlo como leído no le importa a nadie más.
DROP TRIGGER IF EXISTS cambio_datos ON notificaciones;
CREATE CONSTRAINT TRIGGER cambio_datos AFTER INSERT ON notificaciones
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_marcar_cambio('datos');

-- Las cuentas: sólo lo que se ve en Vendedores (iniciar sesión cambia ultimo_acceso y no debe despertar a nadie).
DROP TRIGGER IF EXISTS cambio_equipo ON usuarios;
CREATE CONSTRAINT TRIGGER cambio_equipo
  AFTER INSERT OR DELETE OR UPDATE OF nombre, correo, telefono, foto, rol, activo, meta_mensual, comision_pct ON usuarios
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_marcar_cambio('equipo');
