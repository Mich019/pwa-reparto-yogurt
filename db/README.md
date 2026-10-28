# Base de datos · PostgreSQL

La versión MySQL 8, con los pasos para pasarla a la nube, está en [`mysql/`](mysql/README.md).

## Cómo crearla

Requiere PostgreSQL 15 o superior (las vistas usan `security_invoker`; con 16+ el rol de la API se concede `WITH SET`). Desde esta carpeta:

```bash
psql -U postgres -f crear_bd.sql            # esquema + vistas + sabores + datos de prueba
psql -U postgres -v demo=0 -f crear_bd.sql  # sin datos de prueba
```

El script crea la base `reparto_yogurt` y se detiene si ya existe. Para volver a empezar: `DROP DATABASE reparto_yogurt;`.

| Archivo | Contenido |
|---|---|
| `01_esquema.sql` | Tipos, 16 tablas, índices, restricciones y triggers |
| `02_vistas.sql` | Vistas de reportes y la función de pronóstico |
| `03_datos_iniciales.sql` | Los 6 sabores con sus colores |
| `04_datos_demo.sql` | Sólo desarrollo: admin y vendedor (sin contraseña: `npm run db:migrar -- --demo` les pone una temporal al azar y la muestra), 10 clientes, 4 semanas de historial y la ruta de hoy |

## Análisis del esquema original (drawSQL)

El diseño base era correcto en lo esencial: cuatro entidades (Clientes, Productos, Pedidos, Detalle_Pedido) y sus llaves foráneas. Lo que cambié y por qué:

| # | Problema | Solución |
|---|---|---|
| 1 | Sintaxis MySQL (`AUTO_INCREMENT`, comillas invertidas, `COMMENT`, `DATETIME`). | Sintaxis PostgreSQL, nombres en minúsculas sin comillas (`clientes`, `detalle_pedido`). |
| 2 | Llaves `INT` autoincrementales: el teléfono crea clientes y pedidos sin internet y dos teléfonos generarían el mismo id. | Llaves `uuid` generadas en el teléfono o por la base (RF-051, RF-053). |
| 3 | Dinero en `DOUBLE` en el detalle: pierde centavos al sumar. | `numeric(10,2)` en todos los importes. |
| 4 | `subtotal` y `total` se capturaban a mano y podían no cuadrar. | `subtotal` es columna calculada; `total` lo mantiene un trigger. |
| 5 | No había usuarios ni roles, así que no se sabía qué vendedor hizo cada venta. | Tabla `usuarios` con rol, bloqueo por intentos, sesiones y recuperación de contraseña (M01). |
| 6 | `estado` era texto libre (`pendiente`, `en_camino`, `entregado`). | Tipo `estado_pedido`: pendiente, en_camino, entregado, omitido, cancelado. |
| 7 | `fecha` mezclaba cuándo se creó y cuándo se entrega. | `fecha` = día programado de entrega; `creado_en` y `fecha_entregado_real` aparte. |
| 8 | El margen se calculaba con el costo actual, que cambia con el tiempo. | El detalle congela `precio_unitario` y `costo_unitario` del momento de la venta. |
| 9 | Clientes sin frecuencia, horario, QR, NFC ni baja lógica. | `frecuencia_tipo` + `dias_semana` / `cada_dias`, `ventana_horario`, `qr_uuid`, `nfc_uid`, `activo`, `id_vendedor`. |
| 10 | Productos sin costo, color ni presentación. | `costo_produccion`, `color_hex`, `presentacion_litros`, `descripcion`. |
| 11 | Sin índices para las consultas frecuentes (ruta del día, historial). | Índices por vendedor + fecha + estado, cliente + fecha, búsquedas por nombre, teléfono y colonia. |
| 12 | Borrar un producto o cliente rompía el historial. | `ON DELETE RESTRICT` donde hay ventas (RF-036); baja lógica con `activo`. |

## Tablas y requisitos

| Tabla | Para qué | Requisitos |
|---|---|---|
| `usuarios`, `sesiones`, `recuperaciones_password`, `intentos_login`, `dos_pasos` | Login por rol, Argon2id, bloqueo tras intentos, cierre de sesión, verificación en dos pasos | RF-001 a RF-006, RF-038 a RF-040 |
| `clientes` | Cartera con GPS, frecuencia, horario, QR y NFC | RF-007 a RF-022, RF-041 |
| `productos`, `stock_diario`, `produccion_diaria` | Sabores, precios, costos, litros producidos por día y litros asignados y devueltos a cada vendedor | RF-032 a RF-037 |
| `pedidos`, `detalle_pedido` | Ventas en ruta, pedidos agendados, visitas sin venta, orden de ruta y marca de pedido urgente (`pedidos.urgente`) | RF-023 a RF-031, RF-054 |
| `recordatorios` | "Recordar más tarde" del flujo post-entrega | Flujo B |
| `auditoria` | Bitácora de precios, usuarios, cartera y borrados | RF-042 |
| `operaciones_sync`, `eliminaciones` | Cola de cambios hechos sin conexión, sin duplicados, y borrados por sincronizar | RF-051 a RF-053 |
| `retiros_vendedor` | Clientes, pedidos y recordatorios que salieron de la cartera de un vendedor al reasignar (no son borrados: sólo ese teléfono los quita) | RF-041 |
| `suscripciones_push`, `notificaciones` | Teléfonos suscritos a push y avisos guardados para cada vendedor (pedido urgente, ruta, carga de stock) | RF-054, RF-055 |

Vistas: `v_ruta_del_dia` (RF-027), `v_ventas_diarias` (RF-043, RF-044, RF-047), `v_ventas_por_sabor` (RF-045, RF-046), `v_resumen_cliente` (RF-012, RF-013). La API de reportes (`api/_lib/reportes.ts`) usa el mismo criterio sobre todo el rango pedido en lugar de sumar día por día.
Función: `fn_pronostico_produccion(desde, dias)` devuelve los litros por sabor a producir (agendados + estimado por historial).

## Bases ya creadas

`migraciones/` trae los cambios al esquema posteriores a la primera versión. `npm run db:migrar` (desde la raíz) los aplica en orden, cada uno en una transacción; también se pueden correr a mano con `psql -U postgres -d reparto_yogurt -f migraciones/NNN_*.sql` (son repetibles). `npm run db:probar` dice, sin cambiar nada, si a la base le falta alguno. La API está en [`../api`](../api/README.md); la base en la nube, en [`../docs/produccion-railway.md`](../docs/produccion-railway.md).

## Notas para la API

- **Multiempresa** (migración `007_multiempresa.sql`): cada tabla de negocio tiene `id_empresa` (tabla `empresas`), con llaves compuestas `*_misma_empresa` para que un pedido no apunte al cliente de otra empresa. Las reglas por filas (RLS, política `por_empresa`) se aplican al rol `reparto_app`: la API entra a cada petición con `SET LOCAL ROLE reparto_app` y `set_config('app.id_empresa', …)`, así que sólo ve y escribe filas de esa empresa. El dueño de la base (migraciones, scripts, iniciar sesión) no tiene RLS. `id_empresa` toma por omisión `app.id_empresa`, por eso los `INSERT` no lo mencionan. Un correo pertenece a una sola empresa.

- La contraseña se hashea con Argon2id en la API; la base sólo acepta hashes `$argon2id$…`.
- Para que la auditoría registre quién hizo el cambio, la API ejecuta `SET LOCAL app.id_usuario = '<uuid>'` dentro de cada transacción.
- Un pedido entregado, omitido o cancelado no permite cambiar su detalle. Para una corrección de administrador: `SET LOCAL app.permitir_correccion = 'on'`.
- Stock y avisos (migración `004_stock_y_avisos.sql`): agrega `pedidos.urgente`, la tabla `produccion_diaria` y los índices de sincronización de `stock_diario` y de `notificaciones`. Los avisos se insertan en la misma transacción que el cambio que los origina.
- Reasignar clientes: la API cambia `clientes.id_vendedor` (queda en `auditoria`), anota en `retiros_vendedor` lo que pierde el vendedor anterior y «toca» los pedidos cerrados del cliente para que el vendedor nuevo los descargue. La tabla `eliminaciones` es global y no sirve para esto.
- Sincronización: cada tabla tiene `actualizado_en` y `version` (sube sola en cada cambio). El teléfono pide "lo cambiado desde mi última sincronización" y la tabla `eliminaciones` le dice qué borrar. Si la `version` que mandó el teléfono no coincide con la actual, la operación se guarda como `conflicto`.
