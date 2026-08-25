import { execFileSync } from 'node:child_process'
import * as ui from '../ui.js'
import { computePlan, writeActions, OBSOLETE, NOOP, LOCAL_EDIT } from '../core/plan.js'
import { apply } from '../core/apply.js'
import { ensureVault } from '../core/vault.js'
import { protegeBranchMain } from '../core/github-protect.js'

// execFile con args en array: nunca pasa por el shell, asi que las rutas con
// espacios (todo OneDrive) dejan de ser un problema.
export function gitUserName(cwd) {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8' }).trim() || null
  } catch {
    return null
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
// Las required del catalogo (soutec-github) entran siempre, elija lo que elija.
export async function resolveSkills({ flags, lock, manifest, yes }) {
  const catalog = manifest.skills ?? []
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

// El nucleo compartido por init y upgrade: son el mismo code path. Lo unico que
// cambia entre "repo vacio", "repo legacy" y "migrar del harness viejo" es que
// encuentra computePlan en disco y en el lockfile.
export async function planAndApply({ manifest, cwd, lock, vars, detected, flags, title }) {
  const force = Boolean(flags.force)
  const yes = Boolean(flags.yes) || ui.isCI()
  const skills = await resolveSkills({ flags, lock, manifest, yes })
  const plan = computePlan({ manifest, cwd, lock, vars, detected, force, skills })

  ui.renderPlan(plan, { verbose: Boolean(flags.verbose) })

  const pending = writeActions(plan.actions)
  const obsolete = plan.actions.filter((a) => a.verdict === OBSOLETE)

  if (!pending.length && !obsolete.length) {
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

  // P5: --prune borra archivos. Es destructivo, exige una segunda confirmacion
  // explicita y --yes NO alcanza. Hay que tipear la palabra.
  let prune = false
  if (obsolete.length && flags.prune) {
    prune = await ui.confirmDestructive({
      message: `Se van a BORRAR ${obsolete.length} archivo(s) obsoleto(s):\n${obsolete.map((a) => `    ${a.dest}`).join('\n')}`,
      word: 'BORRAR',
    })
    if (!prune) ui.log.warn('Prune cancelado. Los archivos obsoletos quedan donde estan.')
  }

  const result = apply({
    plan,
    cwd,
    manifest,
    vars,
    detected,
    lock,
    prune,
    backup: flags.backup !== false,
  })

  report(result, plan, manifest)
  return 0
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
  await ensureVault({ cwd, flags, manifest, lock, yes })
  return 0
}

// Siempre activa, sin pedir confirmacion: "main solo recibe merges desde dev"
// es una regla dura de CLAUDE.md/soutec-github, no una preferencia opcional.
// Igual que vaultStep, corre solo si el plan se aplico y nunca en --dry-run
// (no toca nada fuera del repo local). Si gh no esta disponible o falla, se
// reporta y el resto de init/upgrade sigue: nunca bloquea la instalacion.
export function githubProtectionStep({ code, cwd, flags }) {
  if (code !== 0) return code
  if (flags['dry-run']) return code
  protegeBranchMain({ cwd })
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
