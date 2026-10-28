-- Catálogo flexible (Fase 5): además del yogurt por litro, cualquier producto en su unidad y su envase.
--  · unidad: en qué se mide (L, kg, pz…). presentacion_litros es el contenido de cada envase EN ESA UNIDAD (el nombre
--    de la columna viene de cuando todo era yogurt; para los productos en L sigue siendo litros).
--  · envase: cómo se entrega (frasco, garrafon, bolsa…; ver TIPOS_ENVASE en src/lib/registro.ts). Vacío = sin envase
--    propio (se vende por unidad o a granel).
-- Lo que ya había queda en L y sin envase: nada cambia para el yogurt.
-- Repetible:  npm run db:migrar   (o psql -d … -f 010_catalogo.sql)

ALTER TABLE productos ADD COLUMN IF NOT EXISTS unidad varchar(10) NOT NULL DEFAULT 'L';
ALTER TABLE productos ADD COLUMN IF NOT EXISTS envase varchar(30);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_unidad_valida' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE productos ADD CONSTRAINT productos_unidad_valida CHECK (btrim(unidad) <> '');
  END IF;
END $$;
-- El mismo sabor puede venir en botella y en frasco del mismo tamaño.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'productos_nombre_sabor_unico' AND indexdef NOT LIKE '%unidad%') THEN
    DROP INDEX productos_nombre_sabor_unico;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS productos_nombre_sabor_unico ON productos (id_empresa, lower(nombre), lower(sabor), presentacion_litros, unidad, coalesce(envase, ''));
