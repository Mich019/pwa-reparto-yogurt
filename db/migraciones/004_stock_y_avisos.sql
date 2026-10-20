-- RF-037 (stock diario), RF-054 y RF-055 (avisos). Ver 01_esquema.sql. Repetible.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS urgente boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS produccion_diaria (
  fecha          date NOT NULL,
  id_producto    uuid NOT NULL REFERENCES productos (id_producto) ON DELETE CASCADE,
  litros         numeric(8, 2) NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, id_producto),
  CONSTRAINT produccion_litros_validos CHECK (litros >= 0)
);

CREATE INDEX IF NOT EXISTS stock_sync ON stock_diario (actualizado_en);
CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones (id_usuario, creado_en DESC);
