# Puesta en producción: base en Railway, app y API en Vercel

El sistema ya está listo para trabajar con una base PostgreSQL de Railway. Lo único que falta es crear la base y darle sus datos de conexión a la API. Esta guía lleva de cero a la app funcionando.

```
Teléfonos y panel  ──HTTPS──▶  Vercel (app + función /api)  ──SSL──▶  Railway (PostgreSQL)
```

## 1. Crear la base en Railway

1. En [railway.com](https://railway.com), **New Project → Deploy PostgreSQL**. Railway crea el servicio `Postgres` (PostgreSQL 16 o más nuevo).
2. En el servicio Postgres, pestaña **Variables**, copia **`DATABASE_PUBLIC_URL`**. Se ve así:
   `postgresql://postgres:CLAVE@xxxx.proxy.rlwy.net:12345/railway`
   Es la dirección pública: la que sirve desde Vercel y desde tu computadora. La `DATABASE_URL` (`postgres.railway.internal`) sólo funciona para servicios dentro del mismo proyecto de Railway.
3. Cuida esa dirección como una contraseña: trae la clave de la base.

La API detecta la dirección de Railway y cifra la conexión sola (SSL). Si la dirección trae `?sslmode=require`, también funciona tal cual. Railway usa un certificado propio que Node no reconoce, así que de entrada se cifra **sin verificar** el certificado: nadie puede leer el tráfico, pero tampoco se confirma que del otro lado esté tu base. Para cerrar esa puerta, fija el certificado (recomendado, 2 minutos):

```bash
# copia el certificado que presenta tu base (cambia host y puerto por los de tu DATABASE_PUBLIC_URL)
echo | openssl s_client -starttls postgres -connect xxxx.proxy.rlwy.net:12345 -showcerts 2>/dev/null \
  | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > railway-ca.pem
base64 -w0 railway-ca.pem        # en Mac: base64 -i railway-ca.pem
```

Pon ese texto en base64 en `DB_SSL_CA` (en tu `.env` y en Vercel) y corre `npm run db:probar`: si dice «conexión cifrada (SSL)», la API ya sólo acepta ese certificado. Si dice «No conecta … certificate», Railway presenta una cadena distinta: quita `DB_SSL_CA` y la conexión sigue cifrada sin verificar. Si Railway regenera el certificado (al recrear la base), hay que repetir este paso.

## 2. Variables de entorno

Las mismas en tu `.env` local (para crear la base) y en Vercel (**Settings → Environment Variables**, para Production):

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La `DATABASE_PUBLIC_URL` de Railway |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `AUTH_PEPPER_SECRET` | Otra, también con `openssl rand -hex 32`. **Guárdala aparte**: si se pierde, todas las contraseñas se tienen que restablecer |
| `ZONA_HORARIA` | `America/Mexico_City` (la de los teléfonos de reparto) |
| `DB_SSL_CA` | Recomendado: el certificado de la base, ver el paso 1 |
| `CORS_ORIGINS` | La dirección de la app, p. ej. `https://reparto-yogurt.vercel.app` |
| `RESEND_API_KEY`, `MAIL_FROM` | Para «¿Olvidaste tu contraseña?». Sin ellas, en producción no se puede enviar el código |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Opcional, para notificaciones push: `npm run push:claves` |

No hace falta `DB_SSL` (se decide solo) ni `DB_POOL_MAX` (en Vercel usa 3 conexiones por instancia). La lista completa y comentada está en [`.env.example`](../.env.example).

## 3. Crear el esquema (una sola vez)

Desde la raíz del repo, con el `.env` apuntando a Railway:

```bash
npm run db:probar                                   # sólo revisa: variables, conexión, cifrado y estado de la base
npm run db:migrar                                   # crea tablas, vistas y sabores, y aplica las migraciones
npm run db:admin -- tu@correo.com "Tu Nombre"       # primer administrador, con contraseña temporal
npm run db:probar                                   # debe decir «Esquema y migraciones al día» y 1 administrador
```

Con la CLI de Railway también se puede sin `.env`: `railway run npm run db:migrar` toma las variables del proyecto (usa la `DATABASE_PUBLIC_URL`, porque corre en tu computadora).

`db:migrar` hace cada paso en una transacción: si algo falla, la base queda como estaba y se puede volver a correr. Se puede correr las veces que quieras; en una base ya creada sólo aplica migraciones. **No uses `--demo` en la base real.** `--reiniciar` borra todo y, si ya hay usuarios, pide además `--confirmo-borrar-todo`.

## 4. Publicar en Vercel

1. **Add New → Project** con este repositorio. Vercel lee `vercel.json`: compila la app con Vite y publica `api/index.ts` como la función de `/api`.
2. Pon las variables del paso 2 y despliega.
3. Abre `https://TU-APP.vercel.app/api/health`: debe responder `{"ok":true}`.
4. Entra a `https://TU-APP.vercel.app/admin` con el administrador del paso 3 y cambia la contraseña temporal.
5. En **Vendedores → Nueva cuenta** da de alta a cada vendedor; cada uno entra desde `https://TU-APP.vercel.app` en su teléfono e instala la app («Agregar a pantalla de inicio»).

Conviene que la función de Vercel y la base estén en la misma región (Railway: *US East*; Vercel: `iad1`, la predeterminada) para que cada consulta tarde menos.

## 5. Después

- **Respaldos:** en Railway, servicio Postgres → **Backups**: activa los respaldos programados.
- **Seguridad de la base:** la dirección pública de Railway queda abierta a internet protegida sólo por la clave. Usa la clave larga que genera Railway y no la compartas. Si se filtra, en Railway: Postgres → Variables → regenera `PGPASSWORD`, y actualiza `DATABASE_URL` en Vercel.
- **Cambios de esquema futuros:** van en `db/migraciones/NNN_*.sql` (repetibles) y se aplican con `npm run db:migrar` antes de desplegar la versión que los usa.
- **Rotar el pepper:** pon el actual en `AUTH_PEPPER_ANTERIOR` y uno nuevo en `AUTH_PEPPER_SECRET`; cuando todos hayan vuelto a entrar, borra `AUTH_PEPPER_ANTERIOR`.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `db:probar`: «No conecta con la base … ENOTFOUND postgres.railway.internal» | Copiaste la `DATABASE_URL` privada; usa la `DATABASE_PUBLIC_URL` |
| «self-signed certificate» o «unable to verify» | `DB_SSL_CA` no es el certificado que presenta la base (o Railway lo regeneró): vuelve a copiarlo, o quita `DB_SSL_CA` |
| La API no arranca: «Falta la variable de entorno …» | Falta esa variable en Vercel (revísalo también con `npm run db:probar`) |
| `/api/health` responde pero el login da 500 | La base no tiene el esquema: corre `npm run db:migrar` |
| El panel muestra números de «mañana» | `ZONA_HORARIA` no es la del negocio |
| Las llamadas fallan con error de CORS | `CORS_ORIGINS` no tiene exactamente la dirección de la app (con `https://`, sin `/` al final) |
