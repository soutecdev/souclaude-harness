// Hook SessionStart del harness en modo solo (managed): traza por worklog.
//
// En modo solo no hay milestones que declarar: la trazabilidad es una linea
// por bloque de trabajo en Project-<PREFIJO>/worklog.md del Vault, pusheada al
// momento de empezar el bloque. Este hook inyecta la regla y las ultimas
// lineas del worklog para retomar contexto. No valida ni bloquea: la sesion
// nunca se corta por el Vault — exit 0 siempre.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REGLA = [
  '[harness] Modo solo: la trazabilidad vive en Project-<PREFIJO>/worklog.md del Vault.',
  'Al empezar cada bloque de trabajo agrega al final una linea con fecha y objetivo',
  '("- 2026-09-15 · migrando auth a OAuth") y pushea en el momento',
  '(souclaude vault-sync --push -m "docs: worklog" --paths Project-<PREFIJO>).',
  'Si el objetivo cambia, otra linea.',
]

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'))
  } catch {
    return null
  }
}

// Carpeta Project-<PREFIJO> del proyecto: la declarada en vault.local.json
// ("project") o, si hay una sola en el Vault, esa. Mismo criterio que el hook
// declarar-milestone.mjs del modo equipo.
function carpetaProyecto(vaultPath, config) {
  if (config?.project) return config.project
  try {
    const carpetas = fs
      .readdirSync(vaultPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('Project-'))
      .map((d) => d.name)
    return carpetas.length === 1 ? carpetas[0] : null
  } catch {
    return null
  }
}

// Refresco best-effort contra el remoto, con timeout corto y sin prompts de
// credenciales. Si no hay red o remoto, se lee el estado local y ya.
const REFRESCO_TIMEOUT_MS = 5000

function gitRefresco(args) {
  try {
    execFileSync('git', args, {
      stdio: 'ignore',
      timeout: REFRESCO_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return true
  } catch {
    return false
  }
}

// Ultimas lineas de traza del worklog (las viñetas "- ..."), para retomar el
// contexto del trabajo anterior. null = el archivo no existe.
const ULTIMAS = 5

function ultimasLineasWorklog(rutaMd) {
  let contenido
  try {
    contenido = fs.readFileSync(rutaMd, 'utf8')
  } catch {
    return null
  }
  const lineas = contenido
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
  return lineas.slice(-ULTIMAS)
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const salida = [...REGLA]

  const config = leerJson(path.join(root, '.claude', 'vault.local.json'))
  const vaultPath = config?.path ?? process.env.VAULT_PATH ?? null

  if (!vaultPath || !fs.existsSync(vaultPath)) {
    salida.push('Vault no configurado en esta maquina: no hay worklog que leer — pide el contexto al usuario.')
    console.log(salida.join('\n'))
    return
  }

  // El Vault se actualiza antes de leerlo (pull solo fast-forward: si el clon
  // local divergio, no se toca nada y se lee tal cual esta).
  const vaultAlDia = gitRefresco(['-C', vaultPath, 'pull', '--ff-only', '--quiet'])

  const proyecto = carpetaProyecto(vaultPath, config)
  if (!proyecto) {
    salida.push('No se pudo determinar la carpeta Project-<PREFIJO> del Vault: pregunta al usuario cual es.')
    console.log(salida.join('\n'))
    return
  }

  const lineas = ultimasLineasWorklog(path.join(vaultPath, proyecto, 'worklog.md'))
  if (lineas == null) {
    salida.push(
      `${proyecto}/worklog.md no existe todavia: crealo con la linea del primer bloque (npx souclaude upgrade tambien lo siembra).`
    )
  } else {
    salida.push(
      vaultAlDia
        ? `Ultimas lineas de ${proyecto}/worklog.md (recien sincronizado con el remoto):`
        : `Ultimas lineas de ${proyecto}/worklog.md (no se pudo sincronizar con el remoto — puede estar desactualizado):`
    )
    if (lineas.length === 0) salida.push('  (vacio: este es el primer bloque de trabajo)')
    for (const l of lineas) salida.push(`  ${l}`)
  }

  console.log(salida.join('\n'))
}

try {
  main()
} catch {
  // Este hook jamas rompe una sesion: ante cualquier fallo, solo la regla.
  console.log(REGLA.join('\n'))
}
