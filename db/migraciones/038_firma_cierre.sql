-- Quién firma el informe del cierre de mes (src/lib/reportePdf.ts, informeMensualPdf; Configuración → Preferencias →
-- Cierre de mes). NULL = el administrador que genera el PDF. El cargo va debajo de la línea («Administrador» si NULL).
-- Repetible:  npm run db:migrar   (o psql -d … -f 038_firma_cierre.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS firma_nombre varchar(120);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS firma_cargo varchar(80);
