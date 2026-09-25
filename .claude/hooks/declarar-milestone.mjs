// Hook SessionStart del harness (managed): trazabilidad por milestone.
//
// Todo trabajo de un agente pertenece a un milestone del Vault. Este hook
// inyecta al inicio de cada sesion el estado del tablero y la regla de
// declarar (o dar de alta) el milestone antes de trabajar. No valida ni
// bloquea: la sesion nunca se corta por el Vault — exit 0 siempre.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REGLA = [
  '[harness] Trazabilidad obligatoria: todo trabajo pertenece a un milestone del Vault.',
  'Antes de tocar codigo, declara al usuario sobre que milestone vas a trabajar.',
  'Si el pedido no corresponde a ningun milestone existente, da de alta uno en el',
  'Backlog (skill vault-milestones) antes de empezar. Protocolo: progress/README.md.',
]

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'))
  } catch {
    return null
  }
}

// Carpeta Project-<PREFIJO> del proyecto: la declarada en vault.local.json
// ("project") o, si hay una sola en el Vault, esa.
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

// Tarjetas por columna de un tablero kanban-plugin (una tarjeta = una linea).
function tablero(rutaMd) {
  let contenido
  try {
    contenido = fs.readFileSync(rutaMd, 'utf8')
  } catch {
    return null
  }
  const columnas = {}
  let actual = null
  for (const linea of contenido.split('\n')) {
    const titulo = linea.match(/^##\s+(.+?)\s*$/)
    if (titulo) {
      actual = titulo[1]
      columnas[actual] = []
    } else if (actual && /^- \[.\]/.test(linea.trim())) {
      columnas[actual].push(linea.trim())
    }
  }
  return columnas
}

// Refresco best-effort contra el remoto: con timeout corto y sin prompts de
// credenciales, para que un merge o un movimiento de tarjeta hecho en otra
// maquina se vea en esta sesion. Si no hay red, remoto o tiempo, devuelve
// false y el hook sigue con el estado local — la sesion jamas se corta.
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

// Asuntos de los commits ya mergeados al tronco del repo del proyecto. Antes
// de mirar los refs remotos locales se intenta un fetch (best-effort): sin el,
// un PR mergeado despues del ultimo fetch de la maquina es invisible.
function asuntosMergeados(root) {
  gitRefresco(['-C', root, 'fetch', 'origin', '--quiet'])
  const asuntos = []
  for (const ref of ['origin/dev', 'origin/main', 'origin/master']) {
    try {
      const salida = execFileSync('git', ['-C', root, 'log', '--format=%s', '-n', '300', ref], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      asuntos.push(...salida.split('\n'))
    } catch {
      // El ref no existe o git no esta disponible: se sigue con los demas.
    }
  }
  return asuntos
}

// Tarjetas "En review" del kanban cuyo "PR #N" ya aparece mergeado en el tronco
// (merge commit "Merge pull request #N" o squash "titulo (#N)").
function tarjetasConPrMergeado(root, enReview) {
  const conPr = enReview
    .map((tarjeta) => ({ tarjeta, pr: tarjeta.match(/PR\s*#(\d+)/)?.[1] }))
    .filter((t) => t.pr)
  if (conPr.length === 0) return []
  const asuntos = asuntosMergeados(root)
  return conPr.filter(({ pr }) => {
    const patron = new RegExp(`^Merge pull request #${pr}\\b|\\(#${pr}\\)`)
    return asuntos.some((asunto) => patron.test(asunto))
  })
}

// Aviso de tarjetas En review con PR ya mergeado. Devuelve lineas para la
// salida del hook; el hook solo detecta y ordena — mover la tarjeta (Vault
// primero, Jira despues) es del agente, que es quien puede espejar en Jira.
function seccionPrsMergeados(root, vaultPath, proyecto) {
  const columnas = tablero(path.join(vaultPath, proyecto, 'kanban.md'))
  const detectadas = tarjetasConPrMergeado(root, columnas?.['En review'] ?? [])
  if (detectadas.length === 0) return []
  const lineas = ['PRs ya mergeados con tarjeta todavia En review — muevelas a Hecho:']
  for (const { tarjeta, pr } of detectadas) lineas.push(`  ${tarjeta}  <- PR #${pr} mergeado`)
  lineas.push('Mueve cada tarjeta a Hecho en el kanban del Vault (push inmediato) y sincroniza Jira (skill jira-sync).')
  return lineas
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const salida = [...REGLA]

  const config = leerJson(path.join(root, '.claude', 'vault.local.json'))
  const vaultPath = config?.path ?? process.env.VAULT_PATH ?? null

  if (!vaultPath || !fs.existsSync(vaultPath)) {
    salida.push('Vault no configurado en esta maquina: pide el tablero al usuario antes de asumir.')
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

  const columnas = tablero(path.join(vaultPath, proyecto, 'milestones.md'))
  if (!columnas) {
    salida.push(`El Vault no tiene ${proyecto}/milestones.md legible: repórtalo al usuario.`)
    console.log(salida.join('\n'))
    return
  }

  const enCurso = columnas['En curso'] ?? []
  const backlog = columnas['Backlog'] ?? []
  salida.push(
    vaultAlDia
      ? `Tablero ${proyecto}/milestones.md (recien sincronizado con el remoto):`
      : `Tablero ${proyecto}/milestones.md (no se pudo sincronizar con el remoto — puede estar desactualizado: corre souclaude vault-sync):`,
  )
  salida.push(`En curso (${enCurso.length}):`)
  for (const tarjeta of enCurso) salida.push(`  ${tarjeta}`)
  if (enCurso.length === 0) salida.push('  (vacio)')
  salida.push(`Backlog: ${backlog.length} milestone(s) pendiente(s).`)

  try {
    salida.push(...seccionPrsMergeados(root, vaultPath, proyecto))
  } catch {
    // La deteccion de PRs mergeados es best-effort: sin git o sin kanban, nada.
  }

  console.log(salida.join('\n'))
}

try {
  main()
} catch {
  // Este hook jamas rompe una sesion: ante cualquier fallo, solo la regla.
  console.log(REGLA.join('\n'))
}
