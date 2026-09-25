---
name: soutec-github-solo
description: Flujo Git/GitHub de SOUTEC en modo solo (single coder). Aplicar SIEMPRE antes de crear una rama, commitear, pushear, mergear o taggear en un repo instalado en modo solo. Git fluido - ramas simples tipo/slug, commits Conventional sugeridos, merge directo del agente a dev y a main, PR opcional sin plantilla, tags de versión al publicar y la regla de secretos como única regla dura.
---

# SOUTEC — Git & GitHub (modo solo)

Este repo está en **modo solo**: trabaja una sola persona y el objetivo es no
frenarla. No hay coordinador, no hay aprobaciones, no hay checks de formato que
bloqueen. Lo que sigue son convenciones para que el historial se mantenga legible
— y **una** regla que sí es ley.

## Las reglas inviolables

- **Nunca commitear secretos**: `.env`, `*.pem`, `*.key`, `*.pfx`,
  `credentials.json`, `secrets.json`, tokens, contraseñas, llaves privadas.
  `.env.example` sin valores. Si una credencial se expone por accidente:
  **rotarla**, no solo borrar el commit.
- Corolario fuera de este repo: en el **Vault** (repo compartido de la
  organización) jamás `git push --force`.
- **Nunca crear workflows de GitHub Actions ni checks adicionales.** El único
  workflow del repo es el que instala el harness (`reglas-secretos.yml`); no se
  agregan otros en `.github/workflows/` (tests, lint, build, deploy, checks) ni
  se edita ese a mano. Si el proyecto necesita CI propia, se pide al coordinador
  y se evalúa en el harness: los minutos de Actions son de la organización.

## Flujo fluido

Cuando el trabajo está terminado y probado, **puedes mergear y pushear directo a
`dev` y a `main`** — sin PR, sin esperar a nadie:

```bash
git checkout dev && git pull origin dev
git checkout -b tipo/descripcion-corta      # rama simple; lo trivial puede ir directo a dev
# ... commits ...
git checkout dev && git merge tipo/descripcion-corta && git push origin dev
# cuando hay algo publicable:
git checkout main && git pull origin main && git merge dev && git push origin main
```

Antes de mergear a `main`: el proyecto corre localmente, el flujo afectado está
probado y los tests (si existen) pasan. Fluido no significa a ciegas.

`git push --force` no está bloqueado en este repo, pero evítalo sobre `dev` y
`main`: reescribir historia publicada sigue siendo mala idea aunque trabajes solo.

## Ramas

Formato `tipo/descripcion-corta` (`feature/captura-lead`, `fix/timeout-api`).
Sin IDs de milestone: en modo solo no hay milestones.

| Tipo | Uso |
|---|---|
| `feature/` | Nueva funcionalidad |
| `fix/` | Corrección de error no crítico |
| `hotfix/` | Corrección urgente sobre producción |
| `docs/` | Documentación |
| `chore/` | Mantenimiento, dependencias o configuración |
| `refactor/` | Mejora interna sin cambiar comportamiento |
| `experiment/` | Pruebas, POC, IA o laboratorio |

**Prohibidos**: `cambios`, `prueba`, `final`, `final-final`, `arreglo`, o el nombre
de una persona. Al terminar, borra la rama mergeada (`git branch -d`).

## Commits

```
tipo: descripción breve del cambio
```

Sin scope, en español. Tipos: `feat` `fix` `docs` `chore` `refactor` `test`
`style` `build` `ci` `perf` `revert`. Un hotfix se commitea como `fix:`.
**Prohibidos**: `update`, `cosas`, `ya`, `ahora sí`.

Es una convención sugerida — ningún check la bloquea — pero síguela por defecto:
*git tiene memoria; no le demos material para novela de misterio.*

## Pull Request (opcional)

El PR **no es obligatorio ni tiene plantilla**. Ábrelo solo si el usuario lo pide
o si sirve como registro de un cambio grande; sin aprobaciones, **tú mismo puedes
mergearlo** (`gh pr merge --squash`). Si piden correcciones sobre un PR abierto:
push a la misma rama, nunca un PR nuevo.

## Versionamiento

SemVer con prefijo `v`: `v1.2.3` (PATCH corrección · MINOR compatible · MAJOR
incompatible). Al publicar: bump de versión en el archivo del stack
(`package.json` o equivalente), merge `dev` → `main` y **crea y pushea los tags
tú mismo** — el inmutable `vX.Y.Z` y el móvil de la serie (`v1`, `v2`...) — en el
mismo momento. En modo solo normalmente no hay PR de release que dispare un
workflow de tags, así que el tag manual es el camino normal.

## La traza que sí es obligatoria

La trazabilidad del modo solo vive en el **worklog del Vault**, no en Git: al
empezar cada bloque de trabajo, una línea con fecha y objetivo en
`Project-<PREFIJO>/worklog.md` y push inmediato (ver CLAUDE.md, sección "El
Vault"). Git fluido no exime de esa línea.

## Ficha del Observatorio (`OBSERVATORIO.md` en el Vault)

Solo si el repo tiene el Vault conectado (`.claude/vault.local.json`):

- **Al instalar el harness**, si hay contexto del proyecto, rellena la ficha y
  pushéala al Vault en el momento. Si hay hitos/milestones para cargar, no los
  metas todos en "Hitos" a ciegas: para cada uno evalúa por fecha/repo/tags si ya
  ocurrió o es planificado a futuro, o pregúntale al usuario. Lo ya ocurrido va en
  "Hitos"; lo planificado va en "Próxima versión". Los hitos de la Roca van
  aparte, en "Planificación".
- **Al instalar y en cada actualización, solo si hace falta**: si hay una Roca
  vigente del proyecto (`Roca_<trimestre>_<PREFIJO>.md` en `Project-<PREFIJO>/`,
  raíz o subcarpeta `roca/`/`rocas/`), lleva todos sus hitos a la sección
  "Planificación" de la ficha con el formato de la plantilla del Vault:
  `- AAAA-MM-DD · <PREFIJO>-H<n> · <título> · cumplido` (fecha real y marca
  `cumplido` si se cumplió; si no, la fecha planificada y sin marca, salvo
  on/off track declarado en la Roca), por fecha y sin responsable. Nunca en
  "Hitos" ni en "Próxima versión", que son solo de releases (si quedaron ahí
  de una versión anterior, muévelos). Si la ficha no tiene "Planificación",
  agrégala al final como en la plantilla. Si ya coinciden, no hagas nada —
  esto no es un paso que reescriba o pushee en cada actualización. Si falta,
  cambió o sobra una, corrígelo. **Sin Roca vigente, pregúntala una vez, sin
  bloquear**: no todos los proyectos son Rocas. Si el usuario te pasa su Roca
  — lo normal es el export de Ninety/EOS en PDF (tabla de Milestones Title /
  Completed / Due / Owner), que lees con `Read` —, cárgala en el Vault sin
  inventar nada: `Roca_<trimestre>_<PREFIJO>.md` (todo el contenido y tabla
  "Alta rápida" Title / Due date / Completed) y `.yaml` según
  `00-System/templates/plantilla_apertura_roca.yaml`; año de las fechas del
  documento y trimestre preguntado si es ambiguo. Luego agrega sus hitos a
  "Planificación" y pushea. Si no hay Roca o la deja para después, sigue sin
  más.
- **Al publicar un release con tag**, agrega el hito en la sección "Hitos"
  (`- YYYY-MM-DD · vX.Y.Z · resumen breve`) con push directo al Vault. Todo tag
  publicado tiene su línea. En el mismo momento revisa toda "Próxima versión"
  contra lo que el release entrega de verdad: quita lo que se cumple del todo,
  edita la línea si solo se cumple una parte (varios hitos agrupados en una
  línea), y deja el resto si no es claro.
- **Ante un cambio importante del proyecto** (alcance, plataforma, equipo),
  actualiza la sección afectada y pushea.

## Lo que NO existe en modo solo

No lo apliques ni lo exijas: plantilla de PR, aprobaciones y coordinador,
squash & merge obligatorio, checks de rama/commits en CI, milestones/kanban y
espejo del tablero (Jira/Azure Boards). Para volver a la metodología completa:
`npx souclaude upgrade --equipo`.
