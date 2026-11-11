-- El tema de cada cuenta (src/lib/tema.ts; Configuración → Apariencia): claro, oscuro o el del sistema. Vive en la
-- cuenta, igual que el fondo (040), para verse igual en todos sus dispositivos. Todas empiezan en «sistema».
-- Repetible:  npm run db:migrar   (o psql -d … -f 041_tema.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema varchar(10) NOT NULL DEFAULT 'sistema';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_tema_valido') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_tema_valido CHECK (tema IN ('claro', 'oscuro', 'sistema'));
  END IF;
END $$;
