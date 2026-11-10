# ADR: El release se cierra solo tras el merge: tag, GitHub Release, ficha del Observatorio y espejo del tablero

**Fecha**: 2026-11-10
**Status**: accepted
**Deciders**: Leonardo Ibarra (@leonardo), con propuesta y evaluación de alternativas de Claude

## Context

Después de aprobar y mergear el PR de release `dev` → `main`, quedaba una cola de
pasos manuales: crear el tag (script del agente), crear el GitHub Release (regla
«los releases son del coordinador»), completar el hito en la ficha
`OBSERVATORIO.md` del Vault y revisar que el espejo del tablero (Azure Boards)
reflejara lo que salió. Cada paso dependía de que alguien se acordara de pedirlo,
y los hitos de la ficha iban quedando en formatos distintos entre proyectos
(auditoría del 2026-11-10: 20 de 22 fichas con hitos fuera del formato oficial
`AAAA-MM-DD · vX.Y.Z - Título · descripción`).

Restricciones: GitHub Actions está en pausa (SHS-M36) y un workflow no alcanza el
Vault ni el conector MCP del espejo; el coordinador mergea en un momento que ni el
desarrollador ni el agente controlan, y la sesión que abrió el PR puede haberse
cerrado para entonces; los releases de GitHub son texto público.

## Decision

**El desarrollador solo aprueba el PR de release; el cierre es automático.**

1. **Un único texto**, en la sección `## Release en GitHub` del cuerpo del PR de
   release (`Título` de hasta 6 palabras, `Descripción` de menos de 30 palabras,
   `Milestones`). De ahí salen el nombre y el cuerpo del GitHub Release y el hito
   de la ficha, que no pueden desalinearse. `scripts/release-publicar.mjs` valida
   el texto y crea o actualiza el release de forma idempotente.
2. **Disparo híbrido**:
   - el agente que abrió el PR queda atento al merge (sondeo con `gh pr view`);
   - si la sesión se cerró, el hook de SessionStart de la siguiente sesión detecta
     el release mergeado sin cerrar (tag, GitHub Release o hito faltantes, dentro
     de 14 días) y ordena lanzar el subagente;
   - con Actions activo, `tag-release.yml` crea tag y release de inmediato
     (`continue-on-error`), y el subagente verifica el resto.
3. **Subagente de cierre** (skill `soutec-github`, «Cierre del release»): tag →
   release → revisión de hitos de la ficha → hito → «Próxima versión» → espejo del
   tablero. **Si algún hito de la ficha está fuera de formato, no toca nada y
   pregunta al desarrollador; si todo está en regla, agrega el hito y publica.**
   En el espejo, lo que estaba en review y salió en el release pasa a Hecho (Vault
   primero) y a Done; lo que no cuadre se reporta y se pregunta.
4. **Los GitHub Releases dejan de ser del coordinador.**

## Alternatives considered

- **Solo un workflow de Actions**: es lo más inmediato, pero no alcanza el Vault ni
  el MCP, y Actions está en pausa. Se conserva como parte determinista (tag y
  release).
- **Esperar el merge dentro de la sesión, sin hook**: frágil; el merge puede llegar
  horas o días después de que se cierre la sesión.
- **Que el subagente reescriba los hitos viejos mal formados**: tendría que inventar
  títulos de hitos que no son releases (la plantilla prohíbe inventar datos) y
  tocaría fichas con dueño; se prefiere preguntar.
- **Texto del release redactado por el subagente tras el merge**: publicaría un
  texto público sin revisión; se prefiere escribirlo al abrir el PR, donde el
  desarrollador lo ve y lo aprueba junto con el resto.

## Consequences

- Sin sesión abierta y con Actions en pausa, el cierre ocurre en la siguiente sesión
  del repo, no al instante; solo reactivar Actions daría tag y release inmediatos.
- Un PR de release sin la sección `## Release en GitHub` deja el release sin crear
  hasta que el desarrollador la complete: el subagente pregunta en vez de inventar.
- El espejo del tablero depende de que el conector esté autorizado; si no lo está,
  se reporta y el resto del cierre sigue.
- `release-publicar.mjs` se distribuye como archivo managed con la misma condición de
  stack que `tag-release.mjs` (solo Node); los demás stacks cierran el release con
  el flujo de la skill sin el script.
