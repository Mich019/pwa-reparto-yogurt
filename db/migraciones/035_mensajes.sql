-- Los mensajes de WhatsApp de cada cuenta (components/Mensajes.tsx): {"visita": "…", "cobro": "…"}. Viven en la cuenta
-- para que el mismo mensaje siga a la persona del teléfono a la computadora; sin la clave, el de fábrica.
-- Repetible:  npm run db:migrar   (o psql -d … -f 035_mensajes.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mensajes jsonb NOT NULL DEFAULT '{}'::jsonb;
