# ADR: Una rama Git por milestone, no por tarea

**Fecha**: 2026-09-12
**Status**: accepted — supersede parcialmente a
`20260817-milestones-planes-y-sesiones-en-vault.md` en lo referente a rama y PR
**Deciders**: Leonardo Ibarra

## Context

Desde el ADR del 2026-08-17 la metodología prescribía una rama Git por **tarea** del
kanban (`feature/SHS-M7-T006-playbook-adopcion`): cada tarjeta `-T<nnn>` nacía con
su rama, su PR y su espera de merge. En la práctica eso corta el flujo de trabajo:
una tarea chica obliga a rama + PR + coordinación con el coordinador +
sincronización del Vault y del espejo, y el desarrollador pasa más tiempo
administrando ramas que trabajando. El ADR `20260722-capa-rocas-hito-emisor-de-ids`
ya había atado la rama al **hito** (hoy milestone), no a la tarea; la granularidad
por tarea fue una deriva posterior.

El relevamiento previo mostró que la regla no vivía en ningún validador: el regex
de `scripts/check-pr-rules.mjs` ya aceptaba `feature/SHS-M7-slug`, el monitor ya
infería el milestone desde cualquier rama (`milestoneDeRama`), y el contrato de
columnas de `src/core/vault-seeds.js` no dependía de la granularidad. Era prosa
normativa repetida en la skill `soutec-github`, `CLAUDE.md` (local y plantilla),
`AGENTS.md`, `progress/README.md`, la skill `vault-milestones`, la plantilla de PR
y las guías del Vault.

## Decision

1. **Una rama por milestone.** La rama `tipo/M<n>-slug` nace de `dev` al
   tomar el milestone (tarjeta a En curso en `milestones.md`, rama anotada en la
   tarjeta) y vive hasta cerrarlo. El ID de tarea `-T<nnn>` nunca va en el nombre
   de la rama. El Vault sigue desglosado en tareas: las tareas son commits en la
   rama del milestone (opcionalmente `Cierra <ID>` en el cuerpo del commit).
   **Sin clave de proyecto en la rama** (`M31-`, no `SHS-M31-`): un repo pertenece
   a un solo proyecto del Vault, declarado en `vault.local.json`, así que la clave
   es redundante en el nombre. Quien necesite el ID completo lo reconstruye con
   ese `project`: `milestoneDeRama(rama, prefijo)` en el monitor lo hace para
   `sessions.md`. En el registro de usage de `00-System/monitor/usage/` (que no
   conoce el proyecto del Vault) las ramas cortas quedan con `milestone: null`;
   las ramas viejas con clave siguen resolviendo en ambos.
2. **Una tarea pasa a Hecho al pushear su commit** a la rama del milestone, sin
   esperar el merge del PR. La columna `En review` del kanban queda opcional: solo
   para tareas que el usuario quiera dejar gateadas por un PR concreto (ahí sí
   `PR #N` en la tarjeta, que el hook `declarar-milestone.mjs` sigue cruzando con
   los merges).
3. **PRs parciales admitidos** desde la misma rama hacia `dev`, uno abierto a la
   vez, cada uno listando en su descripción las tareas que integra. Tras el squash
   & merge de un PR parcial se sigue en la misma rama con
   `git fetch origin && git merge origin/dev`; nunca se recrea la rama ni se hace
   `push --force`. La rama se borra solo al cerrar el milestone.
4. **Cambios de código mínimos y compatibles**: `RAMA_REGEX` de
   `check-pr-rules.mjs` suma la forma `M<n>-` y conserva las ramas legadas con
   clave y por tarea; `milestoneDeRama(rama, prefijo)` del monitor resuelve la
   forma corta con el proyecto declarado. El hook `declarar-milestone.mjs` y el
   contrato de columnas de `vault-seeds.js` no cambian.

## Consequences

### Positivas
- Menos fricción: un solo ciclo rama/PR por objetivo verificable; las tareas se
  cierran con un push.
- El tablero sigue reflejando el ahora al nivel de tarea, y `sessions.md` y el
  monitor infieren el milestone de la rama con más fidelidad (la rama ya es el
  milestone).
- Coincide con la doctrina original de "el hito emite el ID que amarra rama → PR →
  tag".

### Negativas
- Ramas más largas: más exposición a conflictos con `dev`. Mitigación: `git merge
  origin/dev` tras cada PR parcial y milestones chicos (si un milestone no cabe en
  una rama, se divide con `vault-milestones`).
- "Hecho" en el kanban ya no significa "mergeado en `dev`": el merge se lee en la
  tarjeta del milestone (`PR #N`) o en GitHub.
- Tras un squash & merge parcial, el historial de la rama y el de `dev` divergen
  en forma; el merge de vuelta es limpio porque el contenido es idéntico, pero
  conviene no reordenar ni amender commits ya integrados.

### Neutras
- `En review` sigue existiendo en el contrato de columnas; solo cambia su uso.
- Las ramas por tarea abiertas antes del cambio siguen validando en CI.

## Alternatives considered

### Alternativa A: tarea a Hecho solo al mergear el PR del milestone
**Pros**: "Hecho" conserva el significado "integrado en `dev`"; el hook cierra todas
las tarjetas del PR de una vez.
**Cons**: las tarjetas se acumulan en En review hasta el merge; con PRs parciales
el cruce PR ↔ tarjeta se vuelve ambiguo.
**Por qué se descartó**: reintroduce la espera que motivó el cambio.

### Alternativa B: un único PR al cierre del milestone
**Pros**: cruce PR ↔ milestone trivial; nunca hay que seguir en la rama tras un
squash.
**Cons**: PRs grandes y tardíos; el coordinador revisa todo junto.
**Por qué se descartó**: el usuario prefiere poder integrar por partes.

## References

- `docs/decisions/20260817-milestones-planes-y-sesiones-en-vault.md` (superseded
  parcialmente)
- `docs/decisions/20260722-capa-rocas-hito-emisor-de-ids.md`
- Skill `soutec-github`, sección "Ciclo de vida de la rama del milestone"
- Milestone SHS-M31 del Vault (épica Jira SHS-83)
