// Servidor local para desarrollo (npm run dev:api). En Vercel se usa api/index.ts.
import { construirApp } from './app.js'
import { leerConfig } from './config.js'
import { crearPool } from './db.js'

const config = leerConfig()
const db = crearPool(config.conexion)
const app = await construirApp({ db, config })
await app.listen({ port: config.port, host: '0.0.0.0' })
