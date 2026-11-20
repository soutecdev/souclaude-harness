import fs from 'node:fs'
import path from 'node:path'
import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { resolveDetected } from '../core/detect.js'
import { readLockfile } from '../core/lockfile.js'
import { readIfExists } from '../core/fsx.js'
import { computePlan, writeActions, NOOP, LOCAL_EDIT, CONFLICT, FOREIGN } from '../core/plan.js'
import { avisoCliDesactualizado } from '../core/version-remota.js'
import { resolveVars, avisarIgnorados } from './_shared.js'

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
    ui.log.info('Corre `souclaude init` para instalarlo, o `souclaude adopt` si ya tienes una estructura hecha a mano.')
  } else {
    ui.log.info(`Harness instalado: v${lock.harnessVersion} · disponible: v${manifest.harnessVersion}`)
  }

  const vars = await resolveVars({ flags: { ...flags, yes: true }, lock, detected, cwd, manifest })
  const plan = computePlan({ manifest, cwd, lock, vars, detected })

  ui.renderPlan(plan, { verbose: Boolean(flags.verbose) })
  avisarIgnorados(plan)

  checkSettings(cwd)

  // Una propuesta `.new` que ya esta escrita y al dia no es trabajo para
  // `upgrade`: volver a correrlo la reescribiria igual. Contarla como "pendiente"
  // dejaba a status en exit 1 ("hay upgrade") PARA SIEMPRE en cualquier repo con
  // un archivo propio que el harness no pisa (su README, un CLAUDE.md editado), y
  // mandaba a correr un upgrade que no cambia nada. Es una decision del usuario:
  // cuenta como drift (exit 2), igual que una edicion local.
  const propuestas = writeActions(plan.actions).filter((a) => propuestaAlDia(cwd, a))
  const pending = writeActions(plan.actions).filter((a) => !propuestas.includes(a))
  const drift = plan.actions.filter((a) => a.verdict === LOCAL_EDIT)
  const clean = plan.actions.filter((a) => a.verdict === NOOP)

  if (!pending.length) {
    if (propuestas.length) {
      ui.log.info(
        `${propuestas.length} propuesta(s) .new esperan tu revision: ${propuestas.map((a) => a.writePath).join(', ')}.\n` +
          'Integra lo que te sirva en tu archivo y borra el .new: `souclaude upgrade` no tiene nada nuevo que escribir.'
      )
    }
    const conPropuesta = propuestas.length ? `, ${propuestas.length} con una propuesta .new sin resolver` : ''
    ui.outro(`Al dia. ${clean.length} archivo(s) intactos, ${drift.length} con ediciones locales${conPropuesta}.`)
    return drift.length || propuestas.length ? 2 : 0
  }

  ui.log.warn(`${pending.length} cambio(s) pendiente(s). Corre: souclaude upgrade`)
  ui.outro('Hay un upgrade disponible.')
  return 1
}

// La accion propone un `<archivo>.new` (conflicto, o archivo que el harness no
// genero) y esa propuesta ya esta en disco con el contenido que `upgrade`
// escribiria ahora. Si falta o quedo vieja, sigue siendo trabajo pendiente.
function propuestaAlDia(cwd, action) {
  if (![CONFLICT, FOREIGN].includes(action.verdict) || action.writePath === action.dest) return false
  const abs = path.join(cwd, ...action.writePath.split('/'))
  try {
    if (action.binary) return Buffer.compare(fs.readFileSync(abs), Buffer.from(action.content)) === 0
    // Misma normalizacion que writeFileLF: LF y salto de linea final.
    const lf = (texto) => {
      const n = String(texto).replace(/\r\n/g, '\n')
      return n.endsWith('\n') ? n : `${n}\n`
    }
    return lf(fs.readFileSync(abs, 'utf8')) === lf(action.content)
  } catch {
    return false
  }
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
