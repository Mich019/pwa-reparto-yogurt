// Copia local para revisar pantallas sin tocar producción: crea (o rehace) una base en un Postgres de esta máquina con
// los datos demo (04_datos_demo.sql) y la empresa de volumen «Delisy Pruebas» (datos-prueba.ts: litros, kilos y piezas,
// 4 meses de pedidos), y deja todas sus cuentas con una misma contraseña conocida, sin pedir cambiarla y con el aviso
// legal aceptado, para entrar directo.
//
//   VISTA_URL=postgres://postgres@127.0.0.1:5432/delisy_vista npm run db:vista
//   VISTA_URL=… VISTA_PASSWORD=otra npm run db:vista -- --rehacer     (borra esa base y la vuelve a crear)
//
// Sólo acepta un servidor en esta máquina (localhost / 127.0.0.1 / ::1): nunca toca Supabase ni Railway aunque
// DATABASE_URL apunte ahí. Luego, la API y la app contra esa copia (en otra terminal cada una):
//   PORT=3100 DATABASE_URL=$VISTA_URL DB_SSL=false CORS_ORIGINS=http://localhost:5199 HORA_AVISO_PRODUCCION=no npx tsx --env-file-if-exists=.env api/_lib/servidor.ts
//   VITE_API_URL=http://localhost:3100 npx vite --port 5199 --strictPort
// y entra en http://localhost:5199/admin con admin@yogurt.local o admin@pruebas.delisy.test.
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { leerConfig } from '../api/_lib/config.js'
import { VERSION_LEGAL } from '../api/_lib/privacidad.js'

const url = process.env.VISTA_URL
if (!url) throw new Error('Falta VISTA_URL (p. ej. postgres://postgres@127.0.0.1:5432/delisy_vista)')
const destino = new URL(url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(destino.hostname)) throw new Error(`VISTA_URL debe ser un Postgres de esta máquina, no ${destino.hostname}`)
const base = destino.pathname.slice(1)
if (!/^[a-z_][a-z0-9_]*$/.test(base)) throw new Error('El nombre de la base sólo puede llevar minúsculas, números y _')
const password = process.env.VISTA_PASSWORD ?? 'Delisy-local-2026'
if (password.length < 10) throw new Error('VISTA_PASSWORD necesita al menos 10 caracteres')

// La base se crea desde la de mantenimiento del mismo servidor.
const mantenimiento = new URL(url)
mantenimiento.pathname = '/postgres'
const adm = new pg.Client({ connectionString: mantenimiento.toString() })
await adm.connect()
const { rowCount: existe } = await adm.query('SELECT 1 FROM pg_database WHERE datname = $1', [base])
if (existe && process.argv.includes('--rehacer')) await adm.query(`DROP DATABASE ${base} WITH (FORCE)`)
if (!existe || process.argv.includes('--rehacer')) await adm.query(`CREATE DATABASE ${base}`)
await adm.end()

// Las mismas herramientas de siempre, apuntadas a la copia (sus contraseñas temporales no se muestran).
const env = { ...process.env, DATABASE_URL: url, DB_SSL: 'false' }
const correr = (script: string, ...args: string[]) =>
  execFileSync(process.execPath, ['--import', 'tsx', '--env-file-if-exists=.env', script, ...args], { env, stdio: ['ignore', 'pipe', 'inherit'] })
correr('db/migrar.ts', '--demo')
console.log(String(correr('db/datos-prueba.ts')).split('\n').filter((l) => /creada|Ya existe/.test(l)).join('\n'))

const config = leerConfig()
const cx = new pg.Client({ connectionString: url })
await cx.connect()
const { rowCount } = await cx.query(
  `UPDATE usuarios SET password_hash = $1, debe_cambiar_password = false, legal_version = $2
    WHERE correo IN ('admin@yogurt.local', 'vendedor@yogurt.local') OR correo LIKE '%@pruebas.delisy.test'`,
  [await hashPassword(config, password), VERSION_LEGAL],
)
await cx.end()
console.log(`Listo: ${rowCount} cuentas con la contraseña ${process.env.VISTA_PASSWORD ? 'de VISTA_PASSWORD' : 'de la copia local (Delisy-local-2026)'}.`)
