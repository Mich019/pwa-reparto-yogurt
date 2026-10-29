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
