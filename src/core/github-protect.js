import { execFileSync } from 'node:child_process'
import * as ui from '../ui.js'

// CLAUDE.md, regla dura: "main solo recibe merges desde dev", ningun push ni
// merge directo. Esto la hace cumplir a nivel de GitHub (no solo en el check
// de PR): sin esto, alguien con permiso de push igual podia pushear directo a
// main saltandose reglas-pr.yml por completo.
const RAMA_PROTEGIDA = 'main'
// Nombre del check tal como lo reporta GitHub Actions: el job de
// .github/workflows/reglas-pr.yml no declara "name:", asi que el check-run
// queda con el id del job ("reglas-pr"). Si ese job se renombra, esto se
// desincroniza y hay que actualizarlo a mano.
const CHECK_REQUERIDO = 'reglas-pr'

function sh(args, cwd, input) {
  return execFileSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
  }).trim()
}

function ghDisponible(cwd) {
  try {
    sh(['gh', 'auth', 'status'], cwd, '')
    return true
  } catch {
    return false
  }
}

function repoRemoto(cwd) {
  try {
    return sh(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd, '')
  } catch {
    return null
  }
}

function ramaExiste(cwd, repo) {
  try {
    sh(['gh', 'api', `repos/${repo}/branches/${RAMA_PROTEGIDA}`], cwd, '')
    return true
  } catch {
    return false
  }
}

// Exige PR para tocar main (bloquea push directo), sin aprobaciones
// obligatorias -- la skill soutec-github ya dice "nadie aprueba lo suyo", asi
// que pedir 1 approval seria una regla que el propio equipo no puede cumplir
// -- con el check reglas-pr en verde, sin force-push ni borrado de la rama.
// enforce_admins: true para que la regla alcance tambien a administradores.
function cuerpoProteccion() {
  return JSON.stringify({
    required_status_checks: { strict: true, checks: [{ context: CHECK_REQUERIDO }] },
    enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: 0 },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  })
}

// Siempre activa, sin preguntar (decision explicita del usuario): a
// diferencia de vaultStep, esto no es una escritura local reversible por git,
// pero SOUTEC ya decidio que la regla "main solo desde dev" es no-negociable,
// asi que hacerla cumplir en GitHub tampoco lo es. No rompe init/upgrade si
// falla: se reporta y se sigue (mismo criterio que jira-sync cuando el
// conector no esta autorizado).
export function protegeBranchMain({ cwd }) {
  if (!ghDisponible(cwd)) {
    ui.log.warn(
      'gh no esta instalado o no esta autenticado: no se pudo configurar la proteccion de main. ' +
        'Corre `gh auth login` y reintenta con `souclaude upgrade`.'
    )
    return { aplicado: false }
  }

  const repo = repoRemoto(cwd)
  if (!repo) {
    ui.log.warn('No se pudo resolver el repo de GitHub (sin remoto o sin permisos): proteccion de main no configurada.')
    return { aplicado: false }
  }

  if (!ramaExiste(cwd, repo)) {
    ui.log.info(`"${RAMA_PROTEGIDA}" todavia no existe en ${repo}: proteccion de main queda pendiente para cuando exista.`)
    return { aplicado: false }
  }

  try {
    sh(
      ['gh', 'api', '-X', 'PUT', `repos/${repo}/branches/${RAMA_PROTEGIDA}/protection`, '--input', '-'],
      cwd,
      cuerpoProteccion()
    )
    ui.log.success(`Branch protection de "${RAMA_PROTEGIDA}" en ${repo}: PR obligatorio + check "${CHECK_REQUERIDO}" en verde.`)
    return { aplicado: true }
  } catch (err) {
    ui.log.warn(
      `No se pudo configurar la proteccion de "${RAMA_PROTEGIDA}" en ${repo} (falta permiso de admin en el repo?): ${err.message}`
    )
    return { aplicado: false }
  }
}
