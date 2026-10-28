-- Cobro con Mercado Pago (Fase 3): cada empresa nueva tiene unos días de prueba gratis y luego una suscripción mensual.
--  · prueba_hasta: hasta cuándo usa todo sin pagar (el registro lo fija; sin tarjeta).
--  · suscripcion_estado / mp_preapproval_id: la suscripción en Mercado Pago (pending, authorized, paused, cancelled),
--    al día con sus avisos (webhook) y al volver de pagar.
--  · exenta: no paga nunca. Las empresas que ya existían al llegar el cobro lo son (no se les corta el servicio).
-- Una empresa tiene acceso si está exenta, si sigue en prueba o si su suscripción está autorizada. Sin acceso no se borra
-- nada: el administrador sólo ve la pantalla para pagar y los repartidores un aviso.
-- Repetible:  npm run db:migrar   (o psql -d … -f 009_suscripciones.sql)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'empresas' AND column_name = 'exenta') THEN
    ALTER TABLE empresas ADD COLUMN exenta boolean NOT NULL DEFAULT false;
    UPDATE empresas SET exenta = true; -- sólo la primera vez: las que ya estaban
  END IF;
END $$;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS prueba_hasta timestamptz NOT NULL DEFAULT now() + interval '14 days';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suscripcion_estado varchar(20);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS mp_preapproval_id varchar(64);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suscripcion_actualizada timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS empresas_mp_preapproval ON empresas (mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;
