-- RF-002: intentos de código de recuperación (a los 5 incorrectos el código se invalida).
-- Para bases creadas antes de este cambio:  psql -d reparto_yogurt -f 003_recuperacion_intentos.sql
ALTER TABLE recuperaciones_password ADD COLUMN IF NOT EXISTS intentos smallint NOT NULL DEFAULT 0;
