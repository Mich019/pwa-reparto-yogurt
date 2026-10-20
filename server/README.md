# API de Reparto Yogurt

Servidor de la PWA: **inicio de sesión por rol** (M01), **sincronización** de lo que el teléfono hizo sin conexión (RF-051, RF-052) y **resolución de conflictos** (RF-053). Node 22 + Fastify sobre la base PostgreSQL de [`../db`](../db/README.md).

## Puesta en marcha

```bash
cd server
cp .env.example .env        # ajusta DATABASE_URL y pon un JWT_SECRET largo (openssl rand -hex 32)
npm install
set -a; . ./.env; set +a    # carga las variables (en Windows, defínelas en PowerShell con $env:NOMBRE="valor")
npm start                   # http://localhost:3000   (npm run dev recarga al editar)
```

La base se crea con `db/crear_bd.sql` (ver `db/README.md`). Si ya la tenías creada antes de esta API, aplica además `db/migraciones/001_indice_sync.sql`.

Cuentas de prueba (sólo con los datos demo): `admin@yogurt.local` y `vendedor@yogurt.local`, contraseña `Yogurt2026!`. La primera vez piden elegir una contraseña propia.

### Conectar la app

La app habla con el servidor sólo si se compila con su dirección:

```bash
VITE_API_URL=http://localhost:3000 npm run build     # en la raíz del repo
```

En GitHub Pages, define la variable de repositorio `API_URL` (Settings → Secrets and variables → Actions → Variables). Sin ella la app sigue funcionando como antes, sólo en el teléfono y sin inicio de sesión. **Los teléfonos necesitan HTTPS:** la app publicada en Pages es HTTPS y el navegador bloquea llamadas a un servidor `http://`. Para uso real hay que alojar la API en un servicio con HTTPS y base PostgreSQL (Render, Railway, Fly.io, etc.); `CORS_ORIGINS` debe incluir el origen de la app.

## Qué hace cada ruta

| Ruta | Quién | Para qué |
|---|---|---|
| `POST /auth/login` | todos | Correo y contraseña → token de acceso (15 min) + token de renovación (30 días). Bloqueo de 15 min tras 5 fallos (RF-003). |
| `POST /auth/refresh` | todos | Token de acceso nuevo con el de renovación. |
| `POST /auth/logout` | todos | Revoca la sesión de ese teléfono (RF-006). |
| `POST /auth/cambiar-password` | sesión | Contraseña nueva; cierra las demás sesiones. Obligatorio si `debe_cambiar_password`. |
| `GET /me` | sesión | Datos del usuario. |
| `POST /sync/push` | sesión | El teléfono manda su cola de cambios (hasta 200 por envío). |
| `GET /sync/pull?desde=` | sesión | Lo que cambió desde la última vez, más los borrados. |
| `GET /sync/conflictos` | administrador | Cambios que no se aplicaron, con sus datos. |

Contraseñas con Argon2id (RF-004). El token de acceso lleva la sesión: si se cierra la sesión, se desactiva al usuario o cambia su rol, el servidor lo nota en la siguiente petición (RF-005, RF-006).

## Roles

| | Administrador | Vendedor |
|---|---|---|
| Clientes | todos; los puede borrar y reasignar | sólo su cartera; los crea y los edita, no los borra |
| Pedidos y recordatorios | todos; puede corregir uno ya entregado | los de su cartera; un pedido entregado ya no se edita |
| Sabores y precios | los ve y los cambia | los ve **sin costos**; no los cambia |
| Costos, márgenes, producción | sí | no (el servidor ni los envía) |

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
# base aparte para las pruebas (sin datos demo)
psql -U postgres -c "CREATE DATABASE reparto_yogurt_test ENCODING 'UTF8' TEMPLATE template0"
for f in 01_esquema 02_vistas 03_datos_iniciales; do psql -U postgres -d reparto_yogurt_test -v ON_ERROR_STOP=1 -f ../db/$f.sql; done
DATABASE_URL=postgres://postgres:CLAVE@localhost:5432/reparto_yogurt_test npm test
```

31 pruebas contra PostgreSQL real: login, bloqueo, cierre de sesión, roles, sincronización, idempotencia y cada regla de conflicto. También corren en GitHub Actions (`.github/workflows/server.yml`).

## Lo que todavía no hace

- **Sólo PostgreSQL.** Los triggers y el SQL son de PostgreSQL; la versión MySQL de `db/mysql` no está conectada a esta API.
- **Sincronización con la app cerrada.** El Background Sync del service worker despierta la app si hay una ventana abierta; con la app totalmente cerrada, sincroniza al abrirla.
- Recuperación de contraseña por correo (RF-002), alta de vendedores desde la app (RF-038 a RF-041) y notificaciones push (M10).
- `pull` baja todo el historial la primera vez (sin paginar); un cliente reasignado a otro vendedor no arrastra sus pedidos viejos.
