import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from '../src/core/manifest.js'
import { resolveSkillSet } from '../src/core/plan.js'

// Guardas de contenido del harness 2.2.0: progreso por disco, IDs de task y
// telemetria con costo. Complementa a verify (consistencia del manifest) y
// dogfood (espejo de .claude/): aqui se protege que las convenciones nuevas
// no se pierdan en ediciones futuras de los templates.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

test('progress: todo dest del manifest sin when, emitible en modo equipo, tiene su espejo local en el repo', () => {
  const manifest = loadManifest()
  // Este repo dogfoodea el modo equipo (SHS-M34): lo exigible localmente es lo
  // que un init de equipo emitiria — sin entries de otros modos ni skills que
  // no existen en el catalogo de equipo.
  const skillsEquipo = resolveSkillSet({ manifest, lock: null, modo: 'equipo' })
  const missing = manifest.files
    .filter((f) => !f.when)
    .filter((f) => !f.modos || f.modos.includes('equipo'))
    .filter((f) => !f.skill || skillsEquipo.has(f.skill))
    .map((f) => f.dest)
    .filter((dest) => !fs.existsSync(path.join(REPO_ROOT, dest)))
  assert.deepEqual(missing, [], `Dest sin espejo local (dogfooding roto): ${missing.join(', ')}`)
})

test('progress: el README de progress conserva la doctrina del espejo al Vault', () => {
  const readme = fs.readFileSync(
    path.join(REPO_ROOT, 'templates', 'base', 'progress', 'README.md'),
    'utf8'
  )
  for (const marca of [
    'kanban-plugin: board',
    'vault_skip',
    '.claude/vault.local.json',
    'pull --rebase',
    'soubunker-vault',
  ]) {
    assert.ok(readme.includes(marca), `progress/README.md perdio la marca ${marca}`)
  }
})

// Sin esta aclaracion, un agente disciplinado lee "nunca push directo a main" y
// se niega a escribir en el Vault -- que es justo lo que tiene que hacer.
test('progress: CLAUDE.md distingue el repo del proyecto del repo del Vault', () => {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'base', 'CLAUDE.md'), 'utf8')

  assert.ok(claudeMd.includes('Estas reglas son sobre ESTE repo'))
  assert.ok(claudeMd.includes('.claude/vault.local.json'))
  assert.match(claudeMd, /Push directo a `main`/)
})

