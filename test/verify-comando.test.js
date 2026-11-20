import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { mkRepo } from './helpers.js'
import { main } from '../src/cli.js'
import { verify } from '../src/commands/verify.js'
import { loadManifest } from '../src/core/manifest.js'

// El COMANDO verify (lo que corre CI con --strict): sus codigos de salida. La
// logica de cada chequeo esta en test/verify.test.js; aca se fija que un error
// siempre sale 1, que un aviso solo sale 1 con --strict, y que la frescura de
// docs/metodologia cuenta como error.

// Raiz de generador sin scripts/ ni docs/: el chequeo de docs se salta, como en
// una instalacion que no es el repo del harness.
const sinDocs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude verify '))

function raizConGenDocs(cuerpoDeCorrer) {
  const raiz = sinDocs()
  fs.mkdirSync(path.join(raiz, 'scripts'))
  fs.mkdirSync(path.join(raiz, 'docs', 'metodologia'), { recursive: true })
  fs.writeFileSync(path.join(raiz, 'scripts', 'gen-docs-metodologia.mjs'), `export function correr(opciones) {\n${cuerpoDeCorrer}\n}\n`)
  return raiz
}

test('verify: el repo real sale 0, tambien con --strict (es lo que corre CI)', async () => {
  const dir = mkRepo()
  assert.equal(await main(['verify'], dir), 0)
  assert.equal(await main(['verify', '--strict'], dir), 0)
})

test('verify: un error del manifest sale 1 aunque no se pida --strict', async () => {
  const manifest = loadManifest()
  const roto = { ...manifest, files: [...manifest.files, { id: 'no-existe', src: 'base/no-existe.md', dest: 'no-existe.md', policy: 'managed' }] }
  assert.equal(await verify({}, '.', { manifest: roto, raizGenerador: sinDocs() }), 1)
  assert.equal(await verify({ strict: true }, '.', { manifest: roto, raizGenerador: sinDocs() }), 1)
})

test('verify: un aviso (template huerfano) sale 0, y 1 con --strict', async () => {
  const manifest = loadManifest()
  // Sin su entry, el template de ese hook queda huerfano: aviso, no error.
  const conHuerfano = { ...manifest, files: manifest.files.filter((f) => f.id !== 'hook-worklog-solo') }
  assert.equal(await verify({}, '.', { manifest: conHuerfano, raizGenerador: sinDocs() }), 0)
  assert.equal(await verify({ strict: true }, '.', { manifest: conHuerfano, raizGenerador: sinDocs() }), 1)
})

test('verify: docs/metodologia desactualizado, o un generador que falla, es un error', async () => {
  const manifest = loadManifest()
  const alDia = raizConGenDocs("  return { codigo: 0, lineas: ['[OK  ] docs-metodologia: instalacion.md al dia'] }")
  assert.equal(await verify({ strict: true }, '.', { manifest, raizGenerador: alDia }), 0)

  const viejo = raizConGenDocs("  if (!opciones.check) throw new Error('verify debe correr el generador en modo --check')\n  return { codigo: 1, lineas: ['[OK  ] a.md al dia', '[FAIL] docs-metodologia: instalacion.md desactualizado'] }")
  assert.equal(await verify({}, '.', { manifest, raizGenerador: viejo }), 1)

  const sinCarpeta = raizConGenDocs("  return { codigo: 2, lineas: ['[ERROR] docs-metodologia: marcador sin bloque definido'] }")
  assert.equal(await verify({}, '.', { manifest, raizGenerador: sinCarpeta }), 1)

  const explota = raizConGenDocs("  throw new Error('no se pudo leer package.json')")
  assert.equal(await verify({}, '.', { manifest, raizGenerador: explota }), 1)
})
