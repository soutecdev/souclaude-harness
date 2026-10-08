import path from 'node:path'
import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { resolveDetected } from '../core/detect.js'
import { readLockfile } from '../core/lockfile.js'
import { readIfExists } from '../core/fsx.js'
import { computePlan, writeActions, NOOP, LOCAL_EDIT } from '../core/plan.js'
import { avisoCliDesactualizado } from '../core/version-remota.js'
import { resolveVars } from './_shared.js'

// Claves que Claude Code ignora en silencio. Estaban en el Kit v0 y son la razon
// por la que un settings.json puede "estar configurado" sin hacer absolutamente nada.
const INVALID_SETTINGS_KEYS = ['effort', 'auto_confirm_destructive', 'display_tools', 'token_budget_warning']

export async function status(flags, cwd) {
  const manifest = loadManifest()
  const lock = readLockfile(cwd)
  const detected = resolveDetected(cwd, lock)

  ui.intro('souclaude status')

  // "Disponible" sale del manifest de ESTE CLI: si el CLI quedo atras del
  // ultimo release (cache de npx del tag movil, global viejo), avisarlo —
  // sin este aviso, status diria "al dia" sin estarlo (SHS-M43).
  const atraso = avisoCliDesactualizado(manifest.harnessVersion)
  if (atraso) ui.log.warn(atraso)

  if (!lock) {
    ui.log.warn('Este repo no tiene harness (.claude/harness.json no existe).')
    ui.log.info('Corre `souclaude init` para instalarlo, o `souclaude adopt` si ya tenes una estructura hecha a mano.')
  } else {
    ui.log.info(`Harness instalado: v${lock.harnessVersion} · disponible: v${manifest.harnessVersion}`)
  }

  const vars = await resolveVars({ flags: { ...flags, yes: true }, lock, detected, cwd, manifest })
  const plan = computePlan({ manifest, cwd, lock, vars, detected })

  ui.renderPlan(plan, { verbose: Boolean(flags.verbose) })

  checkSettings(cwd)

  const pending = writeActions(plan.actions)
  const drift = plan.actions.filter((a) => a.verdict === LOCAL_EDIT)
  const clean = plan.actions.filter((a) => a.verdict === NOOP)

  if (!pending.length) {
    ui.outro(`Al dia. ${clean.length} archivo(s) intactos, ${drift.length} con ediciones locales.`)
    return drift.length ? 2 : 0
  }

  ui.log.warn(`${pending.length} cambio(s) pendiente(s). Corre: souclaude upgrade`)
  ui.outro('Hay un upgrade disponible.')
  return 1
}

function checkSettings(cwd) {
  const raw = readIfExists(path.join(cwd, '.claude', 'settings.json'))
  if (raw == null) return
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    ui.log.error('.claude/settings.json no es JSON valido.')
    return
  }
  const bad = INVALID_SETTINGS_KEYS.filter((k) => k in json)
  if (bad.length) {
    ui.log.warn(
      `.claude/settings.json tiene ${bad.length} clave(s) que Claude Code ignora: ${bad.join(', ')}.\n` +
        '`souclaude upgrade` las remueve.'
    )
  }
}
