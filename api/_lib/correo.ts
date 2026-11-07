import type { Config } from './config.js'

// Envío de correo con la API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sin dependencias: un fetch basta y funciona igual en local y en Vercel.
export async function enviarCorreo(config: Config, msj: { para: string; asunto: string; html: string; texto: string }, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  if (!config.resendApiKey) {
    if (config.produccion) throw new Error('Falta RESEND_API_KEY para enviar correos')
    log.warn({ para: msj.para, texto: msj.texto }, 'RESEND_API_KEY vacío: correo NO enviado (sólo desarrollo)')
    return
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.correoRemitente, to: [msj.para], subject: msj.asunto, html: msj.html, text: msj.texto }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${await r.text().catch(() => '')}`)
  log.info({ para: msj.para }, 'correo enviado')
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// Los correos van con la misma paleta de la app (negro, blanco, grises): un marco y sus renglones.
const marco = (contenido: string) => `<!doctype html><html><body style="margin:0;background:#f3f3f3;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:20px;padding:32px">
<tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em">Delisy</td></tr>
${contenido}
</table></td></tr></table></body></html>`
const parrafo = (html: string) => `<tr><td style="padding-top:20px;font-size:16px;line-height:1.5">${html}</td></tr>`
const nota = (html: string) => `<tr><td style="font-size:14px;color:#6b6b6b;line-height:1.5">${html}</td></tr>`
const bloqueCodigo = (codigo: string) =>
  `<tr><td style="padding:24px 0"><div style="background:#f3f3f3;border-radius:14px;padding:18px;text-align:center;font-size:34px;font-weight:700;letter-spacing:10px">${codigo}</div></td></tr>`
const boton = (url: string, texto: string) =>
  `<tr><td style="padding:24px 0"><a href="${escapar(url)}" style="display:inline-block;background:#000;color:#fff;border-radius:999px;padding:14px 28px;font-weight:700;text-decoration:none">${texto}</a></td></tr>`
const primerNombre = (nombre: string) => escapar(nombre.split(' ')[0] ?? '')

// Recuperación de contraseña.
export function correoCodigo(nombre: string, codigo: string, minutos: number) {
  return {
    asunto: `${codigo} es tu código para restablecer la contraseña`,
    texto: `Hola ${nombre}:\n\nTu código para restablecer la contraseña de Delisy es ${codigo}.\nVence en ${minutos} minutos.\n\nSi no lo pediste, ignora este correo: tu contraseña no cambia.`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)}, usa este código para restablecer tu contraseña:`) + bloqueCodigo(codigo)
      + nota(`Vence en ${minutos} minutos. Si no lo pediste, ignora este correo: tu contraseña no cambia.`)),
  }
}

// Registro de una empresa: confirma que el correo es de quien se registra.
export function correoVerificacion(codigo: string, minutos: number) {
  return {
    asunto: `${codigo} es tu código para crear tu cuenta`,
    texto: `Tu código para confirmar tu correo en Delisy es ${codigo}.\nVence en ${minutos} minutos.\n\nSi no estás creando una cuenta, ignora este correo.`,
    html: marco(parrafo('Usa este código para confirmar tu correo y terminar de crear tu cuenta:') + bloqueCodigo(codigo)
      + nota(`Vence en ${minutos} minutos. Si no estás creando una cuenta, ignora este correo.`)),
  }
}

// Alguien intentó registrarse con un correo que ya tiene cuenta: se le avisa a él, no en la pantalla (así no se
// revela quién tiene cuenta).
export function correoYaRegistrado(nombre: string, url: string) {
  return {
    asunto: 'Ya tienes una cuenta en Delisy',
    texto: `Hola ${nombre}:\n\nAlguien (quizá tú) intentó crear una cuenta nueva con este correo, pero ya tienes una.\nEntra en ${url} y, si no recuerdas tu contraseña, usa «¿Olvidaste tu contraseña?».\n\nSi no fuiste tú, ignora este correo.`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)}, alguien (quizá tú) intentó crear una cuenta nueva con este correo, pero ya tienes una.`)
      + boton(url, 'Entrar a mi cuenta')
      + nota('Si no recuerdas tu contraseña, usa «¿Olvidaste tu contraseña?». Si no fuiste tú, ignora este correo.')),
  }
}

// Un administrador invita a un repartidor: el enlace abre la pantalla para crear su contraseña.
export function correoInvitacion(empresa: string, quien: string, url: string, dias: number) {
  return {
    asunto: `${empresa} te invita a repartir con Delisy`,
    texto: `${quien} te invitó a unirte a ${empresa} en Delisy.\nCrea tu contraseña aquí: ${url}\n\nEl enlace vence en ${dias} días. Si no esperabas esta invitación, ignora este correo.`,
    html: marco(parrafo(`${escapar(quien)} te invitó a unirte a <b>${escapar(empresa)}</b> para ver tu ruta y levantar pedidos desde tu teléfono.`)
      + boton(url, 'Crear mi contraseña')
      + nota(`El enlace vence en ${dias} días. Si no esperabas esta invitación, ignora este correo.`)),
  }
}

// Muchos correos de una vez (avisos de la plataforma): la API de lotes de Resend, de 100 en 100. Devuelve cuántos salieron;
// si falla un lote, los anteriores ya se mandaron y el error dice cuántos.
export async function enviarCorreos(config: Config, msjs: { para: string; asunto: string; html: string; texto: string; adjuntos?: { nombre: string; base64: string }[] }[], log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  if (!config.resendApiKey) {
    if (config.produccion) throw new Error('Falta RESEND_API_KEY para enviar correos')
    log.warn({ cuantos: msjs.length }, 'RESEND_API_KEY vacío: correos NO enviados (sólo desarrollo)')
    return msjs.length
  }
  // El envío por lotes de Resend no acepta adjuntos: con adjunto, uno por uno.
  if (msjs.some((m) => m.adjuntos?.length)) {
    let n = 0
    for (const m of msjs) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.correoRemitente, to: [m.para], subject: m.asunto, html: m.html, text: m.texto, attachments: m.adjuntos?.map((a) => ({ filename: a.nombre, content: a.base64 })) }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!r.ok) throw Object.assign(new Error(`Resend respondió ${r.status} tras ${n} correos: ${await r.text().catch(() => '')}`), { enviados: n })
      n++
    }
    log.info({ enviados: n }, 'correos con adjunto enviados')
    return n
  }
  let enviados = 0
  for (let i = 0; i < msjs.length; i += 100) {
    const lote = msjs.slice(i, i + 100)
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(lote.map((m) => ({ from: config.correoRemitente, to: [m.para], subject: m.asunto, html: m.html, text: m.texto }))),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) throw Object.assign(new Error(`Resend respondió ${r.status} tras ${enviados} correos: ${await r.text().catch(() => '')}`), { enviados })
    enviados += lote.length
  }
  log.info({ enviados }, 'correos enviados')
  return enviados
}

// Un aviso importante de la plataforma (apartado «Avisos» en /plataforma), a cada cuenta a la que va.
export function correoAviso(nombre: string, texto: string, url: string) {
  const corto = texto.length > 60 ? `${texto.slice(0, 57).trimEnd()}…` : texto
  return {
    asunto: `Aviso de Delisy: ${corto}`,
    texto: `Hola ${nombre}:\n\n${texto}\n\nEntra a Delisy: ${url}\n\nTe escribimos porque tienes una cuenta en Delisy.`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)},`) + parrafo(escapar(texto).replace(/\n/g, '<br>'))
      + boton(url, 'Entrar a Delisy')
      + nota('Te escribimos porque tienes una cuenta en Delisy.')),
  }
}

// Resumen diario para el administrador (resumen.ts): lo de ayer en renglones, sólo lo que tiene algo.
export interface CifrasResumen {
  desde: string // AAAA-MM-DD; igual a `dia` en el diario, seis días antes en el semanal
  dia: string // AAAA-MM-DD, ayer en la zona de la empresa (el último día que cuenta)
  entregados: number; vendido: number; efectivo: number; transferencia: number; fiado: number; abonos: number
  sinAtender: number; cortesPorConfirmar: number; urgentes: number
  vendidoAntes: number | null // semanal: lo vendido los siete días anteriores; null en el diario
  // Sólo el semanal: el mejor día, lo que más se vendió y cada vendedor contra su meta del mes.
  semana: {
    mejorDia: { dia: string; vendido: number } | null
    sabor: { nombre: string; vendido: number } | null
    vendedores: { nombre: string; semana: number; mes: number; meta: number | null }[]
  } | null
}
const pesos = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const veces = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

const contraAntes = (vendido: number, antes: number) => {
  const p = antes ? Math.round(((vendido - antes) / antes) * 100) : null
  return p === null ? (vendido ? 'La anterior no hubo ventas' : '')
    : p === 0 ? `Igual (${pesos(antes)})`
    : `${Math.abs(p)}% ${p > 0 ? 'más' : 'menos'} (${pesos(antes)})`
}
const fechaLarga = (s: string) => { const [a, m, d] = s.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) }

// Resumen semanal del vendedor (resumen.ts): lo suyo, sin costos ni lo de los demás.
export interface CifrasVendedor {
  desde: string; dia: string // los siete días que terminan ayer
  pedidos: number; vendido: number; vendidoAntes: number
  mes: number; meta: number | null; avanceMesPct: number // cuánto del mes ya pasó, para comparar con la meta
}
export function correoVendedor(nombre: string, empresa: string, c: CifrasVendedor, url: string) {
  const renglones: [string, string][] = [['Vendiste', c.pedidos ? `${pesos(c.vendido)} en ${veces(c.pedidos, 'pedido', 'pedidos')}` : 'Sin ventas']]
  const comparado = contraAntes(c.vendido, c.vendidoAntes)
  if (comparado) renglones.push(['Contra la semana anterior', comparado])
  if (c.meta) {
    renglones.push(['Tu mes', `${pesos(c.mes)} de ${pesos(c.meta)} (${Math.round((c.mes / c.meta) * 100)}%)`])
    renglones.push(['Del mes ya pasó', `${c.avanceMesPct}%`])
  } else renglones.push(['En lo que va del mes', pesos(c.mes)])
  const celda = 'padding:8px 0;border-top:1px solid #eee'
  const tabla = `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">${renglones
    .map(([k, v]) => `<tr><td style="${celda};color:#6b6b6b">${escapar(k)}</td><td align="right" style="${celda};font-weight:600">${escapar(v)}</td></tr>`).join('')}</table></td></tr>`
  const dia = `del ${fechaLarga(c.desde)} al ${fechaLarga(c.dia)}`
  const pie = 'Lo recibes porque lo pediste en la app, en Cuenta → Preferencias. Ahí mismo lo apagas.'
  return {
    asunto: `${empresa}: tu semana`,
    texto: `Hola ${nombre}:\n\nAsí te fue ${dia}:\n${renglones.map(([k, v]) => `· ${k}: ${v}`).join('\n')}\n\nAbre la app: ${url}\n\n${pie}`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)}, así te fue ${escapar(dia)}:`) + tabla + boton(url, 'Abrir la app') + nota(pie)),
  }
}

export function correoResumen(nombre: string, empresa: string, c: CifrasResumen, url: string) {
  const fecha = (s: string, o: Intl.DateTimeFormatOptions) => { const [a, m, d] = s.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('es-MX', { ...o, timeZone: 'UTC' }) }
  const semanal = c.desde !== c.dia
  const dia = semanal
    ? `del ${fecha(c.desde, { weekday: 'long', day: 'numeric', month: 'long' })} al ${fecha(c.dia, { weekday: 'long', day: 'numeric', month: 'long' })}`
    : `el ${fecha(c.dia, { weekday: 'long', day: 'numeric', month: 'long' })}`
  const renglones: [string, string][] = [['Vendido', c.entregados ? `${pesos(c.vendido)} en ${veces(c.entregados, 'pedido', 'pedidos')}` : 'Sin ventas']]
  if (c.entregados) renglones.push(['En efectivo', pesos(c.efectivo)], ['Por transferencia', pesos(c.transferencia)])
  if (c.vendidoAntes !== null) {
    const comparado = contraAntes(c.vendido, c.vendidoAntes)
    if (comparado) renglones.push(['Contra la semana anterior', comparado])
  }
  if (c.semana?.mejorDia) renglones.push(['Mejor día', `${fecha(c.semana.mejorDia.dia, { weekday: 'long', day: 'numeric' })} · ${pesos(c.semana.mejorDia.vendido)}`])
  if (c.semana?.sabor) renglones.push(['Lo que más se vendió', `${c.semana.sabor.nombre} · ${pesos(c.semana.sabor.vendido)}`])
  if (c.fiado) renglones.push(['Fiado', pesos(c.fiado)])
  if (c.abonos) renglones.push(['Abonos cobrados', pesos(c.abonos)])
  // Cada vendedor: lo de la semana y, si tiene meta, cómo va el mes.
  const vendedores: [string, string][] = (c.semana?.vendedores ?? []).map((v) => [v.nombre,
    `${pesos(v.semana)}${v.meta ? ` · mes: ${pesos(v.mes)} de ${pesos(v.meta)} (${Math.round((v.mes / v.meta) * 100)}%)` : ''}`])
  const pendientes = [
    c.cortesPorConfirmar ? `${veces(c.cortesPorConfirmar, 'corte', 'cortes')} por confirmar` : '',
    c.sinAtender ? `${veces(c.sinAtender, 'pedido quedó', 'pedidos quedaron')} sin atender` : '',
    c.urgentes ? `${veces(c.urgentes, 'urgente tardó', 'urgentes tardaron')} en atenderse` : '',
  ].filter(Boolean)
  const celda = 'padding:8px 0;border-top:1px solid #eee'
  const aTabla = (filas: [string, string][]) => `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">${filas
    .map(([k, v]) => `<tr><td style="${celda};color:#6b6b6b">${escapar(k)}</td><td align="right" style="${celda};font-weight:600">${escapar(v)}</td></tr>`).join('')}</table></td></tr>`
  const tabla = aTabla(renglones) + (vendedores.length ? parrafo('<strong>Vendedores</strong> (la semana y, con meta, cómo va el mes)') + aTabla(vendedores) : '')
  const pie = 'Lo recibes porque lo pediste en Configuración → Preferencias. Ahí mismo lo apagas.'
  return {
    asunto: `${empresa}: tu resumen de ${semanal ? 'la semana' : 'ayer'}`,
    texto: `Hola ${nombre}:\n\nAsí le fue a ${empresa} ${dia}:\n${renglones.map(([k, v]) => `· ${k}: ${v}`).join('\n')}${vendedores.length ? `\n\nVendedores:\n${vendedores.map(([k, v]) => `· ${k}: ${v}`).join('\n')}` : ''}${pendientes.length ? `\n\nPendiente: ${pendientes.join('; ')}.` : ''}\n\nEntra a Delisy: ${url}\n\n${pie}`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)}, así le fue a <strong>${escapar(empresa)}</strong> ${escapar(dia)}:`) + tabla
      + (pendientes.length ? parrafo(`<strong>Pendiente:</strong> ${escapar(pendientes.join('; '))}.`) : '')
      + boton(url, 'Abrir el panel')
      + nota(pie)),
  }
}

// Informe del mes al cerrarlo (resumen.ts): las cifras principales en el correo y el PDF del informe adjunto.
export interface CifrasCierre {
  ingreso: number; utilidad: number; pedidos: number; porCobrar: number
  vendedores: { nombre: string; ventas: number; meta: number | null; cumplimientoPct: number | null }[]
}
export function correoMensual(nombre: string, empresa: string, mes: string, c: CifrasCierre, url: string) {
  const [a, m] = mes.split('-').map(Number)
  const nombreMes = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const renglones: [string, string][] = [
    ['Vendido', `${pesos(c.ingreso)} en ${veces(c.pedidos, 'pedido', 'pedidos')}`],
    ['Utilidad', pesos(c.utilidad)],
    ...(c.porCobrar ? [['Por cobrar al cierre', pesos(c.porCobrar)] as [string, string]] : []),
    ...c.vendedores.filter((v) => v.ventas || v.meta).map((v): [string, string] => [v.nombre, `${pesos(v.ventas)}${v.meta ? ` de ${pesos(v.meta)} (${v.cumplimientoPct ?? 0}%)` : ''}`]),
  ]
  const celda = 'padding:8px 0;border-top:1px solid #eee'
  const tabla = `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">${renglones
    .map(([k, v]) => `<tr><td style="${celda};color:#6b6b6b">${escapar(k)}</td><td align="right" style="${celda};font-weight:600">${escapar(v)}</td></tr>`).join('')}</table></td></tr>`
  const pie = 'Lo recibes porque lo pediste en Configuración → Preferencias. Ahí mismo lo apagas.'
  return {
    asunto: `${empresa}: cierre de ${nombreMes}`,
    texto: `Hola ${nombre}:\n\nSe cerró ${nombreMes} en ${empresa}. Va adjunto el informe en PDF.\n${renglones.map(([k, v]) => `· ${k}: ${v}`).join('\n')}\n\nEntra a Delisy: ${url}\n\n${pie}`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)}, se cerró <strong>${escapar(nombreMes)}</strong> en ${escapar(empresa)}. Va adjunto el informe en PDF.`) + tabla
      + boton(url, 'Abrir el panel')
      + nota(pie)),
  }
}

// Constancia de que la cuenta se eliminó (derecho de cancelación): sale al correo que tenía antes de anonimizarla.
export function correoCuentaEliminada(nombre: string, empresa: string) {
  return {
    asunto: 'Eliminamos tu cuenta de Delisy',
    texto: `Hola ${nombre}:\n\nComo lo pediste, eliminamos tu cuenta de ${empresa} en Delisy: tu nombre, correo, teléfono y foto ya no están guardados y no puedes volver a entrar con ella. Las ventas que registraste siguen en los libros de ${empresa}, sin tus datos.\n\nSi no fuiste tú, avisa al administrador de tu negocio.`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)},`)
      + parrafo(`Como lo pediste, eliminamos tu cuenta de <strong>${escapar(empresa)}</strong> en Delisy: tu nombre, correo, teléfono y foto ya no están guardados y no puedes volver a entrar con ella.`)
      + parrafo(`Las ventas que registraste siguen en los libros de ${escapar(empresa)}, sin tus datos.`)
      + nota('Si no fuiste tú, avisa al administrador de tu negocio.')),
  }
}

// La empresa pidió su baja: hasta cuándo puede arrepentirse y a quién escribir.
export function correoBajaEmpresa(nombre: string, empresa: string, borrarEn: Date, soporte: string | null) {
  const dia = borrarEn.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })
  const contacto = soporte ? ` escribe a ${soporte}` : ' responde a este correo'
  return {
    asunto: `${empresa} se dio de baja de Delisy`,
    texto: `Hola ${nombre}:\n\n${empresa} se dio de baja de Delisy: nadie de tu equipo puede entrar y la suscripción quedó cancelada. El ${dia} borraremos todos sus datos (clientes, pedidos, cobranza y cuentas) y ya no se podrán recuperar.\n\nSi fue un error o quieres volver antes de esa fecha,${contacto}.`,
    html: marco(parrafo(`Hola ${primerNombre(nombre)},`)
      + parrafo(`<strong>${escapar(empresa)}</strong> se dio de baja de Delisy: nadie de tu equipo puede entrar y la suscripción quedó cancelada.`)
      + parrafo(`El <strong>${escapar(dia)}</strong> borraremos todos sus datos (clientes, pedidos, cobranza y cuentas) y ya no se podrán recuperar.`)
      + nota(`Si fue un error o quieres volver antes de esa fecha,${escapar(contacto)}.`)),
  }
}
