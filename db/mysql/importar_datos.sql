-- Carga en la base de la nube los datos exportados de la base local (datos.sql).
-- Mientras importa, los triggers no auditan, no bloquean pedidos cerrados ni
-- recalculan totales: los datos llegan tal como estaban.
-- Ejecutar desde la carpeta donde está datos.sql:
--   mysql -h <servidor> -u <usuario> -p reparto_yogurt -e "source importar_datos.sql"

SET @app_importando = 1;
SOURCE datos.sql;
SET @app_importando = NULL;
