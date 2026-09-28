# ADR: Checks de PR en la sesión del agente mientras GitHub Actions está en pausa

**Fecha**: 2026-09-28
**Status**: proposed
**Deciders**: Ignacio A. (@ignacio)

## Context

Desde SHS-M36 (ADR `20260921-pausa-github-actions.md`) ningún workflow se dispara
solo y `github-protect.js` no exige checks en `main`. En la práctica:

- **Nada validaba un PR**: ni base=dev, ni secretos, ni versión, ni las secciones de
  la plantilla, ni el formato de rama y commits.
- **Nada creaba los tags de release**: `tag-release.yml` quedó con `workflow_dispatch`
  y su job exige `pull_request.merged`, así que ni lanzado a mano taggea.

El ADR de la pausa pedía que el agente y el revisor corrieran el script a mano, pero:

- **el comando que citaba no funciona**: `node scripts/check-pr-rules.mjs` sin
  `--grupo` sale con error;
- **el pedido nunca llegó a las instrucciones distribuidas**: la skill `soutec-github`
  seguía diciendo que el check corre en CI, que hay que relanzar jobs con
  `gh run rerun` y que los tags los crea `tag-release.yml`.

Correr el script fuera de Actions destapó además huecos que el checkout de CI tapaba:

- `.env.example`, que la skill pide y el harness siembra, contaba como secreto.
- Las rutas con tildes o ñ no se detectaban: git las escribe entre comillas.
- El diff de árboles no ve un secreto agregado y borrado en commits locales, que el
  push sube igual.
- Con `--pr`, la base y la rama salían del checkout local y no del PR.
- `mergeable` es `UNKNOWN` justo después de crear el PR.
- Un fallo de `gh` salía como stack trace, indistinguible de un FAIL de regla.
- `tag-release.mjs` moría con «would clobber existing tag» cuando el tag móvil
  local estaba viejo, que es el caso normal en la máquina de un dev.

Restricciones:

- **Cero minutos de Actions.**
- **Solo los workflows del harness**: es la regla permanente del punto 5 del ADR de
  la pausa.
- **El chequeo tiene que ser determinista**: el usuario eligió que no dependa de
  que el modelo se acuerde.

## Decision

1. **Hook de Claude Code `reglas-pr`** (`.claude/hooks/reglas-pr.mjs`, managed).
   - **PreToolUse de `git push`**: corre
     `check-pr-rules.mjs --grupo secretos --sin-pushear` sobre cada commit que el
     push subiría. Si falla, `permissionDecision: deny` con una razón accionable.
     En verde no emite nada; nunca `allow`, que saltaría los `ask` de force-push.
   - **PostToolUse de `gh pr create` y de `gh pr edit`** (con body o base):
     1. corre los tres grupos con `--pr <url>`;
     2. publica el resultado como **un comentario nuevo en el PR por corrida**
        (marcador `<!-- souclaude:reglas-pr -->`), que es la evidencia para el
        revisor;
     3. devuelve el resultado al agente: `decision: block` más `additionalContext`
        si fallan `secretos` o `pr-metadata`; `rama-commits` sigue siendo
        informativo.
   - **Modo manual**: `node .claude/hooks/reglas-pr.mjs --pr <url>`, para después de
     un push correctivo (que no vuelve a disparar el PostToolUse) o si el hook no
     corrió.
   - **Registro**: con `if` (`Bash(git push:*)`, `Bash(gh pr:*)` y sus
     equivalentes `PowerShell(…)`) para no lanzar Node en cada comando de shell. El
     hook además se filtra solo, por si una versión de Claude Code ignora `if`. En
     equipo se cablean los dos eventos; en solo, solo el PreToolUse de `git push`,
     con un bloque idéntico al de equipo para que un cambio de modo no lo duplique.
   - **Modo solo** (SHS-M39-T006): el check de secretos antes del push es su única
     regla dura. `reglas-secretos.yml` solo se disparaba en `pull_request`, y en
     solo el agente mergea directo a `dev` y a `main` y pushea sin PR, así que ese
     camino nunca se revisó, ni siquiera antes de la pausa. El hook lo cubre: revisa
     todo commit que el push subiría, incluidos los que trae un merge local. El
     flujo del PR no corre en solo, porque ahí no hay plantilla ni validación de
     PR.
   - **La ruta del comando es `${CLAUDE_PROJECT_DIR}`**, no relativa como en
     `declarar-milestone`: los hooks de tool corren en el cwd **actual** de la
     sesión, que puede ser una subcarpeta. El repo se resuelve con
     `git rev-parse --show-toplevel` desde el cwd y el `cd`/`-C` del comando. Un
     repo sin el script (el Vault, por ejemplo) no lleva check.
   - **Solo ejecuta el script de su propio proyecto** (`<raíz del hook>/scripts/check-pr-rules.mjs`),
     nunca el del repo destino del comando: un PreToolUse corre antes del prompt de
     permisos, y `cd <repo ajeno> && git push` no puede servir para ejecutar código
     de terceros. Del repo destino solo se mira que exista el script, como señal de
     que le corresponde el check. Los pushes de tags, `--tags`, `--all` y `--mirror`
     también se revisan, porque también suben commits. El modo manual solo acepta
     PRs del repo de `origin`, ya que corre sin prompt. Estos tres ajustes salieron
     del security review del PR.
   - **Falla abierto** ante problemas de infraestructura (sin `gh`, sin red, sin
     script), pero lo avisa.
   - **Se instala en los dos modos** (como `check-pr-rules.mjs`). Al pasar de
     equipo a solo, `merge-json` no quita el `PostToolUse` de equipo; el hook lo
     ignora en solo, y como el archivo existe en los dos modos, `--prune` no lo
     borra y no queda MODULE_NOT_FOUND.
2. **`check-pr-rules.mjs` corre bien en local** (el mismo script de los workflows):
   - `.env.example`, `sample`, `template` y `dist` quedan fuera de los secretos;
   - `core.quotePath=false -z`;
   - flag `--sin-pushear` (con `--cabeza`);
   - con `--pr`, base, rama y cabeza (`headRefOid`) salen del PR;
   - reintento de `mergeable` en PRs abiertos;
   - `[ERROR]` con exit 2 ante fallas de `gh` o `git`;
   - tags por `ls-remote`.

   Sin `--pr`, lo que invocan los workflows se comporta igual que antes.
3. **Tags por el agente**: `git fetch origin && node scripts/tag-release.mjs --ref origin/main`.
   `fetch --tags --force` resuelve el tag móvil viejo, y `--ref` taggea sin cambiar
   de rama.
4. **Instrucciones**:
   - `soutec-github`, `CLAUDE.md` (plantilla y local), README y MAINTAINERS;
   - `harness-upgrade`: el tag-release de stacks no Node se genera pausado y se pide
     reiniciar Claude Code cuando un upgrade suma hooks, porque se cargan al iniciar
     la sesión.

   Los párrafos que dependen de la pausa llevan el marcador
   `PAUSA TEMPORAL (SHS-M36)`.

Comandos correctos para correr los checks a mano (corrigen el que cita el ADR de la
pausa, que no se edita porque los ADRs aceptados son inmutables):

```bash
git fetch origin --tags
node scripts/check-pr-rules.mjs --grupo rama-commits --pr <url>
node scripts/check-pr-rules.mjs --grupo secretos --pr <url>
node scripts/check-pr-rules.mjs --grupo pr-metadata --pr <url>
node scripts/check-pr-rules.mjs --grupo secretos --sin-pushear   # antes de un push
node .claude/hooks/reglas-pr.mjs --pr <url>                      # los tres + comentario
```

## Consequences

### Positivas
- **Vuelven los checks de PR sin gastar minutos de Actions.**
- **`secretos` corre antes del push**: es más fuerte que el check de CI, que corría
  con el secreto ya subido a la rama.
- **Es determinista**: corre aunque el modelo no se acuerde, y el agente recibe el
  FAIL en el momento en que puede corregirlo.
- **El revisor tiene evidencia en el PR** sin depender de la sesión.
- **Las correcciones del script sirven también a CI** cuando Actions vuelva.

### Negativas
- **Solo ve lo que el agente corre por sus tools de shell** (Bash o PowerShell). Un
  push humano fuera de Claude Code, o un PR creado desde la web, el MCP de GitHub o
  `gh api`, no se chequea. La skill exige `gh pr create`/`gh pr edit` y prohíbe
  rodear el hook.
- **El comentario es autorreportado** desde la máquina del dev: es evidencia, no una
  compuerta infalsificable.
- **Requiere Node, `gh` autenticado y Git Bash en Windows** (por
  `${CLAUDE_PROJECT_DIR}` en el comando).
- **Hay dos puntos de la doc de hooks sin confirmar**:
  - la versión mínima de Claude Code que soporta `if` en hooks; sin `if`, Node
    arranca en cada comando de shell;
  - que `decision: block` funcione en PostToolUse; por eso el detalle también viaja
    en `additionalContext`.
- **Suma latencia**: alrededor de 1 s por push y de 5 a 20 s al crear o editar un PR
  (`gh`, reintento de mergeable, comentario).
- **Hay un problema preexistente fuera de alcance**: al pasar a modo solo con
  `--prune`, el `SessionStart` de `declarar-milestone` queda apuntando a un archivo
  borrado.

### Neutras
- Queda un comentario por corrida, no uno editado. El usuario lo prefirió así, y el
  marcador permite encontrarlos.
- `hooks` llega a los consumidores por `merge-json`. Un cambio posterior del bloque
  se agregaría al lado del viejo en vez de reemplazarlo, así que cambiarlo exige una
  migración.

## Alternatives considered

### Alternativa A: solo instrucciones en la skill
**Pros**: cambio mínimo; ningún proceso extra.
**Cons**: depende de que el modelo se acuerde en cada push y en cada PR; un olvido
deja pasar un secreto.
**Por qué se descartó**: el usuario pidió que los checks corran sí o sí.

### Alternativa B: commit statuses vía `gh api`
**Pros**: el resultado aparece en la sección de checks del PR, como antes, sin
gastar minutos.
**Cons**: más llamadas y manejo de SHA; sigue siendo autorreportado; invita a
volver a exigirlos en la branch protection, lo que trabaría los PRs creados sin el
agente.
**Por qué se descartó**: el comentario da la misma evidencia con menos maquinaria.

### Alternativa C: git hook pre-push (`core.hooksPath`)
**Pros**: cubre también los pushes humanos.
**Cons**: invade la configuración de git de cada repo consumidor, no cubre la
creación del PR y queda fuera de la superficie Claude que gestiona el harness.
**Por qué se descartó**: el pedido es que los checks corran en la sesión del agente.

### Alternativa D: un único comentario editado
**Pros**: menos ruido en el PR.
**Cons**: hay que buscarlo y editarlo por `gh api`, y `gh pr comment --edit-last`
puede pisar un comentario de una persona, porque el agente comenta con la cuenta del
dev.
**Por qué se descartó**: el usuario eligió un comentario por corrida.

## Al revertir la pausa (SHS-M36)

Esta decisión **no supersede** al ADR de la pausa, que sigue vigente. Cuando Actions
vuelva:

1. Busca `PAUSA TEMPORAL (SHS-M36)` en las skills (`soutec-github`,
   `harness-upgrade`) y `SHS-M36` en `CLAUDE.md` (plantilla y local), y reescribe
   esos párrafos.
2. Decide si el hook `reglas-pr` sigue, como red local previa a CI, o se retira.
   Retirarlo exige una migración de `settings.json`, porque `merge-json` no quita
   entradas.
3. `upgrade` no restaura los workflows de tag-release no-Node escritos a mano: se
   descomentan a mano.
4. `check-pr-rules.mjs` sigue sirviendo a los workflows tal cual: sin `--pr`, el
   comportamiento no cambió, y con `--pr` usa la base, la rama y la cabeza del PR.

## References

- ADR `20260921-pausa-github-actions.md` (SHS-M36).
- Milestone SHS-M39 del Vault (`Project-SHS/milestones.md`), épica Jira SHS-123.
- `.claude/hooks/reglas-pr.mjs`, `scripts/check-pr-rules.mjs`, `scripts/tag-release.mjs`,
  skill `soutec-github`.
- Hooks de Claude Code: https://code.claude.com/docs/en/hooks y
  https://code.claude.com/docs/en/permissions
