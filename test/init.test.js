import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli.js'
import { mkRepo, read, has, tree, snapshot, replan, verdicts } from './helpers.js'
import { NOOP, OBSOLETE } from '../src/core/plan.js'
import { missingVars } from '../src/core/render.js'
import { loadManifest } from '../src/core/manifest.js'

const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']

// Las skills del catalogo 3.0. soutec-github es la unica required.
const SKILLS = [
  'soutec-github',
  'it-security-review',
  'security-report-standard',
  'soutec-md-a-pdf',
  'adr-new',
  'harness-upgrade',
  'vault-milestones',
  'jira-sync',
  'azdo-sync',
]

test('init en repo vacio: emite el harness completo + scaffolding', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES], dir), 0)

  const files = tree(dir)

  // La superficie Claude.
  assert.ok(files.includes('CLAUDE.md'))
  assert.ok(files.includes('.claude/settings.json'))
  assert.ok(files.includes('.claude/harness.json'))
  assert.ok(files.includes('.gitignore'))

  // Sin --skills, se instalan todas las del catalogo.
  for (const s of SKILLS) {
    assert.ok(files.includes(`.claude/skills/${s}/SKILL.md`), `falta la skill ${s}`)
  }
  // Los archivos extra de las skills con mas de un archivo.
  assert.ok(files.includes('.claude/skills/it-security-review/report-template.md'))
  assert.ok(files.includes('.claude/skills/soutec-md-a-pdf/assets/soutec_logo.png'))
  assert.ok(files.includes('docs/decisions/_template.md'))

  // El flujo SDD/CCEM ya no existe: ni agentes, ni constitucion, ni specs.
  assert.ok(!files.some((f) => f.startsWith('.claude/agents/')), 'se emitio un agente')
  assert.ok(!files.some((f) => f.startsWith('specs/')), 'se emitio specs/')
  assert.ok(!files.includes('AGENTS.md'))
  assert.ok(!files.includes('docs/constitution.md'))

  // Scaffolding: solo porque el repo estaba vacio.
  assert.ok(files.includes('src/.gitkeep'))
  assert.ok(files.includes('tests/.gitkeep'))
  assert.ok(files.includes('scripts/.gitkeep'))

  // .claudeignore NO se emite: Claude Code nunca lo soporto.
  assert.ok(!files.includes('.claudeignore'))
})

test('init: no queda ningun {{PLACEHOLDER}} sin resolver', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  for (const rel of ['CLAUDE.md', 'notes.md', 'README.md']) {
    assert.deepEqual(missingVars(read(dir, rel), {}), [], `${rel} tiene placeholders sin resolver`)
  }
})

test('init: las vars llegan al contenido', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', '--yes', '--name', 'facturacion', '--type', 'data', '--lang', 'en'], dir)

  const claudeMd = read(dir, 'CLAUDE.md')
  assert.ok(claudeMd.includes('# CLAUDE.md — facturacion'))
  assert.ok(claudeMd.includes('Proyecto de data.'))
  assert.ok(claudeMd.includes('Responder siempre en ingles.'))
})

test('init: el settings.json emitido es schema-correcto', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  const settings = JSON.parse(read(dir, '.claude/settings.json'))

  // Las 4 claves del Kit v0 que Claude Code ignora en silencio.
  for (const bad of ['effort', 'auto_confirm_destructive', 'display_tools', 'token_budget_warning']) {
    assert.ok(!(bad in settings), `se emitio la clave invalida "${bad}"`)
  }
  assert.equal(settings.effortLevel, 'medium')
  assert.equal(settings.model, undefined, 'no forzamos modelo a nivel proyecto')

  // La exclusion real de secretos vive aca, no en un .claudeignore.
  assert.ok(settings.permissions.deny.includes('Read(./.env)'))
  assert.ok(settings.permissions.deny.includes('Read(./secrets/**)'))
})

test('init: jira-sync y azdo-sync activas a la vez funden sus servidores en .mcp.json sin pisarse', async () => {
  const dir = mkRepo({ 'README.md': '' })
  // Sin --skills: se instalan todas, jira-sync y azdo-sync incluidas (ver SKILLS arriba).
  assert.equal(await main(['init', ...YES], dir), 0)

  const mcp = JSON.parse(read(dir, '.mcp.json'))
  assert.ok(mcp.mcpServers.atlassian, 'falta el servidor de jira-sync')
  assert.ok(mcp.mcpServers['azure-devops'], 'falta el servidor de azdo-sync')
  assert.deepEqual(mcp.mcpServers['azure-devops'].args.slice(0, 2), ['-y', '@azure-devops/mcp'])

  // Una sola accion sobre el dest, no dos que se pisen entre si.
  const plan = replan(dir)
  assert.equal(plan.actions.filter((a) => a.dest === '.mcp.json').length, 1)
})

test('--skills: instala solo lo elegido, pero soutec-github entra siempre', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--skills', 'adr-new'], dir), 0)

  const files = tree(dir)
  assert.ok(files.includes('.claude/skills/adr-new/SKILL.md'))
  assert.ok(files.includes('docs/decisions/_template.md'))
  // La obligatoria entra aunque no se pida.
  assert.ok(files.includes('.claude/skills/soutec-github/SKILL.md'))
  // Las no elegidas no se emiten.
  assert.ok(!files.includes('.claude/skills/soutec-md-a-pdf/SKILL.md'))
  assert.ok(!files.includes('.claude/skills/it-security-review/SKILL.md'))
  assert.ok(!files.includes('.claude/skills/harness-upgrade/SKILL.md'))

  // La seleccion queda en el lockfile, y el upgrade la respeta sin re-preguntar.
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.deepEqual(lock.skills, ['adr-new', 'soutec-github'])

  await main(['upgrade', ...YES], dir)
  assert.ok(!has(dir, '.claude/skills/soutec-md-a-pdf/SKILL.md'), 'el upgrade instalo una skill no elegida')
})

test('--skills: una skill desconocida corta con error claro', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--skills', 'no-existe'], dir), 1)
  assert.ok(!has(dir, '.claude/harness.json'), 'con error no se escribe nada')
})

test('--skills: deseleccionar una skill instalada la marca obsoleta, no la borra', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)
  assert.ok(has(dir, '.claude/skills/adr-new/SKILL.md'))

  await main(['upgrade', ...YES, '--skills', 'harness-upgrade'], dir)

  // Sigue en disco: borrar exige --prune + doble confirmacion (P5).
  assert.ok(has(dir, '.claude/skills/adr-new/SKILL.md'))
  const obsoletos = verdicts(replan(dir))[OBSOLETE] ?? []
  assert.ok(obsoletos.includes('.claude/skills/adr-new/SKILL.md'), 'la skill deseleccionada no quedo obsoleta')
})

test('los assets binarios se copian byte a byte', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
  const rel = 'soutec_logo.png'
  const emitted = fs.readFileSync(path.join(dir, '.claude', 'skills', 'soutec-md-a-pdf', 'assets', rel))
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'templates', 'base', 'claude', 'skills', 'soutec-md-a-pdf', 'assets', rel)
  )
  assert.ok(source.length > 0)
  assert.ok(emitted.equals(source), 'el PNG emitido difiere del template (corrupcion utf8/LF)')
  // Firma PNG intacta.
  assert.equal(emitted.subarray(1, 4).toString('ascii'), 'PNG')
})

test('se emiten los archivos obligatorios de Fase 1 de la guia Git', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  assert.ok(has(dir, '.github/pull_request_template.md'))
  assert.ok(has(dir, '.github/CODEOWNERS'))
  assert.ok(read(dir, '.github/pull_request_template.md').includes('Milestone y tareas relacionadas'))

  // La skill SOUTEC obligatoria.
  assert.ok(has(dir, '.claude/skills/soutec-github/SKILL.md'))
  assert.ok(read(dir, '.claude/skills/soutec-github/SKILL.md').includes('Nunca `git push origin main`'))
})

test('IDEMPOTENCIA: correr init dos veces no cambia nada la segunda vez', async () => {
  const dir = mkRepo({ 'README.md': '' })

  await main(['init', ...YES], dir)
  const before = snapshot(dir)

  await main(['init', ...YES], dir)
  const after = snapshot(dir)

  assert.equal(after, before, 'la segunda corrida modifico archivos')

  // La prueba real: el plan recomputado no tiene ni una accion de escritura.
  const plan = replan(dir)
  const nonNoop = plan.actions.filter((a) => a.verdict !== NOOP)
  assert.deepEqual(nonNoop.map((a) => `${a.dest}:${a.verdict}`), [], 'quedaron acciones pendientes')
})

// El caso real: un repo recien creado en GitHub trae un README.md de 0 bytes.
// Tratarlo como "archivo del usuario" dejaria un README.md.new al lado para siempre.
test('un archivo vacio se llena, no se le deja un .new al lado', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  assert.ok(!has(dir, 'README.md.new'))
  assert.ok(read(dir, 'README.md').includes('# acme'))

  // Y queda reclamado en el lockfile, asi que la proxima corrida es NOOP.
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.ok(lock.files['README.md'])
})

test('PUREZA DE --dry-run: no se escribe ni un byte', async () => {
  const dir = mkRepo({ 'README.md': '# mi readme', 'package.json': '{"name":"x"}' })
  const before = snapshot(dir, { includeLockfile: true })

  assert.equal(await main(['init', ...YES, '--dry-run'], dir), 0)

  assert.equal(snapshot(dir, { includeLockfile: true }), before, '--dry-run escribio algo')
  assert.ok(!has(dir, '.claude/harness.json'))
  assert.ok(!has(dir, 'CLAUDE.md'))
})

test('el lockfile registra hash y policy de cada archivo emitido', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.equal(lock.harnessVersion, loadManifest().harnessVersion)
  assert.equal(lock.vars.PROJECT_NAME, 'acme')
  assert.equal(lock.files['CLAUDE.md'].policy, 'user-owned')
  assert.equal(lock.files['.claude/skills/soutec-github/SKILL.md'].policy, 'managed')
  // Los binarios se registran con su hash de bytes.
  assert.equal(lock.files['.claude/skills/soutec-md-a-pdf/assets/soutec_logo.png'].binary, true)
  assert.deepEqual(lock.skills, [...SKILLS].sort())
  assert.ok(lock.blocks['.gitignore'].hash, 'el bloque del .gitignore no quedo registrado')

  // El lockfile refleja el disco: replanificar da NOOP y nada mas.
  assert.deepEqual(Object.keys(verdicts(replan(dir))), [NOOP])
})
