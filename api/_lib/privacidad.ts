import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { leerAjustes } from './ajustes.js'
import type { Bitacora } from './bitacora.js'
import { hashPassword, PASSWORD_MAX, verificarPassword } from './contrasenas.js'
import { correoBajaEmpresa, correoCuentaEliminada, enviarCorreo, enviarCorreos } from './correo.js'
import { tx, type Cx, type Db } from './db.js'
import { tieneDosPasos, usarCodigo } from './dosPasos.js'
import type { ClienteMp } from './mercadopago.js'
import { tokenAleatorio } from './seguridad.js'

// Privacidad y derechos ARCO (LFPDPPP). Lo que cada cuenta puede hacer con sus datos sin pedírselo a nadie:
// - Aceptar el aviso de privacidad y los términos (POST /me/legal); `legal_version` guarda cuál. Al cambiar VERSION_LEGAL
//   (y los textos de src/views/legal/), todas las cuentas los vuelven a ver al entrar.
// - Acceso: GET /me/datos (sus datos personales) y, el administrador, GET /empresa/datos/:tabla (todo lo de la empresa,
//   por páginas: en Vercel una respuesta no puede pasar de 4.5 MB).
// - Cancelación: POST /me/eliminar anonimiza la cuenta (no se borra la fila: sus ventas siguen en los libros de la empresa,
//   que debe guardarlos 5 años, CFF art. 30) y POST /empresa/baja suspende la empresa, cancela su suscripción y deja
//   programado el borrado de todo lo suyo a los DIAS_BAJA días (lo hace el cron diario, purgarBajas).
// - Rectificación: PATCH /me (auth.ts). Oposición: los avisos push se apagan en Cuenta.
// Todo funciona aunque la suscripción esté vencida: los derechos no dependen de pagar.

// Debe ser igual a VERSION_LEGAL de src/lib/legal.ts (lo revisa privacidad.test.ts).
export const VERSION_LEGAL = '2026-11-05'
export const DIAS_BAJA = 30

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
// Los cambios que podrían dejar a una empresa sin administrador activo van de uno en uno (igual que usuarios.ts).
const CERRADURA_ADMINS = 7001

const bodyLegal = z.object({ version: z.string().max(20) })
const bodyConfirmar = z.object({ password: z.string().min(1).max(PASSWORD_MAX), codigo: z.string().trim().max(20).optional() })
const bodyBaja = bodyConfirmar.extend({ nombre: z.string().trim().max(120), motivo: z.string().trim().max(300).optional() })

// Lo que se exporta de la empresa: cada tabla con su llave (para pedirla por páginas, en orden) y sin id_empresa.
const TABLAS: Record<string, string> = {
  clientes: 'id_cliente::text',
  productos: 'id_producto::text',
  pedidos: 'id_pedido::text',
  detalle_pedido: 'id_detalle_pedido::text',
  recordatorios: 'id_recordatorio::text',
  abonos: 'id_abono::text',
  envases_recogidos: 'id_recogida::text',
  precios_cliente: `id_cliente::text || id_producto::text`,
  cortes_dia: 'id_corte::text',
  cierres_mes: 'id_cierre::text',
  stock_diario: 'id_stock::text',
  produccion_diaria: `fecha::text || id_producto::text`,
}
const PAGINA = 2000

// Contraseña (y código de dos pasos si lo tiene) otra vez: un teléfono abierto en manos de otro no basta para borrar.
// Si no coincide, 403 y no 401: la app tomaría un 401 por sesión vencida y lo reintentaría.
async function confirmarIdentidad(db: Db, config: Contexto['config'], id: string, b: z.infer<typeof bodyConfirmar>) {
  const { rows: [u] } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [id])
  if (!u || !(await verificarPassword(config, u.password_hash, b.password)).ok) return 'La contraseña no es correcta'
  if (await tieneDosPasos(db, id)) {
    if (!b.codigo) return 'Escribe el código de tu app de verificación'
    if (!(await usarCodigo(db, config, id, b.codigo))) return 'El código no es correcto o ya se usó'
  }
  return null
}

// Quita los datos personales de una cuenta y todo lo que permitía entrar con ella. Quedan el id, el rol y las fechas,
// para que sus ventas, cortes y abonos sigan cuadrando («Cuenta eliminada» en reportes).
export async function anonimizarCuenta(c: Cx, config: Contexto['config'], id: string) {
  const inservible = await hashPassword(config, tokenAleatorio()) // nadie la conoce: ya no se puede entrar
  const { rows: [antes] } = await c.query(`SELECT correo FROM usuarios WHERE id_usuario = $1`, [id])
  await c.query(
    `UPDATE usuarios SET nombre = 'Cuenta eliminada', correo = 'eliminada-' || id_usuario || '@cuenta-eliminada.invalid', telefono = NULL, foto = NULL,
            password_hash = $2, activo = false, es_plataforma = false, debe_cambiar_password = false, meta_mensual = NULL, eliminado_en = now()
      WHERE id_usuario = $1`,
    [id, inservible],
  )
  // La bitácora guardaba sus datos de antes (también los de este mismo cambio).
  await c.query(
    `UPDATE auditoria SET datos_antes = datos_antes - ARRAY['nombre', 'correo', 'telefono', 'foto'], datos_despues = datos_despues - ARRAY['nombre', 'correo', 'telefono', 'foto']
      WHERE tabla = 'usuarios' AND id_registro = $1`,
    [id],
  )
  for (const t of ['sesiones', 'suscripciones_push', 'notificaciones', 'dos_pasos', 'recuperaciones_password']) {
    await c.query(`DELETE FROM ${t} WHERE id_usuario = $1`, [id])
  }
  // Los intentos de entrada guardan el correo y la IP, también los de antes de saber de qué cuenta eran.
  await c.query(`DELETE FROM intentos_login WHERE id_usuario = $1 OR lower(correo) = lower($2)`, [id, antes?.correo ?? ''])
  // Sus clientes quedan sin vendedor: el administrador los reparte desde Vendedores («sin asignar»).
  await c.query(`UPDATE clientes SET id_vendedor = NULL WHERE id_vendedor = $1`, [id])
}

// Borra una empresa con todo lo suyo. Como dueño de la base y dentro de una transacción. Se intenta tabla por tabla y se
// repite: las llaves foráneas piden un orden y algunos triggers (bitácora, eliminaciones) agregan renglones al borrar.
// Los cierres de mes van primero: mientras existan, sus meses no dejan borrar pedidos ni abonos.
export async function borrarEmpresa(c: Pick<Cx, 'query'>, idEmpresa: string) {
  await c.query(`SELECT set_config('app.permitir_correccion', 'on', true)`)
  await c.query(`DELETE FROM cierres_mes WHERE id_empresa = $1`, [idEmpresa])
  const { rows: tablas } = await c.query<{ t: string }>(
    `SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables x USING (table_schema, table_name)
      WHERE c.table_schema = current_schema() AND c.column_name = 'id_empresa' AND x.table_type = 'BASE TABLE' AND c.table_name <> 'empresas'`,
  )
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    let quedan = 0
    for (const { t } of tablas) {
      await c.query('SAVEPOINT s')
      try {
        await c.query(`DELETE FROM "${t.replace(/"/g, '""')}" WHERE id_empresa = $1`, [idEmpresa])
        await c.query('RELEASE SAVEPOINT s')
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT s')
        quedan++
      }
    }
    await c.query('SAVEPOINT s')
    try {
      await c.query(`DELETE FROM empresas WHERE id_empresa = $1`, [idEmpresa])
      return
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s')
      if (!quedan && vuelta > 2) throw e
    }
  }
  throw new Error('No se pudo borrar la empresa')
}

// Las empresas cuya baja ya venció se borran. Lo llama el cron diario (plataforma.ts) con el pool sin empresa.
export async function purgarBajas(db: Db, log: Bitacora) {
  const { rows } = await db.query(`SELECT id_empresa FROM empresas WHERE baja_borrar_en <= now() AND NOT interna`)
  let borradas = 0
  for (const { id_empresa } of rows) {
    try {
      await tx(db, null, (c) => borrarEmpresa(c, id_empresa))
      borradas++
      log.info({ empresa: id_empresa }, 'privacidad: empresa dada de baja, borrada')
    } catch (e) {
      log.error({ err: e, empresa: id_empresa }, 'privacidad: no se pudo borrar una empresa dada de baja')
    }
  }
  return borradas
}

export async function rutasPrivacidad(
  app: FastifyInstance,
  { db, config }: Contexto,
  mp: ClienteMp | null,
  { requiereSesionAunConPasswordPendiente, requiereSesionSinCobro, requiereAdminSinCobro }: { requiereSesionAunConPasswordPendiente: Guardia; requiereSesionSinCobro: Guardia; requiereAdminSinCobro: Guardia },
) {
  const limite = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

  app.post('/me/legal', { preHandler: requiereSesionAunConPasswordPendiente }, async (req, rep) => {
    const b = bodyLegal.safeParse(req.body)
    if (!b.success || b.data.version !== VERSION_LEGAL) return rep.code(409).send({ error: 'Hay una versión más nueva del aviso: recarga la página', codigo: 'VERSION_LEGAL' })
    await db.query(`UPDATE usuarios SET legal_version = $2, legal_aceptado_en = now() WHERE id_usuario = $1`, [req.usuario.id, VERSION_LEGAL])
    return { version: VERSION_LEGAL }
  })

  // Derecho de acceso: todo lo que Delisy guarda de la persona (sin contraseñas ni secretos de dos pasos).
  app.get('/me/datos', { preHandler: requiereSesionSinCobro, config: limite }, async (req) => {
    const [{ rows: [u] }, { rows: sesiones }, { rows: [dp] }, { rows: [act] }] = await Promise.all([
      db.query(
        `SELECT u.nombre, u.correo, u.telefono, u.foto, u.rol, u.activo, u.comision_pct::float8, u.meta_mensual::float8, u.creado_en, u.ultimo_acceso,
                u.password_cambiado_en, u.legal_version, u.legal_aceptado_en, e.nombre AS empresa
           FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
        [req.usuario.id],
      ),
      db.query(`SELECT dispositivo, host(ip) AS ip, creado_en, expira_en, revocado_en FROM sesiones WHERE id_usuario = $1 ORDER BY creado_en DESC`, [req.usuario.id]),
      db.query(`SELECT activado_en FROM dos_pasos WHERE id_usuario = $1`, [req.usuario.id]),
      db.query(
        `SELECT (SELECT count(*) FROM pedidos WHERE id_vendedor = $1)::int AS pedidos, (SELECT count(*) FROM clientes WHERE id_vendedor = $1)::int AS clientes,
                (SELECT count(*) FROM suscripciones_push WHERE id_usuario = $1)::int AS dispositivos_avisos`,
        [req.usuario.id],
      ),
    ])
    return {
      generado: new Date().toISOString(),
      responsable: 'Delisy (la plataforma) para tu cuenta; tu empresa para los datos de sus clientes y ventas.',
      cuenta: {
        nombre: u.nombre, correo: u.correo, telefono: u.telefono, foto: u.foto, rol: u.rol, activa: u.activo, empresa: u.empresa,
        comisionPct: u.comision_pct, metaMensual: u.meta_mensual, alta: u.creado_en, ultimoAcceso: u.ultimo_acceso, passwordCambiado: u.password_cambiado_en,
      },
      aceptaciones: { version: u.legal_version, aceptado: u.legal_aceptado_en },
      verificacionEnDosPasos: dp?.activado_en ? { activadaEl: dp.activado_en } : null,
      sesiones,
      actividad: { pedidosRegistrados: act.pedidos, clientesEnTuCartera: act.clientes, dispositivosConAvisos: act.dispositivos_avisos },
    }
  })

  // Derecho de cancelación de la cuenta propia. El último administrador activo no puede: dejaría a la empresa sin quien la
  // maneje (que nombre a otro o dé de baja la empresa). Las cuentas de la plataforma se quitan por consola.
  app.post('/me/eliminar', { preHandler: requiereSesionSinCobro, config: limite }, async (req, rep) => {
    const b = bodyConfirmar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Escribe tu contraseña para confirmar' })
    const { rows: [yo] } = await db.query(
      `SELECT u.nombre, u.correo, u.es_plataforma, e.nombre AS empresa FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
      [req.usuario.id],
    )
    if (yo.es_plataforma) return rep.code(409).send({ error: 'Las cuentas de la plataforma se eliminan desde la consola', codigo: 'CUENTA_PLATAFORMA' })
    const falla = await confirmarIdentidad(db, config, req.usuario.id, b.data)
    if (falla) return rep.code(403).send({ error: falla, codigo: 'NO_CONFIRMADO' })
    const ok = await tx(db, req.usuario.id, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock($1)`, [CERRADURA_ADMINS])
      if (req.usuario.rol === 'administrador') {
        const { rows } = await c.query(`SELECT 1 FROM usuarios WHERE rol = 'administrador' AND activo AND id_usuario <> $1 LIMIT 1`, [req.usuario.id])
        if (!rows.length) return false
      }
      await anonimizarCuenta(c, config, req.usuario.id)
      return true
    })
    if (!ok) {
      return rep.code(409).send({
        error: 'Eres el único administrador. Nombra a otro administrador en Vendedores o da de baja la empresa.',
        codigo: 'ULTIMO_ADMIN',
      })
    }
    req.log.info({ usuario: req.usuario.id }, 'privacidad: cuenta eliminada por su dueño')
    await enviarCorreo(config, { para: yo.correo, ...correoCuentaEliminada(yo.nombre, yo.empresa) }, req.log).catch((e) => req.log.warn({ err: e }, 'privacidad: constancia no enviada'))
    return rep.code(204).send()
  })

  // Derecho de acceso de la empresa (y portabilidad): sus tablas por páginas, en el orden de su llave.
  app.get('/empresa/datos', { preHandler: requiereAdminSinCobro }, async (req) => {
    const { rows: [e] } = await db.query(
      `SELECT nombre, zona_horaria, color_marca, lema, contacto, giros, control_retornables, creado_en, prueba_hasta, suscripcion_estado FROM empresas WHERE id_empresa = $1`,
      [req.usuario.empresa],
    )
    const { rows: usuarios } = await db.query(
      `SELECT id_usuario, nombre, correo, telefono, rol, activo, comision_pct::float8, meta_mensual::float8, creado_en, ultimo_acceso, eliminado_en FROM usuarios ORDER BY creado_en`,
    )
    return { generado: new Date().toISOString(), empresa: e, usuarios, tablas: Object.keys(TABLAS) }
  })

  app.get('/empresa/datos/:tabla', { preHandler: requiereAdminSinCobro, config: { rateLimit: { max: 600, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const { tabla } = req.params as { tabla: string }
    const llave = Object.hasOwn(TABLAS, tabla) ? TABLAS[tabla] : undefined
    if (!llave) return rep.code(404).send({ error: 'Esa tabla no se exporta' })
    const desde = String((req.query as { desde?: string }).desde ?? '').slice(0, 200)
    const { rows } = await db.query(
      `SELECT ${llave} AS llave, to_jsonb(t) - 'id_empresa' AS fila FROM ${tabla} t WHERE ${llave} > $1 ORDER BY ${llave} LIMIT ${PAGINA}`,
      [desde],
    )
    return { filas: rows.map((r) => r.fila), siguiente: rows.length === PAGINA ? rows[rows.length - 1].llave : null }
  })

  // Baja de la empresa (cancelación del servicio). Se confirma con la contraseña y escribiendo el nombre de la empresa.
  // Al instante: suscripción cancelada en Mercado Pago, nadie entra (empresas.activa) y todas las sesiones cerradas.
  // Los datos se guardan DIAS_BAJA días por si se arrepiente (la plataforma la reactiva) y luego se borran.
  app.post('/empresa/baja', { preHandler: requiereAdminSinCobro, config: limite }, async (req, rep) => {
    const b = bodyBaja.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Escribe tu contraseña y el nombre de la empresa para confirmar' })
    const { rows: [e] } = await db.query(
      `SELECT nombre, interna, mp_preapproval_id, suscripcion_estado FROM empresas WHERE id_empresa = $1`,
      [req.usuario.empresa],
    )
    if (e.interna) return rep.code(409).send({ error: 'La empresa de la plataforma no se puede dar de baja', codigo: 'EMPRESA_INTERNA' })
    if (b.data.nombre.toLocaleLowerCase('es') !== String(e.nombre).trim().toLocaleLowerCase('es')) {
      return rep.code(400).send({ error: 'El nombre no coincide con el de tu empresa', codigo: 'NOMBRE_DISTINTO' })
    }
    const falla = await confirmarIdentidad(db, config, req.usuario.id, b.data)
    if (falla) return rep.code(403).send({ error: falla, codigo: 'NO_CONFIRMADO' })
    // Primero el cobro: si Mercado Pago no responde, no se da de baja (seguiría cobrando a una empresa sin acceso).
    if (e.mp_preapproval_id && e.suscripcion_estado && e.suscripcion_estado !== 'cancelled') {
      if (!mp) return rep.code(503).send({ error: 'No pudimos cancelar tu suscripción ahora. Intenta en unos minutos.', codigo: 'COBRO_NO_CONFIGURADO' })
      try {
        await mp.cancelar(e.mp_preapproval_id)
      } catch (err) {
        req.log.warn({ err }, 'privacidad: Mercado Pago no canceló la suscripción')
        return rep.code(503).send({ error: 'No pudimos cancelar tu suscripción ahora. Intenta en unos minutos.', codigo: 'MP_NO_RESPONDE' })
      }
    }
    const r = await tx(db, req.usuario.id, async (c) => {
      const { rows: [x] } = await c.query(
        `UPDATE empresas SET activa = false, suscripcion_estado = CASE WHEN mp_preapproval_id IS NULL THEN suscripcion_estado ELSE 'cancelled' END,
                baja_solicitada_en = now(), baja_borrar_en = now() + make_interval(days => $2), baja_motivo = $3, actualizado_en = now()
          WHERE id_empresa = $1 RETURNING baja_borrar_en`,
        [req.usuario.empresa, DIAS_BAJA, b.data.motivo || null],
      )
      await c.query(`UPDATE sesiones s SET revocado_en = now() FROM usuarios u WHERE u.id_usuario = s.id_usuario AND s.revocado_en IS NULL`)
      await c.query(`DELETE FROM suscripciones_push`)
      const { rows: admins } = await c.query(`SELECT nombre, correo FROM usuarios WHERE rol = 'administrador' AND activo`)
      return { borrarEn: x.baja_borrar_en as Date, admins }
    })
    req.log.info({ empresa: req.usuario.empresa, por: req.usuario.id }, 'privacidad: baja de empresa')
    const { correoSoporte } = await leerAjustes(db, config)
    await enviarCorreos(config, r.admins.map((a) => ({ para: a.correo, ...correoBajaEmpresa(a.nombre, e.nombre, r.borrarEn, correoSoporte) })), req.log)
      .catch((err) => req.log.warn({ err }, 'privacidad: aviso de baja no enviado'))
    return { borrarEn: r.borrarEn }
  })
}
