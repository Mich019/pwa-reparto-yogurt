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

export function leerConfig() {
  const jwtSecret = requerido('JWT_SECRET')
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres')
  const produccion = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  return {
    port: Number(process.env.PORT ?? 3000),
    conexion: leerConexion(),
    jwtSecret,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY === 'true' || !!process.env.VERCEL,
    sinLimiteDePeticiones: process.env.NODE_ENV === 'test', // las pruebas inician sesión decenas de veces desde la misma IP
    accesoMinutos: 15,
    sesionDias: 30,
    maxIntentos: 5, // RF-003
    bloqueoMinutos: 15,
    // RF-002: recuperación por correo con Resend. Sin RESEND_API_KEY, fuera de producción el código sale en la consola.
    produccion,
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    correoRemitente: process.env.MAIL_FROM ?? 'Reparto Yogurt <onboarding@resend.dev>',
    recuperacionMinutos: 15,
    recuperacionMaxIntentos: 5,
  }
}

export type Config = ReturnType<typeof leerConfig>
