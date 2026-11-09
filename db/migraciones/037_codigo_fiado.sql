-- Bloqueo opcional del fiado (api/_lib/empresa.ts PATCH /empresa `codigoFiado`, Configuración → Preferencias → Fiado).
-- Con código puesto, el teléfono no deja entregar a «Fiado» a un cliente que pasaría de su límite hasta que se escribe
-- el código del administrador. Se guarda `sal:sha256(sal:código)`, nunca el código. NULL = sólo avisa (como antes).
-- Repetible:  npm run db:migrar   (o psql -d … -f 037_codigo_fiado.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo_fiado varchar(120);
