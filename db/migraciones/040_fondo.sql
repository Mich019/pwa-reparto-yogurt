-- El color del fondo de cada cuenta en el tema claro (src/lib/tema.ts; Configuración → Apariencia y Cuenta →
-- Preferencias): crema, blanco o gris. Vive en la cuenta para verse igual en todos sus dispositivos. Las cuentas que ya
-- existían se quedan en crema (lo que veían); las nuevas empiezan en blanco.
-- Repetible:  npm run db:migrar   (o psql -d … -f 040_fondo.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fondo varchar(10) NOT NULL DEFAULT 'crema';
ALTER TABLE usuarios ALTER COLUMN fondo SET DEFAULT 'blanco';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_fondo_valido') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_fondo_valido CHECK (fondo IN ('crema', 'blanco', 'gris'));
  END IF;
END $$;
