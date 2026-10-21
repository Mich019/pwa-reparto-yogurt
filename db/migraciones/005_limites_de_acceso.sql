-- RF-002 / RF-003: límites de intentos por cuenta + IP y por IP, en lugar de bloquear la cuenta para todos (así
-- nadie deja fuera al dueño desde otro lado ni averigua qué correos existen), y topes de códigos de recuperación por
-- conexión. password_cambiado_en: al cambiar o restablecer la contraseña, los intentos fallidos de antes ya no cuentan.
-- Repetible. Para bases creadas antes de este cambio:  psql -d reparto_yogurt -f 005_limites_de_acceso.sql
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_cambiado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_intentos_no_negativos;
ALTER TABLE usuarios DROP COLUMN IF EXISTS intentos_fallidos;
ALTER TABLE usuarios DROP COLUMN IF EXISTS bloqueado_hasta;
ALTER TABLE recuperaciones_password ADD COLUMN IF NOT EXISTS ip inet;
CREATE INDEX IF NOT EXISTS intentos_login_ip ON intentos_login (ip, creado_en DESC);
CREATE INDEX IF NOT EXISTS recuperaciones_ip ON recuperaciones_password (ip, creado_en DESC);
