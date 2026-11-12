-- Los envases también se cuadran en el corte del día (api/_lib/cortes.ts): los que el vendedor recogió ese día
-- (envases_recogidos, sin los anulados) contra los que dice que entrega. envases_esperados se recalcula como el efectivo
-- y se congela al confirmar; envases_entregados queda en NULL si no los anotó (empresa sin envases o corte de antes).
-- Repetible:  npm run db:migrar

ALTER TABLE cortes_dia ADD COLUMN IF NOT EXISTS envases_esperados integer NOT NULL DEFAULT 0;
ALTER TABLE cortes_dia ADD COLUMN IF NOT EXISTS envases_entregados integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cortes_envases_no_negativos') THEN
    ALTER TABLE cortes_dia ADD CONSTRAINT cortes_envases_no_negativos CHECK (envases_esperados >= 0 AND (envases_entregados IS NULL OR envases_entregados >= 0));
  END IF;
END $$;
