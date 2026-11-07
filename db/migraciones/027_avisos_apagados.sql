-- Cada cuenta elige qué avisos no quiere recibir (Configuración → Cuenta → «Avisos en este dispositivo»): los tipos de
-- notificaciones.tipo de esta lista no se guardan ni se mandan por push. null = todos.
-- Repetible:  npm run db:migrar   (o psql -d … -f 027_avisos_apagados.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avisos_apagados text[];
