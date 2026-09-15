import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../src/cli.js'
import { mkRepo, read, has, replan, verdicts } from './helpers.js'
import { computePlan, NOOP, OBSOLETE } from '../src/core/plan.js'
import { resolveDetected } from '../src/core/detect.js'
import { resolveModo, githubProtectionStep } from '../src/commands/_shared.js'
import { semillasProyecto } from '../src/core/vault-seeds.js'

const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']

// Manifest sintetico: un entry comun, uno de cada modo. El src apunta a un
// template real cualquiera; lo que se prueba es el filtro, no el contenido.
const MANIFEST = {
  harnessVersion: '9.9.9',
  files: [
    { id: 'comun', src: 'base/notes.md', dest: 'comun.md', policy: 'managed' },
    { id: 'de-equipo', src: 'base/notes.md', dest: 'equipo.md', policy: 'managed', modos: ['equipo'] },
    { id: 'de-solo', src: 'base/notes.md', dest: 'solo.md', policy: 'managed', modos: ['solo'] },
  ],
}

const dests = (plan) => plan.actions.map((a) => a.dest).sort()

test('computePlan: filtra entries por "modos" y anota el modo en el plan', () => {
  const dir = mkRepo()
  const detected = resolveDetected(dir, null)

  const equipo = computePlan({ manifest: MANIFEST, cwd: dir, lock: null, vars: {}, detected, modo: 'equipo' })
  assert.deepEqual(dests(equipo), ['comun.md', 'equipo.md'])
  assert.equal(equipo.modo, 'equipo')

  const solo = computePlan({ manifest: MANIFEST, cwd: dir, lock: null, vars: {}, detected, modo: 'solo' })
  assert.deepEqual(dests(solo), ['comun.md', 'solo.md'])
  assert.equal(solo.modo, 'solo')
})

test('computePlan: sin modo explicito manda el lockfile, y sin nada, equipo', () => {
  const dir = mkRepo()
  const detected = resolveDetected(dir, null)

  const porDefecto = computePlan({ manifest: MANIFEST, cwd: dir, lock: null, vars: {}, detected })
  assert.equal(porDefecto.modo, 'equipo')
  assert.deepEqual(dests(porDefecto), ['comun.md', 'equipo.md'])

  const delLock = computePlan({ manifest: MANIFEST, cwd: dir, lock: { modo: 'solo' }, vars: {}, detected })
  assert.equal(delLock.modo, 'solo')
  assert.deepEqual(dests(delLock), ['comun.md', 'solo.md'])
})

test('resolveModo: prioridad flag > lockfile sticky > default equipo', async () => {
  assert.equal(await resolveModo({ flags: { solo: true }, lock: null, yes: true }), 'solo')
  // El flag explicito gana sobre lo persistido: es la via para cambiar de modo.
  assert.equal(await resolveModo({ flags: { equipo: true }, lock: { modo: 'solo' }, yes: true }), 'equipo')
  // Sticky: lo persistido gana sobre el default no interactivo.
  assert.equal(await resolveModo({ flags: {}, lock: { modo: 'solo' }, yes: true }), 'solo')
  // Sin nada persistido (init, o lockfile anterior a los modos): default equipo.
  assert.equal(await resolveModo({ flags: {}, lock: null, yes: true }), 'equipo')
  assert.equal(await resolveModo({ flags: {}, lock: { harnessVersion: '3.12.0' }, yes: true }), 'equipo')
  // Un valor invalido persistido no se propaga: cae a la pregunta/default.
  assert.equal(await resolveModo({ flags: {}, lock: { modo: 'turbo' }, yes: true }), 'equipo')
})

test('resolveModo: --solo y --equipo juntos cortan con error claro', async () => {
  await assert.rejects(() => resolveModo({ flags: { solo: true, equipo: true }, lock: null, yes: true }), /excluyentes/)
})

test('init --solo: persiste el modo y el upgrade lo respeta sin flag', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--solo'], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'solo')

  // El replan (sin modo explicito) usa el del lockfile: superficie estable.
  assert.ok(replan(dir).actions.every((a) => a.verdict === NOOP))

  // Sticky: upgrade no interactivo SIN flag conserva solo, no vuelve a equipo.
  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'solo')
})

test('init no interactivo sin flag: modo equipo por defecto', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'equipo')
})

test('upgrade de una instalacion existente sin modo persistido: elige y persiste aunque no haya cambios de archivos', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  // Se simula el lockfile de una instalacion anterior a los modos.
  const lockPath = path.join(dir, '.claude', 'harness.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  delete lock.modo
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))

  // El repo ya esta al dia: el unico cambio es la decision del modo.
  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'equipo')
})

test('cambiar de modo por flag queda persistido y reemplaza la superficie', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'equipo')
  assert.ok(read(dir, 'CLAUDE.md').includes('Git — reglas duras'))

  assert.equal(await main(['upgrade', ...YES, '--solo'], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'solo')
  // CLAUDE.md intacto (user-owned sin ediciones) -> UPDATE seguro a la variante solo.
  assert.ok(read(dir, 'CLAUDE.md').includes('modo solo'), 'el switch no reescribio CLAUDE.md')
})

test('init --solo: emite la superficie solo (CLAUDE.md fluido y settings sin candados git/gh)', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--solo'], dir), 0)

  const claudeMd = read(dir, 'CLAUDE.md')
  assert.ok(claudeMd.includes('modo solo'), 'CLAUDE.md no es la variante solo')
  assert.ok(claudeMd.includes('worklog.md'), 'falta el protocolo de worklog')
  assert.ok(!claudeMd.includes('Trazabilidad obligatoria'), 'quedo la regla de milestones de equipo')
  assert.ok(!claudeMd.includes('reglas duras'), 'quedo el Git de equipo')
  // Las vars renderizan igual que en equipo.
  assert.ok(claudeMd.includes('# CLAUDE.md — acme'))

  const settings = JSON.parse(read(dir, '.claude/settings.json'))
  // Secretos: la unica regla dura sobrevive identica.
  assert.ok(settings.permissions.deny.includes('Read(./.env)'))
  assert.ok(settings.permissions.deny.includes('Read(./secrets/**)'))
  // Sin candados git/gh: ni deny de Bash, ni gates de ask; el merge queda permitido.
  assert.ok(!settings.permissions.deny.some((r) => r.startsWith('Bash(')), 'quedo un deny de Bash en modo solo')
  assert.ok(settings.permissions.allow.includes('Bash(gh pr merge:*)'))
  assert.equal(settings.permissions.ask, undefined, 'modo solo no gatea con ask')

  // La traza del modo solo: hook worklog cableado, sin el hook de milestones.
  assert.ok(has(dir, '.claude/hooks/worklog-solo.mjs'), 'falta el hook worklog-solo')
  assert.ok(!has(dir, '.claude/hooks/declarar-milestone.mjs'), 'se instalo el hook de milestones en solo')
  const comandos = JSON.stringify(settings.hooks?.SessionStart ?? [])
  assert.ok(comandos.includes('worklog-solo.mjs'), 'el hook worklog-solo no quedo cableado en settings')
  assert.ok(!comandos.includes('declarar-milestone'), 'quedo cableado el hook de milestones')
  // El protocolo de milestones (progress/README.md) es de equipo.
  assert.ok(!has(dir, 'progress/README.md'), 'se emitio el protocolo de milestones en solo')
})

test('init --solo: catalogo de skills del modo (github-solo required, sin skills de equipo)', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--solo'], dir), 0)

  assert.ok(has(dir, '.claude/skills/soutec-github-solo/SKILL.md'), 'falta la skill Git del modo solo')
  // Las de metodologia de equipo no se instalan en solo.
  for (const s of ['soutec-github', 'vault-milestones', 'jira-sync', 'azdo-sync']) {
    assert.ok(!has(dir, `.claude/skills/${s}/SKILL.md`), `se instalo la skill de equipo ${s}`)
  }
  // Las comunes a ambos modos siguen entrando.
  for (const s of ['adr-new', 'harness-upgrade', 'soutec-md-a-pdf', 'it-security-review', 'security-report-standard']) {
    assert.ok(has(dir, `.claude/skills/${s}/SKILL.md`), `falta la skill comun ${s}`)
  }
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.ok(lock.skills.includes('soutec-github-solo'))
  assert.ok(!lock.skills.includes('soutec-github'))
})

test('--skills de otro modo corta con error claro', async () => {
  const dir = mkRepo({ 'README.md': '' })
  // jira-sync es de equipo: en el catalogo de solo es desconocida.
  assert.equal(await main(['init', ...YES, '--solo', '--skills', 'jira-sync'], dir), 1)
  assert.ok(!has(dir, '.claude/harness.json'), 'con error no se escribe nada')
  // Y la skill de solo no existe en el catalogo de equipo.
  assert.equal(await main(['init', ...YES, '--skills', 'soutec-github-solo'], dir), 1)
})

test('switch equipo -> solo: la skill de solo entra y las de equipo quedan obsoletas', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)
  assert.ok(has(dir, '.claude/skills/soutec-github/SKILL.md'))

  await main(['upgrade', ...YES, '--solo'], dir)

  assert.ok(has(dir, '.claude/skills/soutec-github-solo/SKILL.md'), 'no entro la skill de solo')
  // Los archivos de equipo siguen en disco (borrarlos exige --prune + doble
  // confirmacion), pero el proximo plan ya los marca obsoletos.
  const obsoletos = verdicts(replan(dir))[OBSOLETE] ?? []
  assert.ok(obsoletos.includes('.claude/skills/soutec-github/SKILL.md'))
  assert.ok(obsoletos.includes('.claude/skills/jira-sync/SKILL.md'))
  assert.ok(obsoletos.includes('.claude/hooks/declarar-milestone.mjs'))
  assert.ok(obsoletos.includes('progress/README.md'))
  assert.ok(obsoletos.includes('.github/workflows/reglas-rama-commits.yml'))
  assert.ok(obsoletos.includes('.github/pull_request_template.md'))
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.ok(!lock.skills.includes('jira-sync'), 'el lockfile arrastro una skill del modo anterior')
})

test('init --solo: CI minimo (solo el workflow de secretos) y sin artefactos de review', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--solo'], dir), 0)

  // Lo unico de CI que sobrevive: el check de secretos y el script que usa.
  assert.ok(has(dir, '.github/workflows/reglas-secretos.yml'))
  assert.ok(has(dir, 'scripts/check-pr-rules.mjs'))
  // Sin checks de estilo/metadata, sin plantilla de PR, sin CODEOWNERS.
  for (const f of [
    '.github/workflows/reglas-rama-commits.yml',
    '.github/workflows/reglas-pr-metadata.yml',
    '.github/pull_request_template.md',
    '.github/CODEOWNERS',
  ]) {
    assert.ok(!has(dir, f), `se emitio ${f} en modo solo`)
  }
})

test('githubProtectionStep: en modo solo no configura branch protection; en equipo si', () => {
  const llamadas = []
  const protege = (args) => llamadas.push(args)

  const solo = mkRepo({ '.claude/harness.json': JSON.stringify({ modo: 'solo' }) })
  githubProtectionStep({ code: 0, cwd: solo, flags: {}, protege })
  assert.equal(llamadas.length, 0, 'protegio main en modo solo')

  const equipo = mkRepo({ '.claude/harness.json': JSON.stringify({ modo: 'equipo' }) })
  githubProtectionStep({ code: 0, cwd: equipo, flags: {}, protege })
  assert.equal(llamadas.length, 1, 'no protegio main en modo equipo')
})

test('semillasProyecto: worklog.md solo se siembra en modo solo', () => {
  assert.ok(!('worklog.md' in semillasProyecto('equipo')))
  assert.ok(!('worklog.md' in semillasProyecto()))
  const solo = semillasProyecto('solo')
  assert.ok('worklog.md' in solo)
  // El set base se conserva: un proyecto solo puede volver a equipo sin resembrar.
  assert.ok('milestones.md' in solo)
  assert.ok('sessions.md' in solo)
})

test('init equipo: la superficie de siempre queda intacta', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES], dir), 0)

  const claudeMd = read(dir, 'CLAUDE.md')
  assert.ok(claudeMd.includes('Git — reglas duras'))
  assert.ok(claudeMd.includes('Trazabilidad obligatoria'))
  assert.ok(!claudeMd.includes('modo solo'))

  const settings = JSON.parse(read(dir, '.claude/settings.json'))
  assert.ok(settings.permissions.deny.includes('Bash(gh pr merge:*)'))
  assert.ok(settings.permissions.ask.includes('Bash(git push --force*)'))
  assert.ok(settings.hooks.SessionStart, 'falta el hook declarar-milestone en equipo')
})

test('--dry-run no persiste ni la decision del modo', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)

  assert.equal(await main(['upgrade', ...YES, '--solo', '--dry-run'], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).modo, 'equipo')
})
