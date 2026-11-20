import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { detect } from '../core/detect.js'
import { readLockfile, writeLockfile } from '../core/lockfile.js'
import { computePlan, NOOP, FOREIGN, CONFLICT } from '../core/plan.js'
import { hashContent } from '../core/hash.js'
import { resolveVars, revisarCarpeta } from './_shared.js'

// Primer paso seguro para un repo que ya tiene una estructura hecha a mano
// (una copia del Kit, o un CLAUDE.md escrito a pulso). NO toca ni un archivo:
// solo escribe .claude/harness.json anotando que archivos ya coinciden con el
// harness. Despues `souclaude upgrade` hace el trabajo real, y todo lo que no
// coincida recibe un .new en vez de ser pisado.
export async function adopt(flags, cwd) {
  const manifest = loadManifest()
  const detected = detect(cwd)
  const existing = readLockfile(cwd)

  ui.intro('souclaude adopt')

  if (existing) {
    ui.log.warn(`Este repo ya tiene harness v${existing.harnessVersion}. Para actualizarlo: souclaude upgrade`)
    ui.outro('Nada que adoptar.')
    return 0
  }

  revisarCarpeta(cwd)
  const vars = await resolveVars({ flags, lock: null, detected, cwd, manifest })
  const plan = computePlan({ manifest, cwd, lock: null, vars, detected })

  // Solo reclamamos los archivos que YA son byte-identicos a lo que emitiriamos.
  // Reclamar uno modificado seria decirle al proximo upgrade "esto es output
  // intacto del harness, písalo tranquilo" — y le borrariamos el trabajo al dev.
  const pristine = plan.actions.filter((a) => a.verdict === NOOP && a.policy !== 'append-block')
  const foreign = plan.actions.filter((a) => a.verdict === FOREIGN || a.verdict === CONFLICT)

  const lock = {
    harnessVersion: flags['assume-version'] ?? '0.0.0',
    cliVersion: manifest.harnessVersion,
    installedAt: new Date().toISOString(),
    adopted: true,
    greenfield: detected.isEmpty,
    vars,
    detected: { stacks: detected.stacks, packageManager: detected.packageManager },
    files: {},
    blocks: {},
  }
  for (const a of pristine) {
    lock.files[a.dest] = { policy: a.policy, hash: hashContent(a.content) }
  }

  ui.renderPlan(plan, { verbose: Boolean(flags.verbose) })

  if (flags['dry-run']) {
    ui.outro('--dry-run: no se escribio ni un byte.')
    return 0
  }

  writeLockfile(cwd, lock)

  ui.log.success(`.claude/harness.json creado. ${pristine.length} archivo(s) ya coinciden con el harness.`)
  if (foreign.length) {
    ui.log.info(
      [
        `${foreign.length} archivo(s) tuyos difieren del harness. NO se van a pisar:`,
        ...foreign.map((a) => `    ${a.dest}`),
        '',
        'El proximo `souclaude upgrade` deja la propuesta al lado, en .new, para que mergeas tú.',
      ].join('\n')
    )
  }
  ui.outro('Adoptado. Siguiente paso: souclaude upgrade --dry-run')
  return 0
}
