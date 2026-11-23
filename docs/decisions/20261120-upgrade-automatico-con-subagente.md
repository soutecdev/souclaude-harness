# ADR: El upgrade del harness corre solo en sesión, con un subagente que commitea en la rama actual

**Fecha**: 2026-11-20
**Status**: revertido el 2026-11-23 (SHS-M43-T006, v3.22.1): el security review marcó como riesgo alto que la sesión ejecute con `npx` código del repo del harness y lo commitee sin confirmación del usuario. Se retiran el subagente `harness-upgrader`, la sección «Modo autónomo» de la skill y la orden del hook; vuelve el aviso manual del ADR `20261008-aviso-de-version-en-sesion.md` (alternativa A de este documento).
**Deciders**: Leonardo I (@leonardo), con evaluación de alternativas de Claude

## Context

Desde la v3.17.0 (ADR `20261008-aviso-de-version-en-sesion.md`), los hooks de
SessionStart anuncian la versión nueva del harness y proponen la skill
`harness-upgrade`. El canal funciona, pero el upgrade sigue dependiendo de que
el desarrollador diga que sí: en la práctica el aviso se posterga sesión tras
sesión y los consumidores quedan varias versiones atrás. El paso que se deja
para después no tiene criterio humano real: la skill ya corre el flujo
completo sin pedir OK intermedio, salvo para los obsoletos editados y los hunks
ambiguos de los `.new`.

Ese ADR descartó el «auto-upgrade silencioso en SessionStart» porque violaba
rama + PR, pisaba árboles de trabajo a mitad de un feature y no tenía criterio
para los `.new`. Además, la v3.0 eliminó los agentes del harness («sin agentes
ni flujos fijos: el modelo trabaja directo»).

## Decision

Ante una versión nueva **de la misma major**, el aviso de los hooks de
SessionStart (`declarar-milestone.mjs` y `worklog-solo.mjs`) le dice a la
sesión que hay una versión nueva y le ordena actualizar **sin pedirle
confirmación al usuario**: lanzar en segundo plano el subagente
`harness-upgrader` y seguir con lo que pidió el usuario.

**El procedimiento es agnóstico a la herramienta.** Vive en una sola fuente, la
sección «Modo autónomo» de la skill `harness-upgrade`, que el harness instala
para Claude Code (`.claude/skills/`) y para Codex y Antigravity
(`.agents/skills/`). En Claude Code, `.claude/agents/harness-upgrader.md`
(gestionado por el manifest) es un envoltorio delgado que remite a esa sección.
En otra herramienta, la sesión lanza un subagente propio —con el nombre
`harness-upgrader` si su mecanismo lo permite— con esa consigna, y si no puede
lanzar subagentes corre la sección ella misma, también sin preguntar. Así cada
agente adapta el mecanismo y el procedimiento no se duplica. El subagente:

- corre el flujo de `harness-upgrade` con el **tag exacto** de la versión nueva;
- no toca secciones que llenó el usuario ni resuelve hunks ambiguos: los deja
  en el `.new` y los reporta; tampoco borra obsoletos editados;
- commitea **solo** los archivos que cambió el upgrade, por ruta explícita, en
  la **rama actual**, sin push, sin PR y sin tocar el Vault;
- termina con «Harness actualizado: vX a vY» o «Harness no actualizado: motivo».

El archivo del agente de Claude Code es la única excepción a «sin agentes» de
la v3.0, y no lleva lógica propia: existe porque el trabajo tiene que correr
aislado y en paralelo a la sesión, no como un rol del flujo.

Límites duros, resueltos en el hook antes de que el modelo decida nada: en
`main`, `master` o HEAD suelto el aviso solo avisa (ahí no se commitea nunca), y
si el repo no tiene la skill `harness-upgrade` queda el aviso manual de siempre. La
major nueva sigue siendo una migración manual.

## Consequences

### Positivas
- Los consumidores se mantienen al día sin depender de que alguien diga que sí.
- Sirve igual en Claude Code, Codex y Antigravity: una sola fuente del
  procedimiento, y cada herramienta pone su mecanismo de subagentes.
- Se conserva lo que motivó el rechazo de la alternativa C del ADR anterior: el
  cambio llega a `dev` dentro del PR de la rama de trabajo, con su propio commit
  `chore: actualizar harness vX a vY`, revisable y revertible por separado.
- El usuario sigue trabajando mientras corre el upgrade.

### Negativas
- El commit del upgrade viaja dentro del PR de un feature que no lo pidió.
- Los hooks o `settings.json` nuevos no se cargan hasta reiniciar Claude Code; el
  subagente lo avisa, pero la sesión en curso sigue con los viejos.
- Un subagente que commitea sin preguntar es una superficie nueva: depende de
  que respete «solo los archivos del upgrade» (lo exige su prompt; no hay un
  control mecánico).

### Neutras
- El arranque en frío se repite: el subagente llega a cada consumidor con un
  upgrade manual, y recién desde ahí el siguiente corre solo.

## Alternatives considered

### Alternativa A: dejar el aviso manual (statu quo de la v3.17.0)
**Pros**: cero riesgo nuevo; el usuario decide cada upgrade.
**Cons**: el aviso se posterga y los consumidores se desfasan.
**Por qué se descartó**: no resuelve el problema que motiva esta decisión.

### Alternativa B: upgrade en el hook, sin modelo
**Pros**: determinista, sin agente.
**Cons**: el hook tiene timeout corto y no puede revisar `.new` hunk por hunk;
bloquearía el arranque de la sesión.
**Por qué se descartó**: el upgrade necesita criterio y tiempo que un hook no
tiene.

### Alternativa D: el procedimiento completo en `.claude/agents/harness-upgrader.md`
**Pros**: un archivo, formato nativo de Claude Code.
**Cons**: Codex y Antigravity no leen `.claude/agents/`: el upgrade automático
quedaría solo para Claude Code, o habría que duplicar el procedimiento por
herramienta.
**Por qué se descartó**: el harness es agnóstico al agente (SHS-M48).

### Alternativa C: el modelo principal corre la skill en primer plano
**Pros**: sin agente nuevo.
**Cons**: interrumpe lo que pidió el usuario y llena su contexto con el
volcado del upgrade.
**Por qué se descartó**: el subagente en segundo plano aísla el trabajo y el
contexto.

## References

- Milestone SHS-M43 del Vault, tarea T005.
- `docs/decisions/20261008-aviso-de-version-en-sesion.md` (el aviso y su
  alternativa C descartada).
- `templates/base/claude/agents/harness-upgrader.md`,
  `templates/base/claude/hooks/declarar-milestone.mjs`,
  `templates/base/claude/hooks/worklog-solo.mjs`.
- `test/hook-aviso-version.test.js`.
