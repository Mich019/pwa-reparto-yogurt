-- RF-041: lo que sale de la cartera de un vendedor al reasignar clientes (ver 01_esquema.sql). Repetible.
CREATE TABLE IF NOT EXISTS retiros_vendedor (
  id_vendedor uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  tabla       varchar(50) NOT NULL,
  id_registro uuid NOT NULL,
  retirado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_vendedor, tabla, id_registro)
);
CREATE INDEX IF NOT EXISTS retiros_vendedor_fecha ON retiros_vendedor (id_vendedor, retirado_en);
