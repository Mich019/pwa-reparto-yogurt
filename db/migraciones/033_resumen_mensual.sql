-- Informe mensual por correo (api/_lib/resumen.ts): al cerrar un mes, a los administradores que lo pidieron en
-- Configuración → Preferencias les llega con el PDF del informe adjunto. Apagado de fábrica.
-- Repetible:  npm run db:migrar   (o psql -d … -f 033_resumen_mensual.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resumen_mensual boolean NOT NULL DEFAULT false;
