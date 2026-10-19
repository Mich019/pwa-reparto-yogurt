-- Crea la base completa en MySQL 8.0 (falla si reparto_yogurt ya existe).
-- Ejecutar desde esta carpeta:
--   mysql -u root -p -e "source crear_bd.sql"
-- Sin datos de prueba: quita la línea de 04_datos_demo.sql.

CREATE DATABASE reparto_yogurt CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE reparto_yogurt;

SOURCE 01_esquema.sql;
SOURCE 02_vistas.sql;
SOURCE 03_datos_iniciales.sql;
SOURCE 04_datos_demo.sql;

SHOW TABLES;
