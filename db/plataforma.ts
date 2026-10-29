// Da de alta una cuenta de la plataforma (/plataforma), o pasa ahí una que ya existe.
//   npm run db:plataforma -- tu@correo.com "Tu Nombre"
//
// Las cuentas de la plataforma viven en la empresa interna «Plataforma» con la marca es_plataforma: no administran ningún
// negocio y nadie de un negocio las ve ni las toca. Sólo se hace por consola (con acceso de dueño a la base) o desde el
// propio panel por alguien que ya lo administra. Para entrar al panel hace falta además la verificación en dos pasos.
import pg from 'pg'
import { hashPassword } from '../api/_lib/contrasenas.js'
import { leerConfig } from '../api/_lib/config.js'
import { passwordTemporal } from '../api/_lib/seguridad.js'

const [correo, nombre] = process.argv.slice(2)
if (!correo || !nombre) {
  console.error('Uso: npm run db:plataforma -- tu@correo.com "Tu Nombre"')
  process.exit(1)
}

const config = leerConfig()
const cx = new pg.Client(config.conexion)
await cx.connect()
try {
  await cx.query('BEGIN')
  await cx.query(`SELECT pg_advisory_xact_lock(hashtext('empresa-interna'))`)
  let { rows: [interna] } = await cx.query(`SELECT id_empresa FROM empresas WHERE interna ORDER BY creado_en LIMIT 1`)
  if (!interna) interna = (await cx.query(`INSERT INTO empresas (nombre, interna, exenta) VALUES ('Plataforma', true, true) RETURNING id_empresa`)).rows[0]

  const { rows: [ya] } = await cx.query(
    `SELECT u.id_usuario, u.id_empresa, u.rol, u.activo, e.nombre AS empresa FROM usuarios u JOIN empresas e USING (id_empresa) WHERE lower(u.correo) = lower($1)`,
    [correo.trim()],
  )
  if (!ya) {
    const temporal = passwordTemporal()
    await cx.query(
      `INSERT INTO usuarios (id_empresa, nombre, correo, password_hash, rol, debe_cambiar_password, es_plataforma) VALUES ($1, $2, $3, $4, 'administrador', true, true)`,
      [interna.id_empresa, nombre, correo.trim(), await hashPassword(config, temporal)],
    )
    await cx.query('COMMIT')
    console.log(`\nCuenta de la plataforma creada: ${correo}\nContraseña temporal: ${temporal}\n(Se pedirá cambiarla al entrar; luego activa la verificación en dos pasos.)`)
  } else if (ya.id_empresa === interna.id_empresa) {
    await cx.query(`UPDATE usuarios SET es_plataforma = true, activo = true WHERE id_usuario = $1`, [ya.id_usuario])
    await cx.query('COMMIT')
    console.log(`\n${correo} ya era de la plataforma: queda activa.`)
  } else {
    // Pasarla deja de hacerla administradora de su empresa: que esa empresa no se quede sin nadie que la administre.
    const { rows: [n] } = await cx.query(
      `SELECT count(*)::int AS n FROM usuarios WHERE id_empresa = $1 AND rol = 'administrador' AND activo AND id_usuario <> $2`,
      [ya.id_empresa, ya.id_usuario],
    )
    if (n.n === 0) throw new Error(`${correo} es el único administrador de «${ya.empresa}». Crea otro administrador ahí antes de pasarla a la plataforma.`)
    // Sus sesiones abiertas eran de la empresa anterior: se cierran. Si tiene clientes, pedidos o stock a su nombre, las
    // llaves compuestas (misma empresa) lo impiden y no se cambia nada.
    await cx.query(`UPDATE usuarios SET id_empresa = $2, rol = 'administrador', es_plataforma = true, activo = true WHERE id_usuario = $1`, [ya.id_usuario, interna.id_empresa])
    await cx.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL`, [ya.id_usuario])
    await cx.query('COMMIT')
    console.log(`\n${correo} pasó de «${ya.empresa}» a la plataforma (ya no administra esa empresa). Vuelve a iniciar sesión.`)
  }
} catch (e) {
  await cx.query('ROLLBACK').catch(() => {})
  const err = e as { code?: string; message: string }
  console.error(err.code === '23503' ? `${correo} tiene clientes, pedidos o stock en su empresa: usa otro correo para la plataforma.` : err.message)
  process.exitCode = 1
} finally {
  await cx.end()
}
