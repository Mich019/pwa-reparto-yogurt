-- Panel de la plataforma (Fase 7): quién lo administra y dónde viven esas cuentas.
--  · usuarios.es_plataforma: entra a /plataforma (además de los correos de PLATAFORMA_CORREOS, que dan de alta al
--    primero). Sigue pidiendo la verificación en dos pasos.
--  · empresas.interna: la empresa «Plataforma» donde se crean las cuentas nuevas de super admin, para que no sean
--    administradores de ningún negocio. No aparece en la lista ni en las cifras del panel.
-- Repetible:  npm run db:migrar   (o psql -d … -f 011_plataforma.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_plataforma boolean NOT NULL DEFAULT false;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS interna boolean NOT NULL DEFAULT false;
