-- Avisos importantes también por correo (apartado «Avisos» en /plataforma).
--  · por_correo: el aviso (sólo los de tipo «aviso») se manda por correo a las cuentas a las que va.
--  · correo_enviado_en / correo_destinatarios: cuándo salió y a cuántas cuentas; se manda una sola vez, al empezar su
--    vigencia (aunque después se edite).
-- Repetible:  npm run db:migrar   (o psql -d … -f 016_avisos_correo.sql)

ALTER TABLE avisos_plataforma
  ADD COLUMN IF NOT EXISTS por_correo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correo_enviado_en timestamptz,
  ADD COLUMN IF NOT EXISTS correo_destinatarios integer;
