import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { verifyManifest } from '../core/verify.js'

// A diferencia de status/upgrade/adopt, verify no mira ningun proyecto
// consumidor: audita que el propio harness (manifest + templates/base/) sea
// internamente consistente, asi que `cwd` no se usa. Se mantiene en la firma
// solo por uniformidad con el resto de COMMANDS en cli.js.
export async function verify(flags, _cwd) {
  const manifest = loadManifest()
  ui.intro('souclaude verify')

  const { errors, warnings } = verifyManifest(manifest)

  // Frescura de docs/metodologia (SHS-M16): sus secciones generadas deben
  // coincidir con package.json y el manifest. Solo existe en el repo del
  // generador (el paquete publicado no lleva scripts/ ni docs/), asi que en
  // cualquier otra instalacion el check se salta solo.
  const raizGenerador = fileURLToPath(new URL('../../', import.meta.url))
  const genDocs = path.join(raizGenerador, 'scripts', 'gen-docs-metodologia.mjs')
  if (existsSync(genDocs) && existsSync(path.join(raizGenerador, 'docs', 'metodologia'))) {
    try {
      const { correr } = await import(pathToFileURL(genDocs).href)
      const r = correr({ check: true, raiz: raizGenerador })
      for (const linea of r.lineas) {
        if (linea.startsWith('[FAIL]') || linea.startsWith('[ERROR]')) {
          errors.push({ code: 'stale-docs-metodologia', message: linea })
        }
      }
    } catch (e) {
      errors.push({ code: 'stale-docs-metodologia', message: `[ERROR] docs-metodologia: ${e?.message ?? e}` })
    }
  }

  for (const w of warnings) ui.log.warn(w.message)
  for (const e of errors) ui.log.error(e.message)

  if (!errors.length && !warnings.length) {
    ui.outro('Manifest consistente: sin huerfanos, sin rutas rotas, sin duplicados, sin criticos faltantes.')
    return 0
  }
  if (errors.length) {
    ui.outro(`${errors.length} error(es), ${warnings.length} warning(s).`)
    return 1
  }
  ui.outro(`${warnings.length} warning(s), sin errores.`)
  return flags.strict ? 1 : 0
}
