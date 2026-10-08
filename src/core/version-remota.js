import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lt } from './lockfile.js'

// SHS-M43: los hooks de SessionStart mantienen en
// ~/.claude/souclaude/version-check.json la ultima version publicada del
// harness por major (tags vX.Y.Z leidos con git ls-remote, cacheados por
// maquina). El CLI la lee para detectar su propio atraso: `npx ...#v3` puede
// servir un CLI viejo desde la cache de npx del tag movil, y ese CLI diria
// "al dia" comparando contra su propio manifest. Aca NO se consulta la red:
// sin cache (o rota), null y silencio — el que consulta y escribe es el hook.
export function ultimaVersionConocida(major) {
  try {
    const home = process.env.SOUCLAUDE_CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
    const cache = JSON.parse(fs.readFileSync(path.join(home, 'souclaude', 'version-check.json'), 'utf8'))
    const ultima = cache?.ultimaPorMajor?.[String(major)]
    return typeof ultima === 'string' && /^\d+\.\d+\.\d+$/.test(ultima) ? ultima : null
  } catch {
    return null
  }
}

// Mensaje de atraso del CLI en ejecucion, o null si no hay atraso conocido.
export function avisoCliDesactualizado(versionDelCli) {
  const major = String(versionDelCli).split('.')[0]
  const ultima = ultimaVersionConocida(major)
  if (!ultima || !lt(versionDelCli, ultima)) return null
  return (
    `Este CLI es v${versionDelCli}, pero el ultimo release publicado es v${ultima} ` +
    `(cache de npx o CLI global atrasados). Repite el comando con el tag exacto ` +
    `(npx -y github:soutecdev/souclaude-harness#v${ultima} ...) o reinstala el global con el.`
  )
}
