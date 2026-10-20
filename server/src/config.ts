function requerido(nombre: string): string {
  const v = process.env[nombre]
  if (!v) throw new Error(`Falta la variable de entorno ${nombre} (ver server/.env.example)`)
  return v
}

export function leerConfig() {
  const jwtSecret = requerido('JWT_SECRET')
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres')
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: requerido('DATABASE_URL'),
    jwtSecret,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY === 'true',
    sinLimiteDePeticiones: process.env.NODE_ENV === 'test', // las pruebas inician sesión decenas de veces desde la misma IP
    accesoMinutos: 15,
    sesionDias: 30,
    maxIntentos: 5, // RF-003
    bloqueoMinutos: 15,
  }
}

export type Config = ReturnType<typeof leerConfig>
