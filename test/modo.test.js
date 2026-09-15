import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../src/cli.js'
import { mkRepo, read, replan } from './helpers.js'
import { computePlan, NOOP } from '../src/core/plan.js'
import { resolveDetected } from '../src/core/detect.js'
import { resolveModo } from '../src/commands/_shared.js'

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
  // El hook de milestones no se cablea en solo (la traza llega con su hook propio, T005).
  assert.equal(settings.hooks, undefined)
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
