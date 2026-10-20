# API de Reparto Yogurt

Servidor de la PWA: **inicio de sesión por rol** (M01), **sincronización** de lo que el teléfono hizo sin conexión (RF-051, RF-052) **resolución de conflictos** (RF-053), **reportes** de ventas (M08), **stock diario** (RF-037) y **avisos** al vendedor, con notificaciones push (M10). Node 22 + Fastify sobre la base PostgreSQL de [`../db`](../db/README.md).

## Puesta en marcha

```bash
# en la raíz del repo
npm install
cp .env.example .env        # ajusta DATABASE_URL y pon un JWT_SECRET largo (openssl rand -hex 32)
npm run dev                 # app en http://localhost:5173 y API en http://localhost:3000 (npm run dev:api, sólo la API)
```

La base se crea con `db/crear_bd.sql` (ver `db/README.md`). Si ya la tenías creada antes de esta API, aplica además `db/migraciones/001_indice_sync.sql` y `002_retiros_vendedor.sql`.

Cuentas de prueba (sólo con los datos demo): `admin@yogurt.local` y `vendedor@yogurt.local`, contraseña `Yogurt2026!`. La primera vez piden elegir una contraseña propia.

### Conectar la app

En local y en Vercel no hay que configurar nada: la app llama a `/api` (en local, Vite lo pasa a la API). Si la API vive en otro dominio, se compila con su dirección:

```bash
VITE_API_URL=https://mi-api.example.com npm run build     # en la raíz del repo
```

En GitHub Pages, define la variable de repositorio `API_URL` (Settings → Secrets and variables → Actions → Variables). Sin ella la app sigue funcionando como antes, sólo en el teléfono y sin inicio de sesión. **Los teléfonos necesitan HTTPS:** la app publicada en Pages es HTTPS y el navegador bloquea llamadas a un servidor `http://`. Para uso real hay que alojar la API en un servicio con HTTPS y base PostgreSQL (Render, Railway, Fly.io, etc.); `CORS_ORIGINS` debe incluir el origen de la app.

## Qué hace cada ruta

| Ruta | Quién | Para qué |
|---|---|---|
| `POST /auth/login` | todos | Correo y contraseña → token de acceso (15 min) + token de renovación (30 días). Bloqueo de 15 min tras 5 fallos (RF-003). |
| `POST /auth/refresh` | todos | Token de acceso nuevo con el de renovación. |
| `POST /auth/logout` | todos | Revoca la sesión de ese teléfono (RF-006). |
| `POST /auth/cambiar-password` | sesión | Contraseña nueva; cierra las demás sesiones. Obligatorio si `debe_cambiar_password`. |
| `POST /auth/recuperar` | todos | Manda por correo un código de 6 dígitos que vale 15 min (RF-002). Responde lo mismo exista o no la cuenta. Necesita `RESEND_API_KEY`; sin ella, fuera de producción el código sale en la consola. |
| `POST /auth/restablecer` | todos | Correo, código y contraseña nueva: la cambia, quita el bloqueo y cierra todas las sesiones. El código se anula tras 5 intentos. |
| `GET /me` | sesión | Datos del usuario. |
| `POST /sync/push` | sesión | El teléfono manda su cola de cambios (hasta 200 por envío). |
| `GET /sync/pull?desde=` | sesión | Lo que cambió desde la última vez, más los borrados. |
| `GET /sync/conflictos` | administrador | Cambios que no se aplicaron, con sus datos. |
| `GET /admin/stats?fecha=` | administrador | Resumen del día para el panel: cuentas, clientes, sabores, pedidos por estado, cobrado y esperado, litros y sabores más pedidos. Sin `fecha`, el día de `ZONA_HORARIA`. |
| `GET /usuarios` | administrador | Cuentas con cuántos clientes tiene cada una, y cuántos clientes no tienen vendedor. |
| `POST /usuarios` | administrador | Alta (RF-038): nombre, correo, teléfono, rol. Devuelve una contraseña temporal; la persona debe cambiarla al entrar. |
| `PATCH /usuarios/:id` | administrador | Edición (RF-039): nombre, correo, teléfono, rol. |
| `POST /usuarios/:id/password` | administrador | Restablece la contraseña (RF-039): temporal nueva, cierra sus sesiones, quita el bloqueo. |
| `POST /usuarios/:id/baja` y `/reactivar` | administrador | Suspensión y baja (RF-040): corta el acceso al instante y cierra sus sesiones. Reactivar quita bloqueo e intentos. |
| `POST /clientes/reasignar` | administrador | Pasa clientes a otro vendedor (RF-041): `{ hacia, clienteIds }` o `{ hacia, desde }` para toda una cartera. `null` = sin vendedor. |
| `GET /reportes/ventas` | administrador | Reporte de un periodo (RF-043 a RF-047): resumen, comparación, serie por día/semana/mes, sabores con utilidad y ranking, y rendimiento por vendedor. |
| `GET /reportes/exportar` | administrador | El mismo reporte como archivo (RF-048): `.xlsx` con cinco hojas, o `.csv` de una tabla. |
| `GET /stock?fecha=` | administrador | El día completo (RF-037): producción por sabor y carga de cada vendedor, con lo entregado. |
| `PUT /stock/produccion` | administrador | Litros producidos de cada sabor en una fecha. |
| `PUT /stock/vendedor/:id` | administrador | Carga de un vendedor en una fecha: litros asignados por sabor y, al cerrar, devueltos. Avisa al vendedor si cambia lo asignado. |
| `POST /stock/copiar` | administrador | Repite la carga de un día en otro sin pisar lo ya capturado. |
| `GET /notificaciones/config` | sesión | Si el servidor tiene push y la clave pública VAPID que necesita el navegador. |
| `POST /notificaciones/suscripcion` y `/suscripcion/baja` | sesión | Registra o quita el teléfono para recibir push (RF-054). |
| `POST /notificaciones/leidas` | sesión | Marca avisos como leídos. |
| `POST /notificaciones/prueba` | sesión | Manda un aviso de prueba a los teléfonos de esa cuenta. |

Contraseñas con Argon2id (RF-004). El token de acceso lleva la sesión: si se cierra la sesión, se desactiva al usuario o cambia su rol, el servidor lo nota en la siguiente petición (RF-005, RF-006).

## Roles

| | Administrador | Vendedor |
|---|---|---|
| Clientes | todos; los puede borrar y reasignar | sólo su cartera; los crea y los edita, no los borra |
| Pedidos y recordatorios | todos; puede corregir uno ya entregado | los de su cartera; un pedido entregado ya no se edita |
| Sabores y precios | los ve y los cambia | los ve **sin costos**; no los cambia |
| Costos, márgenes, producción | sí | no (el servidor ni los envía) |

## Cuentas y cartera (M07)

- **Contraseña temporal**: 12 caracteres sin ambigüedades (sin `0/O`, `1/l/I`), siempre con letras y números, en grupos de 4 (`kP7x-Ym3Q-aR9d`). Se genera con `crypto.randomInt`, sólo se devuelve en la respuesta de alta o restablecimiento y la cuenta queda con `debe_cambiar_password`. Si el administrador manda `password` al crear, se usa esa y no se repite en la respuesta.
- **Baja inmediata**: el token de acceso se valida contra `sesiones` y `usuarios.activo` en cada petición, así que la baja surte efecto en la siguiente llamada, no a los 15 minutos. Con la contraseña correcta, el login de una cuenta dada de baja responde `403 CUENTA_SUSPENDIDA`; con una incorrecta, el 401 de siempre (no revela si la cuenta existe).
- **Siempre un administrador**: nadie puede darse de baja ni cambiarse el rol a sí mismo, y un administrador no se puede dar de baja ni degradar si es el último activo. Los cambios que lo afectan se serializan con un candado (`pg_advisory_xact_lock`), de modo que dos administradores que se quiten el puesto a la vez no dejan el sistema sin ninguno.
- **Reasignar**: pasa los clientes y, con ellos, sus pedidos `pendiente`/`en_camino` y recordatorios pendientes. Los pedidos cerrados siguen siendo venta del vendedor que los hizo (sus ventas y su historial no cambian), pero se «tocan» para que el vendedor nuevo los descargue como historial. El vendedor anterior se entera por la tabla `retiros_vendedor`: su siguiente `pull` los trae en `eliminados` (no se usa `eliminaciones`, que es global y borraría el cliente también al vendedor nuevo y al administrador). Si el cliente vuelve a un vendedor que lo tuvo, se borra su retiro. No se puede pasar a un usuario dado de baja.
- **Copias viejas**: el vendedor de un cliente o pedido que ya existe sólo cambia con `/clientes/reasignar`; un administrador con una copia desactualizada que sincroniza no lo deshace. Si el vendedor anterior manda una edición sin conexión de algo que ya no es suyo, la operación se rechaza con `retirado: true` y su teléfono lo quita, sin recibir datos del cliente.
- La baja **no** reasigna sola la cartera por la API; la app lo ofrece en el mismo paso. Todo queda en `auditoria` con quién lo hizo.

## Reportes (M08)

`GET /reportes/ventas?desde=2026-10-01&hasta=2026-10-15&agrupar=semana` (fechas `YYYY-MM-DD`; `agrupar` = `dia` | `semana` | `mes`, por defecto `dia`). Hasta tres años por consulta, y por día hasta un año. Opcional `compararDesde` y `compararHasta` para elegir con qué periodo comparar (debe terminar antes de `desde`); sin ellos se usa el de la misma duración justo antes. Responde `resumen`, `anterior` (`null` si ese periodo no tuvo ventas), `periodos`, `sabores`, `ranking` y `vendedores`.

- **Qué cuenta**: pedidos `entregado`, por su `fecha`, con `precio_unitario` y `costo_unitario` del renglón (congelados al vender). Los costos y márgenes sólo salen por estas rutas, que son de administrador (RF-005).
- **Cálculos en el servidor**: el mismo criterio que `v_ventas_diarias` y `v_ventas_por_sabor`, pero sobre todo el rango, para que «clientes atendidos» cuente una vez a quien compró en dos días distintos.
- **Periodos**: las semanas van de lunes a domingo; el primero y el último se recortan al rango pedido (`inicio`/`fin`) y los días sin ventas aparecen en cero. `anterior.resumen` se compara con `resumen`.
- **Sabores**: ordenados de más a menos litros (desempata por ingreso); `ranking.estrella` es el primero si vendió algo y `ranking.menorRotacion` el último. Entran los sabores disponibles aunque no se hayan vendido, y los no disponibles sólo si vendieron. `sinCosto` avisa de ventas con costo 0.
- **Vendedores**: todos los activos (aunque estén en cero), los dados de baja o administradores que vendieron en el periodo y, si lo hay, «Sin vendedor». `omitidos` son visitas sin venta (RF-026).
- **Exportar** (`/reportes/exportar?desde=&hasta=&agrupar=&formato=xlsx|csv&tabla=ventas|periodos|sabores|vendedores`): `xlsx` trae todas las hojas y `tabla` sólo aplica al CSV. El `.xlsx` se escribe a mano (`_lib/exportar.ts`, un zip con XML, sin dependencias): fechas y números son valores de Excel, con encabezado fijo y filtros. El CSV lleva BOM para Excel y neutraliza celdas que empiezan con `=`, `+`, `-` o `@` (un cliente llamado `=HIPERVINCULO(…)` no se ejecuta). Más de 100,000 renglones de ventas responde `413`.

## Stock diario y avisos (RF-037, M10)

- **Stock**: `produccion_diaria` (litros hechos por fecha y sabor) y `stock_diario` (litros asignados y devueltos a cada vendedor por fecha y sabor). Lo captura sólo el administrador, con las reglas de la base (`devuelto <= asignado`, sin negativos) y en `auditoria`. Un vendedor dado de baja puede devolver pero no recibir más. El `pull` de cada vendedor trae sólo su carga de los últimos 3 días (`stock`); el teléfono calcula lo entregado y lo que queda con sus propios pedidos.
- **Pedido urgente** (`pedidos.urgente`): sólo lo marca o quita el administrador; una copia vieja de un teléfono no lo cambia, y al cerrarse el pedido deja de serlo. Marcarlo avisa al vendedor del cliente.
- **Avisos** (`notificaciones`): los crea el servidor por cada cambio que le toca a un vendedor (pedido urgente, parada nueva/quitada/movida de hoy, cartera que cambió, carga de stock) en la misma transacción que el cambio, y viajan en el `pull` (`avisos`). Nunca avisan a quien hizo el cambio. «Hoy» es el de `ZONA_HORARIA`.
- **Push** (`suscripciones_push`): después de guardar el aviso se manda por Web Push a los teléfonos del vendedor. Es de mejor esfuerzo y nunca hace fallar la operación: un `404` o `410` del servicio de push borra esa suscripción, cualquier otra falla sólo se anota. Sólo se aceptan direcciones de servicios de push conocidos (Google, Mozilla, Apple, Microsoft): la dirección la manda el cliente y el servidor le hace una petición, así que no se acepta cualquier URL (SSRF). Dar de baja a una cuenta o restablecer su contraseña borra sus suscripciones, y al cerrar sesión la app quita ese teléfono (así el siguiente que entre en él no recibe los avisos de la cuenta anterior).
- **Claves VAPID**: `npm run push:claves` genera el par. Se configuran con `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:tu@correo.com` o una URL https); deben definirse juntas. Sin ellas no hay push, pero los avisos se siguen guardando y llegan al sincronizar. `ZONA_HORARIA` (por omisión `America/Mexico_City`) define qué es «hoy» para el negocio; debe coincidir con la zona de los teléfonos de reparto, porque la app ubica la carga del día por la fecha del teléfono.
- **Avisos locales** (RF-055: stock por agotarse y ventas sin enviar): los genera la app en el teléfono, no el servidor; ver el README de la raíz.

## Sincronización y conflictos

El teléfono guarda todo en IndexedDB y anota cada cambio en una cola. Al haber señal manda el estado actual de cada registro tocado (primero sabores, luego clientes, luego pedidos) y después pide lo nuevo. Cada operación lleva un **UUID propio**: si la respuesta se pierde y se reenvía, el servidor devuelve lo que ya pasó y no la aplica dos veces. Cada registro lleva la **versión** del servidor sobre la que se editó.

Si la versión coincide (o el último cambio vino del mismo teléfono) el cambio se aplica. Si otro dispositivo cambió el registro mientras tanto:

1. Un **pedido ya cerrado** (entregado u omitido) gana siempre: nunca se pisa ni se duplica una venta.
2. Un pedido que **se cierra** gana sobre la edición de uno abierto.
3. En lo demás gana el **cambio más reciente** según la hora en que se hizo. El reloj del teléfono se corrige con su desfase contra el servidor, y en empate gana el servidor.
4. **Borrar** algo que otro modificó no se aplica. Editar algo que otro ya borró tampoco.

Lo que pierde no se descarta en silencio: queda en `operaciones_sync` (estado `conflicto` o `rechazada`, con sus datos), el administrador lo ve en `/sync/conflictos` y el teléfono muestra el aviso en **Cuenta**, adoptando la versión del servidor.

Un teléfono que ya trabajaba sin servidor une sus datos con los del servidor al iniciar sesión por primera vez: sus sabores se emparejan por nombre (sin duplicarlos) y todo lo demás se sube.

## Pruebas

```bash
# en la raíz del repo, con una base aparte para las pruebas (sin datos demo)
psql -U postgres -c "CREATE DATABASE reparto_yogurt_test ENCODING 'UTF8' TEMPLATE template0"
for f in 01_esquema 02_vistas 03_datos_iniciales; do psql -U postgres -d reparto_yogurt_test -v ON_ERROR_STOP=1 -f db/$f.sql; done
DATABASE_URL=postgres://postgres:CLAVE@localhost:5432/reparto_yogurt_test npm run test:api
```

123 pruebas contra PostgreSQL real: login, bloqueo, cierre de sesión, roles, sincronización, idempotencia, cada regla de conflicto, altas, ediciones, bajas, contraseñas temporales, reasignación de cartera, reportes, captura de stock, avisos y push (con un enviador falso, sin salir a internet) y la lógica de avisos locales. La del «último administrador» corre en un esquema de Postgres propio para poder dejar un solo administrador sin afectar a las demás. También corren en GitHub Actions (`.github/workflows/server.yml`).

## Lo que todavía no hace

- **Sólo PostgreSQL.** Los triggers y el SQL son de PostgreSQL; la versión MySQL de `db/mysql` no está conectada a esta API.
- **Sincronización con la app cerrada.** El Background Sync del service worker despierta la app si hay una ventana abierta; con la app totalmente cerrada, sincroniza al abrirla.
- **Push con la app cerrada** necesita HTTPS, claves VAPID y que la persona acepte el permiso (iPhone: sólo con la app instalada). Los avisos de stock bajo y de ventas sin enviar los calcula el teléfono, así que sólo salen con la app abierta o al reabrirla.
- `pull` baja todo el historial la primera vez (sin paginar).
- Un teléfono de un vendedor dado de baja conserva en su navegador lo que ya tenía (y lo que no alcanzó a enviar) hasta que alguien entre ahí con esa cuenta; el servidor ya no le acepta nada.
