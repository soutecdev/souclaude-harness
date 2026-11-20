import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { main } from '../src/cli.js'
import { mkRepo, read, write } from './helpers.js'
import { seedMerge } from '../src/core/jsonmerge.js'
import { readLockfile, writeLockfile, lt } from '../src/core/lockfile.js'
import { readTemplate, readFragments } from '../src/core/manifest.js'
import { migrations } from '../src/migrations/index.js'
import { buildBlock } from '../src/core/block.js'

// .claude/settings.json llega a los consumidores por merge-json: el harness solo
// agrega. Estos tests cubren lo que ese merge tiene que garantizar sobre los
// hooks -- que no se dupliquen, y que el de SessionStart corra desde cualquier
// carpeta -- y las reglas que protegen los archivos de secretos.
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const settingsDe = (dir) => JSON.parse(read(dir, '.claude/settings.json'))
const guardar = (dir, json) => write(dir, '.claude/settings.json', JSON.stringify(json, null, 2))
const comandos = (grupos) => (grupos ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command))

test('seedMerge: un grupo de hooks se reconoce por tool + comando, no por sus ajustes', () => {
  const seed = JSON.parse(readTemplate('base/claude/settings.json'))
  const user = structuredClone(seed)
  // El usuario sube el plazo de un hook del harness. Sigue siendo el mismo hook.
  user.hooks.PreToolUse.find((g) => g.matcher === 'Bash').hooks[0].timeout = 120
  user.hooks.SessionStart[0].hooks[0].timeout = 15

  const out = seedMerge(user, seed)
  assert.equal(out.hooks.PreToolUse.length, 2, 'el grupo Bash se duplico por haberle cambiado el timeout')
  assert.equal(out.hooks.PreToolUse.find((g) => g.matcher === 'Bash').hooks[0].timeout, 120, 'el ajuste del usuario se respeta')
  assert.equal(out.hooks.SessionStart.length, 1)
  assert.equal(out.hooks.SessionStart[0].hooks[0].timeout, 15)
  assert.deepEqual(seedMerge(out, seed), out, 'idempotente')

  // Otra tool, otro comando u otro filtro `if` SI son otro grupo.
  const mismoComando = seed.hooks.PostToolUse.find((g) => g.matcher === 'Bash')
  const otros = {
    hooks: {
      PostToolUse: [
        { ...mismoComando, matcher: 'Edit' },
        { matcher: 'Bash', hooks: [{ ...mismoComando.hooks[0], if: 'Bash(gh issue:*)' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node mi-hook.mjs' }] },
      ],
    },
  }
  assert.equal(seedMerge(otros, seed).hooks.PostToolUse.length, 3 + seed.hooks.PostToolUse.length)
  // Los arrays comunes siguen uniendose por igualdad exacta.
  assert.deepEqual(seedMerge({ a: ['x', { k: 1 }] }, { a: ['x', { k: 1 }, { k: 2 }] }).a, ['x', { k: 1 }, { k: 2 }])
})

test('upgrade: cambiar el timeout de un hook del harness no lo duplica', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  const s = settingsDe(dir)
  s.hooks.PreToolUse.find((g) => g.matcher === 'Bash').hooks[0].timeout = 120
  guardar(dir, s)

  assert.equal(await main(['upgrade', ...YES], dir), 0)
  const despues = settingsDe(dir)
  assert.deepEqual(despues.hooks.PreToolUse.map((g) => g.matcher), ['Bash', 'PowerShell'])
  assert.equal(despues.hooks.PreToolUse[0].hooks[0].timeout, 120)
})

for (const [modo, flag, hook] of [['equipo', '--equipo', 'declarar-milestone'], ['solo', '--solo', 'worklog-solo']]) {
  test(`init ${modo}: el hook de SessionStart va con \${CLAUDE_PROJECT_DIR} y con plazo`, async () => {
    const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
    assert.equal(await main(['init', ...YES, flag], dir), 0)
    const [grupo] = settingsDe(dir).hooks.SessionStart
    assert.equal(grupo.hooks[0].command, `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${hook}.mjs"`)
    assert.equal(grupo.hooks[0].timeout, 60)
  })

  test(`upgrade ${modo}: el comando viejo (ruta relativa) se migra en el lugar, sin duplicar`, async () => {
    const viejo = `node .claude/hooks/${hook}.mjs`
    const migracion = migrations.find((m) => m.id === 'v3-settings-session-start-ruta-absoluta')
    for (const timeoutDelUsuario of [undefined, 20]) {
      const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
      assert.equal(await main(['init', ...YES, flag], dir), 0)
      // Asi quedo instalado por las versiones anteriores a la migracion.
      const s = settingsDe(dir)
      s.hooks.SessionStart = [{ hooks: [{ type: 'command', command: viejo, ...(timeoutDelUsuario ? { timeout: timeoutDelUsuario } : {}) }] }]
      s.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'node mi-hook-de-sesion.mjs' }] })
      guardar(dir, s)
      writeLockfile(dir, { ...readLockfile(dir), harnessVersion: '3.18.1' })
      assert.ok(lt('3.18.1', migracion.to), 'la migracion tiene que aplicar a lo instalado hasta 3.18.1')

      assert.equal(await main(['upgrade', ...YES], dir), 0)
      const sesion = settingsDe(dir).hooks.SessionStart
      assert.deepEqual(comandos(sesion), [`node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/${hook}.mjs"`, 'node mi-hook-de-sesion.mjs'])
      assert.equal(sesion[0].hooks[0].timeout, timeoutDelUsuario ?? 60, 'el plazo que puso el usuario se respeta')
      // Y es estable: otro upgrade no cambia nada.
      const antes = read(dir, '.claude/settings.json')
      assert.equal(await main(['upgrade', ...YES], dir), 0)
      assert.equal(read(dir, '.claude/settings.json'), antes)
    }
  })
}

// Claude Code corre los hooks en el directorio actual de la sesion. Tras un `cd`
// del agente, el SessionStart de un resume/clear/compact corria desde ahi: con
// la ruta relativa, node no encontraba el script y la regla del milestone no se
// reinyectaba. ${VAR} lo expande sh; en Windows lo hace Claude Code.
test('SessionStart desde una subcarpeta: el comando nuevo encuentra el hook; el viejo no', { skip: process.platform === 'win32' }, async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n', 'src/app.js': '' })
  assert.equal(await main(['init', ...YES], dir), 0)
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: dir,
    VAULT_PATH: '',
    SOUCLAUDE_CLAUDE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home ')),
    SOUCLAUDE_HARNESS_REMOTO: path.join(os.tmpdir(), 'souclaude-remoto-inexistente'), // sin red
  }
  const correr = (comando) => spawnSync(comando, { cwd: path.join(dir, 'src'), env, shell: true, encoding: 'utf8' })

  const nuevo = correr(settingsDe(dir).hooks.SessionStart[0].hooks[0].command)
  assert.equal(nuevo.status, 0, nuevo.stderr)
  assert.match(nuevo.stdout, /\[harness\] Trazabilidad obligatoria/)

  const viejo = correr('node .claude/hooks/declarar-milestone.mjs')
  assert.notEqual(viejo.status, 0, 'la ruta relativa no deberia resolver desde una subcarpeta')
  assert.doesNotMatch(viejo.stdout, /Trazabilidad obligatoria/)
})

test('settings: la lectura de .env se deniega tambien en subcarpetas, en los dos modos', async () => {
  for (const flag of ['--equipo', '--solo']) {
    const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
    assert.equal(await main(['init', ...YES, flag], dir), 0)
    const deny = settingsDe(dir).permissions.deny
    for (const regla of ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/.env)', 'Read(./**/.env.*)', 'Read(./**/*.pem)', 'Read(./**/id_rsa*)']) {
      assert.ok(deny.includes(regla), `${flag}: falta ${regla}`)
    }
  }
})

// El bloque de .gitignore y el check de secretos del PR tienen que decir lo
// mismo: antes el check rechazaba .env.staging, pero .gitignore solo ignoraba
// .env.local/.development/.production y un `git add -A` lo levantaba igual.
test('.gitignore emitido: ignora cualquier .env.* menos las plantillas, y los residuos de Python de las skills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude ignore '))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.writeFileSync(path.join(dir, '.gitignore'), `${buildBlock(readFragments('fragments/gitignore', []), '0.0.0')}\n`)
  const ignorado = (ruta) => spawnSync('git', ['check-ignore', '-q', ruta], { cwd: dir }).status === 0

  for (const ruta of ['.env', '.env.local', '.env.staging', 'apps/api/.env.production', 'certs/cliente.p12', 'llave.pem',
    '.claude/skills/soutec-md-a-pdf/scripts/__pycache__/soutec_md.cpython-312.pyc', '.claude/vault.local.json', 'CLAUDE.md.new']) {
    assert.equal(ignorado(ruta), true, `deberia ignorarse: ${ruta}`)
  }
  for (const ruta of ['.env.example', 'apps/api/.env.sample', '.env.template', '.env.dist', 'CLAUDE.md', '.claude/settings.json', 'src/env.js']) {
    assert.equal(ignorado(ruta), false, `NO deberia ignorarse: ${ruta}`)
  }
})
