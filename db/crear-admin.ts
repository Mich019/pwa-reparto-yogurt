// Crea un administrador con contraseña temporal (debe cambiarla al entrar).
//   npm run db:admin -- tu@correo.com "Tu Nombre"
//   npm run db:admin -- tu@correo.com "Tu Nombre" --empresa "Lácteos La Vaquita"
//
// Multiempresa: la cuenta es de una empresa. Sin --empresa, la única que haya en la base. Con --empresa, la que se
// llame así (o tenga ese id); si no existe, se crea (así se da de alta una empresa nueva mientras no haya registro).
import pg from 'pg'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { leerConfig } from '../api/_lib/config.js'
import { passwordTemporal } from '../api/_lib/seguridad.js'

const args = process.argv.slice(2)
const i = args.indexOf('--empresa')
const empresaPedida = i >= 0 ? args[i + 1]?.trim() : undefined
const [correo, nombre] = i >= 0 ? [...args.slice(0, i), ...args.slice(i + 2)] : args
if (!correo || !nombre || (i >= 0 && !empresaPedida)) {
  console.error('Uso: npm run db:admin -- tu@correo.com "Tu Nombre" [--empresa "Nombre de la empresa"]')
  process.exit(1)
}

const config = leerConfig()
const cx = new pg.Client(config.conexion)
await cx.connect()
try {
  await cx.query('BEGIN')
  let empresa: { id_empresa: string; nombre: string; nueva?: boolean } | undefined
  if (empresaPedida) {
    const { rows } = await cx.query(
      `SELECT id_empresa, nombre FROM empresas WHERE id_empresa::text = $1 OR lower(nombre) = lower($1) ORDER BY creado_en`,
      [empresaPedida],
    )
    if (rows.length > 1) throw new Error(`Hay ${rows.length} empresas con ese nombre: usa su id en --empresa`)
    empresa = rows[0] ?? { ...(await cx.query(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id_empresa, nombre`, [empresaPedida])).rows[0], nueva: true }
  } else {
    const { rows } = await cx.query(`SELECT id_empresa, nombre FROM empresas ORDER BY creado_en`)
    if (rows.length !== 1) {
      throw new Error(rows.length
        ? `La base tiene ${rows.length} empresas; di cuál con --empresa:\n${rows.map((e) => `  ${e.nombre}  (${e.id_empresa})`).join('\n')}`
        : 'La base no tiene empresas: corre npm run db:migrar')
    }
    empresa = rows[0]
  }

  const temporal = passwordTemporal()
  const { rows } = await cx.query(
    `INSERT INTO usuarios (id_empresa, nombre, correo, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, 'administrador', true)
     ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
    [empresa!.id_empresa, nombre, correo.trim(), await hashPassword(config, temporal)],
  )
  if (!rows[0]) {
    await cx.query('ROLLBACK') // no deja creada una empresa vacía
    console.error(`Ya existe una cuenta con ${correo}. Usa "¿Olvidaste tu contraseña?" en el panel.`)
    process.exitCode = 1
  } else {
    await cx.query('COMMIT')
    console.log(`\n${empresa!.nueva ? 'Empresa creada' : 'Empresa'}: ${empresa!.nombre}`)
    console.log(`Administrador creado: ${correo}\nContraseña temporal: ${temporal}\n(Se pedirá cambiarla al entrar en /admin/)`)
  }
} catch (e) {
  await cx.query('ROLLBACK').catch(() => {})
  console.error((e as Error).message)
  process.exitCode = 1
} finally {
  await cx.end()
}
