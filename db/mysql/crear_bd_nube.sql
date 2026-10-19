-- Crea la base vacía en el servidor de la nube: sólo estructura, sin sabores ni
-- datos de prueba (los datos reales llegan después con importar_datos.sql).
-- Ejecutar desde esta carpeta:
--   mysql -h <servidor> -u <usuario> -p -e "source crear_bd_nube.sql"

CREATE DATABASE reparto_yogurt CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE reparto_yogurt;

SOURCE 01_esquema.sql;
SOURCE 02_vistas.sql;

SHOW TABLES;
