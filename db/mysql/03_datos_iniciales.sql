-- =============================================================================
-- Reparto Yogurt · Catálogo inicial de sabores (mismos colores que la app)
-- Uso (desde esta carpeta):  mysql -u root -p reparto_yogurt -e "source 03_datos_iniciales.sql"
-- =============================================================================

SET NAMES utf8mb4;

INSERT IGNORE INTO productos (nombre, sabor, presentacion_litros, precio_unitario, costo_produccion, color_hex) VALUES
  ('Yogurt', 'Fresa',     1, 60, 28, '#f472b6'),
  ('Yogurt', 'Natural',   1, 55, 24, '#f5ecd7'),
  ('Yogurt', 'Durazno',   1, 60, 28, '#fdba74'),
  ('Yogurt', 'Mango',     1, 62, 29, '#facc15'),
  ('Yogurt', 'Nuez',      1, 70, 35, '#b45309'),
  ('Yogurt', 'Zarzamora', 1, 65, 31, '#7e22ce');
