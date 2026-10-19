-- =============================================================================
-- Reparto Yogurt · Catálogo inicial de sabores (mismos colores que la app)
-- Uso:  psql -U postgres -d reparto_yogurt -f 03_datos_iniciales.sql
-- =============================================================================

SET client_encoding = 'UTF8';

INSERT INTO productos (nombre, sabor, presentacion_litros, precio_unitario, costo_produccion, color_hex) VALUES
  ('Yogurt', 'Fresa',     1, 60, 28, '#f472b6'),
  ('Yogurt', 'Natural',   1, 55, 24, '#f5ecd7'),
  ('Yogurt', 'Durazno',   1, 60, 28, '#fdba74'),
  ('Yogurt', 'Mango',     1, 62, 29, '#facc15'),
  ('Yogurt', 'Nuez',      1, 70, 35, '#b45309'),
  ('Yogurt', 'Zarzamora', 1, 65, 31, '#7e22ce')
ON CONFLICT DO NOTHING;
