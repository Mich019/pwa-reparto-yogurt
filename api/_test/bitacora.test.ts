import { strict as assert } from 'node:assert'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// Sin base: lee el código como texto y revisa que cada llamada al registro siga la forma de bitacora.ts:
// log.<nivel>({ ... }, 'área: qué pasó').
const archivos: string[] = []
const recorrer = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) recorrer(p)
    else if (f.endsWith('.ts')) archivos.push(p)
  }
}
recorrer('api/_lib')

test('los registros del servidor llevan contexto en un objeto y el mensaje «área: qué pasó»', () => {
  const malos: string[] = []
  let vistos = 0
  for (const f of archivos) {
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(/\blog\.(info|warn|error)\(([^)]*?), '([^']*)'\)/g)) {
        vistos++
        const [, , primero, mensaje] = m
        if (!primero.trim().startsWith('{')) malos.push(`${f}:${i + 1} el primer argumento no es un objeto: ${primero}`)
        if (!/^[a-záéíóúñ ]+: \S/.test(mensaje)) malos.push(`${f}:${i + 1} mensaje sin «área: …»: ${mensaje}`)
        // El aviso de «sin RESEND_API_KEY» sólo sale fuera de producción (en producción falla antes) y muestra el correo a propósito.
        if (!mensaje.includes('sólo desarrollo') && /\b(correo|para|telefono|password|codigo)\s*:/.test(primero)) malos.push(`${f}:${i + 1} datos personales en el registro: ${primero}`)
      }
    })
  }
  assert.ok(vistos > 20, `sólo encontré ${vistos} llamadas: ¿cambió la forma de escribirlas?`)
  assert.deepEqual(malos, [])
})
