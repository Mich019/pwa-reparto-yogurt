// Función serverless de Vercel: una sola instancia de Fastify atiende todo /api/* (ver vercel.json).
// Las carpetas con guion bajo (_lib, _test) no se publican como endpoints.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { construirApp } from './_lib/app.js'
import { leerConfig } from './_lib/config.js'
import { crearPool } from './_lib/db.js'

let listo: Promise<FastifyInstance> | null = null

function iniciar() {
  const config = leerConfig()
  const db = crearPool(config.conexion)
  return construirApp({ db, config }).then(async (app) => {
    await app.ready()
    return app
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  listo ??= iniciar().catch((e) => {
    listo = null // que el siguiente intento vuelva a probar (p. ej. la base estaba caída)
    throw e
  })
  const app = await listo
  app.server.emit('request', req, res)
}
