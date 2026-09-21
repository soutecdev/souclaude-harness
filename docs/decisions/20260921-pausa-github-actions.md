# ADR: Pausa temporal y revertible de GitHub Actions

**Fecha**: 2026-09-21
**Status**: accepted (temporal — se revierte al cerrar la optimización de los checks)
**Deciders**: Ignacio A. (@ignacio)

## Context

El consumo de minutos de GitHub Actions de la organización es demasiado alto. La
fuente principal es la superficie de CI que el harness instala y mantiene:

- En este repo, `ci.yml` corre una matriz de 4 jobs (windows/ubuntu × Node 22/24)
  en cada push a `main`/`dev` y en cada PR.
- En cada repo consumidor (y aquí), tres workflows `reglas-*.yml` corren en cada
  PR (rama+commits, secretos, pr-metadata) y `tag-release.yml` en cada merge a
  `main`.

Hasta optimizar esa funcionalidad (menos jobs, filtros por paths, concurrencia,
runners más baratos, etc.) se necesita **detener por completo todo check
automático**, de forma que el cambio sea fácil de revertir cuando la optimización
esté lista.

Restricción: `github-protect.js` declara `reglas-secretos` y `reglas-pr-metadata`
como checks **requeridos** en la branch protection de `main`. Si los workflows
dejan de correr pero los checks siguen requeridos, GitHub queda esperando un
check que nunca llega y **ningún PR a `main` puede mergearse**.

## Decision

1. **Los 9 workflows** (5 en `.github/workflows/` de este repo y los 4 distribuidos
   en `templates/base/github/workflows/`) reemplazan su bloque `on:` por
   `on: workflow_dispatch:`. El bloque `on:` original queda **comentado justo
   encima**, con un comentario `PAUSA TEMPORAL (SHS-M36)` que apunta a este ADR.
   Los workflows siguen existiendo (y pueden lanzarse a mano desde la UI de
   Actions), pero no se disparan solos.
2. `CHECKS_REQUERIDOS` en `src/core/github-protect.js` queda en `[]` y la
   protección de `main` se aplica con `required_status_checks: null`. La línea
   original queda comentada. El resto de la protección (PR obligatorio,
   `enforce_admins`, sin force-push ni borrado) **no cambia**.
3. Los repos consumidores reciben la pausa con `npx souclaude upgrade`: los
   workflows son `managed` y la branch protection se reaplica en cada upgrade.
4. Ningún archivo se borra ni se saca del manifest: el revert es restaurar
   contenido, no reconstruir.
5. **Regla permanente (no se revierte): solo los workflows del harness.** Se
   detectó que distintos proyectos venían sumando workflows y checks propios según
   la funcionalidad implementada, con consumo dispar de minutos. Las
   instrucciones distribuidas (`CLAUDE.md`, `CLAUDE-solo.md`, skills
   `soutec-github` y `soutec-github-solo`) prohíben crear o modificar workflows
   en `.github/workflows/` por proyecto; cualquier necesidad de CI propia se
   pide al coordinador y se evalúa en el harness.

### Procedimiento de revert

1. En cada workflow: borrar el bloque `on:\n  workflow_dispatch:` y descomentar el
   `on:` original (quitar el comentario `PAUSA TEMPORAL`).
2. En `github-protect.js`: restaurar
   `const CHECKS_REQUERIDOS = ['reglas-secretos', 'reglas-pr-metadata']` y borrar
   el comentario de pausa.
3. `npm test` y `npx souclaude verify` en verde; release del harness; en cada
   repo consumidor `npx souclaude upgrade` (reaplica workflows y protección).
4. Marcar este ADR como `superseded` por el ADR de la optimización.

El punto 5 (solo workflows del harness) **no forma parte del revert**: queda
vigente después de reactivar los checks.

Como todo entró en un solo milestone (SHS-M36), `git revert` del merge commit de
su PR es la vía rápida si no hubo cambios encima.

## Consequences

### Positivas
- Consumo de minutos de Actions a cero de inmediato, en este repo y en los
  consumidores tras su próximo `upgrade`.
- Revert mecánico y localizado: cada archivo lleva su original comentado.
- No hay que reconstruir el manifest ni los tests: los archivos siguen ahí.

### Negativas
- **Sin red de seguridad automática mientras dure la pausa**: no se valida
  secretos, base=dev, versión ni plantilla de PR en el servidor. El agente y el
  revisor deben aplicar `scripts/check-pr-rules.mjs` a mano
  (`node scripts/check-pr-rules.mjs` en la rama) y la skill `soutec-github`.
- **Los tags de release vuelven a ser manuales**: `tag-release.yml` ya no corre
  al mergear `dev` → `main`; el agente crea `vX.Y.Z` y el tag móvil `vX` como
  documenta la skill `soutec-github`.
- La suite de este repo solo corre local (`npm test`) hasta el revert.

### Neutras
- La branch protection de `main` **de este repo** en GitHub no se actualiza sola
  (aquí no corre `souclaude upgrade`): el coordinador debe quitar los checks
  requeridos a mano o correr
  `gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input -` con el
  cuerpo que genera `github-protect.js`. Hasta entonces, el PR de este milestone
  a `dev` no se ve afectado (la protección es solo de `main`), pero el próximo
  release `dev` → `main` sí.

## Alternatives considered

### Alternativa A: borrar los workflows y sus entries del manifest
**Pros**: cero ambigüedad, nada que pueda dispararse.
**Cons**: el revert exige recuperar archivos de git, reponer entries del manifest
y el upgrade en los consumidores los marcaría como obsoletos (`--prune` los
borraría del repo consumidor).
**Por qué se descartó**: el pedido es explícito en que debe poder revertirse; el
costo de revert es mucho mayor.

### Alternativa B: desactivar los workflows desde la UI de GitHub (Actions → Disable)
**Pros**: sin cambios en el código.
**Cons**: hay que hacerlo repo por repo, a mano, y no queda traza en git; los
consumidores nuevos que instalen el harness seguirían recibiendo workflows
activos.
**Por qué se descartó**: el harness es el que distribuye la superficie; la pausa
tiene que viajar con él.

### Alternativa C: filtrar con `paths:` / `concurrency` para reducir runs
**Pros**: mantiene parte de la protección.
**Cons**: es justamente la optimización pendiente; requiere análisis y no
detiene el consumo ya.
**Por qué se descartó**: es el trabajo que sigue a esta pausa, no un sustituto.

## References

- Milestone SHS-M36 (Vault `Project-SHS/milestones.md`), épica Jira SHS-106.
- `src/core/github-protect.js`, `.github/workflows/*.yml`,
  `templates/base/github/workflows/*.yml`.
- ADR `20260915-modo-solo.md` (CI mínimo en modo solo) y SHS-M33 (separación de
  los checks).
