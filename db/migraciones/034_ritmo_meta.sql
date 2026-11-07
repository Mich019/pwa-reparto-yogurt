-- Qué tan atrasado es «atrasado» para el aviso de meta (api/_lib/resumen.ts, avisarMetasAtrasadas): a mitad de mes se
-- avisa si un vendedor lleva menos de este porcentaje de lo que debería llevar. Por empresa, 70 de fábrica.
-- Repetible:  npm run db:migrar   (o psql -d … -f 034_ritmo_meta.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ritmo_meta_pct smallint NOT NULL DEFAULT 70 CHECK (ritmo_meta_pct BETWEEN 30 AND 100);
