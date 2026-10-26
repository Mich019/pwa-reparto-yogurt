// RF-052 · Envío de la cola desde el service worker, para cuando vuelve la señal con la app cerrada.
// Se compila aparte como dist/sw-envio.js (vite.config.ts) y public/sw.js lo carga con importScripts.
// Usa el mismo envío que la app (src/lib/envio.ts) y la copia de la sesión que la app deja en la base local.
import { api, ErrorApi } from '../lib/api'
import { db } from '../lib/db'
import { CLAVE_SESION_SW, enviarCola, revocarPendientes, type Llamar, type SesionSegundoPlano } from '../lib/envio'

const leerSesion = async () => (await db.meta.get(CLAVE_SESION_SW))?.valor as SesionSegundoPlano | undefined

// Cambia la copia sólo si sigue siendo la misma sesión: mientras tanto la persona pudo salir o entrar con otra cuenta.
async function actualizarSesion(de: SesionSegundoPlano, cambio: Partial<SesionSegundoPlano> | null) {
  await db.transaction('rw', db.meta, async () => {
    const ahora = await leerSesion()
    if (ahora?.refreshToken !== de.refreshToken || ahora?.usuarioId !== de.usuarioId) return
    if (cambio) await db.meta.put({ clave: CLAVE_SESION_SW, valor: { ...ahora, ...cambio } })
    else await db.meta.delete(CLAVE_SESION_SW)
  })
}

// Token de acceso vigente. El refresh token no rota (api/_lib/auth.ts), así que renovarlo aquí no deja fuera a la app.
// '' = sesión en cookie (panel web): las peticiones del service worker al mismo dominio ya la llevan.
async function tokenVigente(s: SesionSegundoPlano, forzar = false): Promise<string | null> {
  if (!forzar && s.expiraEn - Date.now() > 60_000) return s.accessToken ?? ''
  try {
    const r = await api<{ accessToken?: string; expiraEn: number }>('/auth/refresh', { cuerpo: s.cookie ? {} : { refreshToken: s.refreshToken } })
    await actualizarSesion(s, { accessToken: r.accessToken, expiraEn: r.expiraEn })
    s.accessToken = r.accessToken
    s.expiraEn = r.expiraEn
    return r.accessToken ?? ''
  } catch (e) {
    // Sesión revocada (cerró sesión en otro lado, cuenta dada de baja): ya no se intenta; la app pedirá entrar.
    if (e instanceof ErrorApi && e.status === 401) {
      await actualizarSesion(s, null)
      return null
    }
    throw e // sin señal: el navegador vuelve a despertar el evento más tarde
  }
}

// true = no queda nada por enviar (o no hay con qué); un error = reintentar más tarde.
export async function enviarEnSegundoPlano(): Promise<boolean> {
  await revocarPendientes() // sesiones que se cerraron sin señal
  const s = await leerSesion()
  if (!s || s.debeCambiarPassword || !(await db.cola.count())) return true
  let token = await tokenVigente(s)
  if (token === null) return true
  const llamar: Llamar = async <T>(ruta: string, cuerpo?: unknown) => {
    try {
      return await api<T>(ruta, { cuerpo, token: token ?? '' })
    } catch (e) {
      if (!(e instanceof ErrorApi && e.status === 401)) throw e
      token = await tokenVigente(s, true)
      if (token === null) throw e
      return api<T>(ruta, { cuerpo, token })
    }
  }
  await enviarCola(llamar, s.dispositivo)
  return true
}
