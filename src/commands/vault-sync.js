import * as ui from '../ui.js'
import { readVaultConfig, harnessDocsUrl } from '../core/vault.js'
import { pullRebaseSeguro, pushSeguro, gitReal } from '../core/vault-sync.js'

// souclaude vault-sync: la via sancionada para mover el espejo (kanban, specs,
// progreso) entre esta maquina y el Vault. Reemplaza la secuencia git en prosa
// de .claude/agents/*.md: un comando que los agentes invocan y cuyos exit codes
// distinguen lo que antes se confundia en un "vault_skip" generico.
//
//   vault-sync                      pull --rebase seguro (default)
//   vault-sync --push -m "<msg>"    add -> commit -> pull -> push
//   vault-sync --status             configurado o no, ruta, dirty state
//
// Exit codes: 0 ok / sin cambios · 1 fallo el sync · 2 error de uso ·
// 3 Vault no configurado. El Vault jamas es dependencia dura: quien llama
// decide si un != 0 es bloqueante (para los agentes no lo es: se reporta).

export async function vaultSync(flags, cwd, { git = gitReal } = {}) {
  const config = readVaultConfig(cwd)
  if (!config?.path) {
    ui.log.warn(
      [
        'Vault no configurado en esta maquina (.claude/vault.local.json o VAULT_PATH).',
        '    git clone <repo-del-vault> <ruta-fuera-de-este-repo>',
        '    npx souclaude upgrade --vault-path <ruta>',
        `Detalle en ${harnessDocsUrl('docs/vault-setup.md')}`,
      ].join('\n')
    )
    return 3
  }

  if (flags.status) {
    return await mostrarStatus(config, git)
  }

  if (flags.push) {
    const mensaje = flags.message ?? null
    if (!mensaje) {
      ui.log.error('vault-sync --push requiere -m "<mensaje>" (convencion: docs: espejos, chore: kanban).')
      return 2
    }
    const paths = flags.paths ? flags.paths.split(',').map((p) => p.trim()).filter(Boolean) : null
    // `--paths` lo escribe el agente y `settings.json` permite este comando sin
    // confirmacion: una ruta con forma de opcion (`--pathspec-from-file=...`) se
    // leeria como flag de `git add`, asi que solo se aceptan rutas del Vault.
    if (paths?.some((p) => p.startsWith('-'))) {
      ui.log.error('vault-sync --paths solo acepta rutas relativas al Vault: ninguna puede empezar con "-".')
      return 2
    }
    const r = await pushSeguro({ vaultPath: config.path, mensaje, paths, git })
    if (!r.ok) {
      ui.log.error(`No se pudo espejar al Vault (${r.motivo}). El trabajo local no se pierde: reintenta con red/sin conflictos.`)
      return 1
    }
    ui.log.info(r.motivo === 'sin_cambios' ? 'El Vault ya estaba al dia: nada que espejar.' : 'Espejo publicado en el Vault.')
    return 0
  }

  const r = await pullRebaseSeguro({ vaultPath: config.path, git })
  if (!r.ok) {
    ui.log.error('El pull --rebase del Vault fallo (¿sin red? ¿conflicto?). No se toco nada: reintenta mas tarde.')
    return 1
  }
  ui.log.info(`Vault al dia: ${config.path}`)
  return 0
}

async function mostrarStatus(config, git) {
  ui.log.info(`Vault configurado: ${config.path}`)
  try {
    const status = await git(['-C', config.path, 'status', '--porcelain'])
    ui.log.info(status.trim() === '' ? 'Working tree del Vault: limpio.' : `Working tree del Vault con cambios sin espejar:\n${status.trimEnd()}`)
    return 0
  } catch {
    ui.log.error('No se pudo leer el estado del Vault (¿la ruta sigue siendo un repo git?).')
    return 1
  }
}
