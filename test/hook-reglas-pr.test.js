import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  segmentos,
  palabras,
  pushDelComando,
  cambioDePR,
  urlDelPR,
  prePush,
  postPR,
  salidaPostToolUse,
  procesar,
  prDeEsteRepo,
  rutaNativa,
  destinosDelPush,
  prePushMain,
  rutasDelVault,
  configDelVault,
  repoCanonico,
  mismaCarpeta,
} from '../templates/base/claude/hooks/reglas-pr.mjs'

// Hook PreToolUse/PostToolUse de SHS-M39: con Actions en pausa, los checks de
// check-pr-rules.mjs corren en la sesion del agente. Se testea como lo corre
// Claude Code (JSON por stdin) contra repos git reales en tmp, con espacios en
// la ruta como los de OneDrive, y la logica de PR con un `correr` falso (sin gh).
const HOOK = fileURLToPath(new URL('../templates/base/claude/hooks/reglas-pr.mjs', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../scripts/check-pr-rules.mjs', import.meta.url))
const CWD = path.resolve('/repo')

// --- Lectura del comando ---------------------------------------------------

test('segmentos: corta por operadores pero no dentro de comillas ni en redirecciones', () => {
  assert.deepEqual(segmentos('git add -A && git commit -m "x; git push" && git push 2>&1 | tail -n 3'), [
    'git add -A',
    'git commit -m "x; git push"',
    'git push 2>&1',
    'tail -n 3',
  ])
  assert.deepEqual(segmentos('cd x; git push || echo fallo'), ['cd x', 'git push', 'echo fallo'])
})

test('palabras: quita comillas, redirecciones y asignaciones iniciales', () => {
  assert.deepEqual(palabras('GIT_TRACE=1 git push "origin" fix/M1-x 2>&1'), ['git', 'push', 'origin', 'fix/M1-x'])
  assert.deepEqual(palabras('git push origin x > salida.txt'), ['git', 'push', 'origin', 'x'])
  // PowerShell: la barra invertida es parte de la ruta, no un escape.
  assert.deepEqual(palabras('git -C C:\\repos\\app push', 'powershell'), ['git', '-C', 'C:\\repos\\app', 'push'])
})

test('pushDelComando: pushes de ramas, con y sin refspec', () => {
  assert.deepEqual(pushDelComando('git push', CWD), { dir: CWD, cabezas: ['HEAD'] })
  assert.deepEqual(pushDelComando('git push -u origin fix/M1-x', CWD).cabezas, ['fix/M1-x'])
  assert.deepEqual(pushDelComando('git push origin HEAD', CWD).cabezas, ['HEAD'])
  assert.deepEqual(pushDelComando('git push origin +HEAD:refs/heads/x', CWD).cabezas, ['HEAD'])
  assert.deepEqual(pushDelComando('git fetch origin && git merge origin/dev && git push', CWD).cabezas, ['HEAD'])
  // --dry-run tambien se revisa: es la forma segura de probar el hook.
  assert.deepEqual(pushDelComando('git push --dry-run origin HEAD', CWD).cabezas, ['HEAD'])
  assert.deepEqual(pushDelComando('git push origin fix/M1-x 2>&1 | tail -n 3', CWD).cabezas, ['fix/M1-x'])
})

// Security review de SHS-M39: un tag sobre un commit sin pushear lo sube, y
// --all/--mirror suben ramas que no son HEAD. Todo eso tambien se revisa.
test('pushDelComando: tags, --all y --mirror revisan lo que de verdad suben', () => {
  assert.deepEqual(pushDelComando('git push origin v3.16.0', CWD).cabezas, ['v3.16.0'])
  assert.deepEqual(pushDelComando('git push origin refs/tags/v1', CWD).cabezas, ['refs/tags/v1'])
  assert.deepEqual(pushDelComando('git push --tags', CWD).cabezas, ['--tags'])
  assert.deepEqual(pushDelComando('git push origin --tags', CWD).cabezas, ['--tags'])
  assert.deepEqual(pushDelComando('git push --follow-tags', CWD).cabezas, ['HEAD', '--tags'])
  assert.deepEqual(pushDelComando('git push --all origin', CWD).cabezas, ['--branches'])
  assert.deepEqual(pushDelComando('git push --mirror origin', CWD).cabezas, ['--branches', '--tags'])
})

test('pushDelComando: borrados y comandos sin push no llevan check', () => {
  for (const comando of [
    'git push origin --delete fix/M1-x',
    'git push origin :fix/M1-x',
    'git commit -m "despues hago git push"',
    'git status',
    'echo git push',
  ]) {
    assert.equal(pushDelComando(comando, CWD), null, comando)
  }
})

test('pushDelComando: resuelve la carpeta con -C y con un cd previo', () => {
  assert.equal(pushDelComando('git -C "otra carpeta" push', CWD).dir, path.resolve(CWD, 'otra carpeta'))
  assert.equal(pushDelComando('cd "../el vault" && git add -A && git push', CWD).dir, path.resolve(CWD, '../el vault'))
  assert.equal(pushDelComando('git -c core.x=1 -C sub push', CWD).dir, path.resolve(CWD, 'sub'))
  assert.equal(pushDelComando('"C:/Program Files/Git/cmd/git.exe" push', CWD).dir, CWD)
})

test('cambioDePR: gh pr create, y gh pr edit solo si toca body o base', () => {
  assert.deepEqual(cambioDePR('gh pr create --base dev --title "t" --body-file cuerpo.md', CWD), { accion: 'create', dir: CWD, objetivo: null })
  assert.deepEqual(cambioDePR('gh pr edit 12 --body-file c.md', CWD), { accion: 'edit', dir: CWD, objetivo: '12' })
  assert.equal(cambioDePR('gh pr edit https://github.com/o/r/pull/12 --base dev', CWD).objetivo, 'https://github.com/o/r/pull/12')
  assert.equal(cambioDePR('gh pr edit --body=hola', CWD).objetivo, null)
  for (const comando of ['gh pr create --web', 'gh pr create --dry-run', 'gh pr edit 12 --add-label x', 'gh pr view 12', 'gh pr checks', 'git push']) {
    assert.equal(cambioDePR(comando, CWD), null, comando)
  }
})

test('urlDelPR: la ultima URL de PR, sin pegar dos URLs seguidas', () => {
  const salida = JSON.stringify({ stdout: 'Creating pull request\nhttps://github.com/o/r/pull/7\nhttps://github.com/o/r/pull/12\n' })
  assert.equal(urlDelPR(salida), 'https://github.com/o/r/pull/12')
  assert.equal(urlDelPR(JSON.stringify({ stdout: 'nada' })), null)
})

// --- Flujos con un `correr` falso -------------------------------------------

function repoFalso({ modo } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude reglas '))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'scripts', 'check-pr-rules.mjs'), '// falso\n')
  if (modo) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ modo }))
  }
  return dir
}

// Responde segun el comando: git rev-parse -> la raiz, gh pr view -> el PR,
// el script -> lo que diga `grupos`, gh pr comment -> guarda el cuerpo.
function correrFalso({ raiz, grupos = {}, vista = { status: 0 }, comentario = { status: 0 } }) {
  const llamadas = []
  const correr = (cmd, args, opciones = {}) => {
    llamadas.push({ cmd, args, opciones })
    if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: `${raiz}\n`, stderr: '' }
    if (cmd === 'git') return { status: 0, stdout: '', stderr: '' }
    if (cmd === 'gh' && args[1] === 'view') {
      return vista.status === 0
        ? { status: 0, stdout: JSON.stringify({ url: 'https://github.com/o/r/pull/12', headRefOid: 'abcdef1234' }), stderr: '' }
        : { status: vista.status, stdout: '', stderr: vista.stderr ?? 'gh: error' }
    }
    if (cmd === 'gh' && args[1] === 'comment') return { status: comentario.status, stdout: '', stderr: 'no se pudo comentar' }
    const grupo = args[args.indexOf('--grupo') + 1]
    return grupos[grupo] ?? { status: 0, stdout: `[OK  ] ${grupo}: ok\n`, stderr: '' }
  }
  return { correr, llamadas }
}

test('prePush: FAIL de secretos deniega el push con una razon accionable', () => {
  const raiz = repoFalso()
  const { correr, llamadas } = correrFalso({
    raiz,
    grupos: { secretos: { status: 1, stdout: '[FAIL] sin-secretos: archivos sospechosos en commits sin pushear: .env.staging\n' } },
  })
  const salida = prePush({ push: { dir: raiz, cabezas: ['HEAD'] }, raiz, correr })
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /\.env\.staging/)
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /git rm --cached/)
  const args = llamadas.find((l) => l.cmd === process.execPath).args
  assert.ok(args.includes('--sin-pushear'))
  assert.ok(!args.includes('--cabeza'), 'HEAD no se pasa como --cabeza')
})

test('prePush: check en verde no emite nada (nunca "allow": no salta los ask de force-push)', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz })
  assert.equal(prePush({ push: { dir: raiz, cabezas: ['HEAD'] }, raiz, correr }), null)
})

test('prePush: si el script no pudo verificar, deja pasar pero lo avisa', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz, grupos: { secretos: { status: 2, stdout: '[ERROR] secretos: no se pudo verificar: fatal\n' } } })
  const salida = prePush({ push: { dir: raiz, cabezas: ['HEAD'] }, raiz, correr })
  assert.equal(salida.hookSpecificOutput, undefined, 'no deniega')
  assert.match(salida.systemMessage, /no se pudo validar secretos/)
})

test('prePush: revisa la rama nombrada en el refspec', () => {
  const raiz = repoFalso()
  const { correr, llamadas } = correrFalso({ raiz })
  prePush({ push: { dir: raiz, cabezas: ['fix/M1-otra'] }, raiz, correr })
  const args = llamadas.find((l) => l.cmd === process.execPath).args
  // Con "=": una ref que empiece con "-" no se lee como otra opcion.
  assert.equal(args.at(-1), '--cabeza=fix/M1-otra')
  // Y el script que se ejecuta es el del proyecto del hook, no el del repo destino.
  assert.notEqual(path.resolve(args[0]), path.resolve(raiz, 'scripts', 'check-pr-rules.mjs'))
})

test('prDeEsteRepo: el modo manual solo acepta PRs del repo de origin', () => {
  assert.equal(prDeEsteRepo('https://github.com/soutecdev/app/pull/3', 'soutecdev/app'), true)
  assert.equal(prDeEsteRepo('https://github.com/SoutecDev/App/pull/3', 'soutecdev/app'), true)
  assert.equal(prDeEsteRepo('https://github.com/otra/org/pull/3', 'soutecdev/app'), false)
  assert.equal(prDeEsteRepo('https://github.com/soutecdev/app/pull/3', null), false)
  assert.equal(prDeEsteRepo('12', 'soutecdev/app'), true)
  assert.equal(prDeEsteRepo('http://evil.example/x', 'soutecdev/app'), false)
})

test('postPR: FAIL de pr-metadata -> block, comentario publicado con la tabla', () => {
  const raiz = repoFalso()
  const { correr, llamadas } = correrFalso({
    raiz,
    grupos: {
      'pr-metadata': { status: 1, stdout: '[OK  ] pr-apunta-a-dev: base = dev\n[FAIL] sin-secciones-vacias: vacias: Evidencia\n' },
    },
  })
  const resultado = postPR({ objetivo: 'https://github.com/o/r/pull/12', raiz, correr })
  assert.equal(resultado.estado, 'fail')
  const salida = salidaPostToolUse(resultado)
  assert.equal(salida.decision, 'block')
  assert.match(salida.hookSpecificOutput.additionalContext, /\[FAIL\] sin-secciones-vacias/)
  assert.match(salida.hookSpecificOutput.additionalContext, /gh pr edit https:\/\/github\.com\/o\/r\/pull\/12 --body-file/)
  assert.doesNotMatch(salida.hookSpecificOutput.additionalContext, /pr-apunta-a-dev/, 'al agente solo le llega lo que no dio OK')

  const comentario = llamadas.find((l) => l.cmd === 'gh' && l.args[1] === 'comment')
  assert.ok(comentario, 'publica el comentario')
  assert.match(comentario.opciones.input, /souclaude:reglas-pr/)
  assert.match(comentario.opciones.input, /\| pr-metadata \| FAIL \|/)
  assert.match(comentario.opciones.input, /\| rama-commits \(informativo\) \| OK \|/)
  assert.match(comentario.opciones.input, /abcdef1/)
  // Los tres grupos corren contra la URL del PR, no contra el numero.
  const grupos = llamadas.filter((l) => l.cmd === process.execPath)
  assert.equal(grupos.length, 3)
  for (const l of grupos) assert.ok(l.args.includes('https://github.com/o/r/pull/12'))
})

test('postPR: todo OK -> solo contexto, sin block', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz })
  const salida = salidaPostToolUse(postPR({ objetivo: null, raiz, correr }))
  assert.equal(salida.decision, undefined)
  assert.match(salida.hookSpecificOutput.additionalContext, /Los grupos bloqueantes pasaron/)
})

test('postPR: rama-commits es informativo, su FAIL no bloquea', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz, grupos: { 'rama-commits': { status: 1, stdout: '[FAIL] commits-formato: abc "update"\n' } } })
  const resultado = postPR({ objetivo: null, raiz, correr })
  assert.equal(resultado.estado, 'ok')
  assert.match(resultado.texto, /rama-commits \(informativo\): FAIL/)
})

test('postPR: sin gh (o sin red) no bloquea: avisa que el PR quedo sin validar', () => {
  const raiz = repoFalso()
  const { correr, llamadas } = correrFalso({ raiz, vista: { status: 1, stderr: 'gh: not logged in' } })
  const resultado = postPR({ objetivo: 'https://github.com/o/r/pull/12', raiz, correr })
  assert.equal(resultado.estado, 'error')
  assert.equal(salidaPostToolUse(resultado).decision, undefined)
  assert.match(resultado.texto, /not logged in/)
  assert.ok(!llamadas.some((l) => l.cmd === process.execPath), 'no corre los checks sin datos del PR')
})

test('postPR: un grupo en ERROR no bloquea y pide correr el modo manual', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz, grupos: { 'pr-metadata': { status: 2, stdout: '[ERROR] pr-metadata: no se pudo verificar: timeout\n' } } })
  const resultado = postPR({ objetivo: null, raiz, correr })
  assert.equal(resultado.estado, 'error')
  assert.match(resultado.texto, /node \.claude\/hooks\/reglas-pr\.mjs --pr/)
})

test('postPR: si no se pudo comentar, el agente se entera', () => {
  const raiz = repoFalso()
  const { correr } = correrFalso({ raiz, comentario: { status: 1 } })
  assert.match(postPR({ objetivo: null, raiz, correr }).texto, /No se pudo publicar el comentario/)
})

test('procesar: en modo solo corre el check de secretos del push, pero no el del PR', () => {
  const solo = repoFalso({ modo: 'solo' })
  const conSecreto = correrFalso({
    raiz: solo,
    grupos: { secretos: { status: 1, stdout: '[FAIL] sin-secretos: archivos sospechosos en commits sin pushear: .env\n' } },
  })
  const push = procesar({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: solo, tool_input: { command: 'git merge fix/x && git push origin main' } }, conSecreto.correr)
  assert.equal(push.hookSpecificOutput.permissionDecision, 'deny', 'el merge directo a main que se pushea se revisa')

  const pr = correrFalso({ raiz: solo })
  const salida = procesar(
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: solo, tool_input: { command: 'gh pr create --fill' }, tool_response: { stdout: 'https://github.com/o/r/pull/3' } },
    pr.correr,
  )
  assert.equal(salida, null, 'en solo no hay validacion de PR')
  assert.ok(!pr.llamadas.some((l) => l.cmd === 'gh'), 'ni siquiera consulta el PR')
})

test('procesar: repo sin el script y comandos ajenos -> nada', () => {
  const entradaPush = (cwd) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command: 'git push' } })
  const sinScript = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude sin script '))
  assert.equal(procesar(entradaPush(sinScript), correrFalso({ raiz: sinScript }).correr), null)

  const equipo = repoFalso({ modo: 'equipo' })
  const { correr, llamadas } = correrFalso({ raiz: equipo })
  assert.equal(procesar({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: equipo, tool_input: { command: 'npm test' } }, correr), null)
  assert.equal(llamadas.length, 0, 'un comando ajeno no dispara ni git')
})

test('procesar: PostToolUse toma la URL de la salida de gh pr create', () => {
  const raiz = repoFalso()
  const { correr, llamadas } = correrFalso({ raiz })
  procesar(
    {
      hook_event_name: 'PostToolUse',
      tool_name: 'PowerShell',
      cwd: raiz,
      tool_input: { command: 'gh pr create --base dev --body-file cuerpo.md' },
      tool_response: { stdout: 'https://github.com/o/r/pull/12\n' },
    },
    correr,
  )
  const vista = llamadas.find((l) => l.cmd === 'gh' && l.args[1] === 'view')
  assert.equal(vista.args[2], 'https://github.com/o/r/pull/12')
})

// --- Integracion: el hook y el script reales, como los corre Claude Code -----

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=test@test', '-c', 'user.name=test', '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function repoReal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude hook pr '))
  git(dir, 'init', '-q', '-b', 'dev')
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-pr-rules.mjs'))
  fs.mkdirSync(path.join(dir, 'src', 'modulo'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'modulo', 'a.js'), 'export {}\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'chore: raiz')
  git(dir, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
  git(dir, 'switch', '-q', '-c', 'fix/M1-algo')
  return dir
}

// Sin el VAULT_PATH ni la config de maquina de quien corre los tests: el Vault
// de cada test se declara por `env`.
function correrHook(entrada, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home '))
  return execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: { ...process.env, VAULT_PATH: '', SOUCLAUDE_CLAUDE_HOME: home, ...env },
  })
}

function push(cwd, comando = 'git push -u origin fix/M1-algo', toolName = 'Bash', env = {}) {
  return correrHook({ hook_event_name: 'PreToolUse', tool_name: toolName, cwd, tool_input: { command: comando } }, env)
}

test('hook real: un push que sube un .env.staging queda denegado', () => {
  const dir = repoReal()
  fs.writeFileSync(path.join(dir, '.env.staging'), 'TOKEN=x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feat: config')

  const salida = JSON.parse(push(dir))
  assert.equal(salida.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /\.env\.staging/)
})

test('hook real: tambien desde una subcarpeta y desde la tool PowerShell', () => {
  const dir = repoReal()
  fs.writeFileSync(path.join(dir, 'credentials.json'), '{}\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feat: credenciales')

  const desdeSub = JSON.parse(push(path.join(dir, 'src', 'modulo'), 'git push'))
  assert.equal(desdeSub.hookSpecificOutput.permissionDecision, 'deny')
  const powershell = JSON.parse(push(dir, 'git push origin HEAD', 'PowerShell'))
  assert.equal(powershell.hookSpecificOutput.permissionDecision, 'deny')
})

test('hook real: push limpio y push al Vault -> stdout vacio; en modo solo el secreto se deniega igual', () => {
  const dir = repoReal()
  fs.writeFileSync(path.join(dir, '.env.example'), 'TOKEN=\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feat: plantilla de entorno')
  assert.equal(push(dir), '', 'check en verde: sin salida')

  // Otro repo sin el script del harness (el Vault): no le corresponde el check
  // de secretos. Como esta parado en main, hay que declararlo Vault (SHS-M42):
  // sin eso es un repo mas y su push a main se deniega.
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  git(vault, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(vault, '.env'), 'X=1\n')
  git(vault, 'add', '-A', '--force')
  git(vault, 'commit', '-q', '-m', 'chore: tablero')
  assert.equal(push(dir, `git -C "${vault}" push`, 'Bash', { VAULT_PATH: vault }), '')
  assert.equal(push(dir, `cd "${vault}" && git push`, 'Bash', { VAULT_PATH: vault }), '')
  assert.match(JSON.parse(push(dir, `cd "${vault}" && git push`)).hookSpecificOutput.permissionDecisionReason, /SHS-M42/)

  fs.mkdirSync(path.join(dir, '.claude'))
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ modo: 'solo' }))
  fs.writeFileSync(path.join(dir, '.env.local'), 'X=1\n')
  git(dir, 'add', '-A', '--force')
  git(dir, 'commit', '-q', '-m', 'feat: local')
  // Modo solo: merge directo a dev y push, sin PR. Es justo el camino que
  // reglas-secretos.yml (solo en pull_request) nunca cubrio.
  git(dir, 'switch', '-q', 'dev')
  git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge fix/M1-algo', 'fix/M1-algo')
  const salida = JSON.parse(push(dir, 'git push origin dev'))
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /\.env\.local/)
})

test('hook real: nunca ejecuta el check-pr-rules.mjs del repo destino (cd a un repo ajeno)', () => {
  const dir = repoReal()
  const ajeno = repoReal()
  const marca = path.join(ajeno, 'ejecutado.txt')
  // Un script "malicioso" en el repo ajeno: si el hook lo corriera, dejaria la marca.
  fs.writeFileSync(
    path.join(ajeno, 'scripts', 'check-pr-rules.mjs'),
    `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(marca)}, 'x')\n`,
  )
  fs.writeFileSync(path.join(ajeno, '.env.staging'), 'X=1\n')
  git(ajeno, 'add', '-A')
  git(ajeno, 'commit', '-q', '-m', 'feat: x')

  const salida = JSON.parse(push(dir, `cd "${ajeno}" && git push`))
  assert.ok(!fs.existsSync(marca), 'se ejecuto el script del repo destino')
  // Igual se revisa, con el script confiable del proyecto del hook.
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
})

test('hook real: el push de un tag sobre un commit con secreto se deniega', () => {
  const dir = repoReal()
  fs.writeFileSync(path.join(dir, 'llave.pem'), 'x\n')
  git(dir, 'add', '-A', '--force')
  git(dir, 'commit', '-q', '-m', 'feat: llave')
  git(dir, 'tag', 'v9.9.9')
  git(dir, 'reset', '-q', '--hard', 'HEAD~1')
  const salida = JSON.parse(push(dir, 'git push origin v9.9.9'))
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /llave\.pem/)
})

test('hook real: comandos que no son push ni PR no producen nada', () => {
  const dir = repoReal()
  assert.equal(push(dir, 'npm test'), '')
  assert.equal(
    correrHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: dir, tool_input: { command: 'gh pr view 12' }, tool_response: {} }),
    '',
  )
})

// --- SHS-M42: proteccion de main por repo -------------------------------------
//
// Las reglas deny por texto de settings.json no sabian en que repo corria el
// comando (denegaban el push al Vault, cuyo protocolo es push directo a main) y
// `git -C <ruta> push` ni siquiera empieza por `git push`. La regla pasa al hook,
// que resuelve el repo real del push y exime al Vault y al modo solo.

test('rutaNativa: traduce rutas MSYS (/c/...) a su forma Windows, solo en win32', () => {
  assert.equal(rutaNativa('/c/Users/x/repo', 'win32'), 'C:/Users/x/repo')
  assert.equal(rutaNativa('/d', 'win32'), 'D:/')
  assert.equal(rutaNativa('C:/Users/x', 'win32'), 'C:/Users/x')
  assert.equal(rutaNativa('sub/carpeta', 'win32'), 'sub/carpeta')
  assert.equal(rutaNativa('/home/x', 'win32'), '/home/x')
  assert.equal(rutaNativa('/c/Users/x/repo', 'linux'), '/c/Users/x/repo')
})

test('pushDelComando y destinosDelPush: resuelven la carpeta de una ruta MSYS en Windows', { skip: process.platform !== 'win32' }, () => {
  assert.equal(pushDelComando('cd /c/Users/x/vault && git push', CWD).dir, path.resolve('C:/Users/x/vault'))
  assert.equal(destinosDelPush('git -C /c/Users/x/vault push origin main', CWD)[0].dir, path.resolve('C:/Users/x/vault'))
})

test('destinosDelPush: la rama remota que cada push escribe o borra', () => {
  const d = (comando) => destinosDelPush(comando, CWD).map((p) => p.destinos)
  assert.deepEqual(d('git push origin main'), [['main']])
  assert.deepEqual(d('git push -u origin fix/M1-x'), [['fix/M1-x']])
  assert.deepEqual(d('git push origin HEAD:main'), [['main']])
  assert.deepEqual(d('git push origin dev:refs/heads/main'), [['main']])
  assert.deepEqual(d('git push --force-with-lease origin +main'), [['main']])
  assert.deepEqual(d('git push origin :main'), [['main']])
  assert.deepEqual(d('git push origin --delete main'), [['main']])
  assert.deepEqual(d('git push -o ci.skip origin main'), [['main']])
  assert.deepEqual(d('git push origin v3.17.0'), [['v3.17.0']])
  assert.deepEqual(d('git push origin HEAD'), [['@rama-actual']])
  assert.deepEqual(d('git push'), [['@rama-actual', '@upstream']])
  assert.deepEqual(d('git push origin'), [['@rama-actual', '@upstream']])
  assert.deepEqual(d('git push --follow-tags'), [['@rama-actual', '@upstream']])
  assert.deepEqual(d('git push --all origin'), [['*']])
  assert.deepEqual(d('git push --mirror'), [['*']])
  // Solo tags no toca ramas; sin push, nada.
  assert.deepEqual(d('git push --tags'), [])
  assert.deepEqual(d('git push origin --tags'), [])
  assert.deepEqual(d('git status'), [])
  // Varios pushes en un comando: uno por push, cada uno con su carpeta.
  const dos = destinosDelPush('git push origin dev && cd "la vault" && git push origin main', CWD)
  assert.deepEqual(dos.map((p) => p.destinos), [['dev'], ['main']])
  assert.equal(dos[1].dir, path.resolve(CWD, 'la vault'))
  // El remoto nombrado viaja con el push (null = el de la rama, normalmente origin).
  assert.equal(dos[1].remoto, 'origin')
  assert.equal(destinosDelPush('git push upstream dev:main', CWD)[0].remoto, 'upstream')
  assert.equal(destinosDelPush('git push', CWD)[0].remoto, null)
})

test('repoCanonico: las formas de nombrar un mismo repo coinciden', () => {
  const esperado = 'github.com/soutecdev/soubunker-vault'
  for (const url of [
    'https://github.com/soutecdev/soubunker-vault.git',
    'git@github.com:soutecdev/soubunker-vault.git',
    'ssh://git@github.com/soutecdev/soubunker-vault',
    'HTTPS://GitHub.com/SoutecDev/soubunker-vault/',
  ]) {
    assert.equal(repoCanonico(url), esperado, url)
  }
  assert.equal(repoCanonico('C:\\clones\\soubunker-vault'), 'c:/clones/soubunker-vault')
  assert.equal(repoCanonico('/home/x/soubunker-vault.git'), '/home/x/soubunker-vault')
  assert.notEqual(repoCanonico('https://github.com/soutecdev/app.git'), esperado)
})

test('rutasDelVault: config del repo, VAULT_PATH y config de maquina, en ese orden', () => {
  const proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude proyecto '))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home '))
  assert.deepEqual(rutasDelVault({ raizProyecto: proyecto, env: { SOUCLAUDE_CLAUDE_HOME: home } }), [])
  fs.mkdirSync(path.join(home, 'souclaude'))
  fs.writeFileSync(path.join(home, 'souclaude', 'vault.json'), JSON.stringify({ path: 'C:/maquina/vault' }))
  fs.mkdirSync(path.join(proyecto, '.claude'))
  fs.writeFileSync(path.join(proyecto, '.claude', 'vault.local.json'), JSON.stringify({ path: 'C:/repo/vault' }))
  assert.deepEqual(rutasDelVault({ raizProyecto: proyecto, env: { SOUCLAUDE_CLAUDE_HOME: home, VAULT_PATH: 'C:/env/vault' } }), [
    'C:/repo/vault',
    'C:/env/vault',
    'C:/maquina/vault',
  ])
  // Los `repo` declarados tambien: sirven para reconocer el Vault por su remoto.
  fs.writeFileSync(
    path.join(proyecto, '.claude', 'vault.local.json'),
    JSON.stringify({ path: 'C:/repo/vault', repo: 'git@github.com:otra-org/vault-propio.git' }),
  )
  assert.deepEqual(configDelVault({ raizProyecto: proyecto, env: { SOUCLAUDE_CLAUDE_HOME: home } }), {
    rutas: ['C:/repo/vault', 'C:/maquina/vault'],
    repos: ['git@github.com:otra-org/vault-propio.git'],
  })
  // Un JSON roto no rompe nada: se sigue con el resto.
  fs.writeFileSync(path.join(proyecto, '.claude', 'vault.local.json'), '{ roto')
  assert.deepEqual(rutasDelVault({ raizProyecto: proyecto, env: { SOUCLAUDE_CLAUDE_HOME: home } }), ['C:/maquina/vault'])
})

test('mismaCarpeta: barras, barra final y mayusculas en Windows', () => {
  assert.equal(mismaCarpeta('C:/Users/x/vault', 'C:\\Users\\X\\vault\\', 'win32'), true)
  assert.equal(mismaCarpeta('/home/x/vault', '/home/x/vault/', 'linux'), true)
  assert.equal(mismaCarpeta('/home/x/vault', '/home/x/Vault', 'linux'), false)
  assert.equal(mismaCarpeta('C:/Users/x/vault', 'C:/Users/x/vault/Project-X', 'win32'), false)
})

// `correr` falso para la proteccion de main: responde a los git que usa el hook
// (raiz del repo, rama actual, upstream, existencia de main local y URL del
// remoto; por defecto, la de un proyecto cualquiera).
function gitFalso({ raiz, rama = 'fix/M1-x', upstream = null, mainLocal = true, remoto = 'https://github.com/soutecdev/app.git' } = {}) {
  const llamadas = []
  const correr = (cmd, args, opciones = {}) => {
    llamadas.push({ cmd, args, opciones })
    if (cmd !== 'git') return { status: 0, stdout: '', stderr: '' }
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return raiz ? { status: 0, stdout: `${raiz}\n`, stderr: '' } : { status: 128, stdout: '', stderr: 'fatal: not a git repository' }
    }
    if (args[0] === 'remote') return remoto ? { status: 0, stdout: `${remoto}\n`, stderr: '' } : { status: 2, stdout: '', stderr: 'error: No such remote' }
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: `${rama}\n`, stderr: '' }
    if (args[0] === 'rev-parse' && args[1] === '--verify') return { status: mainLocal ? 0 : 1, stdout: '', stderr: '' }
    if (args[0] === 'config') return upstream ? { status: 0, stdout: `refs/heads/${upstream}\n`, stderr: '' } : { status: 1, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  return { correr, llamadas }
}

test('prePushMain: el push a main del proyecto se deniega con una razon accionable', () => {
  const proyecto = repoFalso()
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  const { correr } = gitFalso({ raiz: proyecto })
  const salida = prePushMain({ push: { dir: proyecto, destinos: ['main'] }, correr, vault: { rutas: [vault], repos: [] } })
  assert.equal(salida.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /SHS-M42/)
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /vault-sync --push/)
  assert.ok(salida.hookSpecificOutput.permissionDecisionReason.includes(vault), 'dice donde esta el Vault configurado')
  // Otras ramas y tags pasan; y nunca se emite "allow" (no salta los ask de force-push).
  assert.equal(prePushMain({ push: { dir: proyecto, destinos: ['dev'] }, correr, vault: { rutas: [vault], repos: [] } }), null)
  assert.equal(prePushMain({ push: { dir: proyecto, destinos: ['fix/M1-x', 'v1.0.0'] }, correr, vault: { rutas: [vault], repos: [] } }), null)
})

test('prePushMain: sin Vault configurado, la razon dice como configurarlo', () => {
  const proyecto = repoFalso()
  const salida = prePushMain({ push: { dir: proyecto, destinos: ['main'] }, correr: gitFalso({ raiz: proyecto }).correr, vault: { rutas: [], repos: [] } })
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /--vault-path/)
})

test('prePushMain: el Vault queda exento, por la carpeta del push o por la raiz de su repo', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  fs.mkdirSync(path.join(vault, 'Project-X'))
  // La misma carpeta escrita distinto: barras, barra final y (en Windows) mayusculas.
  const otraForma = (process.platform === 'win32' ? vault.toUpperCase().replace(/\\/g, '/') : vault) + '/'
  const { correr } = gitFalso({ raiz: vault, rama: 'main' })
  assert.equal(prePushMain({ push: { dir: vault, destinos: ['main'] }, correr, vault: { rutas: [otraForma], repos: [] } }), null)
  // Desde una subcarpeta del Vault: la raiz del repo es el Vault.
  assert.equal(prePushMain({ push: { dir: path.join(vault, 'Project-X'), destinos: ['main'] }, correr, vault: { rutas: [vault], repos: [] } }), null)
  // Sin refspec, parado en main del Vault.
  assert.equal(prePushMain({ push: { dir: vault, destinos: ['@rama-actual', '@upstream'] }, correr, vault: { rutas: [vault], repos: [] } }), null)
})

test('prePushMain: un clon del Vault se reconoce sin configuracion, por su remoto o por 00-System', () => {
  const clon = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude clon vault '))
  const sinConfig = { rutas: [], repos: [] }
  const decision = (git, vault = sinConfig) =>
    prePushMain({ push: { dir: clon, remoto: null, destinos: ['main'] }, correr: gitFalso({ raiz: clon, rama: 'main', ...git }).correr, vault })
      ?.hookSpecificOutput.permissionDecision ?? null
  // Por el remoto de la organizacion, en cualquiera de sus formas.
  assert.equal(decision({ remoto: 'https://github.com/soutecdev/soubunker-vault.git' }), null)
  assert.equal(decision({ remoto: 'git@github.com:ialvarezsoutec/soubunker-vault.git' }), null)
  // Por el repo declarado en la config, aunque se llame distinto.
  assert.equal(decision({ remoto: 'https://github.com/otra-org/vault-propio.git' }, { rutas: [], repos: ['git@github.com:otra-org/vault-propio.git'] }), null)
  // Un proyecto cualquiera, o un repo sin remoto, sigue denegado.
  assert.equal(decision({ remoto: 'https://github.com/soutecdev/app.git' }), 'deny')
  assert.equal(decision({ remoto: null }), 'deny')
  // Por la carpeta 00-System, la senal con la que el CLI reconoce un Vault.
  fs.mkdirSync(path.join(clon, '00-System'))
  assert.equal(decision({ remoto: 'https://github.com/soutecdev/app.git' }), null)
})

test('prePushMain: el remoto que se consulta es el nombrado en el comando', () => {
  const proyecto = repoFalso()
  const { correr, llamadas } = gitFalso({ raiz: proyecto, remoto: 'https://github.com/soutecdev/soubunker-vault.git' })
  assert.equal(prePushMain({ push: { dir: proyecto, remoto: 'vault', destinos: ['main'] }, correr, vault: { rutas: [], repos: [] } }), null)
  assert.deepEqual(llamadas.find((l) => l.args[0] === 'remote')?.args, ['remote', 'get-url', 'vault'])
})

test('prePushMain: en modo solo el agente mergea y pushea main a proposito', () => {
  const solo = repoFalso({ modo: 'solo' })
  assert.equal(prePushMain({ push: { dir: solo, destinos: ['main'] }, correr: gitFalso({ raiz: solo }).correr, vault: { rutas: [], repos: [] } }), null)
})

test('prePushMain: resuelve con git la rama actual, el upstream y las ramas de --all', () => {
  const proyecto = repoFalso()
  const decision = (destinos, git) =>
    prePushMain({ push: { dir: proyecto, destinos }, correr: gitFalso({ raiz: proyecto, ...git }).correr, vault: { rutas: [], repos: [] } })?.hookSpecificOutput.permissionDecision ?? null
  // `git push origin HEAD` parado en main deniega; en otra rama pasa aunque su upstream sea main.
  assert.equal(decision(['@rama-actual'], { rama: 'main' }), 'deny')
  assert.equal(decision(['@rama-actual'], { rama: 'fix/M1-x', upstream: 'main' }), null)
  // `git push` a secas: con el upstream en main (push.default=upstream) tambien deniega.
  assert.equal(decision(['@rama-actual', '@upstream'], { rama: 'fix/M1-x', upstream: 'main' }), 'deny')
  assert.equal(decision(['@rama-actual', '@upstream'], { rama: 'fix/M1-x', upstream: 'fix/M1-x' }), null)
  assert.equal(decision(['@rama-actual', '@upstream'], { rama: 'HEAD' }), null, 'HEAD suelto: git fallaria solo')
  // --all / --mirror: solo si hay un main local que subir.
  assert.equal(decision(['*'], { mainLocal: true }), 'deny')
  assert.equal(decision(['*'], { mainLocal: false }), null)
})

test('prePushMain: una carpeta que no es repo tampoco deja pasar un main explicito (ese push fallaria igual)', () => {
  const sinRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude sin repo '))
  const { correr } = gitFalso({ raiz: null })
  assert.equal(prePushMain({ push: { dir: sinRepo, destinos: ['main'] }, correr, vault: { rutas: [], repos: [] } })?.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(prePushMain({ push: { dir: sinRepo, destinos: ['dev'] }, correr, vault: { rutas: [], repos: [] } }), null)
})

// --- Integracion SHS-M42: el hook instalado y git reales -------------------------

// El hook copiado a `.claude/hooks/` de un proyecto de tmp, como lo deja el
// harness: asi lee el vault.local.json de ESE proyecto.
function proyectoConHook({ vaultPath = null } = {}) {
  const dir = repoReal()
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true })
  fs.copyFileSync(HOOK, path.join(dir, '.claude', 'hooks', 'reglas-pr.mjs'))
  if (vaultPath) fs.writeFileSync(path.join(dir, '.claude', 'vault.local.json'), JSON.stringify({ path: vaultPath }))
  return dir
}

function vaultReal() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  git(vault, 'init', '-q', '-b', 'main')
  fs.mkdirSync(path.join(vault, 'Project-X'))
  fs.writeFileSync(path.join(vault, 'Project-X', 'kanban.md'), '## Backlog\n')
  git(vault, 'add', '-A')
  git(vault, 'commit', '-q', '-m', 'chore: tablero')
  return vault
}

function correrHookInstalado(proyecto, comando, { cwd = proyecto, toolName = 'Bash', env = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home '))
  return execFileSync(process.execPath, [path.join(proyecto, '.claude', 'hooks', 'reglas-pr.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, cwd, tool_input: { command: comando } }),
    encoding: 'utf8',
    env: { ...process.env, VAULT_PATH: '', SOUCLAUDE_CLAUDE_HOME: home, ...env },
  })
}

test('hook real: el push a main del proyecto queda denegado, en todas sus formas', () => {
  const proyecto = proyectoConHook({ vaultPath: vaultReal() })
  for (const comando of [
    'git push origin main',
    'git push -u origin HEAD:main',
    'git push origin dev:main',
    'git push origin :main',
    `git -C "${proyecto}" push origin main`,
    `cd "${proyecto}" && git push origin main`,
    'git fetch origin && git merge origin/dev && git push origin main',
  ]) {
    const salida = JSON.parse(correrHookInstalado(proyecto, comando))
    assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny', comando)
    assert.match(salida.hookSpecificOutput.permissionDecisionReason, /SHS-M42/, comando)
  }
  // Las ramas de trabajo siguen pasando (y el check de secretos sigue corriendo: en verde, sin salida).
  assert.equal(correrHookInstalado(proyecto, 'git push -u origin fix/M1-algo'), '')
  // Parado en main, hasta el push sin refspec, y tambien desde la tool PowerShell.
  git(proyecto, 'switch', '-q', '-c', 'main')
  assert.equal(JSON.parse(correrHookInstalado(proyecto, 'git push')).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(JSON.parse(correrHookInstalado(proyecto, 'git push origin HEAD', { toolName: 'PowerShell' })).hookSpecificOutput.permissionDecision, 'deny')
})

test('hook real: el Vault se pushea a main sin deny: por cd, por -C, sin refspec y desde una subcarpeta', () => {
  const vault = vaultReal()
  const proyecto = proyectoConHook({ vaultPath: vault })
  assert.equal(correrHookInstalado(proyecto, `cd "${vault}" && git add -A && git commit -m "chore: tablero" && git push origin main`), '')
  assert.equal(correrHookInstalado(proyecto, `git -C "${vault}" push origin main`), '')
  assert.equal(correrHookInstalado(proyecto, 'git push', { cwd: vault }), '')
  assert.equal(correrHookInstalado(proyecto, 'git push origin HEAD:main', { cwd: path.join(vault, 'Project-X') }), '')
  // Y el proyecto sigue protegido en la misma sesion.
  assert.equal(JSON.parse(correrHookInstalado(proyecto, 'git push origin main')).hookSpecificOutput.permissionDecision, 'deny')
})

test('hook real: el Vault tambien se reconoce por VAULT_PATH y por la config de maquina', () => {
  const vault = vaultReal()
  const proyecto = proyectoConHook()
  const comando = `git -C "${vault}" push origin main`
  assert.equal(JSON.parse(correrHookInstalado(proyecto, comando)).hookSpecificOutput.permissionDecision, 'deny', 'sin configurar, el Vault es un repo mas')
  assert.equal(correrHookInstalado(proyecto, comando, { env: { VAULT_PATH: vault } }), '')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home '))
  fs.mkdirSync(path.join(home, 'souclaude'))
  fs.writeFileSync(path.join(home, 'souclaude', 'vault.json'), JSON.stringify({ path: vault }))
  assert.equal(correrHookInstalado(proyecto, comando, { env: { SOUCLAUDE_CLAUDE_HOME: home } }), '')
})

test('hook real: en Git Bash sobre Windows la ruta MSYS del Vault tambien se reconoce, y la del proyecto se deniega', { skip: process.platform !== 'win32' }, () => {
  const msys = (ruta) => ruta.replace(/^([A-Za-z]):\\/, (_, unidad) => `/${unidad.toLowerCase()}/`).replace(/\\/g, '/')
  const vault = vaultReal()
  const proyecto = proyectoConHook({ vaultPath: vault })
  assert.equal(correrHookInstalado(proyecto, `cd "${msys(vault)}" && git push origin main`), '')
  assert.equal(correrHookInstalado(proyecto, `git -C "${msys(vault)}" push origin main`), '')
  // Antes, la carpeta MSYS no se resolvia y el push quedaba sin revisar.
  assert.equal(JSON.parse(correrHookInstalado(proyecto, `cd "${msys(proyecto)}" && git push origin main`)).hookSpecificOutput.permissionDecision, 'deny')
})

test('hook real: en modo solo el push a main pasa', () => {
  const proyecto = proyectoConHook()
  fs.writeFileSync(path.join(proyecto, '.claude', 'harness.json'), JSON.stringify({ modo: 'solo' }))
  git(proyecto, 'switch', '-q', '-c', 'main')
  assert.equal(correrHookInstalado(proyecto, 'git push origin main'), '')
})

// --- SHS-M42-T004: el Vault en los dos modos, con o sin configuracion ----------

test('hook real: un clon del Vault sin configurar se reconoce por su remoto, en equipo y en solo', () => {
  const vault = vaultReal()
  git(vault, 'remote', 'add', 'origin', 'https://github.com/soutecdev/soubunker-vault.git')
  for (const modo of ['equipo', 'solo']) {
    const proyecto = proyectoConHook() // sin vault.local.json ni config de maquina
    fs.writeFileSync(path.join(proyecto, '.claude', 'harness.json'), JSON.stringify({ modo }))
    assert.equal(correrHookInstalado(proyecto, `cd "${vault}" && git push origin main`), '', modo)
    assert.equal(correrHookInstalado(proyecto, `git -C "${vault}" push origin main`), '', modo)
    assert.equal(correrHookInstalado(proyecto, 'git push', { cwd: vault }), '', modo)
    assert.equal(correrHookInstalado(proyecto, 'git push origin HEAD:main', { cwd: path.join(vault, 'Project-X'), toolName: 'PowerShell' }), '', modo)
  }
})

test('hook real: un Vault con remoto propio se reconoce por el repo declarado o por 00-System', () => {
  const vault = vaultReal()
  git(vault, 'remote', 'add', 'origin', 'https://github.com/otra-org/vault-propio.git')
  const proyecto = proyectoConHook()
  const comando = `git -C "${vault}" push origin main`
  assert.equal(JSON.parse(correrHookInstalado(proyecto, comando)).hookSpecificOutput.permissionDecision, 'deny', 'ni ruta, ni remoto conocido, ni 00-System: es un repo mas')
  fs.writeFileSync(path.join(proyecto, '.claude', 'vault.local.json'), JSON.stringify({ path: 'C:/otra/ruta', repo: 'git@github.com:otra-org/vault-propio.git' }))
  assert.equal(correrHookInstalado(proyecto, comando), '', 'por el repo declarado en vault.local.json')
  fs.rmSync(path.join(proyecto, '.claude', 'vault.local.json'))
  fs.mkdirSync(path.join(vault, '00-System'))
  assert.equal(correrHookInstalado(proyecto, comando), '', 'por la carpeta 00-System')
})

test('hook real: en modo solo, el Vault configurado se pushea a main igual que en equipo', () => {
  const vault = vaultReal()
  const proyecto = proyectoConHook({ vaultPath: vault })
  fs.writeFileSync(path.join(proyecto, '.claude', 'harness.json'), JSON.stringify({ modo: 'solo' }))
  assert.equal(correrHookInstalado(proyecto, `cd "${vault}" && git add -A && git commit -m "docs: worklog" && git push origin main`), '')
  assert.equal(correrHookInstalado(proyecto, `git -C "${vault}" push origin main`), '')
  assert.equal(correrHookInstalado(proyecto, 'git push', { cwd: vault }), '')
})
