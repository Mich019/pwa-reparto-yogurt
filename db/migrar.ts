// Crea o pone al día la base PostgreSQL (Supabase u otra) con los scripts de esta carpeta.
// Lee la conexión del .env de la raíz (las mismas variables que la API).
//
//   npm run db:migrar                      base vacía → 01_esquema + 02_vistas + 03_datos_iniciales
//                                          base ya creada con estos scripts → sólo aplica migraciones/
//   npm run db:migrar -- --demo            además carga 04_datos_demo y muestra las contraseñas temporales
//                                          de admin@yogurt.local y vendedor@yogurt.local (sólo en una base de prueba)
//   npm run db:migrar -- --reiniciar       BORRA las tablas y tipos de la app y la vuelve a crear
//
// --reiniciar hace falta si la base se creó con otro script (p. ej. db.txt): la API usa los
// triggers, vistas y tipos de 01_esquema.sql y no funciona sobre un esquema distinto.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { leerConfig } from '../api/_lib/config.js'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { passwordTemporal } from '../api/_lib/seguridad.js'

const DIR = dirname(fileURLToPath(import.meta.url))
const args = new Set(process.argv.slice(2))
const sql = (f: string) => readFileSync(join(DIR, f), 'utf8')

const TABLAS = [
  'notificaciones', 'suscripciones_push', 'eliminaciones', 'retiros_vendedor', 'operaciones_sync', 'auditoria',
  'recordatorios', 'detalle_pedido', 'pedidos', 'produccion_diaria', 'stock_diario', 'productos', 'clientes',
  'intentos_login', 'recuperaciones_password', 'sesiones', 'usuarios',
]
const TIPOS = [
  // 01_esquema.sql
  'rol_usuario', 'ventana_horario', 'tipo_frecuencia', 'estado_pedido', 'metodo_pago', 'estado_recordatorio', 'estado_sync',
  // db.txt
  'frecuencia_tipo_enum', 'ventana_horario_enum', 'estado_pedido_enum', 'metodo_pago_enum', 'estado_recordatorio_enum',
  'tabla_sync_enum', 'operacion_sync_enum', 'estado_sync_enum',
]

const config = leerConfig()
const cx = new pg.Client(config.conexion)
const cuentasDemo: string[] = []
await cx.connect()

try {
  const existe = async (tabla: string) => (await cx.query(`SELECT to_regclass($1) AS t`, [`public.${tabla}`])).rows[0].t !== null
  const esquemaOficial = async () =>
    (await cx.query(`SELECT 1 FROM pg_proc WHERE proname = 'fn_marcar_actualizacion'`)).rowCount === 1

  if (args.has('--reiniciar')) {
    const { rows } = (await existe('usuarios')) ? await cx.query(`SELECT count(*)::int AS n FROM usuarios`) : { rows: [{ n: 0 }] }
    console.log(`Borrando tablas y tipos de la app (usuarios actuales: ${rows[0].n})…`)
    await cx.query(`BEGIN`)
    await cx.query(`DROP VIEW IF EXISTS v_ruta_del_dia, v_ventas_diarias, v_ventas_por_sabor, v_resumen_cliente CASCADE`)
    await cx.query(`DROP TABLE IF EXISTS ${TABLAS.join(', ')} CASCADE`)
    await cx.query(`DROP TYPE IF EXISTS ${TIPOS.join(', ')} CASCADE`)
    await cx.query(`DROP FUNCTION IF EXISTS fn_marcar_actualizacion, fn_detalle_precios, fn_recalcular_total, fn_detalle_bloqueado, fn_registrar_eliminacion, fn_auditar, fn_pronostico_produccion CASCADE`)
    await cx.query(`COMMIT`)
  }

  if (!(await existe('usuarios'))) {
    for (const f of ['01_esquema.sql', '02_vistas.sql', '03_datos_iniciales.sql']) {
      console.log(`→ ${f}`)
      await cx.query(sql(f))
    }
    if (args.has('--demo')) {
      console.log('→ 04_datos_demo.sql')
      await cx.query(sql('04_datos_demo.sql'))
      // Contraseñas temporales al azar, con el pepper de este servidor: nunca una fija escrita en el repositorio.
      for (const correo of ['admin@yogurt.local', 'vendedor@yogurt.local']) {
        const temporal = passwordTemporal()
        await cx.query(`UPDATE usuarios SET password_hash = $2, debe_cambiar_password = true WHERE correo = $1`, [correo, await hashPassword(config, temporal)])
        cuentasDemo.push(`  ${correo}  ·  ${temporal}`)
      }
    }
  } else if (!(await esquemaOficial())) {
    console.error(
      '\nLa base ya tiene tablas, pero no son las de db/01_esquema.sql (faltan triggers y vistas que usa la API).\n' +
      'Si no tiene datos que quieras conservar, ejecuta:  npm run db:migrar -- --reiniciar\n',
    )
    process.exitCode = 1
  }

  if (process.exitCode !== 1) {
    for (const f of readdirSync(join(DIR, 'migraciones')).filter((f) => f.endsWith('.sql')).sort()) {
      console.log(`→ migraciones/${f}`)
      await cx.query(sql(join('migraciones', f)))
    }
    const { rows } = await cx.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'administrador' AND activo`)
    console.log(`\nBase lista. Administradores activos: ${rows[0].n}.`)
    if (cuentasDemo.length) console.log(`Cuentas de prueba (contraseña temporal; al entrar se pide elegir otra):\n${cuentasDemo.join('\n')}`)
    if (rows[0].n === 0) console.log('Crea el primero con:  npm run db:admin -- tu@correo.com "Tu Nombre"')
  }
} finally {
  await cx.end()
}
