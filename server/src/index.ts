import { construirApp } from './app.ts'
import { leerConfig } from './config.ts'
import { crearPool } from './db.ts'

const config = leerConfig()
const db = crearPool(config.databaseUrl)
const app = await construirApp({ db, config })
await app.listen({ port: config.port, host: '0.0.0.0' })
