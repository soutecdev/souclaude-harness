import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { resolveDetected } from '../core/detect.js'
import { readLockfile } from '../core/lockfile.js'
import { lt } from '../core/lockfile.js'
import { migrationsFor, migrations } from '../migrations/index.js'
import { avisoCliDesactualizado } from '../core/version-remota.js'
import { leerChangelog, novedadesEntre } from '../core/novedades.js'
import { resolveVars, planAndApply, vaultStep, githubProtectionStep, cliGlobalStep } from './_shared.js'

export async function upgrade(flags, cwd) {
  const manifest = loadManifest()
  const lock = readLockfile(cwd)
  const detected = resolveDetected(cwd, lock)

  ui.intro(`souclaude upgrade — harness v${manifest.harnessVersion}`)

  // Un upgrade corrido por un CLI atrasado (cache de npx del tag movil)
  // "actualizaria" a una version vieja creyendola la ultima (SHS-M43).
  const atraso = avisoCliDesactualizado(manifest.harnessVersion)
  if (atraso) ui.log.warn(atraso)

  const from = lock?.harnessVersion ?? '0.0.0'
  if (!lock) {
    ui.log.warn('No hay .claude/harness.json. Se asume una estructura previa hecha a mano (v0).')
  } else {
    ui.log.info(`Harness actual: v${from} -> v${manifest.harnessVersion}`)
  }

  const pending = migrations.filter((m) => migrationsFor(m.dest, from).includes(m))
  if (pending.length) {
    ui.log.step(`Migraciones a aplicar:\n${pending.map((m) => `  · ${m.describe}`).join('\n')}`)
  }

  const vars = await resolveVars({ flags, lock, detected, cwd, manifest })
  const code = await planAndApply({ manifest, cwd, lock, vars, detected, flags, title: 'upgrade' })
  mostrarNovedades({ code, cwd, from, manifest, lock })
  const code2 = await vaultStep({ code, cwd, flags, manifest, lock })
  const code3 = githubProtectionStep({ code: code2, cwd, flags })
  return cliGlobalStep({ code: code3, flags, manifest })
}

// SHS-M43-T004: que trae la version recien instalada, en un recuadro para que
// no se pierda entre los logs. Solo cuando ESTA corrida dejo instalada una
// version mas nueva — el lockfile reescrito lo confirma (ni --dry-run, ni
// cancelado, ni "nada que hacer"). Con muchas versiones de distancia se
// muestran las 3 mas nuevas y se dice cuantas quedaron afuera.
const NOVEDADES_MAX = 3

function mostrarNovedades({ code, cwd, from, manifest, lock }) {
  try {
    if (code !== 0 || !lock || !lt(from, manifest.harnessVersion)) return
    if (readLockfile(cwd)?.harnessVersion !== manifest.harnessVersion) return
    const secciones = novedadesEntre(leerChangelog(), from, manifest.harnessVersion)
    if (!secciones.length) return
    for (const s of secciones.slice(0, NOVEDADES_MAX).reverse()) {
      ui.note(s.lineas.join('\n'), `Novedades del harness v${s.version}`)
    }
    if (secciones.length > NOVEDADES_MAX) {
      ui.log.info(
        `Quedaron ${secciones.length - NOVEDADES_MAX} version(es) intermedia(s) sin mostrar: CHANGELOG.md completo en el repo del harness.`
      )
    }
  } catch {
    // Las novedades son informativas: jamas rompen un upgrade que ya aplico.
  }
}
