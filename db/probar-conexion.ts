// Revisa, sin cambiar nada, que la API pueda trabajar con la base del .env (o la de Railway con `railway run`).
//   npm run db:probar
// Dice si las variables están bien, si conecta, si la conexión va cifrada, y si la base ya tiene el esquema
// y las migraciones. Todo dentro de una transacción de sólo lectura.
import pg from 'pg'
import { leerConfig, type Config } from '../api/_lib/config.js'

let config: Config
try {
  config = leerConfig()
} catch (e) {
  console.error(`✗ Variables de entorno: ${(e as Error).message}`)
  process.exit(1)
}
console.log('✓ Variables de entorno completas')
if (config.produccion && config.corsOrigins.some((o) => o.startsWith('http://') && !o.includes('localhost'))) {
  console.warn('! CORS_ORIGINS tiene un origen http:// que no es localhost; en producción usa https://')
}

const cx = new pg.Client(config.conexion)
try {
  await cx.connect()
} catch (e) {
  console.error(`✗ No conecta con la base: ${(e as Error).message}`)
  console.error('  Revisa DATABASE_URL. Desde fuera de Railway usa la DATABASE_PUBLIC_URL del servicio Postgres.')
  process.exit(1)
}

try {
  await cx.query('BEGIN READ ONLY')
  const { rows: [info] } = await cx.query(
    `SELECT current_setting('server_version') AS version, current_database() AS base,
            coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS cifrada`,
  )
  console.log(`✓ Conectada a «${info.base}» (PostgreSQL ${info.version}), conexión ${info.cifrada ? 'cifrada (SSL)' : 'SIN cifrar'}`)
  const local = /^(localhost|127\.|::1|.*\.railway\.internal$)/.test(new URL(cx.host.includes(':') ? `http://[${cx.host}]` : `http://${cx.host}`).hostname)
  if (!info.cifrada && !local) console.warn('! La conexión viaja sin cifrar por internet: pon DB_SSL=true')
  if (Number.parseInt(info.version, 10) < 15) console.warn('! Se necesita PostgreSQL 15 o más nuevo (vistas con security_invoker, multiempresa)')

  const esquema = (await cx.query(`SELECT 1 FROM pg_proc WHERE proname = 'fn_marcar_actualizacion'`)).rowCount === 1
  if (!esquema) {
    const otras = (await cx.query(`SELECT to_regclass('public.usuarios') IS NOT NULL AS hay`)).rows[0].hay
    console.log(otras
      ? '✗ La base tiene tablas que no son las de db/01_esquema.sql: npm run db:migrar -- --reiniciar (borra esas tablas)'
      : '· La base está vacía: créala con  npm run db:migrar  y luego  npm run db:admin -- tu@correo.com "Tu Nombre"')
  } else {
    // Una columna de cada migración: si falta alguna, hay que correr db:migrar.
    const { rows: [m] } = await cx.query(
      `SELECT to_regclass('public.retiros_vendedor') IS NOT NULL AS m002,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recuperaciones_password' AND column_name = 'intentos') AS m003,
              to_regclass('public.produccion_diaria') IS NOT NULL AS m004,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'password_cambiado_en') AS m005,
              to_regclass('public.dos_pasos') IS NOT NULL AS m006,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'id_empresa') AS m007,
              to_regclass('public.invitaciones') IS NOT NULL AS m008`,
    )
    const faltan = Object.entries(m).filter(([, ok]) => !ok).map(([k]) => k.slice(1))
    console.log(faltan.length ? `✗ Esquema creado, pero faltan migraciones (${faltan.join(', ')}): npm run db:migrar` : '✓ Esquema y migraciones al día')
    const { rows: [u] } = await cx.query(
      `SELECT count(*) FILTER (WHERE rol = 'administrador' AND activo)::int AS admins, count(*)::int AS total,
              count(*) FILTER (WHERE correo LIKE '%@yogurt.local')::int AS demo
         FROM usuarios`,
    )
    console.log(u.admins ? `✓ ${u.admins} administrador(es) activo(s), ${u.total} cuenta(s) en total` : '· Sin administradores: npm run db:admin -- tu@correo.com "Tu Nombre"')
    if (u.demo && config.produccion) console.warn('! Hay cuentas de demostración (@yogurt.local) en una base de producción: dalas de baja')
  }
} finally {
  await cx.query('ROLLBACK').catch(() => {})
  await cx.end()
}
