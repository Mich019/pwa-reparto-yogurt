// Crea un administrador con contraseña temporal (debe cambiarla al entrar).
//   npm run db:admin -- tu@correo.com "Tu Nombre"
import pg from 'pg'
import { hashPassword } from '../api/_lib/auth.js'
import { leerConfig } from '../api/_lib/config.js'
import { passwordTemporal } from '../api/_lib/seguridad.js'

const [correo, nombre] = process.argv.slice(2)
if (!correo || !nombre) {
  console.error('Uso: npm run db:admin -- tu@correo.com "Tu Nombre"')
  process.exit(1)
}

const cx = new pg.Client(leerConfig().conexion)
await cx.connect()
try {
  const temporal = passwordTemporal()
  const { rows } = await cx.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password)
     VALUES ($1, $2, $3, 'administrador', true)
     ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
    [nombre, correo.trim(), await hashPassword(temporal)],
  )
  if (!rows[0]) {
    console.error(`Ya existe una cuenta con ${correo}. Usa "¿Olvidaste tu contraseña?" en el panel.`)
    process.exitCode = 1
  } else {
    console.log(`\nAdministrador creado: ${correo}\nContraseña temporal: ${temporal}\n(Se pedirá cambiarla al entrar en /admin/)`)
  }
} finally {
  await cx.end()
}
