-- El estilo de las gráficas de cada cuenta (src/lib/tema.ts; Configuración → Apariencia): línea con puntos o barras.
-- Vive en la cuenta para verse igual en todas sus computadoras. Todas empiezan en línea.
-- Repetible:  npm run db:migrar   (o psql -d … -f 046_graficas.sql)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS graficas varchar(10) NOT NULL DEFAULT 'linea';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_graficas_valido') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_graficas_valido CHECK (graficas IN ('linea', 'barras'));
  END IF;
END $$;
