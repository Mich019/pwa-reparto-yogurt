-- Horario de silencio de cada cuenta (Configuración → Preferencias): de `silencio_desde` a `silencio_hasta` (horas 0–23
-- en la zona de la empresa; puede pasar de medianoche) los avisos no suenan por push. Se guardan igual y llegan al
-- sincronizar. El pedido urgente suena siempre. null = sin horario.
-- Repetible:  npm run db:migrar   (o psql -d … -f 028_horario_silencio.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS silencio_desde smallint;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS silencio_hasta smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_silencio_valido') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_silencio_valido CHECK (
      (silencio_desde IS NULL AND silencio_hasta IS NULL)
      OR (silencio_desde BETWEEN 0 AND 23 AND silencio_hasta BETWEEN 0 AND 23 AND silencio_desde <> silencio_hasta));
  END IF;
END $$;
