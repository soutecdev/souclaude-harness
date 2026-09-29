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

function correrHook(entrada) {
  return execFileSync(process.execPath, [HOOK], { input: JSON.stringify(entrada), encoding: 'utf8' })
}

function push(cwd, comando = 'git push -u origin fix/M1-algo', toolName = 'Bash') {
  return correrHook({ hook_event_name: 'PreToolUse', tool_name: toolName, cwd, tool_input: { command: comando } })
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

  // Otro repo sin el script del harness (el Vault): no le corresponde el check.
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  git(vault, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(vault, '.env'), 'X=1\n')
  git(vault, 'add', '-A', '--force')
  git(vault, 'commit', '-q', '-m', 'chore: tablero')
  assert.equal(push(dir, `git -C "${vault}" push`), '')
  assert.equal(push(dir, `cd "${vault}" && git push`), '')

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
