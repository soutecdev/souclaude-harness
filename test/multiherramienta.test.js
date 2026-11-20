import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli.js'
import { loadManifest, conSkillsParaAgentes, SKILLS_CLAUDE, SKILLS_AGENTES } from '../src/core/manifest.js'
import { verifyManifest } from '../src/core/verify.js'
import { mkRepo, tree, read, write, has } from './helpers.js'
import {
  entradaComoClaude,
  salidaParaAntigravity,
  contextoParaAntigravity,
} from '../templates/base/agents/hooks/souclaude-antigravity.mjs'

// SHS-M48: el harness instala siempre para Claude Code, Codex y Antigravity,
// sin preguntar que herramienta se usa.

const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const RAIZ = fileURLToPath(new URL('..', import.meta.url))

test('manifest: cada archivo de skill tiene su gemelo en .agents/skills', () => {
  const manifest = loadManifest()
  const deSkill = manifest.files.filter((f) => f.skill && f.dest.startsWith(SKILLS_CLAUDE))
  assert.ok(deSkill.length > 0)
  const porDest = new Map(manifest.files.map((f) => [f.dest, f]))
  for (const entry of deSkill) {
    const gemelo = porDest.get(SKILLS_AGENTES + entry.dest.slice(SKILLS_CLAUDE.length))
    assert.ok(gemelo, `sin gemelo en .agents/skills: ${entry.dest}`)
    assert.equal(gemelo.src, entry.src)
    assert.equal(gemelo.skill, entry.skill)
    assert.equal(gemelo.policy, entry.policy)
    assert.equal(gemelo.binary, entry.binary)
    assert.deepEqual(gemelo.modos, entry.modos)
  }
  assert.deepEqual(verifyManifest(manifest).errors, [])
})

test('conSkillsParaAgentes: no duplica lo que no vive bajo .claude/skills', () => {
  const m = conSkillsParaAgentes({
    files: [
      { id: 'a', src: 'x', dest: '.claude/skills/a/SKILL.md', policy: 'managed', skill: 'a' },
      { id: 'mcp', src: 'y', dest: '.mcp.json', policy: 'merge-json', skill: 'a' },
      { id: 'hook', src: 'z', dest: '.claude/hooks/h.mjs', policy: 'managed' },
    ],
  })
  assert.deepEqual(
    m.files.map((f) => f.dest),
    ['.claude/skills/a/SKILL.md', '.mcp.json', '.claude/hooks/h.mjs', '.agents/skills/a/SKILL.md'],
  )
  assert.equal(m.files.at(-1).id, 'a--agents')
})

test('init: emite instrucciones, skills y hooks para las tres herramientas', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES], dir), 0)
  const files = tree(dir)

  // Instrucciones: CLAUDE.md es la fuente; AGENTS.md remite a el.
  assert.ok(files.includes('CLAUDE.md'))
  assert.ok(files.includes('AGENTS.md'))
  const agents = read(dir, 'AGENTS.md')
  assert.match(agents, /# AGENTS\.md — acme/)
  assert.match(agents, /lee completo el archivo `CLAUDE\.md`/)
  assert.doesNotMatch(agents, /\{\{[A-Z_]+\}\}/, 'quedo un placeholder sin resolver')

  // Skills: las dos carpetas llevan exactamente los mismos archivos.
  const enClaude = files.filter((f) => f.startsWith(SKILLS_CLAUDE)).map((f) => f.slice(SKILLS_CLAUDE.length))
  const enAgentes = files.filter((f) => f.startsWith(SKILLS_AGENTES)).map((f) => f.slice(SKILLS_AGENTES.length))
  assert.ok(enClaude.length > 0)
  assert.deepEqual(enAgentes, enClaude)
  for (const rel of enClaude) {
    assert.ok(
      fs.readFileSync(path.join(dir, '.claude/skills', rel)).equals(fs.readFileSync(path.join(dir, '.agents/skills', rel))),
      `contenido distinto entre carpetas: ${rel}`,
    )
  }

  // Hooks: Codex usa los scripts de .claude/hooks; Antigravity, su adaptador.
  const codex = JSON.parse(read(dir, '.codex/hooks.json'))
  assert.match(codex.hooks.PreToolUse[0].hooks[0].command, /\.claude\/hooks\/reglas-pr\.mjs/)
  assert.match(codex.hooks.SessionStart[0].hooks[0].command, /declarar-milestone\.mjs/)
  const antigravity = JSON.parse(read(dir, '.agents/hooks.json'))
  assert.equal(antigravity['souclaude-reglas-pr'].PreToolUse[0].matcher, 'run_command')
  assert.ok(antigravity['souclaude-inicio-de-sesion'].SessionStart[0].command.includes('inicio-de-sesion'))
  assert.ok(files.includes('.agents/hooks/souclaude-antigravity.mjs'))
})

test('init --skills: la skill no elegida no aparece en ninguna de las dos carpetas', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--skills', 'adr-new'], dir), 0)
  const files = tree(dir)
  for (const base of [SKILLS_CLAUDE, SKILLS_AGENTES]) {
    assert.ok(files.includes(`${base}adr-new/SKILL.md`))
    assert.ok(files.includes(`${base}soutec-github/SKILL.md`), 'la obligatoria entra siempre')
    assert.ok(!files.some((f) => f.startsWith(`${base}soutec-md-a-pdf/`)))
  }
})

test('init en modo solo: Codex registra worklog-solo y no declarar-milestone', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', ...YES, '--solo'], dir), 0)
  const codex = JSON.parse(read(dir, '.codex/hooks.json'))
  assert.match(codex.hooks.SessionStart[0].hooks[0].command, /worklog-solo\.mjs/)
  assert.equal(codex.hooks.PostToolUse, undefined)
  assert.ok(has(dir, '.agents/skills/soutec-github-solo/SKILL.md'))
  assert.ok(!has(dir, '.agents/skills/soutec-github/SKILL.md'))
  assert.ok(has(dir, 'AGENTS.md'))
})

test('upgrade: un repo ya instalado recibe lo nuevo sin tocar lo que el equipo edito', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)
  // Simula un repo de antes de SHS-M48: sin nada de Codex ni Antigravity.
  for (const rel of ['AGENTS.md', '.codex', '.agents']) fs.rmSync(path.join(dir, rel), { recursive: true, force: true })
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  for (const dest of Object.keys(lock.files)) {
    if (dest === 'AGENTS.md' || dest.startsWith('.codex/') || dest.startsWith('.agents/')) delete lock.files[dest]
  }
  write(dir, '.claude/harness.json', JSON.stringify(lock, null, 2))
  const claudeMd = read(dir, 'CLAUDE.md') + '\n## Regla propia del equipo\n'
  write(dir, 'CLAUDE.md', claudeMd)

  assert.equal(await main(['upgrade', ...YES], dir), 0)

  assert.ok(has(dir, 'AGENTS.md'))
  assert.ok(has(dir, '.codex/hooks.json'))
  assert.ok(has(dir, '.agents/hooks.json'))
  assert.ok(has(dir, '.agents/skills/soutec-github/SKILL.md'))
  assert.equal(read(dir, 'CLAUDE.md'), claudeMd, 'el CLAUDE.md del equipo no se toca')
})

test('upgrade: un AGENTS.md o un hooks.json que ya existian no se pisan', async () => {
  const dir = mkRepo({
    'README.md': '',
    'AGENTS.md': '# Mis instrucciones para Codex\n',
    '.codex/hooks.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo fin' }] }] } }),
  })
  assert.equal(await main(['init', ...YES], dir), 0)

  // El AGENTS.md ajeno queda intacto; la propuesta del harness va al lado.
  assert.equal(read(dir, 'AGENTS.md'), '# Mis instrucciones para Codex\n')
  assert.ok(has(dir, 'AGENTS.md.new'))
  // El hooks.json se funde: lo del usuario se conserva y lo del harness se suma.
  const codex = JSON.parse(read(dir, '.codex/hooks.json'))
  assert.equal(codex.hooks.Stop[0].hooks[0].command, 'echo fin')
  assert.ok(codex.hooks.PreToolUse)
})

// --- Adaptador de Antigravity -------------------------------------------------

test('adaptador: traduce run_command al contrato de reglas-pr', () => {
  const entrada = { toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: '/repo/sub' } } }
  assert.deepEqual(entradaComoClaude(entrada, { plataforma: 'linux', raiz: '/repo' }), {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    cwd: '/repo/sub',
  })
  assert.equal(entradaComoClaude(entrada, { plataforma: 'win32', raiz: '/repo' }).tool_name, 'PowerShell')
})

test('adaptador: sin Cwd usa el workspace y, sin eso, la raiz del repo', () => {
  const llamada = { name: 'run_command', args: { CommandLine: 'ls' } }
  assert.equal(entradaComoClaude({ toolCall: llamada, workspacePaths: ['/ws'] }, { raiz: '/repo' }).cwd, '/ws')
  assert.equal(entradaComoClaude({ toolCall: llamada }, { raiz: '/repo' }).cwd, '/repo')
})

test('adaptador: un Cwd que no es cadena no tumba la revision', () => {
  const llamada = { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: { ruta: '/x' } } }
  assert.equal(entradaComoClaude({ toolCall: llamada, workspacePaths: [42] }, { raiz: '/repo' }).cwd, '/repo')
  assert.equal(entradaComoClaude({ toolCall: llamada, workspacePaths: ['/ws'] }, { raiz: '/repo' }).cwd, '/ws')
})

test('adaptador: otras tools y entradas rotas no producen nada', () => {
  assert.equal(entradaComoClaude({ toolCall: { name: 'view_file', args: {} } }), null)
  assert.equal(entradaComoClaude({ toolCall: { name: 'run_command', args: {} } }), null)
  assert.equal(entradaComoClaude({ toolCall: { name: 'run_command', args: { CommandLine: '   ' } } }), null)
  assert.equal(entradaComoClaude({}), null)
  assert.equal(entradaComoClaude(null), null)
})

test('adaptador: el deny bloquea y un aviso de "no se verifico" pregunta al usuario', () => {
  assert.deepEqual(
    salidaParaAntigravity({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } }),
    { decision: 'deny', reason: 'no' },
  )
  assert.equal(salidaParaAntigravity(null), null)
  assert.deepEqual(salidaParaAntigravity({ systemMessage: 'aviso' }), { decision: 'ask', reason: 'aviso' })
  assert.equal(salidaParaAntigravity({ hookSpecificOutput: { permissionDecision: 'allow' } }), null)
  // reglas-pr tambien puede pedir confirmacion (push ilegible o forzado).
  assert.deepEqual(
    salidaParaAntigravity({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'confirma' } }),
    { decision: 'ask', reason: 'confirma' },
  )
  assert.deepEqual(
    salidaParaAntigravity({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'confirma' }, systemMessage: 'sin validar' }),
    { decision: 'ask', reason: 'confirma\nsin validar' },
  )
})

test('adaptador: el texto del inicio de sesion va como paso inyectado', () => {
  assert.deepEqual(contextoParaAntigravity('  hola\n'), { injectSteps: [{ systemMessage: { systemMessage: 'hola' } }] })
  assert.equal(contextoParaAntigravity(''), null)
  assert.equal(contextoParaAntigravity(undefined), null)
})

// Integracion: el adaptador instalado en un repo real, con git de verdad.
function repoInstalado() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'souclaude m48 '))
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  for (const rel of ['.claude/hooks/reglas-pr.mjs', '.claude/hooks/declarar-milestone.mjs']) {
    write(dir, rel, fs.readFileSync(path.join(RAIZ, 'templates/base', rel.replace('.claude/', 'claude/')), 'utf8'))
  }
  write(dir, '.agents/hooks/souclaude-antigravity.mjs', fs.readFileSync(path.join(RAIZ, 'templates/base/agents/hooks/souclaude-antigravity.mjs'), 'utf8'))
  write(dir, 'README.md', 'x\n')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'chore: init')
  return dir
}

function adaptador(dir, modo, entrada) {
  // Entorno sin Vault: ni la config de la maquina del dev ni VAULT_PATH.
  const env = { ...process.env, VAULT_PATH: '', SOUCLAUDE_CLAUDE_HOME: process.env.SOUCLAUDE_CLAUDE_HOME }
  return spawnSync(process.execPath, [path.join(dir, '.agents/hooks/souclaude-antigravity.mjs'), modo], {
    cwd: dir,
    env,
    input: JSON.stringify(entrada),
    encoding: 'utf8',
  })
}

test('adaptador real: un push a main queda denegado con el formato de Antigravity', () => {
  const dir = repoInstalado()
  const r = adaptador(dir, 'reglas-pr', { toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: dir } } })
  assert.equal(r.status, 0)
  const salida = JSON.parse(r.stdout)
  assert.equal(salida.decision, 'deny')
  assert.match(salida.reason, /push a `main` denegado/)
})

test('adaptador real: un comando cualquiera pasa sin salida', () => {
  const dir = repoInstalado()
  const r = adaptador(dir, 'reglas-pr', { toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: dir } } })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('adaptador real: el inicio de sesion inyecta la regla de trazabilidad', () => {
  const dir = repoInstalado()
  const r = adaptador(dir, 'inicio-de-sesion', {})
  assert.equal(r.status, 0)
  const salida = JSON.parse(r.stdout)
  assert.match(salida.injectSteps[0].systemMessage.systemMessage, /Trazabilidad obligatoria/)
})

test('adaptador real: sin los hooks de .claude instalados no rompe la sesion', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'souclaude m48 '))
  write(dir, '.agents/hooks/souclaude-antigravity.mjs', fs.readFileSync(path.join(RAIZ, 'templates/base/agents/hooks/souclaude-antigravity.mjs'), 'utf8'))
  for (const modo of ['reglas-pr', 'inicio-de-sesion', 'modo-desconocido']) {
    const r = adaptador(dir, modo, { toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: dir } } })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

test('adaptador real: con el hook roto no deja pasar el push en silencio, pregunta', () => {
  const dir = repoInstalado()
  write(dir, '.claude/hooks/reglas-pr.mjs', 'export function procesar( {')
  const r = adaptador(dir, 'reglas-pr', { toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: dir } } })
  assert.equal(r.status, 0)
  const salida = JSON.parse(r.stdout)
  assert.equal(salida.decision, 'ask')
  assert.match(salida.reason, /no se verifico nada/)
})

test('adaptador real: un Cwd con forma inesperada no evita el deny', () => {
  const dir = repoInstalado()
  const r = adaptador(dir, 'reglas-pr', { toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main', Cwd: { x: 1 } } } })
  assert.equal(JSON.parse(r.stdout).decision, 'deny')
})
