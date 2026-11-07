-- Resumen diario por correo para el administrador (Configuración → Preferencias; api/_lib/resumen.ts): lo de ayer en un
-- solo correo, para quien prefiere eso a un push por cada corte. Apagado de fábrica. `resumen_enviado_dia` evita
-- mandarlo dos veces el mismo día aunque el cron corra de más.
-- Repetible:  npm run db:migrar   (o psql -d … -f 030_resumen_correo.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_correo boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_enviado_dia date;
