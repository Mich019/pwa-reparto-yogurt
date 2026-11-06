-- El orden del menú del panel se guarda en la cuenta (antes sólo en el navegador): sigue a la persona en cualquier
-- computadora. null = el de fábrica. Lo escribe PATCH /me (ordenMenu) y lo devuelve GET /me.
-- Repetible:  npm run db:migrar   (o psql -d … -f 026_orden_menu.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS orden_menu text[];
