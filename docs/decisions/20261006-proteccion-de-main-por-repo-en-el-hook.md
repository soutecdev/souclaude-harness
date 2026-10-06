# ADR: La protección de `main` se decide por repo en el hook `reglas-pr`, no por el texto del comando

**Fecha**: 2026-10-06
**Status**: proposed
**Deciders**: Ignacio A. (@ignacio)

## Context

Varios integrantes del equipo dejaron de poder pushear al Vault desde la sesión del
agente. El análisis de una de esas sesiones (RAM, sesión R4) lo atribuyó a las tres
reglas `deny` por texto de `.claude/settings.json`:

```json
"Bash(git push origin main*)",
"Bash(git push * main)",
"Bash(git push * *:main*)"
```

Esas reglas protegen `main` **del repo del proyecto** (regla dura de `CLAUDE.md`), pero
se evalúan sobre el texto del comando y no saben en qué repositorio corre. El comando
que hay que correr en los dos repos es, carácter por carácter, el mismo:
`git push origin main` es una violación en el proyecto y es el protocolo en el Vault
(«push directo a `main`, sin PR», `progress/README.md`).

Lo que se verificó antes de decidir, con la documentación oficial de Claude Code y con
pruebas `--dry-run` sobre un repo de scratch, usando el hook vivo de la sesión:

- **Una regla `deny` no la anula ningún hook.** Claude Code evalúa `deny` y `ask`
  aunque un hook PreToolUse devuelva `allow`, y ninguna regla de permisos puede
  depender del cwd ni del repo. Así que la excepción para el Vault no se puede
  expresar en `settings.json` ni abrir desde un hook: hay que quitar la regla por
  texto y decidir en otro lado.
- **La regla no protegía lo que creía proteger.** `git -C <ruta> push origin main` no
  empieza por `git push` y pasaba (la propia documentación lo lista como ejemplo). En
  un comando compuesto, `deny` aplica si **algún** subcomando casa, así que
  `cd <vault> && git push origin main` quedaba denegado y `git -C <vault> push origin
  main` pasaba: según cómo escribiera el agente, el bloqueo parecía aleatorio.
- **El filtro `if: Bash(git push:*)` del PreToolUse tenía el mismo hueco.** Se dispara
  con `cd x && git push` (algún subcomando), pero no con `git -C x push`: esa forma
  esquivaba el hook entero, incluido el check de secretos de SHS-M39.
- **En Git Bash sobre Windows el agente escribe rutas MSYS** (`/c/Users/...`).
  `path.resolve` las convierte en `C:\c\Users\...`, la carpeta no existe y el hook no
  revisaba nada.
- Los comodines `*` de las reglas `deny` sí actúan en la versión de Claude Code de la
  máquina del mantenedor (2.1.241): la prueba limpia la denegó la regla, no el hook.
- La vía sancionada desde SHS-M37, `souclaude vault-sync --push`, sigue siendo la que
  corre sin confirmación; pero exige el CLI global instalado y no evita que un agente
  escriba el push a mano cuando `CLAUDE.md` le dice literalmente «push directo a
  `main`».

Restricciones: `main` del proyecto tiene que seguir cerrada a cualquier push desde la
sesión, en Bash y en PowerShell; el Vault tiene que poder recibir `git push origin
main` desde el agente sin trucos; el modo solo mergea y pushea `main` a propósito; los
consumidores ya instalados tienen que recibir el arreglo con `upgrade`, y `merge-json`
solo agrega claves.

## Decision

1. **Las tres reglas `deny` por texto salen de `templates/base/claude/settings.json`**
   (la plantilla de solo nunca las tuvo). Quedan los `deny` de lectura de secretos y de
   `gh pr merge`/`gh pr review`/`gh release`, y los `ask` de force-push.
2. **La protección de `main` vive en el hook `reglas-pr`, por repo.** Antes de cada
   `git push`, el hook resuelve la carpeta real del push (cwd más `cd`/`-C`, con las
   rutas MSYS traducidas), calcula qué ramas remotas tocaría (refspec, `HEAD:main`,
   `dev:main`, `:main`, `--delete`, `--all`/`--mirror`, o la rama actual y su upstream
   cuando no hay refspec) y deniega con una razón accionable si alguna es `main`,
   salvo que el repo sea **el Vault** —la ruta de `.claude/vault.local.json`,
   `VAULT_PATH` o `~/.claude/souclaude/vault.json`, en el mismo orden que el CLI— o
   esté en **modo solo**. Si no hay Vault configurado, la razón dice cómo configurarlo.
   Nunca devuelve `allow`: un push al Vault sigue el flujo normal de permisos (`ask` o
   `allow` según settings), y `vault-sync --push` sigue siendo la vía sin confirmación.
3. **El PreToolUse pierde el filtro `if`.** El hook corre en cada comando de shell y se
   filtra solo: sin push ni PR en el comando, termina sin hacer nada. El PostToolUse
   (`gh pr create`/`gh pr edit`) conserva su `if`.
4. **Migración `v3-settings-main-por-hook`** (a 3.17.0, sobre `.claude/settings.json`):
   quita las tres reglas y el `if` viejo de los hooks de `reglas-pr`. Sin ella,
   `merge-json` dejaría las reglas y agregaría el bloque nuevo del hook al lado del
   viejo.
5. `CLAUDE.md` (plantilla), skill `soutec-github` y `progress/README.md` describen la
   regla y qué hacer si el hook deniega un push al Vault.

## Consequences

### Positivas
- **El Vault se pushea desde la sesión** con cualquier forma del comando, sin
  depender de cómo lo escriba el agente.
- **`main` del proyecto queda mejor protegida que antes**: también contra `git -C`,
  `cd`, rutas MSYS, `:main`, `--delete`, `--all`/`--mirror` y la tool PowerShell (las
  reglas por texto eran solo `Bash(...)`).
- **Se cierra el hueco de secretos** de `git -C <ruta> push`, que esquivaba el hook.
- **Una sola fuente para la regla**, con tests unitarios y de integración (hook y git
  reales), en vez de tres patrones de texto que había que mantener en paridad.

### Negativas
- **Falla abierto si Node no corre**: una regla `deny` de settings no necesita nada;
  el hook sí. Node ya es requisito del harness (todos los hooks y el check son Node),
  pero es una capa menos dura ante una máquina rota.
- **Node arranca en cada comando de shell** (decenas de milisegundos), no solo en
  los `git push`.
- **Solo ve lo que el agente corre por sus tools de shell.** Igual que antes: un push
  humano fuera de Claude Code no pasa por aquí.
- **Las copias locales de este repo** (`.claude/settings.json`, `.claude/hooks/`)
  no las puede editar el agente que las tiene vivas: las aplica el usuario (o un
  `upgrade` sobre este repo, que corre la migración).

### Neutras
- Un push a `main` de un repo ajeno (ni proyecto con harness ni Vault) también se
  deniega, como hacían las reglas por texto. El Vault es el único repo con push
  directo a `main`.
- Tras el `upgrade` hay que reiniciar Claude Code: los hooks y permisos se cargan al
  iniciar la sesión.

## Alternatives considered

### Alternativa A: no tocar nada; el push al Vault lo hace el humano o `vault-sync --push`
**Pros**: cero cambios en la configuración.
**Cons**: deja la regla con el hueco del `-C`, y la experiencia depende de que el agente
no escriba nunca un push a mano; en la práctica lo hace, y el bloqueo parece aleatorio.
**Por qué se descartó**: el pedido es que nadie con el harness instalado tenga problemas
para pushear al Vault.

### Alternativa B: cerrar el hueco del `-C` con más `deny` y abrir una excepción `allow` con la ruta del Vault
**Pros**: parecía declarativo y sin código.
**Cons**: no funciona. `allow` nunca gana a `deny`, y un `deny` `git -C * push * main*`
también casa con la ruta literal del Vault. Además, la ruta es de cada máquina
(`settings.local.json`), fuera del alcance del harness.
**Por qué se descartó**: contradice la precedencia documentada deny → ask → allow.

### Alternativa C: mantener los `deny` y que el hook devuelva `allow` para el Vault
**Pros**: cambio mínimo en settings.
**Cons**: imposible: las reglas `deny` se evalúan aunque el hook devuelva `allow`.
**Por qué se descartó**: verificado en la documentación de permisos.

### Alternativa D: que el Vault se escriba fuera del harness (script del coordinador, cron)
**Pros**: el harness no necesitaría excepción.
**Cons**: el tablero dejaría de reflejar «el ahora» en el momento en que la tarjeta se
mueve, que es lo que pide el protocolo.
**Por qué se descartó**: rompe el contrato de `progress/README.md`.

## References

- Análisis de la sesión R4 (RAM): «Por qué el harness bloquea el push al Vault»,
  2026-10-05.
- Milestone SHS-M42 del Vault (`Project-SHS/milestones.md`).
- ADR `20260928-checks-de-pr-en-la-sesion.md` (SHS-M39): el hook `reglas-pr` y su
  registro con `if`.
- CHANGELOG 3.11.0 y 3.13.x (SHS-M29, SHS-M37): origen de las reglas por texto y de
  `vault-sync --push`.
- Permisos de Claude Code: https://code.claude.com/docs/en/permissions (orden deny →
  ask → allow; «PreToolUse hook decisions don't bypass permission rules»; `git -C`
  como forma que una regla `Bash(git push *)` no detiene).
- Hooks de Claude Code: https://code.claude.com/docs/en/hooks.
