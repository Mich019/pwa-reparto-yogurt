import type { FastifyReply, FastifyRequest } from 'fastify'

// Sesión del panel web en cookies que JavaScript no puede leer (HttpOnly): si algún día se colara un script en la
// página, no podría llevarse la sesión. Sólo cuando la app y la API comparten dominio (Vercel); la app de reparto
// sigue con tokens porque funciona sin conexión y su service worker los necesita.
//  · SameSite=Strict: el navegador no las manda desde otro sitio.
//  · En producción, Secure y prefijo __Host- (sólo https, sin Domain, Path=/): ningún subdominio puede pisarlas.
//  · Además, un cambio hecho con cookie exige la cabecera X-Solicitud (ver autenticar en app.ts): un formulario de otro
//    sitio no puede ponerla y un fetch de otro origen con ella necesita permiso de CORS.

export const CABECERA_APP = 'x-solicitud'

interface Ajustes { produccion: boolean; accesoMinutos: number; sesionDias: number }

const nombres = (c: Pick<Ajustes, 'produccion'>) => (c.produccion ? { acceso: '__Host-ry_acceso', sesion: '__Host-ry_sesion' } : { acceso: 'ry_acceso', sesion: 'ry_sesion' })

export function leerCookie(req: FastifyRequest, c: Pick<Ajustes, 'produccion'>, cual: 'acceso' | 'sesion'): string | undefined {
  const nombre = nombres(c)[cual]
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=')
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim())
  }
  return undefined
}

function cookie(c: Ajustes, nombre: string, valor: string, segundos: number) {
  return `${nombre}=${encodeURIComponent(valor)}; Path=/; Max-Age=${segundos}; HttpOnly; SameSite=Strict${c.produccion ? '; Secure' : ''}`
}

// Al entrar: el token de acceso (15 min) y el de la sesión (30 días).
export function fijarCookiesSesion(rep: FastifyReply, c: Ajustes, t: { acceso: string; sesion?: string }) {
  const n = nombres(c)
  rep.header('set-cookie', [
    cookie(c, n.acceso, t.acceso, c.accesoMinutos * 60),
    ...(t.sesion ? [cookie(c, n.sesion, t.sesion, c.sesionDias * 86_400)] : []),
  ])
}

export function borrarCookiesSesion(rep: FastifyReply, c: Ajustes) {
  const n = nombres(c)
  rep.header('set-cookie', [cookie(c, n.acceso, '', 0), cookie(c, n.sesion, '', 0)])
}
