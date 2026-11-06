-- Un corte confirmado se puede reabrir anotando el motivo (por ejemplo, llegó tarde un cobro en efectivo de ese día):
-- vuelve a pendiente, lo esperado se recalcula y el vendedor lo puede corregir. Confirmaciones y reaperturas quedan en
-- historial, como en el cierre de mes.
-- Repetible:  npm run db:migrar   (o psql -d … -f 025_cortes_reabrir.sql)

ALTER TABLE cortes_dia ADD COLUMN IF NOT EXISTS historial jsonb NOT NULL DEFAULT '[]';
