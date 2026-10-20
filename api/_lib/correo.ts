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

// Correo con el código de recuperación, con la misma paleta de la app (negro, blanco, grises).
export function correoCodigo(nombre: string, codigo: string, minutos: number) {
  const n = escapar(nombre.split(' ')[0] ?? '')
  return {
    asunto: `${codigo} es tu código para restablecer la contraseña`,
    texto: `Hola ${nombre}:\n\nTu código para restablecer la contraseña de Reparto Yogurt es ${codigo}.\nVence en ${minutos} minutos.\n\nSi no lo pediste, ignora este correo: tu contraseña no cambia.`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f3f3;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:20px;padding:32px">
<tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em">Reparto Yogurt</td></tr>
<tr><td style="padding-top:20px;font-size:16px;line-height:1.5">Hola ${n}, usa este código para restablecer tu contraseña:</td></tr>
<tr><td style="padding:24px 0"><div style="background:#f3f3f3;border-radius:14px;padding:18px;text-align:center;font-size:34px;font-weight:700;letter-spacing:10px">${codigo}</div></td></tr>
<tr><td style="font-size:14px;color:#6b6b6b;line-height:1.5">Vence en ${minutos} minutos. Si no lo pediste, ignora este correo: tu contraseña no cambia.</td></tr>
</table></td></tr></table></body></html>`,
  }
}
