-- Qué día de la semana le llega a cada administrador su resumen semanal (api/_lib/resumen.ts), 1 = lunes … 7 = domingo
-- (ISO). Cuenta los siete días que terminan ayer, sea el día que sea.
-- Repetible:  npm run db:migrar   (o psql -d … -f 032_dia_resumen_semanal.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_semanal_dia smallint NOT NULL DEFAULT 1 CHECK (resumen_semanal_dia BETWEEN 1 AND 7);
