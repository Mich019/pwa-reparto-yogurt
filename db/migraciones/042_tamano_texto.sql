-- El tamaño de la letra del panel de cada cuenta (src/lib/tema.ts; Configuración → Apariencia): normal, grande o más
-- grande. Vive en la cuenta, igual que el fondo (040) y el tema (041), para que quien siempre la usa grande la tenga así
-- en cualquier computadora. Todas empiezan en «normal».
-- Repetible:  npm run db:migrar   (o psql -d … -f 042_tamano_texto.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tamano_texto varchar(12) NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_tamano_texto_valido') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_tamano_texto_valido CHECK (tamano_texto IN ('normal', 'grande', 'mas-grande'));
  END IF;
END $$;
