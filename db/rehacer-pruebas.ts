// Rehace desde cero la base de las pruebas de la API (la misma que usa api/_test/ayuda.ts), como la arma CI: esquema,
// vistas y datos iniciales, sin demo. Cada corrida de `npm run test:api` deja cuentas y empresas nuevas; tras muchas, la
// primera empresa junta miles de usuarios, las consultas pasan del statement_timeout (30 s) y las pruebas fallan al azar.
//
//   npm run db:test                                   (postgres://postgres:test@localhost:5432/reparto_yogurt_test)
//   DATABASE_URL=postgres://postgres@127.0.0.1:55433/reparto_yogurt_test npm run db:test
//
// Sólo un Postgres de esta máquina y una base cuyo nombre termine en _test: nunca borra otra cosa.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:test@localhost:5432/reparto_yogurt_test'
const destino = new URL(url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(destino.hostname)) throw new Error(`La base de pruebas debe estar en esta máquina, no en ${destino.hostname}`)
const base = destino.pathname.slice(1)
if (!/^[a-z_][a-z0-9_]*_test$/.test(base)) throw new Error('El nombre de la base de pruebas debe terminar en _test (minúsculas, números y _)')

const mantenimiento = new URL(url)
mantenimiento.pathname = '/postgres'
mantenimiento.search = ''
const adm = new pg.Client({ connectionString: mantenimiento.toString() })
await adm.connect()
await adm.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`)
await adm.query(`CREATE DATABASE ${base} ENCODING 'UTF8' TEMPLATE template0`)
await adm.end()

destino.search = ''
const cx = new pg.Client({ connectionString: destino.toString() })
await cx.connect()
for (const f of ['01_esquema', '02_vistas', '03_datos_iniciales']) await cx.query(readFileSync(new URL(`./${f}.sql`, import.meta.url), 'utf8'))
await cx.end()
console.log(`Base de pruebas ${base} rehecha.`)
