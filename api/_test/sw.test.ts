import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// public/sw.js no pasa por TypeScript ni por Vite: un error de sintaxis ahí deja a los teléfonos sin modo sin
// conexión, sin envío en segundo plano y sin avisos push, sin que nada más falle. Pasó una vez (una «\/» perdida).
describe('service worker', () => {
  it('public/sw.js se puede cargar', () => {
    const r = spawnSync(process.execPath, ['--check', 'public/sw.js'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  })
})
