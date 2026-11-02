-- Foto de perfil de cada usuario: una imagen chica (256 px, JPG/PNG/WEBP) como data URL, igual que el logo de la
-- empresa. La pone cada quien desde Configuración → Cuenta o Mi cuenta; la API valida el formato y el tamaño.
-- Repetible:  npm run db:migrar   (o psql -d … -f 012_foto_perfil.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto text;
