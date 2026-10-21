import type { PoolConfig } from 'pg'

function requerido(nombre: string): string {
  const v = process.env[nombre]
  if (!v) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`)
  return v
}

// Conexión: DATABASE_URL completa, o por partes (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL).
// Supabase: usar el Transaction Pooler (puerto 6543), que aguanta muchas funciones serverless a la vez.
function leerConexion(): PoolConfig {
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  const max = Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10))
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl, max }
  return {
    host: requerido('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database: requerido('DB_NAME'),
    user: requerido('DB_USER'),
    password: requerido('DB_PASSWORD'),
    ssl,
    max,
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
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
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
    recuperacionPorHoraIp: 10,
    recuperacionPisoMs: prueba ? 300 : 2000, // /auth/recuperar tarda siempre lo mismo: el tiempo no dice si el correo existe
    // RF-054: notificaciones push con claves VAPID (npm run push:claves). Sin ellas no hay push.
    ...leerPush(),
    // Para saber cuál es «hoy» al avisar de cambios en la ruta del día.
    zonaHoraria: leerZona(),
  }
}

export type Config = ReturnType<typeof leerConfig>
