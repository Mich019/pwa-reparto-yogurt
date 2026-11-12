-- Índices para las dos llaves que apuntan a un pedido «tomado como base» (id_pedido_origen). Sin ellos, cada pedido
-- borrado obligaba a Postgres a recorrer pedidos y recordatorios enteros para poner en NULL a quien lo tomó de base:
-- borrar los pedidos de una empresa (baja, db:datos --quitar) tardaba más de medio minuto con unos miles.
-- Parciales: casi ningún pedido tiene origen. Repetible:  npm run db:migrar

CREATE INDEX IF NOT EXISTS pedidos_origen ON pedidos (id_pedido_origen) WHERE id_pedido_origen IS NOT NULL;
CREATE INDEX IF NOT EXISTS recordatorios_origen ON recordatorios (id_pedido_origen) WHERE id_pedido_origen IS NOT NULL;
