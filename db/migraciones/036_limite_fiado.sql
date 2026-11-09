-- Límite de fiado por cliente (components/LimiteFiado.tsx, api/_lib/precios.ts PUT /clientes/:id/limite-fiado). Lo pone
-- el administrador; viaja al teléfono con el cliente (`limiteFiado`) y, al elegir «Fiado» en la entrega, avisa al
-- vendedor si con ese pedido el cliente pasaría de su límite. Sólo avisa: no impide fiar. NULL = sin límite.
-- Repetible:  npm run db:migrar   (o psql -d … -f 036_limite_fiado.sql)

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS limite_fiado numeric(12, 2);
DO $$ BEGIN
  ALTER TABLE clientes ADD CONSTRAINT clientes_limite_fiado_valido CHECK (limite_fiado IS NULL OR limite_fiado >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
