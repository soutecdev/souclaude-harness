import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as ui from '../ui.js'
import { computePlan, writeActions, MODOS, OBSOLETE, NOOP, LOCAL_EDIT, CONFLICT } from '../core/plan.js'
import { readLockfile, writeLockfile } from '../core/lockfile.js'
import { apply } from '../core/apply.js'
import { ensureVault } from '../core/vault.js'
import { protegeBranchMain } from '../core/github-protect.js'
import { instalarCliGlobal } from '../core/cli-global.js'

// execFile con args en array: nunca pasa por el shell, asi que las rutas con
// espacios (todo OneDrive) dejan de ser un problema.
export function gitUserName(cwd) {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

// SHS-M53: donde se instala. Dentro de un repo git, solo en la raiz: los hooks,
// .github/ y el lockfile se resuelven contra ella, y un harness en un
// subdirectorio queda a medias sin que nada lo avise. Fuera de un repo se
// instala igual (el proyecto desde cero corre `git init` antes o despues),
// pero se dice. Solo en init y adopt: una instalacion existente no se bloquea.
export function revisarCarpeta(cwd) {
  let raiz = null
  try {
    raiz = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    raiz = null
  }
  if (!raiz) {
    if (!fs.existsSync(path.join(cwd, '.git'))) {
      ui.log.warn(
        'Esta carpeta no es un repo git: el harness se instala igual, pero el flujo de ramas, los hooks y la ' +
          'proteccion de main no aplican hasta que corras `git init -b main` y conectes el remoto.'
      )
    }
    return
  }
  const real = (p) => {
    try {
      return fs.realpathSync.native(p)
    } catch {
      return path.resolve(p)
    }
  }
  const [a, b] = [real(raiz), real(cwd)]
  const iguales = process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  if (!iguales) {
    throw new Error(
      `Esta carpeta es un subdirectorio del repo ${raiz}. El harness se instala en la raiz del repo: ` +
        'repite el comando desde ahi. No se escribio nada.'
    )
  }
}

const TYPES = ['backend', 'frontend', 'data', 'ml', 'automation', 'infra', 'integration']

export async function resolveVars({ flags, lock, detected, cwd, manifest }) {
  const prev = lock?.vars ?? {}
  const yes = Boolean(flags.yes) || ui.isCI()

  const projectName =
    flags.name ?? prev.PROJECT_NAME ?? (await ui.text({
      message: 'Nombre del proyecto',
      initialValue: detected.projectName,
      yes,
    }))

  const projectType =
    flags.type ?? prev.PROJECT_TYPE ?? (await ui.select({
      message: 'Tipo de proyecto',
      options: TYPES.map((t) => ({ value: t, label: t })),
      initialValue: 'backend',
      yes,
    }))

  const stack = flags.stack ?? prev.STACK ?? detected.stackLabel

  const langFlag = flags.lang ?? (prev.LANGUAGE === 'ingles' ? 'en' : prev.LANGUAGE ? 'es' : null)
  const lang =
    langFlag ?? (await ui.select({
      message: 'Idioma en el que Claude responde',
      options: [
        { value: 'es', label: 'espanol' },
        { value: 'en', label: 'ingles' },
      ],
      initialValue: 'es',
      yes,
    }))

  return {
    PROJECT_NAME: projectName,
    PROJECT_TYPE: projectType,
    STACK: stack,
    // La herramienta que hace cumplir la regla de dependencias de P2 en CI. Sale del
    // stack detectado: sin nombrarla, P2 queda como buena intencion.
    ARCH_ENFORCER: flags.enforcer ?? prev.ARCH_ENFORCER ?? detected.enforcer,
    LANGUAGE: lang === 'en' ? 'ingles' : 'espanol',
    // URL del Vault: es de organizacion, identica en toda maquina, asi que puede
    // vivir en el lockfile commiteado. La RUTA local no: esa va a
    // .claude/vault.local.json, que esta gitignorado (ver core/vault.js).
    VAULT_REPO: flags['vault-repo'] ?? prev.VAULT_REPO ?? manifest.vault?.repo ?? null,
    OWNER: prev.OWNER ?? gitUserName(cwd) ?? 'por definir',
    // Sticky, como OWNER: es la fecha de instalacion de un archivo user-owned
    // (CLAUDE.md, constitution.md), sembrada una vez. Si se recalculara en cada
    // corrida, un simple cambio de dia haria que el motor viera "el template
    // cambio" y generara un .new espurio sin que nada real haya cambiado.
    DATE: prev.DATE ?? new Date().toISOString().slice(0, 10),
    HARNESS_VERSION: manifest.harnessVersion,
  }
}

// Que skills se instalan. Prioridad: --skills explicito > seleccion guardada en
// el lockfile (sticky, como las vars) > checkbox interactivo con todas marcadas.
// Las required del catalogo del modo (soutec-github en equipo, soutec-github-solo
// en solo) entran siempre, elija lo que elija. El catalogo se filtra por modo:
// las skills del otro modo ni se ofrecen ni se aceptan por flag.
export async function resolveSkills({ flags, lock, manifest, yes, modo = 'equipo' }) {
  const catalog = (manifest.skills ?? []).filter((s) => !s.modos || s.modos.includes(modo))
  if (!catalog.length) return undefined

  if (flags.skills != null) {
    const chosen = String(flags.skills).split(',').map((s) => s.trim()).filter(Boolean)
    const known = new Set(catalog.map((s) => s.id))
    const unknown = chosen.filter((id) => !known.has(id))
    if (unknown.length) {
      throw new Error(`--skills: skill(s) desconocida(s): ${unknown.join(', ')}. Disponibles: ${[...known].join(', ')}`)
    }
    return chosen
  }

  if (lock?.skills) return lock.skills

  const optional = catalog.filter((s) => !s.required)
  const requiredLabels = catalog.filter((s) => s.required).map((s) => s.id).join(', ')
  return ui.multiselect({
    message: `Skills a instalar (${requiredLabels} es obligatoria y se instala siempre)`,
    options: optional.map((s) => ({ value: s.id, label: s.label ?? s.id })),
    initialValues: optional.map((s) => s.id),
    yes,
  })
}

// Modo de trabajo del repo (SHS-M34). Prioridad: flag explicito > modo guardado
// en el lockfile (sticky, como skills) > pregunta con default equipo. Un lockfile
// sin campo modo (o con un valor invalido) cae a la pregunta: asi una instalacion
// existente elige modo en su primer upgrade; en no interactivo el default es
// equipo, para no cambiar el comportamiento de las automatizaciones.
export async function resolveModo({ flags, lock, yes }) {
  if (flags.solo && flags.equipo) {
    throw new Error('--solo y --equipo son excluyentes: elige un solo modo')
  }
  if (flags.solo) return 'solo'
  if (flags.equipo) return 'equipo'
  if (MODOS.includes(lock?.modo)) return lock.modo
  return ui.select({
    message: 'Modo de trabajo del repo',
    options: [
      { value: 'equipo', label: 'equipo — metodologia completa: milestones, PRs y espejo del tablero' },
      { value: 'solo', label: 'solo — single coder: Git fluido, sin validacion de PR, traza minima en el Vault' },
    ],
    initialValue: 'equipo',
    yes,
  })
}

// El nucleo compartido por init y upgrade: son el mismo code path. Lo unico que
// cambia entre "repo vacio", "repo legacy" y "migrar del harness viejo" es que
// encuentra computePlan en disco y en el lockfile.
// `prompts` (default: el modulo real de UI) se puede inyectar en tests para
// ejercer las confirmaciones escritas sin una TTY, igual que en ensureVault.
export async function planAndApply({ manifest, cwd, lock, vars, detected, flags, title, prompts = ui }) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes) || ui.isCI()
  // El modo se resuelve ANTES que las skills: el catalogo que se ofrece y se
  // valida es el del modo elegido.
  const modo = await resolveModo({ flags, lock, yes })
  ui.log.info(`Modo de trabajo: ${modo}`)
  const skills = await resolveSkills({ flags, lock, manifest, yes, modo })
  let plan = computePlan({ manifest, cwd, lock, vars, detected, force, skills, modo })

  // --force pisa EN EL LUGAR archivos que el usuario edito. El README ("La
  // garantia") y el --help prometen para eso una confirmacion escrita que no
  // existia: bastaba `upgrade --force --yes` -- al alcance de un agente -- para
  // sobrescribir trabajo del usuario. Mismo criterio que BORRAR: hay que tipear
  // la palabra, --yes NUNCA la implica y en CI se deniega. Sin confirmacion, el
  // plan vuelve a ser el de siempre: nada se pisa, la propuesta queda en .new.
  const pisados = plan.actions.filter((a) => a.verdict === CONFLICT && a.writePath === a.dest)
  if (force && pisados.length && !flags['dry-run']) {
    const respaldo = flags.backup !== false ? 'queda backup en .claude/backup-<fecha>/' : 'SIN backup: pasaste --no-backup'
    const confirmado = await prompts.confirmDestructive({
      message: `--force va a SOBRESCRIBIR ${pisados.length} archivo(s) que editaste (${respaldo}):\n${pisados.map((a) => `    ${a.dest}`).join('\n')}`,
      word: 'FORCE',
    })
    if (!confirmado) {
      ui.log.warn('--force sin confirmar: esos archivos no se pisan. La propuesta del harness queda al lado, en .new.')
      plan = computePlan({ manifest, cwd, lock, vars, detected, force: false, skills, modo })
    }
  }

  ui.renderPlan(plan, { verbose: Boolean(flags.verbose) })
  avisarIgnorados(plan)

  const pending = writeActions(plan.actions)
  const obsolete = plan.actions.filter((a) => a.verdict === OBSOLETE)

  if (!pending.length && !obsolete.length) {
    // Sin cambios de archivos, la decision del modo se persiste igual (salvo en
    // --dry-run): si no, el upgrade de una instalacion existente ya al dia
    // preguntaria el modo en cada corrida sin guardarlo jamas.
    if (lock && plan.modo !== lock.modo && !flags['dry-run']) {
      writeLockfile(cwd, { ...lock, modo: plan.modo })
      ui.log.info(`Modo de trabajo persistido: ${plan.modo}`)
    }
    ui.outro(`Ya estas en harness v${manifest.harnessVersion}. Nada que hacer.`)
    return 0
  }

  if (flags['dry-run']) {
    ui.outro('--dry-run: no se escribio ni un byte.')
    return 0
  }

  const ok = await ui.confirm({ message: `${title}: aplicar ${pending.length} cambio(s)?`, initialValue: true, yes })
  if (!ok) {
    ui.cancelled()
    return 1
  }

  // P6: --prune borra archivos. Los obsoletos intactos desde que el harness los
  // escribio (autoPrune) se borran sin preguntar -- es contenido del harness, no
  // del usuario. Los que el usuario edito exigen la segunda confirmacion escrita
  // de siempre, y --yes NUNCA la implica.
  const prune = Boolean(flags.prune && obsolete.length)
  const editedObsolete = obsolete.filter((a) => !a.autoPrune)
  let pruneEdited = false
  if (prune && editedObsolete.length) {
    pruneEdited = await prompts.confirmDestructive({
      message: `Se van a BORRAR ${editedObsolete.length} archivo(s) obsoleto(s) que editaste:\n${editedObsolete.map((a) => `    ${a.dest}`).join('\n')}`,
      word: 'BORRAR',
    })
    if (!pruneEdited) ui.log.warn('Prune de los editados cancelado. Esos archivos quedan donde estan.')
  }

  const result = apply({
    plan,
    cwd,
    manifest,
    vars,
    detected,
    lock,
    prune,
    pruneEdited,
    backup: flags.backup !== false,
  })

  report(result, plan, manifest)
  reportSkippedByStack(plan)
  return 0
}

// Claves del lockfile que no son una ruta relativa dentro del repo (ver
// esDestSeguro): el motor no las toca y desaparecen del lockfile en la proxima
// escritura. Se avisa porque un lockfile asi no lo escribio el harness.
export function avisarIgnorados(plan) {
  if (!plan.ignorados?.length) return
  ui.log.warn(
    [
      '.claude/harness.json trae rutas que no pertenecen a este repo. Se ignoran (no se leen ni se borran):',
      ...plan.ignorados.map((i) => `    ${i.dest} (${i.motivo})`),
      'Revisa quien modifico el lockfile: el harness nunca escribe rutas absolutas ni con "..".',
    ].join('\n')
  )
}

// SHS-M28: entries con "when": "stack:<id>" (ej. tag-release, atado a Node) no
// se instalan si el repo no trae esa senal. No es un error -- es la senal de que
// el agente tiene que generar el equivalente para el stack real del proyecto,
// siguiendo la instruccion de la skill harness-upgrade.
function reportSkippedByStack(plan) {
  if (!plan.skippedByStack?.length) return
  ui.log.warn(
    [
      'No se instalaron por stack (requieren un lenguaje/runtime que este repo no tiene):',
      ...plan.skippedByStack.map((s) => `    ${s.dest} (requiere stack: ${s.stack})`),
      '',
      'Ver skill harness-upgrade -- seccion "Tag-release fuera de Node" -- para generar',
      'el equivalente segun el stack real del proyecto.',
    ].join('\n')
  )
}

// El paso del Vault corre DESPUES de planAndApply y fuera del motor de plan a
// proposito: .claude/vault.local.json no es un archivo del harness sino config
// de esta maquina, y apply() bloquea (write guard) toda escritura que no salga
// del plan que el usuario confirmo. Si el plan se cancelo o fallo, no se toca
// nada: no dejamos media configuracion.
export async function vaultStep({ code, cwd, flags, manifest, lock }) {
  if (code !== 0) return code
  // --dry-run no escribe ni un byte, y eso incluye la config del Vault.
  if (flags['dry-run']) return code
  const yes = Boolean(flags.yes) || ui.isCI()
  // El modo se relee fresco del lockfile: `lock` es la foto de ANTES del plan
  // (null en un init) y apply acaba de persistir el modo elegido. La siembra
  // del Vault depende de el (worklog.md solo en modo solo, SHS-M34).
  const modo = readLockfile(cwd)?.modo ?? lock?.modo ?? 'equipo'
  await ensureVault({ cwd, flags, manifest, lock, yes, modo })
  return 0
}

// Siempre activa en modo equipo, sin pedir confirmacion: "main solo recibe
// merges desde dev" es una regla dura de CLAUDE.md/soutec-github, no una
// preferencia opcional. En modo solo NO corre: el flujo del modo ES mergear
// directo a main (SHS-M34) y proteger la rama dejaria al dueño afuera de su
// propio flujo. Igual que vaultStep, corre solo si el plan se aplico y nunca
// en --dry-run (no toca nada fuera del repo local). Si gh no esta disponible o
// falla, se reporta y el resto de init/upgrade sigue: nunca bloquea la
// instalacion. `protege` es inyectable para testear el corte por modo.
export function githubProtectionStep({ code, cwd, flags, protege = protegeBranchMain }) {
  if (code !== 0) return code
  if (flags['dry-run']) return code
  // Opt-out explicito: protegeBranchMain hace un PUT que REEMPLAZA la proteccion
  // existente (aprobaciones requeridas, revision de CODEOWNERS, otros checks
  // obligatorios). Un repo cuya proteccion administra la organizacion, o que ya
  // tiene reglas mas estrictas, tiene que poder decir que no.
  if (flags['github-protect'] === false) {
    ui.log.info('--no-github-protect: no se toca la proteccion de main en GitHub.')
    return code
  }
  if ((readLockfile(cwd)?.modo ?? 'equipo') === 'solo') {
    ui.log.info('Modo solo: no se configura branch protection de main.')
    return code
  }
  protege({ cwd })
  return code
}

// SHS-M21 / SHS-M35-T004: deja el CLI global instalado y al dia (npm install
// -g desde GitHub) para que `souclaude vault-sync` y `souclaude monitor`
// funcionen desde cualquier terminal. Se hace solo, tambien con --yes; en CI
// exige --cli-global. Igual que los otros pasos post-plan: nunca corre en
// --dry-run y nunca bloquea la instalacion si falla.
export async function cliGlobalStep({ code, flags, manifest }) {
  if (code !== 0) return code
  if (flags['dry-run']) return code
  await instalarCliGlobal({ manifest, flags })
  return code
}

function report(result, plan, manifest) {
  const news = result.written.filter((w) => w.dest.endsWith('.new'))
  const touched = plan.actions.filter((a) => a.verdict === LOCAL_EDIT)
  const kept = plan.actions.filter((a) => a.verdict === NOOP).length

  ui.log.success(`${result.written.length} archivo(s) escrito(s). ${kept} sin cambios.`)

  if (result.backupRoot) {
    ui.log.info(`Backup de lo sobrescrito en ${result.backupRoot.split(/[\\/]/).slice(-2).join('/')}`)
  }
  if (result.removed.length) {
    ui.log.warn(`Borrados: ${result.removed.join(', ')}`)
  }
  if (touched.length) {
    ui.log.info(`Respetados (los editaste tú, el template no cambio): ${touched.map((a) => a.dest).join(', ')}`)
  }

  if (news.length) {
    ui.log.warn(
      [
        `${news.length} archivo(s) NO fueron sobrescritos. La propuesta del harness quedo al lado, en .new:`,
        ...news.map((w) => `    ${w.dest}`),
        '',
        'Compara y mergea a mano. Por ejemplo:',
        `    git diff --no-index ${news[0].dest.replace(/\.new$/, '')} ${news[0].dest}`,
      ].join('\n')
    )
  }

  ui.outro(`Harness v${manifest.harnessVersion} listo.`)
}
