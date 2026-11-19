#!/usr/bin/env node
// Adaptador de los hooks del harness para Antigravity (SHS-M48, en prueba).
//
// La logica de los hooks vive UNA sola vez, en `.claude/hooks/` (reglas-pr.mjs,
// declarar-milestone.mjs, worklog-solo.mjs), escrita contra el contrato de
// Claude Code. Codex usa ese mismo contrato y los invoca directo. Antigravity
// usa otro: este archivo solo traduce la entrada y la salida, no decide nada.
//
//   node .agents/hooks/souclaude-antigravity.mjs reglas-pr          (PreToolUse)
//   node .agents/hooks/souclaude-antigravity.mjs inicio-de-sesion   (SessionStart)
//
// Contrato de Antigravity (antigravity.google/docs/hooks):
//   - PreToolUse recibe por stdin { toolCall: { name, args }, workspacePaths, ... };
//     la tool de terminal es `run_command` y el comando va en args.CommandLine.
//   - Se bloquea con { "decision": "deny", "reason": "..." } por stdout.
//   - SessionStart inyecta contexto con { "injectSteps": [{ "systemMessage": ... }] }.
//
// Igual que los hooks originales, este adaptador jamas rompe una sesion: ante
// cualquier fallo propio sale con codigo 0 y sin salida.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TOOL_TERMINAL = 'run_command'

// Raiz del repo: este archivo vive en <raiz>/.agents/hooks/.
export function raizDelRepo(archivo = fileURLToPath(import.meta.url)) {
  return path.resolve(path.dirname(archivo), '..', '..')
}

// Entrada de PreToolUse de Antigravity -> entrada de PreToolUse de Claude Code.
// Devuelve null si la llamada no es un comando de terminal: nada que revisar.
export function entradaComoClaude(entrada, { plataforma = process.platform, raiz = raizDelRepo() } = {}) {
  const llamada = entrada?.toolCall
  if (llamada?.name !== TOOL_TERMINAL) return null
  const comando = llamada.args?.CommandLine
  if (typeof comando !== 'string' || !comando.trim()) return null
  return {
    hook_event_name: 'PreToolUse',
    // reglas-pr interpreta el comando segun el shell; en Windows, Antigravity
    // corre la terminal en PowerShell.
    tool_name: plataforma === 'win32' ? 'PowerShell' : 'Bash',
    tool_input: { command: comando },
    cwd: llamada.args?.Cwd || entrada.workspacePaths?.[0] || raiz,
  }
}

// Salida de reglas-pr (contrato de Claude Code) -> salida de Antigravity.
// Solo el deny se traduce: reglas-pr nunca emite "allow", y un aviso sin
// bloqueo no tiene equivalente documentado en PreToolUse.
export function salidaParaAntigravity(salida) {
  const decision = salida?.hookSpecificOutput
  if (decision?.permissionDecision !== 'deny') return null
  return { decision: 'deny', reason: String(decision.permissionDecisionReason ?? 'reglas-pr denego el comando.') }
}

// Texto del hook de inicio de sesion -> pasos inyectados de Antigravity.
export function contextoParaAntigravity(texto) {
  const limpio = String(texto ?? '').trim()
  if (!limpio) return null
  return { injectSteps: [{ systemMessage: { systemMessage: limpio } }] }
}

function leerEntrada() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

async function reglasPr(raiz) {
  const entrada = entradaComoClaude(leerEntrada(), { raiz })
  if (!entrada) return null
  const hook = path.join(raiz, '.claude', 'hooks', 'reglas-pr.mjs')
  if (!fs.existsSync(hook)) return null
  const { procesar } = await import(pathToFileURL(hook).href)
  return salidaParaAntigravity(procesar(entrada))
}

// Equipo: declarar-milestone. Solo: worklog-solo. Se usa el que este instalado.
function inicioDeSesion(raiz) {
  const hook = ['declarar-milestone.mjs', 'worklog-solo.mjs']
    .map((nombre) => path.join(raiz, '.claude', 'hooks', nombre))
    .find((ruta) => fs.existsSync(ruta))
  if (!hook) return null
  const r = spawnSync(process.execPath, [hook], {
    cwd: raiz,
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz },
    encoding: 'utf8',
    timeout: 50_000,
    windowsHide: true,
  })
  return contextoParaAntigravity(r.stdout)
}

async function main() {
  const raiz = raizDelRepo()
  const modo = process.argv[2]
  let salida = null
  try {
    if (modo === 'reglas-pr') salida = await reglasPr(raiz)
    else if (modo === 'inicio-de-sesion') salida = inicioDeSesion(raiz)
  } catch {
    // Un fallo del adaptador no bloquea ni rompe la sesion.
    salida = null
  }
  if (salida) process.stdout.write(JSON.stringify(salida))
  process.exit(0)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
