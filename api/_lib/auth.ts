import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Config } from './config.js'
import { hashPassword, PASSWORD_MAX, revisarPassword, verificarPassword, verificarRelleno } from './contrasenas.js'
import { tx, type Db } from './db.js'
import { tieneDosPasos, usarCodigo } from './dosPasos.js'
import { borrarCookiesSesion, fijarCookiesSesion, leerCookie } from './cookies.js'
import { AVISOS_ELEGIBLES } from './notificaciones.js'
import { esPlataforma } from './plataforma.js'
import { VERSION_LEGAL } from './privacidad.js'
import { ipCliente, sha256, tokenAleatorio } from './seguridad.js'

// modo 'cookie': el panel web recibe la sesión en cookies HttpOnly en lugar de en la respuesta (ver cookies.ts).
const modo = z.enum(['token', 'cookie']).default('token')
const bodyLogin = z.object({
  correo: z.string().trim().min(3).max(150),
  password: z.string().min(1).max(PASSWORD_MAX),
  dispositivo: z.string().max(200).optional(),
  modo,
})
// Sin refreshToken, la sesión es la de la cookie.
const bodyRefresh = z.object({ refreshToken: z.string().min(20).max(200).optional() })
const bodyCodigoLogin = z.object({
  desafio: z.string().min(20).max(2000),
  codigo: z.string().trim().min(6).max(20),
  dispositivo: z.string().max(200).optional(),
  modo,
})
// Marca del token que entrega el login cuando falta el segundo paso: no sirve como sesión (ver autenticar en app.ts).
export const DESAFIO = 'dos-pasos'
// La foto llega ya recortada a 256 px por el navegador (src/lib/imagen.ts): unos 20 KB; el tope deja margen.
const foto = z.string().max(200_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
const bodyPerfil = z.object({ nombre: z.string().trim().min(2).max(100).optional(), telefono: z.string().trim().max(20).optional(), foto: foto.nullable().optional(),
  // El orden del menú del panel (views/admin/menu.ts); [] vuelve al de fábrica.
  ordenMenu: z.array(z.string().regex(/^[a-z]{1,20}$/)).max(20).optional(),
  // El color del fondo en el tema claro (src/lib/tema.ts).
  fondo: z.enum(['crema', 'blanco', 'gris']).optional(),
  // Claro, oscuro o el del sistema (src/lib/tema.ts).
  tema: z.enum(['claro', 'oscuro', 'sistema']).optional(),
  // El tamaño de la letra del panel (src/lib/tema.ts).
  tamanoTexto: z.enum(['normal', 'grande', 'mas-grande']).optional(),
  // Los avisos que no quiere recibir (notificaciones.ts, AVISOS_ELEGIBLES); [] = todos.
  avisosApagados: z.array(z.enum(AVISOS_ELEGIBLES)).max(AVISOS_ELEGIBLES.length).optional(),
  // Horario de silencio del push (horas 0–23 en la zona de la empresa; puede pasar de medianoche); null lo quita.
  silencio: z.object({ desde: z.number().int().min(0).max(23), hasta: z.number().int().min(0).max(23) }).strict()
    .refine((s) => s.desde !== s.hasta).nullable().optional(),
  // Resumen diario por correo (resumen.ts): sólo cuenta para administradores.
  resumenCorreo: z.boolean().optional(),
  resumenSemanal: z.boolean().optional(),
  // Día ISO del semanal: 1 = lunes … 7 = domingo.
  resumenSemanalDia: z.number().int().min(1).max(7).optional(),
  // El informe del mes por correo al cerrarlo.
  resumenMensual: z.boolean().optional(),
  // Sus mensajes de WhatsApp (components/Mensajes.tsx); null en uno lo vuelve al de fábrica. Sólo se cambian los que vienen.
  mensajes: z.object({ visita: z.string().trim().min(1).max(500).nullable().optional(), cobro: z.string().trim().min(1).max(500).nullable().optional(), limite: z.string().trim().min(1).max(500).nullable().optional(), camino: z.string().trim().min(1).max(500).nullable().optional() }).strict().optional() }).strict()
const silencioDe = (u: { silencio_desde: number | null; silencio_hasta: number | null }) =>
  u.silencio_desde === null ? null : { desde: u.silencio_desde, hasta: u.silencio_hasta }
const bodyCerrarSesion = z.object({ id: z.string().uuid().optional() }).strict()
const bodyCambio = z.object({ actual: z.string().min(1).max(PASSWORD_MAX), nueva: z.string().max(1000) })

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos'
// Multiempresa: la empresa entera está suspendida (sólo se dice con la contraseña correcta, como la cuenta de baja).
const EMPRESA_SUSPENDIDA = { error: 'La cuenta de tu empresa está suspendida. Habla con el administrador de tu negocio.', codigo: 'EMPRESA_SUSPENDIDA' }

// RF-003: antes de probar una contraseña se revisa el límite de intentos y el intento queda registrado como fallido
// (si resulta correcta, se marca como bueno). Contar y registrar va bajo un candado por IP: los intentos simultáneos
// se forman y no se cuelan en paralelo. Se cuenta igual exista o no la cuenta, así el bloqueo no dice cuáles existen.
// Fallidos que cuentan: los de esa cuenta desde esa IP después de su último acceso bueno desde ahí o de su último
// cambio de contraseña, y todos los de esa IP, dentro de la ventana. Aparte, los de esa cuenta desde cualquier IP
// (después de su último acceso bueno o cambio de contraseña): pasado maxIntentosCuenta frena a quien la prueba desde
// muchas IPs, pero no en una IP donde la cuenta entró bien en los últimos días, para que su dueño no quede fuera.
// null = bloqueado.
async function registrarIntento(db: Db, config: Config, intento: { correo: string; ip: string; idUsuario?: string; passwordCambiadoEn?: Date }) {
  return tx(db, null, async (c) => {
    // Siempre en este orden (IP y luego cuenta), así dos intentos no se esperan en cruz.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('login:' || $1))`, [intento.ip])
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('login-cuenta:' || lower($1)))`, [intento.correo])
    const { rows: [f] } = await c.query(
      `WITH recientes AS (
         SELECT lower(correo) = lower($2) AS misma, exitoso, creado_en
           FROM intentos_login WHERE ip = $1 AND creado_en > now() - make_interval(mins => $3)),
       de_la_cuenta AS (
         SELECT exitoso, creado_en FROM intentos_login
          WHERE lower(correo) = lower($2) AND creado_en > now() - make_interval(mins => $3))
       SELECT count(*) FILTER (WHERE NOT exitoso)::int AS de_la_ip,
              count(*) FILTER (WHERE misma AND NOT exitoso
                                 AND creado_en > COALESCE((SELECT max(creado_en) FROM recientes WHERE misma AND exitoso), '-infinity')
                                 AND creado_en > COALESCE($4::timestamptz, '-infinity'))::int AS de_la_cuenta,
              (SELECT count(*) FROM de_la_cuenta WHERE NOT exitoso
                  AND creado_en > COALESCE((SELECT max(creado_en) FROM de_la_cuenta WHERE exitoso), '-infinity')
                  AND creado_en > COALESCE($4::timestamptz, '-infinity'))::int AS de_la_cuenta_total,
              EXISTS (SELECT 1 FROM intentos_login WHERE lower(correo) = lower($2) AND ip = $1 AND exitoso
                         AND creado_en > now() - make_interval(days => $5)) AS ip_conocida
         FROM recientes`,
      [intento.ip, intento.correo, config.bloqueoMinutos, intento.passwordCambiadoEn ?? null, config.diasIpConocida],
    )
    if (f.de_la_cuenta >= config.maxIntentos || f.de_la_ip >= config.maxIntentosIp) return null
    if (f.de_la_cuenta_total >= config.maxIntentosCuenta && !f.ip_conocida) return null
    const { rows: [r] } = await c.query(
      `INSERT INTO intentos_login (correo, id_usuario, exitoso, ip) VALUES ($1, $2, false, $3) RETURNING id_intento`,
      [intento.correo.slice(0, 150), intento.idUsuario ?? null, intento.ip],
    )
    return { bueno: () => db.query(`UPDATE intentos_login SET exitoso = true WHERE id_intento = $1`, [r.id_intento]) }
  })
}

function bloqueado(rep: FastifyReply, config: Config) {
  return rep.code(429).header('retry-after', String(config.bloqueoMinutos * 60)).send({
    error: `Demasiados intentos fallidos. Por seguridad espera ${config.bloqueoMinutos} minutos o restablece tu contraseña.`,
    codigo: 'BLOQUEADA',
  })
}

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

export async function rutasAuth(
  app: FastifyInstance,
  { db, config }: Contexto,
  { requiereSesion, requiereSesionAunConPasswordPendiente }: { requiereSesion: Guardia; requiereSesionAunConPasswordPendiente: Guardia },
) {
  // Con cookie, los tokens viajan sólo en Set-Cookie (HttpOnly): la respuesta no los trae y la página no los ve.
  // `refreshToken` sólo al abrir la sesión: al renovar, la cookie de la sesión ya está puesta.
  function respuestaSesion(
    rep: FastifyReply,
    u: { id_usuario: string; nombre: string; correo: string; rol: string; debe_cambiar_password: boolean; es_plataforma: boolean; interna: boolean },
    sid: string,
    refreshToken: string,
    cookie: { nueva: boolean } | null,
  ) {
    const accessToken = app.jwt.sign({ sub: u.id_usuario, sid })
    const expiraEn = Date.now() + config.accesoMinutos * 60_000
    // `plataforma`: al entrar, la app lo lleva a /plataforma (el panel vuelve a revisar el permiso en cada petición).
    const usuario = { id: u.id_usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password, plataforma: esPlataforma(u) }
    if (!cookie) return { accessToken, expiraEn, refreshToken, usuario }
    fijarCookiesSesion(rep, config, { acceso: accessToken, sesion: cookie.nueva ? refreshToken : undefined })
    return { cookie: true, expiraEn, usuario }
  }

  // RF-001 / RF-003 / RF-004
  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyLogin.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Faltan el correo o la contraseña' })
    const { correo, password, dispositivo, modo } = body.data
    const ip = ipCliente(req, config)

    const { rows } = await db.query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.rol, u.password_hash, u.activo, u.debe_cambiar_password, u.password_cambiado_en, u.es_plataforma,
              e.activa AS empresa_activa, e.interna
         FROM usuarios u JOIN empresas e USING (id_empresa) WHERE lower(u.correo) = lower($1)`,
      [correo],
    )
    const u = rows[0]
    const intento = await registrarIntento(db, config, { correo, ip, idUsuario: u?.id_usuario, passwordCambiadoEn: u?.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)

    if (!u) {
      await verificarRelleno(config, password) // tarda lo mismo que con una cuenta que sí existe
      return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    }
    const { ok, rehacer } = await verificarPassword(config, u.password_hash, password)
    if (!ok) return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    // RF-040: sólo con la contraseña correcta se le dice por qué no entra.
    if (!u.activo) return rep.code(403).send({ error: 'Tu cuenta está dada de baja. Habla con el administrador.', codigo: 'CUENTA_SUSPENDIDA' })
    if (!u.empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)

    await intento.bueno()
    // Un hash del pepper anterior o con otros parámetros se rehace ahora que se tiene la contraseña.
    if (rehacer) await db.query(`UPDATE usuarios SET password_hash = $2 WHERE id_usuario = $1`, [u.id_usuario, await hashPassword(config, password)])
    // Con verificación en dos pasos la contraseña sola no abre sesión: se entrega un desafío de 5 minutos que sólo
    // sirve para /auth/login/codigo, junto con el código del autenticador.
    if (await tieneDosPasos(db, u.id_usuario)) {
      const desafio = app.jwt.sign({ sub: u.id_usuario, tipo: DESAFIO }, { expiresIn: '5m' })
      return { dosPasos: true, desafio }
    }
    return abrirSesion(rep, u, dispositivo, ip, modo)
  })

  async function abrirSesion(rep: FastifyReply, u: Parameters<typeof respuestaSesion>[1], dispositivo: string | undefined, ip: string, modo: 'token' | 'cookie') {
    await db.query(`UPDATE usuarios SET ultimo_acceso = now() WHERE id_usuario = $1`, [u.id_usuario])
    const refresh = tokenAleatorio()
    const { rows: s } = await db.query(
      `INSERT INTO sesiones (id_usuario, refresh_token_hash, dispositivo, ip, expira_en)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id_sesion`,
      [u.id_usuario, sha256(refresh), dispositivo ?? null, ip, config.sesionDias],
    )
    return respuestaSesion(rep, u, s[0].id_sesion, refresh, modo === 'cookie' ? { nueva: true } : null)
  }

  // Segundo paso del login: el código del autenticador o uno de respaldo. Un código equivocado cuenta como intento
  // fallido (RF-003), con los mismos límites que la contraseña: no se pueden probar los millones de combinaciones.
  app.post('/auth/login/codigo', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCodigoLogin.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe el código de verificación' })
    let sub: string
    try {
      const p = app.jwt.verify<{ sub: string; tipo?: string }>(body.data.desafio)
      if (p.tipo !== DESAFIO) throw new Error('no es un desafío')
      sub = p.sub
    } catch {
      return rep.code(401).send({ error: 'Pasaron más de 5 minutos. Vuelve a escribir tu contraseña.', codigo: 'DESAFIO_VENCIDO' })
    }
    const ip = ipCliente(req, config)
    const { rows: [u] } = await db.query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.rol, u.activo, u.debe_cambiar_password, u.password_cambiado_en, u.es_plataforma, e.activa AS empresa_activa, e.interna
         FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
      [sub],
    )
    if (!u?.activo) return rep.code(401).send({ error: 'Vuelve a escribir tu contraseña.', codigo: 'DESAFIO_VENCIDO' })
    if (!u.empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)
    const intento = await registrarIntento(db, config, { correo: u.correo, ip, idUsuario: u.id_usuario, passwordCambiadoEn: u.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)
    if (!(await usarCodigo(db, config, u.id_usuario, body.data.codigo))) {
      return rep.code(401).send({ error: 'El código no es correcto o ya se usó. Escribe el que se ve ahora en tu app.' })
    }
    await intento.bueno()
    return abrirSesion(rep, u, body.data.dispositivo, ip, body.data.modo)
  })

  // Renueva el token de acceso. El refresh token no rota: en zonas sin señal una respuesta perdida
  // dejaría al repartidor fuera; se revoca al cerrar sesión o al cambiar la contraseña.
  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body ?? {})
    if (!body.success) return rep.code(400).send({ error: 'Falta el token de sesión' })
    const deCookie = body.data.refreshToken ? undefined : leerCookie(req, config, 'sesion')
    const refresh = body.data.refreshToken ?? deCookie
    if (!refresh) return rep.code(401).send({ error: 'Sesión vencida, inicia sesión de nuevo', codigo: 'SESION_INVALIDA' })
    const { rows } = await db.query(
      `SELECT s.id_sesion, u.id_usuario, u.nombre, u.correo, u.rol, u.debe_cambiar_password, u.es_plataforma, e.activa AS empresa_activa, e.interna
         FROM sesiones s JOIN usuarios u USING (id_usuario) JOIN empresas e USING (id_empresa)
        WHERE s.refresh_token_hash = $1 AND s.revocado_en IS NULL AND s.expira_en > now() AND u.activo`,
      [sha256(refresh)],
    )
    if (!rows[0]) {
      if (deCookie) borrarCookiesSesion(rep, config)
      return rep.code(401).send({ error: 'Sesión vencida, inicia sesión de nuevo', codigo: 'SESION_INVALIDA' })
    }
    // 403 y no 401: la app no cierra la sesión, así lo que el repartidor no ha enviado se queda en el teléfono.
    if (!rows[0].empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)
    return respuestaSesion(rep, rows[0], rows[0].id_sesion, refresh, deCookie ? { nueva: false } : null)
  })

  // RF-006: revoca la sesión de este dispositivo (la del cuerpo o la de la cookie). Siempre 204, para poder reintentar.
  app.post('/auth/logout', async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body ?? {})
    const refresh = (body.success && body.data.refreshToken) || leerCookie(req, config, 'sesion')
    if (refresh) {
      await db.query(`UPDATE sesiones SET revocado_en = now() WHERE refresh_token_hash = $1 AND revocado_en IS NULL`, [sha256(refresh)])
    }
    if (!(body.success && body.data.refreshToken)) borrarCookiesSesion(rep, config)
    return rep.code(204).send()
  })

  app.get('/me', { preHandler: requiereSesionAunConPasswordPendiente }, async (req) => {
    const { rows } = await db.query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.telefono, u.foto, u.rol, u.debe_cambiar_password, u.es_plataforma, u.creado_en, u.ultimo_acceso, u.password_cambiado_en, u.legal_version, u.orden_menu, u.fondo, u.tema, u.tamano_texto, u.avisos_apagados, u.silencio_desde, u.silencio_hasta, u.resumen_correo, u.resumen_semanal, u.resumen_semanal_dia, u.resumen_mensual, u.mensajes, e.interna, e.nombre AS empresa
         FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
      [req.usuario.id],
    )
    const u = rows[0]
    return {
      id: u.id_usuario, nombre: u.nombre, correo: u.correo, telefono: u.telefono ?? '', foto: u.foto ?? null, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password, plataforma: esPlataforma(u),
      empresa: u.empresa, alta: u.creado_en, ultimoAcceso: u.ultimo_acceso, passwordCambiado: u.password_cambiado_en,
      // Falta aceptar el aviso de privacidad y los términos vigentes (privacidad.ts): la app los muestra antes de seguir.
      legalPendiente: u.legal_version !== VERSION_LEGAL, versionLegal: VERSION_LEGAL,
      ordenMenu: u.orden_menu ?? null,
      fondo: u.fondo,
      tema: u.tema,
      tamanoTexto: u.tamano_texto,
      avisosApagados: u.avisos_apagados ?? [],
      silencio: silencioDe(u),
      resumenCorreo: u.resumen_correo,
      resumenSemanal: u.resumen_semanal,
      resumenSemanalDia: u.resumen_semanal_dia,
      resumenMensual: u.resumen_mensual,
      mensajes: u.mensajes ?? {},
    }
  })

  // El perfil propio: nombre, teléfono y foto. El correo no: es con lo que se entra y cambiarlo pediría confirmar el nuevo
  // (un administrador lo cambia desde Equipo).
  app.patch('/me', { preHandler: requiereSesion }, async (req, rep) => {
    const b = bodyPerfil.safeParse(req.body ?? {})
    if (!b.success) {
      const enFoto = b.error.issues.some((i) => i.path[0] === 'foto')
      return rep.code(400).send({ error: enFoto ? 'La foto debe ser una imagen JPG, PNG o WEBP' : 'Revisa el nombre (2 a 100 letras) y el teléfono (hasta 20)' })
    }
    const u = await tx(db, req.usuario.id, async (c) => (await c.query(
      `UPDATE usuarios SET nombre = COALESCE($2, nombre), telefono = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE telefono END,
              foto = CASE WHEN $5::boolean THEN $6 ELSE foto END,
              orden_menu = CASE WHEN $7::boolean THEN $8::text[] ELSE orden_menu END,
              avisos_apagados = CASE WHEN $9::boolean THEN $10::text[] ELSE avisos_apagados END,
              silencio_desde = CASE WHEN $11::boolean THEN $12::smallint ELSE silencio_desde END,
              silencio_hasta = CASE WHEN $11::boolean THEN $13::smallint ELSE silencio_hasta END,
              resumen_correo = COALESCE($14::boolean, resumen_correo),
              resumen_semanal = COALESCE($15::boolean, resumen_semanal),
              resumen_semanal_dia = COALESCE($16::smallint, resumen_semanal_dia),
              resumen_mensual = COALESCE($17::boolean, resumen_mensual),
              mensajes = CASE WHEN $18::jsonb IS NULL THEN mensajes ELSE jsonb_strip_nulls(mensajes || $18::jsonb) END,
              fondo = COALESCE($19, fondo),
              tema = COALESCE($20, tema),
              tamano_texto = COALESCE($21, tamano_texto)
        WHERE id_usuario = $1 RETURNING nombre, telefono, foto, orden_menu, fondo, tema, tamano_texto, avisos_apagados, silencio_desde, silencio_hasta, resumen_correo, resumen_semanal, resumen_semanal_dia, resumen_mensual, mensajes`,
      [req.usuario.id, b.data.nombre ?? null, b.data.telefono !== undefined, b.data.telefono ?? null, b.data.foto !== undefined, b.data.foto ?? null,
        b.data.ordenMenu !== undefined, b.data.ordenMenu?.length ? b.data.ordenMenu : null,
        b.data.avisosApagados !== undefined, b.data.avisosApagados?.length ? [...new Set(b.data.avisosApagados)] : null,
        b.data.silencio !== undefined, b.data.silencio?.desde ?? null, b.data.silencio?.hasta ?? null, b.data.resumenCorreo ?? null, b.data.resumenSemanal ?? null, b.data.resumenSemanalDia ?? null, b.data.resumenMensual ?? null,
        b.data.mensajes ? JSON.stringify(b.data.mensajes) : null, b.data.fondo ?? null, b.data.tema ?? null, b.data.tamanoTexto ?? null],
    )).rows[0])
    return { nombre: u.nombre, telefono: u.telefono ?? '', foto: u.foto ?? null, ordenMenu: u.orden_menu ?? null, fondo: u.fondo, tema: u.tema, tamanoTexto: u.tamano_texto, avisosApagados: u.avisos_apagados ?? [], silencio: silencioDe(u), resumenCorreo: u.resumen_correo, resumenSemanal: u.resumen_semanal, resumenSemanalDia: u.resumen_semanal_dia, resumenMensual: u.resumen_mensual, mensajes: u.mensajes ?? {} }
  })

  // Las sesiones abiertas de la cuenta (la de esta petición marcada) y cerrar una o todas las demás.
  app.get('/me/sesiones', { preHandler: requiereSesion }, async (req) => {
    const { rows } = await db.query(
      `SELECT id_sesion, host(ip) AS ip, creado_en, expira_en FROM sesiones
        WHERE id_usuario = $1 AND revocado_en IS NULL AND expira_en > now() ORDER BY creado_en DESC`,
      [req.usuario.id],
    )
    return rows.map((r) => ({ id: r.id_sesion, actual: r.id_sesion === req.usuario.sid, ip: r.ip, inicio: r.creado_en, vence: r.expira_en }))
  })

  app.post('/me/sesiones/cerrar', { preHandler: requiereSesion, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const b = bodyCerrarSesion.safeParse(req.body ?? {})
    if (!b.success) return rep.code(400).send({ error: 'Sesión no válida' })
    if (b.data.id === req.usuario.sid) return rep.code(400).send({ error: 'Para cerrar esta sesión usa «Cerrar sesión»' })
    const r = await db.query(
      `UPDATE sesiones SET revocado_en = now()
        WHERE id_usuario = $1 AND id_sesion <> $2 AND revocado_en IS NULL AND ($3::uuid IS NULL OR id_sesion = $3)`,
      [req.usuario.id, req.usuario.sid, b.data.id ?? null],
    )
    return { cerradas: r.rowCount }
  })

  // RF-039: quita la marca de "debe cambiar la contraseña". Cierra las demás sesiones. Probar la contraseña actual
  // cuenta como un intento más (RF-003): con un teléfono ajeno abierto no se puede adivinar a la larga.
  app.post('/auth/cambiar-password', { preHandler: requiereSesionAunConPasswordPendiente, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCambio.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe tu contraseña actual y la nueva' })
    const { actual, nueva } = body.data
    const { rows: [u] } = await db.query(`SELECT correo, password_hash, password_cambiado_en FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const regla = revisarPassword(nueva, u.correo)
    if (regla) return rep.code(400).send({ error: regla })
    if (actual === nueva) return rep.code(400).send({ error: 'La contraseña nueva debe ser distinta a la actual' })
    const intento = await registrarIntento(db, config, { correo: u.correo, ip: ipCliente(req, config), idUsuario: req.usuario.id, passwordCambiadoEn: u.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)
    if (!(await verificarPassword(config, u.password_hash, actual)).ok) return rep.code(401).send({ error: 'La contraseña actual no es correcta' })
    await intento.bueno()
    await db.query(`UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false, password_cambiado_en = now() WHERE id_usuario = $1`, [
      req.usuario.id,
      await hashPassword(config, nueva),
    ])
    await db.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND id_sesion <> $2 AND revocado_en IS NULL`, [req.usuario.id, req.usuario.sid])
    // Las otras sesiones ya no reciben avisos; este teléfono vuelve a suscribirse solo al abrir la app (src/lib/push.ts).
    await db.query(`DELETE FROM suscripciones_push WHERE id_usuario = $1`, [req.usuario.id])
    return rep.code(204).send()
  })
}
