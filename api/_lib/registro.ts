import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { hashPassword, revisarPassword } from './contrasenas.js'
import { correoInvitacion, correoVerificacion, correoYaRegistrado, enviarCorreo } from './correo.js'
import { tx, type Cx } from './db.js'
import { ipCliente, tokenAleatorio } from './seguridad.js'

// Alta de empresas por cuenta propia (Fase 2) e invitaciones a repartidores.
// 1. POST /registro/codigo: manda un código de 6 dígitos al correo. Responde siempre lo mismo: si el correo ya tiene
//    cuenta, en lugar del código le llega un aviso (la pantalla no revela quién tiene cuenta). Mismos topes que la
//    recuperación de contraseña: 3 por correo cada hora, 6 al día, 10 por conexión cada hora.
// 2. POST /registro/verificar: con el código correcto devuelve un comprobante firmado (con AUTH_PEPPER_SECRET) que vale
//    24 h, para terminar el formulario aunque se deje a medias. 5 códigos incorrectos invalidan el código.
// 3. POST /registro/empresa: con el comprobante crea, en una sola transacción, la empresa, su administrador (ya
//    verificado), su catálogo y las invitaciones. Los correos de invitación salen después, sin detener el alta.
// 4. POST /invitacion/consultar y /invitacion/aceptar: el repartidor abre el enlace y crea su contraseña. El enlace va
//    en el fragmento (#) de la dirección, que el navegador no manda a ningún servidor; aquí sólo se guarda su HMAC.

const correo = z.string().trim().toLowerCase().max(150).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Correo no válido')
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const zona = z.string().max(64).refine((z) => {
  try {
    new Intl.DateTimeFormat('es', { timeZone: z })
    return true
  } catch {
    return false
  }
}, 'Zona horaria no válida')
// El logo va en la base como data URL (hasta 500 KB de imagen ≈ 700 000 caracteres). Se muestra siempre con <img>,
// donde un SVG no puede ejecutar nada.
const logo = z.string().max(700_000).regex(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/, 'El logo debe ser una imagen PNG, JPG, WEBP o SVG')

const bodyCodigo = z.object({ correo })
const bodyVerificar = z.object({ correo, codigo: z.string().trim().regex(/^\d{6}$/) })
const bodyEmpresa = z.object({
  comprobante: z.string().max(200).default(''), // un borrador de antes no lo trae: se pide confirmar el correo
  empresa: z.object({
    nombre: z.string().trim().min(2).max(120),
    giros: z.array(z.string().max(40)).max(20).default([]),
    zonaHoraria: zona,
    color,
    logo: logo.nullable().default(null),
    controlRetornables: z.boolean().default(false),
  }),
  administrador: z.object({
    nombre: z.string().trim().min(2).max(100),
    correo,
    password: z.string().max(1000),
    aceptaTerminos: z.literal(true, { message: 'Hay que aceptar los términos del servicio' }),
  }),
  envases: z.array(z.object({
    id: z.string().min(1).max(64),
    nombre: z.string().trim().max(60).optional(),
    tipo: z.string().max(30),
    contenido: z.number().positive().max(999),
    unidad: z.string().trim().min(1).max(10),
    retornable: z.boolean().default(false),
  })).max(60),
  productos: z.array(z.object({
    nombre: z.string().trim().min(1).max(100),
    color,
    variantes: z.array(z.object({ nombre: z.string().trim().min(1).max(100), color })).max(50).default([]),
    presentaciones: z.array(z.object({
      envase: z.string().max(64),
      precio: z.number().positive().max(9_999_999),
      costo: z.number().nonnegative().max(9_999_999).nullable().default(null),
    })).min(1).max(60),
  })).min(1).max(100),
  invitaciones: z.array(correo).max(50).default([]),
})
const bodyToken = z.object({ token: z.string().min(20).max(100) })
const bodyAceptar = bodyToken.extend({ nombre: z.string().trim().min(2).max(100), password: z.string().max(1000) })
const bodyInvitar = z.object({ correo })

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const MENSAJE_CODIGO = 'El código es incorrecto o ya venció. Pide uno nuevo.'
const INVITACION_INVALIDA = { error: 'Esta invitación ya se usó o venció. Pide otra a quien te invitó.', codigo: 'INVITACION_INVALIDA' }
const CORREO_REPETIDO = { error: 'Ya hay una cuenta con ese correo. Entra con tu contraseña o usa «¿Olvidaste tu contraseña?».', codigo: 'CORREO_REPETIDO' }
const esperarHasta = (t: number) => new Promise((r) => setTimeout(r, Math.max(0, t - Date.now())))
const revisa = (e: z.ZodError) => e.issues[0]?.message ?? 'Datos incompletos'

class CorreoRepetido extends Error {}

// Lo que devuelve el registro como productos de hoy (un renglón por producto × variante × envase). El catálogo flexible
// (Fase 5) guardará envases y unidades de verdad; mientras, el contenido va en presentacion_litros (ml y g pasan a L y
// kg) y el envase en la descripción.
export function productosDelRegistro(b: Pick<z.infer<typeof bodyEmpresa>, 'envases' | 'productos'>) {
  const envases = new Map(b.envases.map((e) => [e.id, e]))
  const filas: { nombre: string; sabor: string; descripcion: string; presentacion: number; precio: number; costo: number; color: string }[] = []
  const ya = new Set<string>()
  for (const p of b.productos) {
    const variantes = p.variantes.length ? p.variantes : [{ nombre: p.nombre, color: p.color }]
    for (const pr of p.presentaciones) {
      const e = envases.get(pr.envase)
      if (!e) continue
      const chico = ['ml', 'g'].includes(e.unidad.toLowerCase())
      const presentacion = Math.min(999.99, Math.max(0.01, Math.round((chico ? e.contenido / 1000 : e.contenido) * 100) / 100))
      const descripcion = e.nombre || `${e.contenido} ${e.unidad}`
      for (const v of variantes) {
        // Dos envases del mismo tamaño (botella y frasco de 1 L) serían el mismo sabor: se distinguen por el envase.
        let sabor = v.nombre
        if (ya.has(`${p.nombre}|${sabor}|${presentacion}`.toLowerCase())) sabor = `${v.nombre} (${descripcion})`.slice(0, 100)
        const clave = `${p.nombre}|${sabor}|${presentacion}`.toLowerCase()
        if (ya.has(clave)) continue
        ya.add(clave)
        filas.push({ nombre: p.nombre, sabor, descripcion, presentacion, precio: pr.precio, costo: pr.costo ?? 0, color: v.color })
      }
    }
  }
  return filas
}

export async function rutasRegistro(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  const hmac = (uso: string, valor: string) => createHmac('sha256', config.pimienta).update(`${uso}:${valor}`).digest('hex')
  const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

  // El comprobante dice «este correo se confirmó» hasta una hora dada.
  const comprobante = (c: string) => {
    const vence = Date.now() + config.verificacionHoras * 3600_000
    return `${vence}.${hmac('verificado', `${c}:${vence}`)}`
  }
  const comprobanteValido = (texto: string, c: string) => {
    const [vence, firma] = texto.split('.')
    return Number(vence) > Date.now() && !!firma && iguales(firma, hmac('verificado', `${c}:${vence}`))
  }

  async function mandarCodigo(c: string, ip: string, log: FastifyBaseLogger) {
    const { rows: [cuenta] } = await db.query(`SELECT nombre FROM usuarios WHERE lower(correo) = $1`, [c])
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const nuevo = await tx(db, null, async (cx) => {
      await cx.query(`SELECT pg_advisory_xact_lock(hashtext('verificar:' || $1))`, [c])
      const { rows: [n] } = await cx.query(
        `SELECT count(*) FILTER (WHERE lower(correo) = $1 AND creado_en > now() - interval '1 hour')::int AS correo,
                count(*) FILTER (WHERE lower(correo) = $1)::int AS correo_dia,
                count(*) FILTER (WHERE ip = $2 AND creado_en > now() - interval '1 hour')::int AS ip
           FROM verificaciones_correo WHERE creado_en > now() - interval '1 day' AND (lower(correo) = $1 OR ip = $2)`,
        [c, ip],
      )
      if (n.correo >= config.recuperacionPorHoraCuenta || n.correo_dia >= config.recuperacionPorDiaCuenta || n.ip >= config.recuperacionPorHoraIp) return false
      await cx.query(`UPDATE verificaciones_correo SET usado_en = now() WHERE lower(correo) = $1 AND usado_en IS NULL`, [c])
      // Con cuenta, el renglón sólo cuenta para los topes: ya nace usado y ningún código lo abre.
      await cx.query(
        `INSERT INTO verificaciones_correo (correo, codigo_hash, expira_en, ip, usado_en) VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5)`,
        [c, cuenta ? '-' : hmac('registro', codigo), config.verificacionMinutos, ip, cuenta ? new Date() : null],
      )
      return true
    })
    if (!nuevo) return log.warn({ ip }, 'registro: tope de códigos alcanzado, no se manda otro')
    const msj = cuenta ? correoYaRegistrado(cuenta.nombre, `${config.urlApp}/admin`) : correoVerificacion(codigo, config.verificacionMinutos)
    await enviarCorreo(config, { para: c, ...msj }, log)
  }

  app.post('/registro/codigo', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const b = bodyCodigo.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Escribe un correo válido' })
    const listo = Date.now() + config.recuperacionPisoMs
    try {
      await mandarCodigo(b.data.correo, ipCliente(req, config), req.log)
    } catch (e) {
      req.log.error(e, 'no se pudo preparar o enviar el código de registro')
    }
    await esperarHasta(listo)
    return { ok: true, minutos: config.verificacionMinutos }
  })

  app.post('/registro/verificar', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const b = bodyVerificar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Escribe el código de 6 dígitos' })
    const { correo: c, codigo } = b.data
    const { rows: [v] } = await db.query(
      `SELECT id_verificacion, codigo_hash FROM verificaciones_correo
        WHERE lower(correo) = $1 AND usado_en IS NULL AND expira_en > now() ORDER BY creado_en DESC LIMIT 1`,
      [c],
    )
    if (!v) return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    if (!iguales(v.codigo_hash, hmac('registro', codigo))) {
      await db.query(
        `UPDATE verificaciones_correo SET intentos = intentos + 1, usado_en = CASE WHEN intentos + 1 >= $2 THEN now() ELSE usado_en END
          WHERE id_verificacion = $1`,
        [v.id_verificacion, config.recuperacionMaxIntentos],
      )
      return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    }
    const usado = await db.query(`UPDATE verificaciones_correo SET usado_en = now() WHERE id_verificacion = $1 AND usado_en IS NULL`, [v.id_verificacion])
    if (usado.rowCount !== 1) return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    return { comprobante: comprobante(c) }
  })

  // Crea la invitación dentro de la transacción (ya en la empresa) y devuelve el enlace para mandarlo al terminar.
  async function invitar(cx: Cx, c: string, idInvitador: string | null) {
    const token = tokenAleatorio()
    await cx.query(
      `INSERT INTO invitaciones (correo, token_hash, id_invitador, expira_en) VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [c, hmac('invitacion', token), idInvitador, config.invitacionDias],
    )
    return { correo: c, url: `${config.urlApp}/invitacion#${token}` }
  }
  async function mandarInvitaciones(lista: { correo: string; url: string }[], empresa: string, quien: string, log: FastifyBaseLogger) {
    for (const i of lista) {
      await enviarCorreo(config, { para: i.correo, ...correoInvitacion(empresa, quien, i.url, config.invitacionDias) }, log)
        .catch((e) => log.error(e, 'no se pudo enviar una invitación'))
    }
  }

  app.post('/registro/empresa', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyEmpresa.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: revisa(b.error) })
    const { empresa: e, administrador: a, invitaciones } = b.data
    if (!comprobanteValido(b.data.comprobante, a.correo)) {
      return rep.code(400).send({ error: 'Confirma tu correo con el código antes de crear la empresa', codigo: 'CORREO_SIN_CONFIRMAR' })
    }
    const regla = revisarPassword(a.password, a.correo)
    if (regla) return rep.code(400).send({ error: regla })
    const productos = productosDelRegistro(b.data)
    if (!productos.length) return rep.code(400).send({ error: 'Agrega al menos un producto con su precio' })
    const hash = await hashPassword(config, a.password)

    try {
      // Como dueño de la base (la empresa todavía no existe); app.id_empresa da dueño a todo lo que sigue.
      const r = await tx(db, null, async (cx) => {
        const { rows: [emp] } = await cx.query(
          `INSERT INTO empresas (nombre, zona_horaria, color_marca, logo, giros, control_retornables) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_empresa`,
          [e.nombre, e.zonaHoraria, e.color, e.logo, e.giros, e.controlRetornables],
        )
        await cx.query(`SELECT set_config('app.id_empresa', $1, true)`, [emp.id_empresa])
        const { rows: [u] } = await cx.query(
          `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password) VALUES ($1, $2, $3, 'administrador', false)
           ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
          [a.nombre, a.correo, hash],
        )
        if (!u) throw new CorreoRepetido()
        await cx.query(`SELECT set_config('app.id_usuario', $1, true)`, [u.id_usuario])
        for (const p of productos) {
          await cx.query(
            `INSERT INTO productos (nombre, sabor, descripcion, presentacion_litros, precio_unitario, costo_produccion, color_hex) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [p.nombre, p.sabor, p.descripcion, p.presentacion, p.precio, p.costo, p.color],
          )
        }
        const enlaces = []
        for (const c of new Set(invitaciones.filter((c) => c !== a.correo))) enlaces.push(await invitar(cx, c, u.id_usuario))
        return { idEmpresa: emp.id_empresa as string, enlaces }
      })
      await mandarInvitaciones(r.enlaces, e.nombre, a.nombre, req.log)
      return rep.code(201).send({ empresa: { id: r.idEmpresa, nombre: e.nombre }, productos: productos.length, invitaciones: r.enlaces.length })
    } catch (err) {
      if (err instanceof CorreoRepetido) return rep.code(409).send(CORREO_REPETIDO)
      throw err
    }
  })

  // El administrador invita a alguien más después del registro (Equipo).
  app.post('/invitaciones', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyInvitar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Escribe un correo válido' })
    // Desde la empresa no se ven cuentas de otras: el correo repetido se descubre al aceptar, no aquí.
    const { rows: [ya] } = await db.query(`SELECT 1 FROM usuarios WHERE lower(correo) = $1`, [b.data.correo])
    if (ya) return rep.code(409).send({ error: 'Esa persona ya está en tu equipo', codigo: 'CORREO_REPETIDO' })
    const { enlace, empresa, quien } = await tx(db, req.usuario.id, async (cx) => {
      const { rows: [d] } = await cx.query(
        `SELECT e.nombre AS empresa, u.nombre AS quien FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
        [req.usuario.id],
      )
      return { enlace: await invitar(cx, b.data.correo, req.usuario.id), ...d }
    })
    await mandarInvitaciones([enlace], empresa, quien, req.log)
    return rep.code(201).send({ ok: true, correo: b.data.correo, dias: config.invitacionDias })
  })

  // Lo que ve el repartidor al abrir el enlace, antes de crear su contraseña.
  async function invitacionAbierta(cx: { query: Cx['query'] }, token: string, bloquear = false) {
    const { rows: [i] } = await cx.query(
      `SELECT i.id_invitacion, i.id_empresa, i.correo, i.rol, e.nombre AS empresa, e.color_marca, e.logo
         FROM invitaciones i JOIN empresas e USING (id_empresa)
        WHERE i.token_hash = $1 AND i.usado_en IS NULL AND i.expira_en > now() AND e.activa
        ${bloquear ? 'FOR UPDATE OF i' : ''}`,
      [hmac('invitacion', token)],
    )
    return i
  }

  app.post('/invitacion/consultar', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const b = bodyToken.safeParse(req.body)
    const i = b.success ? await invitacionAbierta(db, b.data.token) : null
    if (!i) return rep.code(404).send(INVITACION_INVALIDA)
    return { correo: i.correo, empresa: { nombre: i.empresa, color: i.color_marca, logo: i.logo } }
  })

  app.post('/invitacion/aceptar', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const b = bodyAceptar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: revisa(b.error) })
    const previa = await invitacionAbierta(db, b.data.token)
    if (!previa) return rep.code(404).send(INVITACION_INVALIDA)
    const regla = revisarPassword(b.data.password, previa.correo)
    if (regla) return rep.code(400).send({ error: regla })
    const hash = await hashPassword(config, b.data.password)
    try {
      const r = await tx(db, null, async (cx) => {
        const i = await invitacionAbierta(cx, b.data.token, true) // otra vez, ya bloqueada: dos envíos a la vez
        if (!i) return null
        await cx.query(`SELECT set_config('app.id_empresa', $1, true)`, [i.id_empresa])
        const { rows: [u] } = await cx.query(
          `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password) VALUES ($1, $2, $3, $4, false)
           ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
          [b.data.nombre, i.correo, hash, i.rol],
        )
        if (!u) throw new CorreoRepetido()
        await cx.query(`UPDATE invitaciones SET usado_en = now() WHERE id_invitacion = $1`, [i.id_invitacion])
        return { correo: i.correo as string }
      })
      if (!r) return rep.code(404).send(INVITACION_INVALIDA)
      return rep.code(201).send(r)
    } catch (err) {
      if (err instanceof CorreoRepetido) return rep.code(409).send(CORREO_REPETIDO)
      throw err
    }
  })
}
