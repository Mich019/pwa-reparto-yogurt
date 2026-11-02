-- Más marca de la empresa (Configuración → Marca): un lema corto y una línea de contacto (teléfono, dirección, web…)
-- que salen en los PDF. Opcionales; sin ellos todo se ve como antes.
-- Repetible:  npm run db:migrar   (o psql -d … -f 013_marca.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS lema varchar(80);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS contacto varchar(160);
