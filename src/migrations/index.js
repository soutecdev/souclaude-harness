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
  {
    // Las reglas `deny` por texto de `git push … main` no distinguen repos:
    // denegaban tambien el push al Vault, cuyo protocolo es push directo a main,
    // y no cubrian `git -C <ruta> push origin main`. La proteccion de main pasa
    // al hook reglas-pr (SHS-M42), que resuelve el repo real del push; y el
    // PreToolUse pierde el filtro `if` que dejaba pasar `git -C`. merge-json
    // solo agrega: sin esta migracion, las tres reglas y el `if` viejo seguirian
    // en los consumidores para siempre (y el bloque nuevo quedaria duplicado).
    id: 'v3-settings-main-por-hook',
    to: '3.17.0',
    dest: '.claude/settings.json',
    describe:
      'settings.json: la protección de `main` pasa al hook reglas-pr — se quitan las reglas deny por texto de `git push … main` (denegaban también el Vault) y el filtro `if` del PreToolUse que dejaba pasar `git -C`',
    transform(content) {
      const json = parseJson(content, '.claude/settings.json')
      if (json == null) return content
      const REGLAS = ['Bash(git push origin main*)', 'Bash(git push * main)', 'Bash(git push * *:main*)']
      let changed = false
      if (Array.isArray(json.permissions?.deny)) {
        const deny = json.permissions.deny.filter((r) => !REGLAS.includes(r))
        if (deny.length !== json.permissions.deny.length) {
          json.permissions.deny = deny
          changed = true
        }
      }
      for (const grupo of json.hooks?.PreToolUse ?? []) {
        for (const hook of grupo?.hooks ?? []) {
          if (/^(Bash|PowerShell)\(git push:\*\)$/.test(hook?.if ?? '') && /reglas-pr\.mjs/.test(hook?.command ?? '')) {
            delete hook.if
            changed = true
          }
        }
      }
      return changed ? stringifyJson(json) : content
    },
  },
]

// Devuelve las migraciones aplicables a `dest` para pasar de `fromVersion` al
// harness actual. Una migracion aplica si el repo esta por debajo de su `to`.
export function migrationsFor(dest, fromVersion) {
  return migrations.filter((m) => m.dest === dest && lt(fromVersion, m.to))
}
