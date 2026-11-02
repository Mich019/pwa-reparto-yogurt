-- Contadores de los límites de peticiones (api/_lib/limites.ts). Antes vivían en la memoria de cada instancia de la
-- API; en Vercel hay varias a la vez y cada una contaba por su lado. UNLOGGED: son contadores de minutos, si la base se
-- reinicia de golpe no importa perderlos y así escribir es más barato.
-- Repetible:  npm run db:migrar   (o psql -d … -f 017_limites_peticion.sql)

CREATE UNLOGGED TABLE IF NOT EXISTS limites_peticion (
  clave   text PRIMARY KEY,         -- ruta + IP (o usuario) que cuenta
  cuenta  integer NOT NULL,
  vence   timestamptz NOT NULL      -- fin de la ventana actual
);
CREATE INDEX IF NOT EXISTS limites_peticion_vence ON limites_peticion (vence);
