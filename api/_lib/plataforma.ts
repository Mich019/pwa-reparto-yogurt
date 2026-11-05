import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { leerAjustes } from './ajustes.js'
import type { Config } from './config.js'
import { hashPassword } from './contrasenas.js'
import { correoAviso, correoInvitacion, enviarCorreo, enviarCorreos } from './correo.js'
import type { Db } from './db.js'
import { purgarBajas } from './privacidad.js'
import { hashInvitacion } from './registro.js'
import { passwordTemporal, tokenAleatorio } from './seguridad.js'
import { CON_ACCESO } from './suscripcion.js'

// Panel de la plataforma (Fase 7): quienes administran el servicio ven todas las empresas, su estado de pago y su uso,
// y pueden suspenderlas o reactivarlas. Entra sólo una cuenta marcada en la base (es_plataforma) que viva en la empresa
// interna «Plataforma» y tenga activa la verificación en dos pasos. El correo nunca da el permiso: un administrador de
// empresa puede poner a una cuenta el correo que quiera. Y en la empresa interna nadie de un negocio la ve ni la toca
// (reglas por empresa). La primera cuenta se da de alta por consola: npm run db:plataforma. Estas rutas cruzan
// empresas: usan la conexión del dueño de la base (`db` sin envolver, ver app.ts), no la de la empresa de quien llama.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Administra la plataforma: marcada en la base y en la empresa interna (las dos cosas, para que una marca puesta por
// error en una cuenta de un negocio no dé el permiso).
export const esPlataforma = (u: { es_plataforma?: boolean; interna?: boolean }) => !!u.es_plataforma && !!u.interna
const idEmpresa = z.object({ id: z.uuid() })
const bodyActiva = z.object({ activa: z.boolean() })
const correo = z.string().trim().toLowerCase().max(150).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Escribe un correo válido')
const zona = z.string().max(64).refine((z) => {
  try {
    new Intl.DateTimeFormat('es', { timeZone: z })
    return true
  } catch {
    return false
  }
}, 'Zona horaria no válida')
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida')
// Ajustes de una empresa desde el panel: nombre, hasta cuándo dura su prueba y si no paga.
const bodyAjustes = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 letras').max(120).optional(),
  pruebaHasta: fecha.optional(),
  exenta: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')
// Alta de una empresa desde el panel: su primer administrador recibe una invitación para crear su contraseña.
const bodyEmpresaNueva = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre del negocio').max(120),
  zonaHoraria: zona.default('America/Mexico_City'),
  administrador: z.object({ nombre: z.string().trim().min(2, 'Escribe el nombre del administrador').max(100), correo }),
  pruebaDias: z.number().int().min(0).max(365).optional(),
  exenta: z.boolean().default(false),
})

// Ajustes de la plataforma (plataforma_ajustes). '' o null quita el correo o los días propios.
const bodyAjustesPlataforma = z.object({
  registroAbierto: z.boolean().optional(),
  pruebaDias: z.number().int().min(0, 'Los días de prueba van de 0 a 365').max(365, 'Los días de prueba van de 0 a 365').nullable().optional(),
  correoSoporte: z.union([z.literal(''), z.string().trim().toLowerCase().email('Escribe un correo válido').max(150)]).nullable().optional(),
  avisoPruebaDias: z.number().int().min(0, 'El aviso va de 0 a 60 días antes').max(60, 'El aviso va de 0 a 60 días antes').optional(),
  avisoPruebaVendedores: z.boolean().optional(),
}).strict().refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')

// Un aviso escrito por la plataforma: a quién va y entre qué fechas sale (null = sin límite por ese lado).
const momento = z.iso.datetime({ offset: true, message: 'Fecha no válida' }).nullable()
const bodyAviso = z.object({
  texto: z.string().trim().min(1, 'Escribe el aviso').max(280, 'El aviso es de 280 letras como máximo'),
  tipo: z.enum(['info', 'aviso']).default('info'),
  para: z.enum(['todos', 'administradores', 'vendedores']).default('todos'),
  desde: momento.default(null),
  hasta: momento.default(null),
  porCorreo: z.boolean().default(false), // sólo cuenta en los de tipo «aviso»
}).strict().refine((b) => !b.desde || !b.hasta || new Date(b.hasta) > new Date(b.desde), { message: 'El final va después del inicio', path: ['hasta'] })
const idAviso = z.object({ id: z.uuid() })
type FilaAviso = {
  id_aviso: string; texto: string; tipo: string; para: string; desde: Date | null; hasta: Date | null; actualizado_en: Date
  por_correo: boolean; correo_enviado_en: Date | null; correo_destinatarios: number | null
}
const wireAviso = (a: FilaAviso) => ({
  id: a.id_aviso, texto: a.texto, tipo: a.tipo, para: a.para,
  desde: a.desde?.toISOString() ?? null, hasta: a.hasta?.toISOString() ?? null, actualizado: a.actualizado_en.toISOString(),
  porCorreo: a.por_correo, correo: a.correo_enviado_en ? { enviado: a.correo_enviado_en.toISOString(), destinatarios: a.correo_destinatarios ?? 0 } : null,
})

const bodyCuenta = z.object({ nombre: z.string().trim().min(2, 'Escribe el nombre').max(100), correo })

// Lo que la empresa vive hoy: suspendida por ustedes, exenta, pagando, en prueba o sin acceso (vencida/cancelada).
const estadoDe = (e: { activa: boolean; exenta: boolean; suscripcion_estado: string | null; con_acceso: boolean }) =>
  !e.activa ? 'suspendida' : e.exenta ? 'exenta' : e.suscripcion_estado === 'authorized' ? 'activa' : e.con_acceso ? 'prueba'
    : e.suscripcion_estado === 'cancelled' ? 'cancelada' : 'vencida'


export async function rutasPlataforma(app: FastifyInstance, { db, config }: { db: Db; config: Config }, { requiereSesionSinCobro }: { requiereSesionSinCobro: Guardia }) {
  async function requierePlataforma(req: FastifyRequest, rep: FastifyReply) {
    await requiereSesionSinCobro(req, rep)
    if (rep.sent) return
    const { rows: [u] } = await db.query(
      `SELECT u.es_plataforma, e.interna, d.activado_en IS NOT NULL AS dos_pasos
         FROM usuarios u JOIN empresas e USING (id_empresa) LEFT JOIN dos_pasos d USING (id_usuario) WHERE u.id_usuario = $1`,
      [req.usuario.id],
    )
    if (!u || !esPlataforma(u)) return rep.code(403).send({ error: 'Sólo para quienes administran la plataforma', codigo: 'SIN_PERMISO' })
    if (!u.dos_pasos) {
      return rep.code(403).send({ error: 'Activa la verificación en dos pasos en Configuración → Seguridad para entrar al panel de la plataforma.', codigo: 'DOS_PASOS_REQUERIDOS' })
    }
  }

  // Cómo está el servicio: los ajustes que se cambian aquí, lo que viene del entorno (sólo si cada pieza está lista,
  // nunca sus claves), la versión desplegada, la base y el uso. Las cuentas de la empresa interna no cuentan.
  app.get('/plataforma/servicio', { preHandler: requierePlataforma }, async () => {
    const { rows: [b] } = await db.query(
      `SELECT current_setting('server_version') AS version, pg_database_size(current_database())::bigint AS tamano,
              (SELECT count(*) FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.activo AND NOT e.interna)::int AS usuarios,
              (SELECT count(*) FROM sesiones s JOIN usuarios u USING (id_usuario) JOIN empresas e ON e.id_empresa = u.id_empresa
                WHERE s.revocado_en IS NULL AND s.expira_en > now() AND NOT e.interna)::int AS sesiones,
              (SELECT count(*) FROM suscripciones_push)::int AS push,
              (SELECT count(*) FROM invitaciones WHERE usado_en IS NULL AND expira_en > now())::int AS invitaciones`,
    )
    return {
      ajustes: await leerAjustes(db, config),
      pruebaDiasEntorno: config.pruebaDias,
      cobro: config.mercadoPago.activo,
      precioMensual: config.mercadoPago.precioMensual,
      moneda: config.mercadoPago.moneda,
      webhookFirmado: !!config.mercadoPago.webhookSecret,
      invitacionDias: config.invitacionDias,
      correo: !!config.resendApiKey,
      remitente: config.correoRemitente,
      push: !!config.vapidPublica,
      urlApp: config.urlApp,
      zonaHoraria: config.zonaHoraria,
      produccion: config.produccion,
      despliegue: config.despliegue,
      seguridad: { sesionDias: config.sesionDias, accesoMinutos: config.accesoMinutos, maxIntentos: config.maxIntentos, bloqueoMinutos: config.bloqueoMinutos },
      base: { version: String(b.version).split(' ')[0], tamano: Number(b.tamano) },
      uso: { usuarios: b.usuarios, sesiones: b.sesiones, dispositivosPush: b.push, invitaciones: b.invitaciones },
    }
  })

  app.patch('/plataforma/ajustes', { preHandler: requierePlataforma, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyAjustesPlataforma.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { registroAbierto, pruebaDias, correoSoporte, avisoPruebaDias, avisoPruebaVendedores } = b.data
    await db.query(
      `UPDATE plataforma_ajustes SET
              registro_abierto = coalesce($1, registro_abierto),
              prueba_dias = CASE WHEN $2 THEN $3::int ELSE prueba_dias END,
              correo_soporte = CASE WHEN $4 THEN $5 ELSE correo_soporte END,
              aviso_prueba_dias = coalesce($6, aviso_prueba_dias),
              aviso_prueba_vendedores = coalesce($7, aviso_prueba_vendedores),
              actualizado_en = now()
        WHERE id`,
      [registroAbierto ?? null, pruebaDias !== undefined, pruebaDias ?? null, correoSoporte !== undefined, correoSoporte || null,
        avisoPruebaDias ?? null, avisoPruebaVendedores ?? null],
    )
    req.log.info({ cambios: Object.keys(b.data) }, 'ajustes de la plataforma cambiados')
    return leerAjustes(db, config)
  })

  // Lo que cualquiera puede leer, con o sin sesión: si el registro está abierto y a dónde escribir.
  app.get('/plataforma/publico', async (_req, rep) => {
    const a = await leerAjustes(db, config)
    rep.header('cache-control', 'public, max-age=60')
    return { registroAbierto: a.registroAbierto, correoSoporte: a.correoSoporte }
  })

  // Los avisos importantes marcados «por correo» salen una sola vez, cuando empieza su vigencia: al publicarlos, o el
  // primero que pase por aquí después de su hora (los programados no tienen quien los dispare a la hora exacta: los
  // reclama la siguiente consulta de avisos de cualquier cuenta). Se marcan antes de mandar, así dos consultas a la vez
  // no los mandan dos veces; si no sale ninguno, se desmarcan para reintentar.
  async function mandarAvisosPorCorreo(log: FastifyRequest['log']) {
    const { rows } = await db.query<FilaAviso>(
      `UPDATE avisos_plataforma SET correo_enviado_en = now()
        WHERE por_correo AND tipo = 'aviso' AND correo_enviado_en IS NULL
          AND (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta > now())
        RETURNING *`,
    )
    for (const a of rows) {
      const { rows: cuentas } = await db.query<{ nombre: string; correo: string }>(
        `SELECT u.nombre, u.correo FROM usuarios u JOIN empresas e ON e.id_empresa = u.id_empresa
          WHERE u.activo AND e.activa AND NOT e.interna AND ($1 = 'todos' OR u.rol::text = $2)`,
        [a.para, a.para === 'administradores' ? 'administrador' : 'vendedor'],
      )
      let enviados = 0
      try {
        enviados = await enviarCorreos(config, cuentas.map((c) => ({ para: c.correo, ...correoAviso(c.nombre, a.texto, config.urlApp) })), log)
      } catch (e) {
        enviados = (e as { enviados?: number }).enviados ?? 0
        log.error({ err: e, aviso: a.id_aviso }, 'plataforma: no salieron todos los correos de un aviso')
      }
      await db.query(
        `UPDATE avisos_plataforma SET correo_destinatarios = $2, correo_enviado_en = CASE WHEN $2 > 0 OR $3 = 0 THEN correo_enviado_en END WHERE id_aviso = $1`,
        [a.id_aviso, enviados, cuentas.length],
      )
    }
  }
  const releer = async (id: string) => (await db.query<FilaAviso>(`SELECT * FROM avisos_plataforma WHERE id_aviso = $1`, [id])).rows[0]
  const correosPendientes = (log: FastifyRequest['log']) => mandarAvisosPorCorreo(log).catch((e) => log.error({ err: e }, 'plataforma: avisos por correo'))

  // Despertador: manda los avisos programados que ya les tocó, sin esperar a que alguien abra la app. Lo llama un cron
  // (vercel.json) con el secreto en la cabecera; sin CRON_SECRET configurado la ruta no existe.
  app.get('/cron/avisos', async (req, rep) => {
    const secreto = config.cronSecret
    if (secreto.length < 24) return rep.code(404).send({ error: 'No encontrado' })
    const dado = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /i, ''))
    const bueno = Buffer.from(secreto)
    if (dado.length !== bueno.length || !timingSafeEqual(dado, bueno)) return rep.code(401).send({ error: 'No autorizado' })
    await mandarAvisosPorCorreo(req.log)
    const borradas = await purgarBajas(db, req.log) // empresas cuya baja ya venció (privacidad.ts)
    return { ok: true, borradas }
  })

  // Apartado «Avisos»: los que la plataforma escribe para las empresas (los vencidos al final) y el aviso automático.
  app.get('/plataforma/avisos', { preHandler: requierePlataforma }, async (req) => {
    await correosPendientes(req.log)
    const { rows } = await db.query<FilaAviso>(
      `SELECT * FROM avisos_plataforma ORDER BY coalesce(hasta, 'infinity') < now(), coalesce(desde, creado_en) DESC`,
    )
    return { avisos: rows.map(wireAviso), avisoPrueba: (await leerAjustes(db, config)).avisoPrueba, correoActivo: !!config.resendApiKey || !config.produccion }
  })

  app.post('/plataforma/avisos', { preHandler: requierePlataforma, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyAviso.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { rows: [a] } = await db.query<FilaAviso>(
      `INSERT INTO avisos_plataforma (texto, tipo, para, desde, hasta, por_correo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.data.texto, b.data.tipo, b.data.para, b.data.desde, b.data.hasta, b.data.porCorreo],
    )
    req.log.info({ aviso: a.id_aviso, por: req.usuario.id }, 'plataforma: aviso nuevo')
    await correosPendientes(req.log)
    return rep.code(201).send({ aviso: wireAviso(await releer(a.id_aviso)) })
  })

  // Se cambia entero (el editor manda todo). Cambiarlo lo vuelve a mostrar a quien lo había cerrado.
  app.put('/plataforma/avisos/:id', { preHandler: requierePlataforma, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const p = idAviso.safeParse(req.params)
    if (!p.success) return rep.code(404).send({ error: 'Ese aviso no existe' })
    const b = bodyAviso.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { rows: [a] } = await db.query<FilaAviso>(
      `UPDATE avisos_plataforma SET texto = $2, tipo = $3, para = $4, desde = $5, hasta = $6, por_correo = $7, actualizado_en = now()
        WHERE id_aviso = $1 RETURNING *`,
      [p.data.id, b.data.texto, b.data.tipo, b.data.para, b.data.desde, b.data.hasta, b.data.porCorreo],
    )
    if (!a) return rep.code(404).send({ error: 'Ese aviso no existe' })
    await correosPendientes(req.log)
    return { aviso: wireAviso(await releer(a.id_aviso)) }
  })

  app.delete('/plataforma/avisos/:id', { preHandler: requierePlataforma }, async (req, rep) => {
    const p = idAviso.safeParse(req.params)
    if (!p.success) return rep.code(404).send({ error: 'Ese aviso no existe' })
    const { rowCount } = await db.query(`DELETE FROM avisos_plataforma WHERE id_aviso = $1`, [p.data.id])
    if (!rowCount) return rep.code(404).send({ error: 'Ese aviso no existe' })
    return rep.code(204).send()
  })

  // Lo que ve cada cuenta arriba del panel o de la app de reparto: sólo con sesión (también con la prueba vencida), nunca
  // en las pantallas de entrada. Los avisos vigentes que van a su rol y, si su prueba gratis está por terminar y no hay
  // suscripción en marcha, el automático. «clave» cambia cuando cambia el aviso (o pasa un día de prueba): así, lo que se
  // cerró vuelve a salir.
  app.get('/plataforma/avisos/vigentes', { preHandler: requiereSesionSinCobro }, async (req, rep) => {
    rep.header('cache-control', 'private, no-store')
    await correosPendientes(req.log)
    const admin = req.usuario.rol === 'administrador'
    const { rows } = await db.query<FilaAviso>(
      `SELECT * FROM avisos_plataforma
        WHERE (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta > now()) AND para IN ('todos', $1)
        ORDER BY tipo = 'aviso' DESC, coalesce(desde, creado_en) DESC`,
      [admin ? 'administradores' : 'vendedores'],
    )
    const avisos: { clave: string; texto: string; tipo: string; accion?: 'suscripcion' }[] = rows.map((a) => ({
      clave: `${a.id_aviso}:${a.actualizado_en.getTime()}`, texto: a.texto, tipo: a.tipo,
    }))
    const { avisoPrueba } = await leerAjustes(db, config)
    if (avisoPrueba.dias > 0 && (admin || avisoPrueba.vendedores)) {
      const { rows: [e] } = await db.query(
        `SELECT nombre, ceil(extract(epoch FROM prueba_hasta - now()) / 86400)::int AS dias FROM empresas
          WHERE id_empresa = $1 AND NOT exenta AND prueba_hasta > now()
            AND coalesce(suscripcion_estado, '') NOT IN ('authorized', 'pending')`,
        [req.usuario.empresa],
      )
      if (e && e.dias <= avisoPrueba.dias) {
        const quedan = e.dias === 1 ? 'Queda 1 día' : `Quedan ${e.dias} días`
        avisos.unshift(admin
          ? { clave: `prueba:${e.dias}`, tipo: 'aviso', accion: 'suscripcion', texto: `${quedan} de prueba gratis. Suscríbete para que tu equipo no pierda el acceso.` }
          : { clave: `prueba:${e.dias}`, tipo: 'aviso', texto: `${quedan} de prueba gratis de ${e.nombre}. Avísale a tu administrador para que no se corte el acceso.` })
      }
    }
    return { avisos }
  })

  app.get('/plataforma/empresas', { preHandler: requierePlataforma }, async () => {
    const { rows } = await db.query(
      `SELECT e.id_empresa, e.nombre, e.creado_en, e.activa, e.exenta, e.prueba_hasta, e.suscripcion_estado, ${CON_ACCESO} AS con_acceso,
              (SELECT u.correo FROM usuarios u WHERE u.id_empresa = e.id_empresa AND u.rol = 'administrador' AND u.activo ORDER BY u.creado_en LIMIT 1) AS contacto,
              (SELECT count(*) FROM usuarios u WHERE u.id_empresa = e.id_empresa AND u.activo)::int AS usuarios,
              (SELECT count(*) FROM clientes c WHERE c.id_empresa = e.id_empresa AND c.activo)::int AS clientes,
              (SELECT count(*) FROM pedidos p WHERE p.id_empresa = e.id_empresa AND p.estado = 'entregado' AND p.fecha >= current_date - 30)::int AS pedidos_30,
              (SELECT max(p.fecha) FROM pedidos p WHERE p.id_empresa = e.id_empresa AND p.estado = 'entregado') AS ultimo_pedido
         FROM empresas e WHERE NOT e.interna ORDER BY e.creado_en DESC`,
    )
    const empresas = rows.map((e) => ({
      id: e.id_empresa as string,
      nombre: e.nombre as string,
      alta: e.creado_en as Date,
      contacto: (e.contacto as string | null) ?? null,
      estado: estadoDe(e),
      pruebaHasta: e.prueba_hasta as Date,
      suscripcion: (e.suscripcion_estado as string | null) ?? null,
      usuarios: e.usuarios as number,
      clientes: e.clientes as number,
      pedidos30: e.pedidos_30 as number,
      ultimoPedido: (e.ultimo_pedido as string | null) ?? null,
    }))
    const cuenta = (estado: string) => empresas.filter((e) => e.estado === estado).length
    // Quienes administran la plataforma.
    const { rows: gente } = await db.query(
      `SELECT u.nombre, u.correo, u.activo, d.activado_en IS NOT NULL AS dos_pasos
         FROM usuarios u JOIN empresas e USING (id_empresa) LEFT JOIN dos_pasos d USING (id_usuario)
        WHERE u.es_plataforma AND e.interna ORDER BY u.creado_en`,
    )
    // Series de la plataforma: altas por mes (12 meses, el último es el actual) y pedidos entregados por día (30 días).
    const { rows: altas } = await db.query(
      `SELECT to_char(m, 'YYYY-MM') AS mes, (SELECT count(*) FROM empresas e WHERE NOT e.interna AND date_trunc('month', e.creado_en) = m)::int AS n
         FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`,
    )
    const { rows: dias } = await db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              (SELECT count(*) FROM pedidos p JOIN empresas e USING (id_empresa) WHERE NOT e.interna AND p.estado = 'entregado' AND p.fecha = d::date)::int AS n
         FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`,
    )
    const porVencer = rows.filter((e) => estadoDe(e) === 'prueba' && new Date(e.prueba_hasta).getTime() - Date.now() < 7 * 86400_000).length
    return {
      series: { altasPorMes: altas.map((a) => ({ mes: a.mes as string, n: a.n as number })), pedidosPorDia: dias.map((d) => ({ dia: d.dia as string, n: d.n as number })) },
      cuentas: gente.map((g) => ({ nombre: g.nombre as string, correo: g.correo as string, activo: g.activo as boolean, dosPasos: g.dos_pasos as boolean })),
      resumen: {
        total: empresas.length,
        prueba: cuenta('prueba'),
        activas: cuenta('activa'),
        vencidas: cuenta('vencida'),
        canceladas: cuenta('cancelada'),
        exentas: cuenta('exenta'),
        suspendidas: cuenta('suspendida'),
        porVencer,
        ingresoMensual: cuenta('activa') * config.mercadoPago.precioMensual,
        moneda: config.mercadoPago.moneda,
      },
      empresas,
    }
  })

  // Suspender corta el acceso de todos en esa empresa en su siguiente petición (app.ts revisa empresas.activa); no se
  // borra nada. La propia empresa no se suspende: dejaría fuera a quien la administra.
  app.post('/plataforma/empresas/:id/activa', { preHandler: requierePlataforma }, async (req, rep) => {
    const p = idEmpresa.safeParse(req.params)
    const b = bodyActiva.safeParse(req.body)
    if (!p.success) return rep.code(404).send({ error: 'Esa empresa no existe' })
    if (!b.success) return rep.code(400).send({ error: 'Indica si la empresa queda activa' })
    if (p.data.id === req.usuario.empresa && !b.data.activa) return rep.code(409).send({ error: 'No puedes suspender tu propia empresa', codigo: 'PROPIA_EMPRESA' })
    // Reactivar también cancela una baja pedida por la empresa: sus datos ya no se borran.
    const r = await db.query(
      `UPDATE empresas SET activa = $2, actualizado_en = now(),
              baja_solicitada_en = CASE WHEN $2 THEN NULL ELSE baja_solicitada_en END, baja_borrar_en = CASE WHEN $2 THEN NULL ELSE baja_borrar_en END
        WHERE id_empresa = $1`,
      [p.data.id, b.data.activa],
    )
    if (!r.rowCount) return rep.code(404).send({ error: 'Esa empresa no existe' })
    req.log.info({ empresa: p.data.id, activa: b.data.activa, por: req.usuario.id }, 'plataforma: cambio de estado de una empresa')
    return { ok: true, activa: b.data.activa }
  })

  // Una cuenta nueva de super admin. Vive en la empresa interna «Plataforma» (se crea la primera vez): así no administra
  // ningún negocio ni ve sus datos. Entra con contraseña temporal y, para el panel, activa la verificación en dos pasos.
  app.post('/plataforma/cuentas', { preHandler: requierePlataforma, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyCuenta.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const temporal = passwordTemporal()
    const hash = await hashPassword(config, temporal)
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      // Dos altas a la vez no crean dos empresas internas.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('empresa-interna'))`)
      let { rows: [e] } = await c.query(`SELECT id_empresa FROM empresas WHERE interna ORDER BY creado_en LIMIT 1`)
      if (!e) e = (await c.query(`INSERT INTO empresas (nombre, interna, exenta) VALUES ('Plataforma', true, true) RETURNING id_empresa`)).rows[0]
      const { rows: [u] } = await c.query(
        `INSERT INTO usuarios (id_empresa, nombre, correo, password_hash, rol, debe_cambiar_password, es_plataforma)
         VALUES ($1, $2, $3, $4, 'administrador', true, true) ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
        [e.id_empresa, b.data.nombre, b.data.correo, hash],
      )
      if (!u) {
        await c.query('ROLLBACK')
        return rep.code(409).send({ error: 'Ya hay una cuenta con ese correo', codigo: 'CORREO_REPETIDO' })
      }
      await c.query('COMMIT')
      req.log.info({ correo: b.data.correo, por: req.usuario.id }, 'plataforma: cuenta nueva de super admin')
      return rep.code(201).send({ nombre: b.data.nombre, correo: b.data.correo, passwordTemporal: temporal })
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      c.release()
    }
  })

  // Detalle de una empresa: sus datos, su equipo, su catálogo y su actividad. Sin dinero de sus ventas: es del negocio.
  app.get('/plataforma/empresas/:id', { preHandler: requierePlataforma }, async (req, rep) => {
    const p = idEmpresa.safeParse(req.params)
    if (!p.success) return rep.code(404).send({ error: 'Esa empresa no existe' })
    const { rows: [e] } = await db.query(
      `SELECT e.*, ${CON_ACCESO} AS con_acceso FROM empresas e WHERE e.id_empresa = $1 AND NOT e.interna`,
      [p.data.id],
    )
    if (!e) return rep.code(404).send({ error: 'Esa empresa no existe' })
    const [equipo, conteos, actividad, invitaciones] = await Promise.all([
      db.query(
        `SELECT u.nombre, u.correo, u.rol, u.activo, u.ultimo_acceso, u.creado_en, d.activado_en IS NOT NULL AS dos_pasos
           FROM usuarios u LEFT JOIN dos_pasos d USING (id_usuario) WHERE u.id_empresa = $1 ORDER BY u.rol, u.nombre`,
        [e.id_empresa],
      ),
      db.query(
        `SELECT (SELECT count(*) FROM clientes WHERE id_empresa = $1 AND activo)::int AS clientes,
                (SELECT count(*) FROM productos WHERE id_empresa = $1 AND disponible)::int AS productos,
                (SELECT count(*) FROM pedidos WHERE id_empresa = $1 AND estado = 'entregado')::int AS entregados,
                (SELECT count(*) FROM pedidos WHERE id_empresa = $1 AND estado = 'pendiente' AND fecha >= current_date)::int AS pendientes,
                (SELECT max(fecha) FROM pedidos WHERE id_empresa = $1 AND estado = 'entregado') AS ultimo_pedido`,
        [e.id_empresa],
      ),
      db.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
                (SELECT count(*) FROM pedidos p WHERE p.id_empresa = $1 AND p.estado = 'entregado' AND p.fecha = d::date)::int AS n
           FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`,
        [e.id_empresa],
      ),
      db.query(
        `SELECT correo, rol, expira_en FROM invitaciones WHERE id_empresa = $1 AND usado_en IS NULL AND expira_en > now() ORDER BY creado_en DESC`,
        [e.id_empresa],
      ),
    ])
    const c = conteos.rows[0]
    return {
      id: e.id_empresa as string,
      nombre: e.nombre as string,
      alta: e.creado_en as Date,
      zonaHoraria: e.zona_horaria as string,
      giros: (e.giros as string[]) ?? [],
      color: (e.color_marca as string | null) ?? null,
      logo: (e.logo as string | null) ?? null,
      estado: estadoDe(e),
      exenta: e.exenta as boolean,
      pruebaHasta: e.prueba_hasta as Date,
      suscripcion: (e.suscripcion_estado as string | null) ?? null,
      baja: e.baja_borrar_en ? { solicitada: e.baja_solicitada_en as Date, borrarEn: e.baja_borrar_en as Date, motivo: (e.baja_motivo as string | null) ?? null } : null,
      equipo: equipo.rows.map((u) => ({
        nombre: u.nombre as string, correo: u.correo as string, rol: u.rol as string, activo: u.activo as boolean,
        ultimoAcceso: (u.ultimo_acceso as Date | null) ?? null, alta: u.creado_en as Date, dosPasos: u.dos_pasos as boolean,
      })),
      invitaciones: invitaciones.rows.map((i) => ({ correo: i.correo as string, rol: i.rol as string, vence: i.expira_en as Date })),
      conteos: { clientes: c.clientes as number, productos: c.productos as number, entregados: c.entregados as number, pendientes: c.pendientes as number, ultimoPedido: (c.ultimo_pedido as string | null) ?? null },
      pedidosPorDia: actividad.rows.map((d) => ({ dia: d.dia as string, n: d.n as number })),
    }
  })

  app.patch('/plataforma/empresas/:id', { preHandler: requierePlataforma }, async (req, rep) => {
    const p = idEmpresa.safeParse(req.params)
    const b = bodyAjustes.safeParse(req.body)
    if (!p.success) return rep.code(404).send({ error: 'Esa empresa no existe' })
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { nombre, pruebaHasta, exenta } = b.data
    // La prueba termina al final de ese día, en la zona horaria de la empresa.
    const r = await db.query(
      `UPDATE empresas SET nombre = coalesce($2, nombre),
              prueba_hasta = CASE WHEN $3::date IS NULL THEN prueba_hasta ELSE (($3::date + 1)::timestamp AT TIME ZONE zona_horaria) END,
              exenta = coalesce($4, exenta), actualizado_en = now()
        WHERE id_empresa = $1 AND NOT interna`,
      [p.data.id, nombre ?? null, pruebaHasta ?? null, exenta ?? null],
    )
    if (!r.rowCount) return rep.code(404).send({ error: 'Esa empresa no existe' })
    req.log.info({ empresa: p.data.id, cambios: b.data, por: req.usuario.id }, 'plataforma: ajustes de una empresa')
    return { ok: true }
  })

  // Una empresa nueva desde el panel (p. ej. un cliente que se da de alta por teléfono). Nadie escribe su contraseña:
  // su administrador recibe el enlace por correo, y el panel lo muestra para mandarlo también por otro medio.
  app.post('/plataforma/empresas', { preHandler: requierePlataforma, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyEmpresaNueva.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { nombre, zonaHoraria, administrador: a, exenta } = b.data
    const dias = b.data.pruebaDias ?? (await leerAjustes(db, config)).pruebaDias
    const { rows: [ya] } = await db.query(`SELECT 1 FROM usuarios WHERE lower(correo) = $1`, [a.correo])
    if (ya) return rep.code(409).send({ error: 'Ya hay una cuenta con ese correo', codigo: 'CORREO_REPETIDO' })
    const token = tokenAleatorio()
    const c = await db.connect()
    let id: string
    try {
      await c.query('BEGIN')
      const { rows: [e] } = await c.query(
        `INSERT INTO empresas (nombre, zona_horaria, exenta, prueba_hasta) VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id_empresa`,
        [nombre, zonaHoraria, exenta, dias],
      )
      id = e.id_empresa
      await c.query(
        `INSERT INTO invitaciones (id_empresa, correo, rol, token_hash, expira_en) VALUES ($1, $2, 'administrador', $3, now() + make_interval(days => $4))`,
        [id, a.correo, hashInvitacion(config, token), config.invitacionDias],
      )
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      c.release()
    }
    const enlace = `${config.urlApp}/invitacion#${token}`
    await enviarCorreo(config, { para: a.correo, ...correoInvitacion(nombre, 'Delisy', enlace, config.invitacionDias) }, req.log)
      .catch((err) => req.log.error(err, 'no se pudo enviar la invitación del administrador'))
    req.log.info({ empresa: id, por: req.usuario.id }, 'plataforma: empresa nueva')
    return rep.code(201).send({ id, enlace, dias: config.invitacionDias })
  })
}
