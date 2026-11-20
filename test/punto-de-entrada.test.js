import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { esPuntoDeEntrada } from '../templates/base/claude/hooks/reglas-pr.mjs'

// El hook reglas-pr y los scripts de scripts/ solo corren `main()` cuando son el
// script de entrada. Esa guarda comparaba import.meta.url contra process.argv[1]
// tal cual, y Node resuelve los enlaces simbolicos del script de entrada: por una
// ruta con un enlace (symlink, junction, /tmp y /var en macOS) no coincidian, el
// script terminaba sin hacer nada y con exit 0 -- el hook dejaba de proteger main
// y un check de CI quedaba "en verde" sin haber corrido. Estos tests invocan cada
// uno a traves de un enlace y exigen que haga su trabajo.
const REPO = fileURLToPath(new URL('..', import.meta.url))

// 'junction' solo aplica en Windows (no pide privilegios); en POSIX se ignora y
// queda un symlink de directorio comun.
function enlaceA(destino) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude enlace '))
  const enlace = path.join(dir, 'enlace')
  fs.symlinkSync(destino, enlace, 'junction')
  return enlace
}

function correr(script, args, { cwd, input } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, VAULT_PATH: '', SOUCLAUDE_CLAUDE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home ')) },
  })
  return { status: r.status, salida: `${r.stdout}${r.stderr}` }
}

test('esPuntoDeEntrada: compara rutas reales, no la forma en que se escribio la ruta', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude entrada '))
  const script = path.join(real, 'script.mjs')
  fs.writeFileSync(script, '')
  const porEnlace = path.join(enlaceA(real), 'script.mjs')

  // Node entrega import.meta.url con la ruta real aunque se lo invoque por el enlace.
  const urlReal = pathToFileURL(fs.realpathSync.native(script)).href
  assert.equal(esPuntoDeEntrada(urlReal, script), true)
  assert.equal(esPuntoDeEntrada(urlReal, porEnlace), true, 'invocado por un enlace sigue siendo el punto de entrada')
  assert.equal(esPuntoDeEntrada(urlReal, path.join(real, 'otro.mjs')), false)
  assert.equal(esPuntoDeEntrada(urlReal, undefined), false, 'sin argv[1] (import desde un REPL) no es el punto de entrada')
  // En Windows las rutas no distinguen mayusculas: el mismo archivo escrito con
  // otra caja sigue siendo el punto de entrada. La plataforma se pasa a mano para
  // que esa rama corra tambien en Linux y macOS.
  const otraCaja = path.join(fs.realpathSync.native(real), 'SCRIPT.MJS')
  assert.equal(esPuntoDeEntrada(urlReal, otraCaja, 'win32'), true)
  assert.equal(esPuntoDeEntrada(urlReal, path.join(fs.realpathSync.native(real), 'OTRO.MJS'), 'win32'), false)
})

test('hook reglas-pr invocado por un enlace: sigue denegando el push a main', () => {
  const proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude proyecto '))
  fs.mkdirSync(path.join(proyecto, '.claude', 'hooks'), { recursive: true })
  fs.copyFileSync(path.join(REPO, 'templates', 'base', 'claude', 'hooks', 'reglas-pr.mjs'), path.join(proyecto, '.claude', 'hooks', 'reglas-pr.mjs'))
  const entrada = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: proyecto, tool_input: { command: 'git push origin main' } })

  for (const [como, raiz] of [['ruta real', proyecto], ['enlace', enlaceA(proyecto)]]) {
    const r = correr(path.join(raiz, '.claude', 'hooks', 'reglas-pr.mjs'), [], { cwd: proyecto, input: entrada })
    assert.equal(r.status, 0, como)
    assert.notEqual(r.salida, '', `por ${como} el hook no emitio nada: main queda sin proteccion`)
    assert.equal(JSON.parse(r.salida).hookSpecificOutput.permissionDecision, 'deny', como)
  }
})

test('scripts invocados por un enlace: corren de verdad en vez de salir en silencio con exit 0', () => {
  const enlazado = enlaceA(REPO)
  const sinRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude sin repo '))
  const casos = [
    // script, args, exit esperado, salida esperada
    ['scripts/check-pr-rules.mjs', ['--grupo', 'inventado'], 2, /\[ERROR\] uso: --grupo debe ser uno de/],
    ['templates/base/scripts/check-pr-rules.mjs', ['--grupo', 'inventado'], 2, /\[ERROR\] uso: --grupo debe ser uno de/],
    ['scripts/tag-release.mjs', ['--ref', 'no-existe'], 1, /\[ERROR\]/],
    ['scripts/release-publicar.mjs', ['--version', 'x', '--dry-run'], 1, /\[ERROR\] versión SemVer inválida/],
    ['scripts/gen-docs-metodologia.mjs', ['--check'], 0, /docs-metodologia/],
  ]
  for (const [script, args, exit, patron] of casos) {
    const r = correr(path.join(enlazado, ...script.split('/')), args, { cwd: sinRepo })
    assert.equal(r.status, exit, `${script} por enlace: exit ${r.status}, salida: ${r.salida}`)
    assert.match(r.salida, patron, `${script} por enlace no hizo su trabajo`)
  }
})
