import { lt } from '../core/lockfile.js'
import { parseJson, stringifyJson } from '../core/jsonmerge.js'

// Transforms mecanicos que el diff-por-hash no puede expresar: remover o
// renombrar claves, mover archivos. El seed-merge solo AGREGA, asi que sin una
// migracion una clave invalida vivira para siempre.
//
// Es un array de funciones chicas a proposito. Nada de un DSL de migraciones.
export const migrations = [
  {
    id: 'v1-settings-drop-invalid-keys',
    to: '1.0.0',
    dest: '.claude/settings.json',
    describe:
      'settings.json: remueve claves que Claude Code ignora en silencio (effort, auto_confirm_destructive, display_tools, token_budget_warning)',
    transform(content) {
      const json = parseJson(content, '.claude/settings.json')
      if (json == null) return content

      // Estas cuatro nunca existieron en el schema de Claude Code. Estaban en el
      // Kit v0 y no hacian absolutamente nada.
      const INVALID = ['effort', 'auto_confirm_destructive', 'display_tools', 'token_budget_warning']

      let changed = false
      for (const key of INVALID) {
        if (key in json) {
          delete json[key]
          changed = true
        }
      }
      return changed ? stringifyJson(json) : content
    },
  },
  {
    // El CLAUDE.md es user-owned y casi siempre esta editado, asi que el upgrade
    // solo le deja un .new que nadie mira: la instruccion vieja seguiria mandando
    // al agente a `git -C "<vault>" ...`, que pide confirmacion. Reemplazo literal
    // del texto que emitieron las plantillas v3.9.0-v3.14.0 (equipo y solo); si el
    // usuario lo reescribio a su manera, no coincide y no se toca.
    id: 'v3-claude-md-vault-sync',
    to: '3.14.1',
    dest: 'CLAUDE.md',
    describe: 'CLAUDE.md: el ciclo del Vault pasa a `souclaude vault-sync` (sin confirmación); solo se reemplaza la línea que escribió el harness',
    transform(content) {
      return content
        .replace('`git -C "<vault>" pull --rebase` y lee', '`souclaude vault-sync` y lee')
        .replace(
          '`npx souclaude vault-sync --push -m "docs: worklog"`',
          '`souclaude vault-sync --push -m "docs: worklog" --paths Project-<PREFIJO>`'
        )
    },
  },
]

// Devuelve las migraciones aplicables a `dest` para pasar de `fromVersion` al
// harness actual. Una migracion aplica si el repo esta por debajo de su `to`.
export function migrationsFor(dest, fromVersion) {
  return migrations.filter((m) => m.dest === dest && lt(fromVersion, m.to))
}
