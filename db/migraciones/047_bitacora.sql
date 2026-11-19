-- Bitácora de cambios para el administrador (Configuración → Bitácora; api/_lib/bitacoraCambios.ts la traduce y le pone
-- nivel: leve, moderado o alto). Usa la tabla auditoria que ya existía y le suma lo que faltaba: ajustes de la empresa,
-- abonos, cortes, cierres de mes, precios especiales, límite de fiado, recogidas de envases anuladas e invitaciones.
-- Además fn_auditar ya no guarda ruido (preferencias de pantalla, marcas del cron) ni imágenes enteras (logo, firma,
-- foto: sólo su huella, para saber que cambiaron).
-- Repetible:  npm run db:migrar   (o psql -d … -f 047_bitacora.sql)

CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  antes   jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  despues jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  -- Lo que cambia solo o es gusto de cada quien: no es un cambio que alguien tenga que revisar.
  rutina  text[] := ARRAY['actualizado_en', 'version', 'ultimo_acceso', 'resumen_enviado_dia', 'resumen_semanal_enviado',
                          'suscripcion_actualizada', 'orden_menu', 'fondo', 'graficas', 'tema', 'tamano_texto', 'mensajes',
                          'avisos_apagados', 'silencio_desde', 'silencio_hasta', 'resumen_correo', 'resumen_semanal',
                          'resumen_semanal_dia', 'resumen_mensual', 'legal_version', 'legal_aceptado_en'];
  pesado  text;
BEGIN
  -- Nunca guardar contraseñas ni tokens en la bitácora.
  antes   := antes   - 'password_hash' - 'token_hash';
  despues := despues - 'password_hash' - 'token_hash';
  -- Imágenes, cifras grandes y el código para fiar de más: sólo su huella (se sabe que cambió, no qué es).
  FOREACH pesado IN ARRAY ARRAY['logo', 'firma_imagen', 'foto', 'cifras', 'codigo_fiado'] LOOP
    IF antes ? pesado AND antes ->> pesado IS NOT NULL THEN antes := jsonb_set(antes, ARRAY[pesado], to_jsonb(md5(antes ->> pesado))); END IF;
    IF despues ? pesado AND despues ->> pesado IS NOT NULL THEN despues := jsonb_set(despues, ARRAY[pesado], to_jsonb(md5(despues ->> pesado))); END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND antes - rutina = despues - rutina THEN
    RETURN NULL;
  END IF;
  INSERT INTO auditoria (id_empresa, id_usuario, accion, tabla, id_registro, datos_antes, datos_despues)
  VALUES ((coalesce(despues, antes) ->> 'id_empresa')::uuid, nullif(current_setting('app.id_usuario', true), '')::uuid,
          TG_OP, TG_TABLE_NAME, (coalesce(despues, antes) ->> TG_ARGV[0])::uuid, antes, despues);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS clientes_auditoria ON clientes;
CREATE TRIGGER clientes_auditoria AFTER UPDATE OF id_vendedor, activo, limite_fiado OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_cliente');
DROP TRIGGER IF EXISTS empresas_auditoria ON empresas;
CREATE TRIGGER empresas_auditoria AFTER UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_empresa');
DROP TRIGGER IF EXISTS abonos_auditoria ON abonos;
CREATE TRIGGER abonos_auditoria AFTER INSERT OR UPDATE OF anulado_en ON abonos
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_abono');
DROP TRIGGER IF EXISTS cortes_auditoria ON cortes_dia;
CREATE TRIGGER cortes_auditoria AFTER UPDATE OF estado ON cortes_dia
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_corte');
DROP TRIGGER IF EXISTS cierres_auditoria ON cierres_mes;
CREATE TRIGGER cierres_auditoria AFTER INSERT OR UPDATE OF estado ON cierres_mes
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_cierre');
DROP TRIGGER IF EXISTS precios_cliente_auditoria ON precios_cliente;
CREATE TRIGGER precios_cliente_auditoria AFTER INSERT OR UPDATE OR DELETE ON precios_cliente
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_cliente');
DROP TRIGGER IF EXISTS recogidas_auditoria ON envases_recogidos;
CREATE TRIGGER recogidas_auditoria AFTER UPDATE OF anulado_en ON envases_recogidos
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_recogida');
DROP TRIGGER IF EXISTS invitaciones_auditoria ON invitaciones;
CREATE TRIGGER invitaciones_auditoria AFTER INSERT ON invitaciones
  FOR EACH ROW EXECUTE FUNCTION fn_auditar('id_invitacion');

-- La bitácora se lee por empresa, de lo más nuevo a lo más viejo.
CREATE INDEX IF NOT EXISTS auditoria_empresa_reciente ON auditoria (id_empresa, id_auditoria DESC);
