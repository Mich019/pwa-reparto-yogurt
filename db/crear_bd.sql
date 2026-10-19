-- Crea la base completa (falla si reparto_yogurt ya existe). Ejecutar desde esta carpeta:
--   psql -U postgres -f crear_bd.sql
-- (Agrega "-v demo=0" para no cargar los datos de prueba.)
\set ON_ERROR_STOP on
\encoding UTF8
\if :{?demo}
\else
  \set demo 1
\endif

CREATE DATABASE reparto_yogurt ENCODING 'UTF8' TEMPLATE template0;
\connect reparto_yogurt

\ir 01_esquema.sql
\ir 02_vistas.sql
\ir 03_datos_iniciales.sql
\if :demo
  \ir 04_datos_demo.sql
\endif

\echo
\echo 'Base reparto_yogurt creada. Tablas:'
\dt
