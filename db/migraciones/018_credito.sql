-- Fiado (1/2): la forma de pago «a crédito». Va sola en su archivo porque un valor nuevo de un tipo no se puede usar
-- dentro de la misma transacción que lo crea (la migración 019 ya lo usa).
-- Repetible:  npm run db:migrar   (o psql -d … -f 018_credito.sql)

ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'credito';
