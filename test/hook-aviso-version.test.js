import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mkRepo, write, read } from './helpers.js'

// Integracion real del aviso de version nueva (SHS-M43) en los DOS hooks de
// SessionStart: cada script se ejecuta tal cual lo corre el harness, con el
// "repo del harness" apuntado a un repo git local con tags
// (SOUCLAUDE_HARNESS_REMOTO) y la cache por maquina redirigida a un home
// temporal (SOUCLAUDE_CLAUDE_HOME) — ni red real ni el home del dev.
const HOOKS = {
  'declarar-milestone': fileURLToPath(new URL('../templates/base/claude/hooks/declarar-milestone.mjs', import.meta.url)),
  'worklog-solo': fileURLToPath(new URL('../templates/base/claude/hooks/worklog-solo.mjs', import.meta.url)),
}

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// Repo git local que hace de repo del harness: solo importan sus tags.
function remotoConTags(tags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude tags '))
  git(dir, 'init')
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'chore: raiz')
  for (const tag of tags) git(dir, 'tag', tag)
  return dir
}

function homeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home aviso '))
}

function consumidorCon(version) {
  const dir = mkRepo()
  if (version != null) {
    write(dir, '.claude/harness.json', JSON.stringify({ harnessVersion: version, files: {}, blocks: {} }))
  }
  return dir
}

function correrHook(hook, root, { remoto, home }) {
  return execFileSync(process.execPath, [HOOKS[hook]], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      SOUCLAUDE_HARNESS_REMOTO: remoto,
      SOUCLAUDE_CLAUDE_HOME: home,
    },
  })
}

for (const hook of Object.keys(HOOKS)) {
  test(`${hook}: avisa la version nueva de la misma major y propone harness-upgrade`, () => {
    const remoto = remotoConTags(['v3.16.2', 'v3.18.0', 'v3'])
    const salida = correrHook(hook, consumidorCon('3.16.2'), { remoto, home: homeTmp() })
    assert.match(salida, /Version nueva del harness: v3\.18\.0 \(instalada: v3\.16\.2\)\./)
    assert.match(salida, /harness-upgrade/)
  })

  test(`${hook}: al dia no avisa nada (el tag movil v3 no cuenta como version)`, () => {
    const remoto = remotoConTags(['v3.18.0', 'v3'])
    const salida = correrHook(hook, consumidorCon('3.18.0'), { remoto, home: homeTmp() })
    assert.doesNotMatch(salida, /Version nueva del harness/)
    assert.doesNotMatch(salida, /Major nueva del harness/)
  })
}

// Los demas casos cubren la logica compartida: con un solo hook alcanza.

test('major nueva: aviso aparte, ademas del de la propia major si corresponde', () => {
  const remoto = remotoConTags(['v3.16.2', 'v3.18.0', 'v4.0.0'])
  const salida = correrHook('declarar-milestone', consumidorCon('3.16.2'), { remoto, home: homeTmp() })
  assert.match(salida, /Version nueva del harness: v3\.18\.0/)
  assert.match(salida, /Major nueva del harness: v4\.0\.0 .*migracion de major es manual/)
})

test('la consulta se cachea por maquina: el segundo arranque no toca el remoto', () => {
  const remoto = remotoConTags(['v3.18.0'])
  const home = homeTmp()
  const consumidor = consumidorCon('3.16.2')
  assert.match(correrHook('declarar-milestone', consumidor, { remoto, home }), /v3\.18\.0/)

  const cache = JSON.parse(read(home, 'souclaude/version-check.json'))
  assert.equal(cache.ultimaPorMajor['3'], '3.18.0')

  // Remoto borrado: si el segundo arranque consultara la red, no podria avisar.
  fs.rmSync(remoto, { recursive: true, force: true })
  assert.match(correrHook('declarar-milestone', consumidor, { remoto, home }), /v3\.18\.0/)
})

test('sin remoto alcanzable ni cache previa: silencio, exit 0 y fallo anotado para el backoff', () => {
  const home = homeTmp()
  const salida = correrHook('declarar-milestone', consumidorCon('3.16.2'), {
    remoto: path.join(os.tmpdir(), 'souclaude-remoto-que-no-existe'),
    home,
  })
  assert.match(salida, /Trazabilidad obligatoria/)
  assert.doesNotMatch(salida, /Version nueva del harness/)
  const cache = JSON.parse(read(home, 'souclaude/version-check.json'))
  assert.ok(cache.falloEn)
})

test('sin lockfile o con version 0.0.0 (adopt sin version): silencio', () => {
  const remoto = remotoConTags(['v3.18.0'])
  assert.doesNotMatch(
    correrHook('declarar-milestone', consumidorCon(null), { remoto, home: homeTmp() }),
    /Version nueva del harness/
  )
  assert.doesNotMatch(
    correrHook('declarar-milestone', consumidorCon('0.0.0'), { remoto, home: homeTmp() }),
    /Version nueva del harness/
  )
})

test('en el repo del propio generador el aviso calla aunque el lockfile este viejo', () => {
  const remoto = remotoConTags(['v3.18.0'])
  const dir = consumidorCon('3.1.0')
  write(dir, 'templates/harness.manifest.json', '{}')
  assert.doesNotMatch(
    correrHook('declarar-milestone', dir, { remoto, home: homeTmp() }),
    /Version nueva del harness/
  )
})
