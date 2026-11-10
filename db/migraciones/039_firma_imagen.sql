-- La firma dibujada o fotografiada de quien firma los informes (Configuración → Preferencias → Firma de los informes):
-- data URL de imagen (PNG/WEBP con fondo transparente) que se imprime sobre la línea de firma. NULL = línea en blanco.
-- Repetible:  npm run db:migrar   (o psql -d … -f 039_firma_imagen.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS firma_imagen text;
