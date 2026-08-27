import { execSync } from 'node:child_process'
import os from 'node:os'
import * as ui from './../ui.js'

// SHS-M21: el monitor "en produccion" para el equipo es el CLI instalado
// global desde GitHub (npm install -g), no un publish al registro de npm:
// el repo es privado y UNLICENSED, y el acceso ya lo controla GitHub. Se
// apunta al tag movil de la serie mayor (v3), el mismo de las instrucciones
// de npx del README, asi el global se actualiza con cada release publicado.
const PAQUETE = 'souclaude-harness'
const REPO_GITHUB = 'ialvarezsoutec/souclaude-harness'

export function specGlobal(manifest) {
  const major = String(manifest.harnessVersion).split('.')[0]
  return `github:${REPO_GITHUB}#v${major}`
}

// npm va por execSync con comando constante (nada del usuario entra al
// string): en Windows npm es npm.cmd y execFileSync sin shell lo rechaza
// (EINVAL, fix de CVE-2024-27980). El cwd va explicito al home (CWE-427):
// cmd.exe resuelve "npm" buscando PRIMERO en el directorio actual, y el
// actual seria el repo consumidor — un npm.cmd commiteado ahi se ejecutaria.
// Ningun npm -g depende del cwd, asi que no se pierde nada.
function runNpm(cmd) {
  return execSync(cmd, { cwd: os.homedir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// npm ls -g sale con codigo != 0 si el paquete no esta: el catch es el caso
// "no instalado", no un error.
export function versionGlobalInstalada({ run = runNpm } = {}) {
  try {
    const salida = run(`npm ls -g ${PAQUETE} --depth=0 --json`)
    return JSON.parse(salida)?.dependencies?.[PAQUETE]?.version ?? null
  } catch {
    return null
  }
}

// Idempotente: con el global ya en la version del manifest no hace nada. En
// modo no interactivo (--yes / CI) solo instala con --cli-global explicito:
// un npm install -g de ~1 minuto no se dispara solo en un runner. Si npm
// falla, se reporta y el resto de init/upgrade sigue (mismo criterio que la
// proteccion de main).
export async function instalarCliGlobal({ manifest, flags, yes, run = runNpm }) {
  // Antes de tocar npm: en modo no interactivo sin flag no se hace NADA (ni
  // el npm ls de deteccion) -- los tests y los runners corren init/upgrade
  // muchas veces y ese ls real cuesta segundos cada vez.
  if (yes && flags['cli-global'] !== true) {
    ui.log.info('CLI global "souclaude": en modo no interactivo se instala/actualiza solo con --cli-global.')
    return { aplicado: false, motivo: 'sin-flag' }
  }

  const objetivo = manifest.harnessVersion
  const instalada = versionGlobalInstalada({ run })

  if (instalada === objetivo) {
    ui.log.info(`CLI global "souclaude" v${instalada} al dia: \`souclaude monitor\` disponible en cualquier terminal.`)
    return { aplicado: false, motivo: 'al-dia' }
  }

  const spec = specGlobal(manifest)
  if (flags['cli-global'] !== true) {
    const ok = await ui.confirm({
      message: instalada
        ? `Actualizar el CLI global "souclaude" (v${instalada} -> v${objetivo})? Corre: npm install -g ${spec}`
        : `Instalar el CLI global "souclaude" para usar \`souclaude monitor\` desde cualquier terminal? Corre: npm install -g ${spec}`,
      initialValue: true,
      yes,
    })
    if (!ok) {
      ui.log.info(`CLI global omitido. Se instala a mano con: npm install -g ${spec}`)
      return { aplicado: false, motivo: 'rechazado' }
    }
  }

  try {
    ui.log.step(`Instalando el CLI global: npm install -g ${spec} (puede tardar ~1 min)...`)
    run(`npm install -g ${spec}`)
    const ahora = versionGlobalInstalada({ run }) ?? objetivo
    ui.log.success(`CLI global "souclaude" v${ahora} listo: corre \`souclaude monitor\` desde cualquier terminal.`)
    return { aplicado: true }
  } catch (err) {
    ui.log.warn(
      `No se pudo instalar el CLI global (${err.message.split('\n')[0]}). El harness quedo bien igual; reintenta con: npm install -g ${spec}`
    )
    return { aplicado: false, motivo: 'error' }
  }
}
