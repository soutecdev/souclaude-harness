import { test } from 'node:test'
import assert from 'node:assert/strict'

import { main } from '../src/cli.js'
import { mkRepo, read, write, replan, verdicts } from './helpers.js'
import { retirarSemilla } from '../src/core/jsonmerge.js'
import { loadManifest } from '../src/core/manifest.js'
import { resolveDetected } from '../src/core/detect.js'
import { readLockfile } from '../src/core/lockfile.js'
import { computePlan } from '../src/core/plan.js'

// Cambio de modo y settings.json. El ADR del modo solo (20260915) dice que esa
// superficie deja settings.json permisivo y reemplaza el hook de sesion. Como el
// merge solo AGREGA, tras `upgrade --solo` quedaban el deny de `gh pr merge` (que
// le gana al allow del modo solo: no se podia mergear), los ask del push forzado,
// los checks de PR y el hook declarar-milestone, apuntando a un archivo que
// --prune acababa de borrar. Ahora el cambio de modo retira lo que sembro el modo
// anterior -- y solo eso.
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const SETTINGS = '.claude/settings.json'
const repo = () => mkRepo({ 'package.json': '{"name":"acme"}\n' })
const settingsDe = (dir) => JSON.parse(read(dir, SETTINGS))
const guardar = (dir, settings) => write(dir, SETTINGS, JSON.stringify(settings, null, 2) + '\n')
const comandos = (settings, evento) => (settings.hooks?.[evento] ?? []).flatMap((g) => g.hooks.map((h) => h.command))

// Dos settings son "el mismo" sin importar el orden dentro de cada array.
function canon(v) {
  if (Array.isArray(v)) return v.map((x) => JSON.stringify(canon(x))).sort()
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  return v
}

test('retirarSemilla: quita de los arrays lo que sembro el modo anterior y el nuevo no trae; nada mas', () => {
  const grupo = (command, extra = {}) => ({ hooks: [{ type: 'command', command, ...extra }] })
  const anterior = {
    effortLevel: 'medium',
    permissions: { deny: ['A', 'B'], ask: ['F'] },
    hooks: { SessionStart: [grupo('viejo', { timeout: 60 })], PostToolUse: [{ matcher: 'Bash', ...grupo('pr') }] },
  }
  const nuevo = { effortLevel: 'medium', permissions: { deny: ['A'], allow: ['M'] }, hooks: { SessionStart: [grupo('nuevo', { timeout: 60 })] } }
  const delUsuario = {
    effortLevel: 'high',
    model: 'sonnet',
    permissions: { deny: ['A', 'B', 'MIO'], ask: ['F'], allow: ['X'] },
    hooks: { SessionStart: [grupo('viejo', { timeout: 5 }), grupo('mi-hook')], PostToolUse: [{ matcher: 'Bash', ...grupo('pr') }] },
  }
  const copia = structuredClone(delUsuario)

  assert.deepEqual(retirarSemilla(delUsuario, anterior, nuevo), {
    effortLevel: 'high', // un escalar del usuario no se toca
    model: 'sonnet',
    // B sale (era del modo anterior); A sigue (tambien es del nuevo); MIO es del usuario.
    // `ask` quedo vacio por el retiro y el modo nuevo no lo declara: no deja la clave colgando.
    permissions: { deny: ['A', 'MIO'], allow: ['X'] },
    // El hook del harness se reconoce aunque el usuario le haya cambiado el timeout.
    hooks: { SessionStart: [grupo('mi-hook')] },
  })
  assert.deepEqual(delUsuario, copia, 'no muta lo que recibe')

  // Lo que el usuario reescribio ya no coincide con el seed: se queda.
  assert.deepEqual(retirarSemilla({ permissions: { deny: ['B --admin'] } }, anterior, nuevo), { permissions: { deny: ['B --admin'] } })
  // Un array que ya estaba vacio no se borra, y sin seed anterior no hay nada que retirar.
  assert.deepEqual(retirarSemilla({ permissions: { ask: [] } }, anterior, nuevo), { permissions: { ask: [] } })
  assert.deepEqual(retirarSemilla(delUsuario, {}, nuevo), delUsuario)
  assert.equal(retirarSemilla(null, anterior, nuevo), null)
})

test('equipo -> solo: settings.json queda igual que en una instalacion solo de cero', async () => {
  const dir = repo()
  await main(['init', ...YES], dir)
  assert.equal(await main(['upgrade', ...YES, '--solo'], dir), 0)
  const settings = settingsDe(dir)

  const deCero = repo()
  await main(['init', ...YES, '--solo'], deCero)
  assert.deepEqual(canon(settings), canon(settingsDe(deCero)))

  // Lo mismo, dicho en concreto: el modo solo puede mergear, no pregunta por el
  // push forzado, no valida PR y su hook de sesion es el del worklog.
  assert.ok(settings.permissions.allow.includes('Bash(gh pr merge:*)'))
  for (const regla of ['Bash(gh pr merge:*)', 'Bash(gh pr review:*)', 'Bash(gh release:*)']) {
    assert.ok(!settings.permissions.deny.includes(regla), `${regla} sigue denegado en modo solo`)
  }
  assert.equal(settings.permissions.ask, undefined)
  assert.equal(settings.hooks.PostToolUse, undefined)
  assert.deepEqual(comandos(settings, 'SessionStart').map((c) => c.match(/hooks\/([\w-]+)\.mjs/)[1]), ['worklog-solo'])
  assert.equal(settings.hooks.PreToolUse.length, 2, 'el check de secretos antes del push sigue (Bash y PowerShell)')
  // La regla dura que sobrevive en los dos modos: los secretos.
  assert.ok(settings.permissions.deny.includes('Read(./.env)'))

  // Y es estable: otro upgrade no encuentra nada que hacer en settings.json.
  assert.ok(verdicts(replan(dir)).noop.includes(SETTINGS))
})

test('solo -> equipo: settings.json queda igual que en una instalacion equipo de cero', async () => {
  const dir = repo()
  await main(['init', ...YES, '--solo'], dir)
  assert.equal(await main(['upgrade', ...YES, '--equipo'], dir), 0)
  const settings = settingsDe(dir)

  const deCero = repo()
  await main(['init', ...YES], deCero)
  assert.deepEqual(canon(settings), canon(settingsDe(deCero)))
  assert.ok(!settings.permissions.allow.includes('Bash(gh pr merge:*)'), 'el allow del modo solo quedo en equipo')
  assert.deepEqual(comandos(settings, 'SessionStart').map((c) => c.match(/hooks\/([\w-]+)\.mjs/)[1]), ['declarar-milestone'])
})

test('cambio de modo: lo que el usuario agrego o reescribio en settings.json se queda', async () => {
  const dir = repo()
  await main(['init', ...YES], dir)
  const s = settingsDe(dir)
  s.model = 'sonnet'
  s.permissions.allow.push('Bash(make:*)')
  s.permissions.ask.push('Bash(rm -rf:*)')
  // Reescribe una regla del harness: ya no es la que el harness sembro.
  s.permissions.deny = s.permissions.deny.map((r) => (r === 'Bash(gh release:*)' ? 'Bash(gh release delete:*)' : r)).concat('Read(./secretos/**)')
  // Ajusta el timeout del hook de sesion del harness y suma uno propio.
  s.hooks.SessionStart[0].hooks[0].timeout = 5
  s.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'node scripts/mi-hook.mjs' }] })
  guardar(dir, s)

  assert.equal(await main(['upgrade', ...YES, '--solo'], dir), 0)
  const despues = settingsDe(dir)
  assert.equal(despues.model, 'sonnet')
  assert.ok(despues.permissions.allow.includes('Bash(make:*)'))
  assert.deepEqual(despues.permissions.ask, ['Bash(rm -rf:*)'], 'se van los ask del harness; el del usuario queda')
  assert.ok(despues.permissions.deny.includes('Read(./secretos/**)'))
  assert.ok(despues.permissions.deny.includes('Bash(gh release delete:*)'), 'una regla reescrita por el usuario no se retira')
  assert.ok(!despues.permissions.deny.includes('Bash(gh pr merge:*)'))
  const sesion = comandos(despues, 'SessionStart')
  assert.ok(sesion.includes('node scripts/mi-hook.mjs'))
  assert.ok(!sesion.some((c) => c.includes('declarar-milestone')), 'el hook del modo anterior se retira aunque se le haya cambiado el timeout')
  assert.ok(sesion.some((c) => c.includes('worklog-solo')))
})

test('sin cambio de modo no se retira nada, aunque coincida con el seed del otro modo', async () => {
  const dir = repo()
  await main(['init', ...YES, '--solo'], dir)
  const s = settingsDe(dir)
  s.permissions.deny.push('Bash(gh release:*)') // igual a una regla de equipo, puesta a mano
  guardar(dir, s)
  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.ok(settingsDe(dir).permissions.deny.includes('Bash(gh release:*)'))
})

test('un lockfile sin modo (anterior al modo solo) era equipo: al elegir solo tambien se retira', async () => {
  const dir = repo()
  await main(['init', ...YES], dir)
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  delete lock.modo
  write(dir, '.claude/harness.json', JSON.stringify(lock, null, 2) + '\n')

  assert.equal(await main(['upgrade', ...YES, '--solo'], dir), 0)
  const settings = settingsDe(dir)
  assert.ok(!settings.permissions.deny.includes('Bash(gh pr merge:*)'))
  assert.ok(!comandos(settings, 'SessionStart').some((c) => c.includes('declarar-milestone')))
})

test('cambio de modo: el plan lo explica, y --dry-run no escribe', async () => {
  const dir = repo()
  await main(['init', ...YES], dir)
  const antes = read(dir, SETTINGS)

  const lock = readLockfile(dir)
  const plan = computePlan({ manifest: loadManifest(), cwd: dir, lock, vars: lock.vars, detected: resolveDetected(dir, lock), modo: 'solo' })
  const accion = plan.actions.find((a) => a.dest === SETTINGS)
  assert.equal(accion.verdict, 'update')
  assert.ok(accion.reasons.some((r) => /cambio de modo equipo -> solo: se retiran los permisos y hooks que sembro el modo equipo/.test(r)), accion.reasons.join(' | '))
  // En el mismo modo, ninguna razon de cambio de modo.
  const mismo = computePlan({ manifest: loadManifest(), cwd: dir, lock, vars: lock.vars, detected: resolveDetected(dir, lock) })
  assert.ok(!mismo.actions.find((a) => a.dest === SETTINGS).reasons.some((r) => /cambio de modo/.test(r)))

  assert.equal(await main(['upgrade', ...YES, '--solo', '--dry-run'], dir), 0)
  assert.equal(read(dir, SETTINGS), antes, '--dry-run escribio settings.json')
})
