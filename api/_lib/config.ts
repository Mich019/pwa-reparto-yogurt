import type { PoolConfig } from 'pg'

function requerido(nombre: string): string {
  const v = process.env[nombre]
  if (!v) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`)
  return v
}

const PARAMETROS_SSL = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']

// Cifrado de la conexión, con los niveles de libpq:
//  · cifrar sin verificar (lo predeterminado con Railway, que usa un certificado propio que Node no reconoce): evita que
//    se lea el tráfico, pero no confirma que del otro lado esté la base.
//  · DB_SSL_CA (el certificado de la base o de su autoridad, en PEM o base64), o sslmode=verify-ca: además exige que el
//    certificado venga de esa autoridad. Es lo recomendable con Railway (ver docs/produccion-railway.md).
//  · sslmode=verify-full o DB_SSL=verify-full: además exige que el certificado sea del nombre del servidor.
// DB_SSL=true|false|verify-full manda; si no viene, se cifra cuando la dirección lo pide (?sslmode=…) o es la pública de
// Railway (*.rlwy.net). La red privada de Railway (*.railway.internal) y localhost van sin cifrar.
function leerSsl(host: string, sslmode: string | null): PoolConfig['ssl'] {
  const caTexto = process.env.DB_SSL_CA?.trim()
  const ca = caTexto ? (caTexto.startsWith('-----') ? caTexto : Buffer.from(caTexto, 'base64').toString('utf8')) : undefined
  const pedido = process.env.DB_SSL ?? ''
  const modo = pedido === 'verify-full' ? 'verify-full' : pedido === 'true' || pedido === 'false' ? null : sslmode
  if (pedido === 'false' || modo === 'disable') return undefined
  if (modo === 'verify-full') return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
  if (ca || modo === 'verify-ca') {
    if (!ca) throw new Error('sslmode=verify-ca necesita el certificado de la base en DB_SSL_CA')
    return { rejectUnauthorized: true, ca, checkServerIdentity: () => undefined }
  }
  const cifrar = pedido === 'true' || /^(require|prefer)$/.test(modo ?? '') || /\.rlwy\.net$/i.test(host)
  return cifrar ? { rejectUnauthorized: false } : undefined
}

// Conexión: DATABASE_URL completa (Railway: la «DATABASE_PUBLIC_URL» de su servicio Postgres si la API está fuera de
// Railway, o la «DATABASE_URL» privada si corre dentro), o por partes (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD).
function leerConexion(): PoolConfig {
  const serverless = !!process.env.VERCEL
  const comunes: PoolConfig = {
    max: Number(process.env.DB_POOL_MAX ?? (serverless ? 3 : 10)),
    // Una función serverless se congela entre peticiones: las conexiones ociosas se sueltan pronto para no agotar la base.
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000, // si la base no contesta, error claro en 10 s en lugar de quedarse colgado
    keepAlive: true,
    statement_timeout: 30_000, // ninguna consulta acapara la base más de 30 s
  }
  const url = process.env.DATABASE_URL?.trim()
  if (url) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      throw new Error('DATABASE_URL no es una dirección válida (ejemplo: postgresql://usuario:clave@host:5432/base)')
    }
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL debe empezar con postgresql://')
    // pg deja que los parámetros SSL de la dirección pisen la opción ssl (y trata «require» como «verificar»): se quitan
    // de la dirección y se decide aquí, para que pegar tal cual la dirección de Railway funcione.
    const sslmode = u.searchParams.get('sslmode')
    for (const p of PARAMETROS_SSL) u.searchParams.delete(p)
    return { ...comunes, connectionString: u.toString(), ssl: leerSsl(u.hostname, sslmode) }
  }
  const host = requerido('DB_HOST')
  return {
    ...comunes,
    host,
    port: Number(process.env.DB_PORT ?? 5432),
    database: requerido('DB_NAME'),
    user: requerido('DB_USER'),
    password: requerido('DB_PASSWORD'),
    ssl: leerSsl(host, null),
  }
}

function leerPush() {
  const vapidPublica = process.env.VAPID_PUBLIC_KEY ?? ''
  const vapidPrivada = process.env.VAPID_PRIVATE_KEY ?? ''
  if (!!vapidPublica !== !!vapidPrivada) throw new Error('Define VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY juntas (npm run push:claves las genera)')
  const vapidContacto = process.env.VAPID_SUBJECT ?? ''
  if (vapidPublica && !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(vapidContacto)) {
    throw new Error('Falta VAPID_SUBJECT: un correo (mailto:tu@correo.com) o una dirección https con la que los servicios de push puedan contactarte')
  }
  return { vapidPublica, vapidPrivada, vapidContacto }
}

function leerZona(): string {
  const zona = process.env.ZONA_HORARIA ?? 'America/Mexico_City'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona })
  } catch {
    throw new Error(`ZONA_HORARIA no es una zona válida: ${zona} (ejemplo: America/Mexico_City)`)
  }
  return zona
}

// RF-004: pepper de las contraseñas (ver contrasenas.ts). Sin valor por defecto: sin AUTH_PEPPER_SECRET la API no arranca.
// Para rotarlo sin dejar a nadie fuera, el de antes va en AUTH_PEPPER_ANTERIOR mientras la gente vuelve a entrar.
function leerPimienta(jwtSecret: string) {
  const pimienta = process.env.AUTH_PEPPER_SECRET?.trim() ?? ''
  if (!pimienta) throw new Error('Falta la variable de entorno AUTH_PEPPER_SECRET (ver .env.example): genera una con  openssl rand -hex 32')
  if (pimienta.length < 32) throw new Error('AUTH_PEPPER_SECRET debe tener al menos 32 caracteres aleatorios')
  if (pimienta === jwtSecret) throw new Error('AUTH_PEPPER_SECRET y JWT_SECRET deben ser distintos')
  const pimientaAnterior = process.env.AUTH_PEPPER_ANTERIOR?.trim() || null // sólo verifica, nunca se usa para guardar
  return { pimienta, pimientaAnterior }
}

// Detrás de un proxy, cuántos saltos se le creen a X-Forwarded-For para saber la IP real (límites de intentos).
// Sólo el del proxy propio: lo que el visitante mande en esa cabecera se puede inventar.
function leerProxy(): number | false {
  const v = process.env.TRUST_PROXY ?? ''
  if (/^\d+$/.test(v)) return Number(v) || false
  return v === 'true' || process.env.VERCEL ? 1 : false
}

// Orígenes a los que el navegador deja llamar a la API desde otro dominio. En producción sólo direcciones https
// exactas: nunca «*» ni localhost (cualquier página abierta en la computadora de alguien podría usar su sesión).
// Sin CORS_ORIGINS en producción no se acepta ningún otro dominio: la app servida junto a la API (Vercel) no lo necesita.
function leerCors(produccion: boolean): string[] {
  const valor = process.env.CORS_ORIGINS?.trim()
  if (!valor) return produccion ? [] : ['http://localhost:5173']
  const origenes = valor.split(',').map((s) => s.trim()).filter(Boolean)
  for (const o of origenes) {
    if (o === '*' || o.includes('*')) throw new Error('CORS_ORIGINS no admite comodines (*): pon la dirección exacta de la app')
    let u: URL
    try {
      u = new URL(o)
    } catch {
      throw new Error(`CORS_ORIGINS tiene una dirección no válida: ${o} (ejemplo: https://reparto-yogurt.vercel.app)`)
    }
    if (u.origin !== o) throw new Error(`CORS_ORIGINS debe tener sólo el origen, sin ruta ni «/» al final: ${u.origin}`)
    if (produccion && (u.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(u.hostname))) {
      throw new Error(`En producción CORS_ORIGINS sólo admite direcciones https públicas, no ${o}`)
    }
  }
  return origenes
}

export function leerConfig() {
  const jwtSecret = requerido('JWT_SECRET')
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres')
  // En Vercel cuenta como producción también la vista previa: es pública y no debe escribir códigos en el registro.
  const produccion = process.env.NODE_ENV === 'production' || !!process.env.VERCEL
  const prueba = process.env.NODE_ENV === 'test'
  return {
    port: Number(process.env.PORT ?? 3000),
    conexion: leerConexion(),
    jwtSecret,
    ...leerPimienta(jwtSecret),
    corsOrigins: leerCors(produccion),
    trustProxy: leerProxy(),
    enVercel: !!process.env.VERCEL,
    sinLimiteDePeticiones: prueba, // las pruebas inician sesión decenas de veces desde la misma IP (los límites de la base sí aplican)
    accesoMinutos: 15,
    sesionDias: 30,
    // RF-003: tras 5 intentos fallidos seguidos con una cuenta desde una misma conexión, esa conexión espera 15 min
    // para esa cuenta; y una conexión con 15 fallidos (cualquier cuenta) espera también. Así nadie puede dejar fuera
    // al dueño de la cuenta desde otro lado, ni probar contraseñas en muchas cuentas.
    maxIntentos: 5,
    maxIntentosIp: 15,
    bloqueoMinutos: 15,
    // RF-002: recuperación por correo con Resend. Sin RESEND_API_KEY, fuera de producción el código sale en la consola.
    produccion,
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    correoRemitente: process.env.MAIL_FROM ?? 'Reparto Yogurt <onboarding@resend.dev>',
    recuperacionMinutos: 15,
    recuperacionMaxIntentos: 5,
    recuperacionPorHoraCuenta: 3, // códigos por cuenta y por hora; pasado el tope no se manda otro (sin decirlo)
    recuperacionPorDiaCuenta: 6, // y por día: con 5 intentos por código, como mucho 30 intentos de adivinarlo al día
    recuperacionPorHoraIp: 10,
    recuperacionPisoMs: prueba ? 300 : 2000, // /auth/recuperar tarda siempre lo mismo: el tiempo no dice si el correo existe
    // RF-054: notificaciones push con claves VAPID (npm run push:claves). Sin ellas no hay push.
    ...leerPush(),
    // Para saber cuál es «hoy» al avisar de cambios en la ruta del día.
    zonaHoraria: leerZona(),
  }
}

export type Config = ReturnType<typeof leerConfig>
