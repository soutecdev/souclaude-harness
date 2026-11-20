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
//   - Se bloquea con { "decision": "deny", "reason": "..." } por stdout; con
//     "ask" se le pregunta al usuario.
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
    // Solo cadenas: un Cwd con otra forma no debe tumbar la revision.
    cwd: [llamada.args?.Cwd, entrada.workspacePaths?.[0]].find((c) => typeof c === 'string' && c) ?? raiz,
  }
}

// Salida de reglas-pr (contrato de Claude Code) -> salida de Antigravity.
//   - deny            -> decision "deny": el comando no corre.
//   - ask             -> decision "ask": reglas-pr no puede leer el destino del
//     push (o es un push forzado) y le deja la decision al usuario.
//   - systemMessage   -> decision "ask": reglas-pr avisa que NO pudo verificar
//     (sin el script de checks, error interno). En Claude Code ese aviso se le
//     muestra al usuario; aca no hay canal equivalente, asi que se le pregunta
//     en vez de dejar pasar el comando en silencio.
// reglas-pr nunca emite "allow": sin salida, el comando sigue su curso normal.
export function salidaParaAntigravity(salida) {
  const decision = salida?.hookSpecificOutput
  if (decision?.permissionDecision === 'deny') {
    return { decision: 'deny', reason: String(decision.permissionDecisionReason ?? 'reglas-pr denego el comando.') }
  }
  const aviso = typeof salida?.systemMessage === 'string' ? salida.systemMessage : ''
  if (decision?.permissionDecision === 'ask') {
    const motivo = String(decision.permissionDecisionReason ?? 'reglas-pr pide confirmar el comando.')
    return { decision: 'ask', reason: aviso ? `${motivo}\n${aviso}` : motivo }
  }
  if (aviso) return { decision: 'ask', reason: aviso }
  return null
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
  try {
    const { procesar } = await import(pathToFileURL(hook).href)
    return salidaParaAntigravity(procesar(entrada))
  } catch (e) {
    // Igual que el hook original ante un error interno: no bloquea, pero avisa.
    const motivo = String(e?.message ?? e).split('\n')[0]
    return { decision: 'ask', reason: `reglas-pr: error interno del hook (${motivo}); no se verifico nada.` }
  }
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
  // Se sale recien cuando la salida termino de escribirse: un motivo largo no
  // puede quedar cortado a medio JSON.
  if (salida) process.stdout.write(JSON.stringify(salida), () => process.exit(0))
  else process.exit(0)
}

// Este archivo es el script que se esta ejecutando (y no un import desde los
// tests)? Igual que en reglas-pr.mjs, se comparan rutas REALES: si el proyecto
// se abre por una ruta con un enlace simbolico, import.meta.url y
// process.argv[1] difieren, y comparados tal cual el adaptador terminaba sin
// hacer nada y con exit 0.
export function esPuntoDeEntrada(urlDelModulo, argv1 = process.argv[1], plataforma = process.platform) {
  if (!argv1) return false
  const real = (ruta) => {
    try {
      return fs.realpathSync.native(ruta)
    } catch {
      return path.resolve(ruta)
    }
  }
  const [modulo, entrada] = [real(fileURLToPath(urlDelModulo)), real(argv1)]
  return plataforma === 'win32' ? modulo.toLowerCase() === entrada.toLowerCase() : modulo === entrada
}

if (esPuntoDeEntrada(import.meta.url)) {
  main()
}
