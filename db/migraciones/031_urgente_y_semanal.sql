-- Minutos que espera un pedido urgente antes de recordarlo (api/_lib/urgentes.ts), por empresa: lo elige el
-- administrador en Configuración → Preferencias. Y el resumen semanal por correo (resumen.ts), cada lunes, aparte del
-- diario; `resumen_semanal_enviado` evita mandarlo dos veces el mismo lunes.
-- Repetible:  npm run db:migrar   (o psql -d … -f 031_urgente_y_semanal.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS minutos_urgente smallint NOT NULL DEFAULT 30 CHECK (minutos_urgente BETWEEN 5 AND 240);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_semanal boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_semanal_enviado date;
