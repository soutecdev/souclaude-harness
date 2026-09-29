import { execFile } from 'node:child_process'

// Sincronizacion segura con el Vault: la unica forma sancionada de mover commits
// entre esta maquina y el repo compartido. Extraida del patron que el publisher
// del monitor ya tenia probado en produccion (vault-monitor-publisher.js).
//
// REGLAS QUE NO SE NEGOCIAN:
// - pull --rebase ANTES de escribir o pushear; si falla, rebase --abort defensivo
//   y no se toca nada mas.
// - Jamas --force, en ninguna direccion.
// - git con args en array via execFile (nunca shell): las rutas con espacios
//   (todo OneDrive) no son un problema y no hay inyeccion posible.
// - Nada de aca lanza: los llamadores deciden con { ok, motivo }.

export function gitReal(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/**
 * pull --rebase del Vault. Ante fallo, rebase --abort defensivo (por si quedo un
 * rebase a medias) y nada mas: el working tree del Vault no se toca.
 * @returns {Promise<{ok: boolean, motivo: 'pull_fallo'|null}>}
 */
export async function pullRebaseSeguro({ vaultPath, git = gitReal }) {
  try {
    await git(['-C', vaultPath, 'pull', '--rebase'])
    return { ok: true, motivo: null }
  } catch {
    try {
      await git(['-C', vaultPath, 'rebase', '--abort'])
    } catch {
      // No habia rebase que abortar: el pull fallo antes (sin red).
    }
    return { ok: false, motivo: 'pull_fallo' }
  }
}

/**
 * Espejo al Vault: add -> commit -> pull --rebase -> push, en ese orden. El pull
 * va DESPUES del commit para que el rebase integre lo nuestro sobre lo remoto
 * (mismo modelo que el publisher). "Nothing to commit" no es un error: el Vault
 * ya dice lo mismo — salvo que tenga commits locales sin subir, que se empujan.
 * @param {object} p
 * @param {string} p.vaultPath ruta local del Vault
 * @param {string} p.mensaje mensaje de commit (convencion: `docs:` espejos, `chore:` kanban)
 * @param {string[]|null} p.paths rutas relativas al Vault para el add; null = todo (add -A)
 * @returns {Promise<{ok: boolean, motivo: 'sin_cambios'|'pull_fallo'|'push_fallo'|null}>}
 */
export async function pushSeguro({ vaultPath, mensaje, paths = null, git = gitReal }) {
  const addArgs = paths?.length ? paths : ['-A']
  try {
    await git(['-C', vaultPath, 'add', ...addArgs])
  } catch {
    return { ok: false, motivo: 'push_fallo' }
  }

  try {
    await git(['-C', vaultPath, 'commit', '-m', mensaje])
  } catch {
    // commit sale con error tanto por "nothing to commit" como por un fallo real.
    // El desempate es el status: sucio => fallo real. Limpio y sin commits
    // locales por subir => no habia nada que espejar. Limpio pero adelantado del
    // remoto => alguien commiteo a mano y nunca pusheo: se sigue al pull + push
    // en vez de responder "sin_cambios" y dejar ese commit varado.
    const { limpio, adelantado } = await estadoDelVault(vaultPath, git)
    if (!limpio) return { ok: false, motivo: 'push_fallo' }
    if (!adelantado) return { ok: true, motivo: 'sin_cambios' }
  }

  const pull = await pullRebaseSeguro({ vaultPath, git })
  if (!pull.ok) return { ok: false, motivo: 'pull_fallo' }

  try {
    await git(['-C', vaultPath, 'push'])
  } catch {
    // El commit local quedo hecho: el proximo pushSeguro (o el pull inicial de
    // cualquier corrida) lo termina de empujar cuando vuelva la red.
    return { ok: false, motivo: 'push_fallo' }
  }

  return { ok: true, motivo: null }
}

/**
 * Estado del Vault con UNA llamada (`status --porcelain -b`): la primera linea es
 * la cabecera de la rama (`## main...origin/main [ahead 1]`), el resto son los
 * archivos modificados. Ante cualquier error se asume sucio (el camino seguro:
 * el llamador lo trata como fallo, nunca como "nada que hacer").
 * @returns {Promise<{limpio: boolean, adelantado: boolean}>}
 */
async function estadoDelVault(vaultPath, git) {
  try {
    const lineas = (await git(['-C', vaultPath, 'status', '--porcelain', '-b'])).split('\n')
    const cabecera = lineas.find((l) => l.startsWith('## ')) ?? ''
    const archivos = lineas.filter((l) => l.trim() !== '' && !l.startsWith('## '))
    return { limpio: archivos.length === 0, adelantado: /\[ahead \d+/.test(cabecera) }
  } catch {
    return { limpio: false, adelantado: false }
  }
}
