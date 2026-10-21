# Base de datos · MySQL 8.0

Misma base que la versión PostgreSQL de `db/`: las mismas 15 tablas, reglas, vistas y pronóstico. El análisis del esquema original está en [`../README.md`](../README.md).

## Cómo crearla

Requiere MySQL 8.0.16 o superior. Desde esta carpeta:

```bash
mysql -u root -p -e "source crear_bd.sql"
```

Crea la base `reparto_yogurt` (utf8mb4) y se detiene si ya existe. Para no cargar los datos de prueba, quita la línea de `04_datos_demo.sql` en `crear_bd.sql`.

Con MySQL Workbench: ejecuta `CREATE DATABASE reparto_yogurt CHARACTER SET utf8mb4;`, selecciónala y abre y ejecuta los archivos `01` a `04` en orden.

| Archivo | Contenido |
|---|---|
| `01_esquema.sql` | 15 tablas, índices, restricciones y triggers |
| `02_vistas.sql` | Vistas de reportes y el procedimiento de pronóstico |
| `03_datos_iniciales.sql` | Los 6 sabores con sus colores |
| `04_datos_demo.sql` | Sólo desarrollo: admin y vendedor (sin contraseña: las genera el servidor con su pepper, como en `db/migrar.ts`), 10 clientes, 4 semanas de historial y la ruta de hoy |
| `crear_bd.sql` | Crea la base local completa |
| `crear_bd_nube.sql` | Crea la base vacía en la nube (sólo `01` y `02`) |
| `importar_datos.sql` | Carga en la nube los datos exportados de la base local |

Pronóstico de producción de la próxima semana: `CALL sp_pronostico_produccion(NULL, 7);`

## Diferencias con la versión PostgreSQL

| PostgreSQL | MySQL |
|---|---|
| `uuid` | `CHAR(36)` con `DEFAULT (UUID())` |
| `timestamptz` | `DATETIME(3)` en hora del centro de México (ver zona horaria abajo) |
| `dias_semana smallint[]` (0 a 6) | `SET('dom','lun','mar','mie','jue','vie','sab')` |
| Tipos `ENUM` propios | `ENUM` en la columna |
| `jsonb`, `inet` | `JSON`, `VARCHAR(45)` |
| Función `fn_pronostico_produccion()` | Procedimiento `sp_pronostico_produccion()` |
| `SET LOCAL app.id_usuario = '…'` | `SET @app_id_usuario = '…'` |
| `SET LOCAL app.permitir_correccion = 'on'` | `SET @app_permitir_correccion = 1` |

MySQL no ejecuta triggers en los borrados en cascada. Si la API borra un pedido, también debe registrar sus detalles en `eliminaciones`.

## Notas para la API

- Al conectarse, la API ejecuta `SET time_zone = '-06:00'` para que "hoy" sea el día local de la ruta.
- Antes de cada cambio, `SET @app_id_usuario = '<uuid del usuario>'` para que la auditoría sepa quién lo hizo. Con un pool de conexiones, hay que fijarla en cada petición, no sólo al abrir la conexión.
- La conexión se lee de variables de entorno (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`). Pasar de local a la nube es sólo cambiar esos valores.
- Los estados de la app (`PENDIENTE`, `ENTREGADO`…) se guardan en minúsculas (`pendiente`, `entregado`…).

## Pasarla a la nube

El esquema usa sólo MySQL 8.0 estándar, sin extensiones, así que funciona en AWS RDS o Aurora, Azure Database for MySQL, Google Cloud SQL y DigitalOcean.

1. **Permiso para triggers.** En la nube el usuario administrador no es SUPER. Activa `log_bin_trust_function_creators = 1` en los parámetros del servidor; sin él no se crean los triggers ni los procedimientos.
2. **Zona horaria.** Pon el parámetro `time_zone` del servidor en `-06:00`, o deja que la API lo fije al conectarse (ver arriba).
3. **Crear la base vacía** (desde esta carpeta):
   ```bash
   mysql -h <servidor> -u <usuario> -p -e "source crear_bd_nube.sql"
   ```
4. **Exportar los datos de la base local:**
   ```bash
   mysqldump -u root -p --no-create-info --skip-triggers --complete-insert reparto_yogurt > datos.sql
   ```
5. **Importarlos en la nube** (desde la carpeta donde quedó `datos.sql`, con `importar_datos.sql` a un lado):
   ```bash
   mysql -h <servidor> -u <usuario> -p reparto_yogurt -e "source importar_datos.sql"
   ```
   Mientras importa, los triggers no auditan, no bloquean pedidos cerrados ni recalculan totales, así que los datos llegan idénticos (ids, versiones y fechas de cambio incluidos).
6. **Activa SSL** en la conexión de la API (`DB_SSL=true`).
