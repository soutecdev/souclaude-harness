---
name: soutec-github
description: Flujo Git/GitHub obligatorio de SOUTEC (Guía Operativa v2.0). Aplicar SIEMPRE antes de crear una rama, commitear, pushear o abrir un Pull Request en un repo de SOUTEC. Cubre nombres de rama tipo/ID-milestone (una rama por milestone, no por tarea), commits Conventional Commits, la plantilla obligatoria de PR, los checks de PR que corre el hook reglas-pr en la sesión, squash & merge, semver vX.Y.Z (tags de release) y las reglas de secretos.
---

# SOUTEC — Git & GitHub

> *"Primero disciplina, luego automatización. Automatizar el desorden solo produce
> caos más rápido."* — Guía Operativa v2.0

## Reglas inviolables

Estas no se negocian, ni siquiera en un hotfix.

- **Nunca `git push origin main`.** `main` es producción. Nadie trabaja directo sobre
  `main` — tampoco el coordinador ni los administradores.
- **`main` solo recibe merges desde `dev`.** Las ramas de trabajo nacen de `dev` y su
  PR apunta a `dev`; el paso `dev` → `main` es el release, también por PR. Ninguna
  rama de trabajo mergea directo a `main`.
- **Nunca hacer merge de un PR propio.** El autor del cambio no mergea. El squash &
  merge lo hace el coordinador o el aprobador suplente.
- **Nunca aprobar un PR.** Nadie aprueba lo suyo.
- **Nunca `git push --force`.** Solo `--force-with-lease`, solo sobre rama propia, y
  solo si se usó rebase. Con la política por defecto (merge) no hay force-push nunca.
- **Nunca commitear secretos**: `.env`, `*.pem`, `*.key`, `*.pfx`, `credentials.json`,
  `secrets.json`, tokens, contraseñas, llaves privadas.
- **Nunca crear una rama sin nombre descriptivo.** Formato `tipo/descripcion-corta`. Si
  el trabajo tiene un ID rastreable — milestone del Vault, o tarea de un tracker
  externo — va como prefijo del slug (`feature/M7-playbook-adopcion`,
  `feature/REA-123-captura-lead`); si no lo hay, el slug solo. **No inventes IDs.**
- **Una rama por milestone, no por tarea.** Las tareas del kanban del Vault son
  commits en la rama de su milestone; el ID `-T<nnn>` nunca va en el nombre de la
  rama. Ver "Ciclo de vida de la rama del milestone".
- **Nunca crear repositorios.** Eso es del coordinador. Los **tags de versión**
  (`vX.Y.Z` y el tag móvil por major) se crean únicamente al publicar, después
  del merge del PR de release `dev` → `main`: los crea el workflow
  `tag-release.yml` o, en repos sin ese workflow, el agente.
  **PAUSA TEMPORAL (SHS-M36)**: mientras GitHub Actions esté en pausa,
  `tag-release.yml` no se dispara y los tags los crea siempre el agente (ver
  "Versionamiento"). El **GitHub Release** tampoco es del coordinador: se crea
  solo al mergearse el PR de release, con su descripción corta (ver "Cierre del
  release").
- **Un hotfix NO es un bypass.** Aun en máxima criticidad: rama + Pull Request.
- **Nunca crear workflows de GitHub Actions ni checks adicionales.** Los únicos
  workflows del repo son los que instala y actualiza el harness (`reglas-*.yml`,
  `tag-release.yml`); no se agregan otros en `.github/workflows/` por proyecto ni
  por funcionalidad (tests, lint, build, deploy, checks extra en los PRs) ni se
  editan a mano. Si un proyecto necesita CI propia, se pide al coordinador y se
  evalúa en el harness. El consumo de minutos de Actions es de la organización,
  no del repo.

## Antes de tocar código

```bash
git checkout dev
git pull origin dev           # siempre partir de dev actualizado
git checkout -b tipo/descripcion-corta
```

Chequeo previo: ¿leíste el README? ¿tienes el `.env` local configurado?

## Nombre de rama

```
tipo/descripcion-corta          # o tipo/ID-descripcion-corta si hay ID rastreable
```

El **ID** va en mayúsculas como prefijo del slug y es uno de estos (**no inventes
IDs**):

- **Milestone del Vault** (el caso normal con Vault conectado):
  `feature/M7-playbook-adopcion`. **Una rama por milestone**; las tareas del
  milestone (`SHS-M7-T001`, `T002`, ...) se hacen como commits en esa rama. El ID
  de tarea `-T<nnn>` **nunca** va en el nombre de la rama. La **clave del proyecto
  tampoco** (`M7-`, no `SHS-M7-`): el repo ya pertenece a un solo proyecto del
  Vault (`project` en `.claude/vault.local.json`), y el monitor la completa solo
  al inferir el milestone. El número de milestone va en mayúscula (`M7`).
- **Tracker externo** (sin Vault): `feature/REA-123-captura-lead`
- **Sin ID rastreable**: `feature/captura-lead`

## Ciclo de vida de la rama del milestone

Con Vault conectado, la rama y el milestone viven juntos:

1. **Nace de `dev` al tomar el milestone** (tarjeta a En curso en `milestones.md`),
   con el nombre `tipo/M<n>-slug`. Anota la rama en la tarjeta del
   milestone.
2. **Cada tarea terminada son commits pusheados a esa rama.** Cuando el push
   pasa (si el hook `reglas-pr` lo deniega, la tarea sigue En curso), la
   tarjeta de la tarea pasa a **Hecho** en `kanban.md` en ese momento (push
   inmediato al Vault, espejo en la skill de sincronización instalada). No hace
   falta esperar a que el PR se mergee. `En review` queda para las tareas que el
   usuario quiera dejar gateadas por un PR concreto (ahí sí se anota `PR #N`).
3. **PRs parciales admitidos.** Desde la misma rama se abren tantos PRs a `dev`
   como el usuario pida (uno abierto a la vez); cada PR lista en su descripción las
   tareas que cubre. Tras el squash & merge de un PR parcial, **se sigue en la misma
   rama**: `git fetch origin && git merge origin/dev` (mergea limpio: los cambios
   ya integrados son idénticos a ambos lados) y a continuar. Nunca borres ni
   recrees la rama entre PRs parciales, y nunca `push --force`.
4. **El milestone se cierra** cuando todas sus tareas están en Hecho y el último PR
   está mergeado: tarjeta a Hecho en `milestones.md` y recién ahí se borra la rama
   (`git branch -d`).

Si un milestone resulta demasiado grande para una rama, la solución es dividir el
milestone (skill `vault-milestones`), no abrir ramas por tarea.

| Tipo | Uso |
|---|---|
| `feature/` | Nueva funcionalidad |
| `fix/` | Corrección de error no crítico |
| `hotfix/` | Corrección urgente sobre producción |
| `docs/` | Documentación |
| `chore/` | Mantenimiento, dependencias o configuración |
| `refactor/` | Mejora interna sin cambiar comportamiento |
| `experiment/` | Pruebas, POC, IA o laboratorio |

```
feature/captura-lead
fix/error-integracion-odoo
hotfix/correccion-produccion
refactor/mejorar-estructura-api
experiment/prueba-modelo-rag
```

**Prohibidos**: `cambios`, `prueba`, `final`, `final-final`, `arreglo`, o el nombre de
una persona.

## Commits

```
tipo: descripción breve del cambio
```

Sin scope. Sin ID en el título del commit (el ID del milestone va en la rama y en
el PR). Si quieres dejar rastro de qué tarea del kanban cierra un commit, ponlo en
el **cuerpo** del mensaje (`Cierra SHS-M7-T003`), nunca en el título. Descripciones
en español.

| | | |
|---|---|---|
| `feat` | `fix` | `docs` |
| `chore` | `refactor` | `test` |
| `style` | `build` | `ci` |
| `perf` | `revert` | |

```
feat: agregar endpoint de consulta de órdenes
fix: corregir error de autenticación con Odoo
refactor: reorganizar servicio de conexión a BD
```

**Ojo**: no existe el tipo de commit `hotfix`. Un hotfix **se commitea como `fix:`**.

**Prohibidos**: `update`, `fix`, `cosas`, `ya`, `ahora sí`.
*Git tiene memoria; no le demos material para novela de misterio.*

## Sincronizar con dev

**Por defecto, merge.** Simple, no reescribe historia, no requiere force-push.

```bash
git fetch origin
git merge origin/dev
# resolver conflictos si los hay
git push origin <tu-rama>
```

Rebase es opcional y solo para uso avanzado: nunca sobre rama compartida, y con
`--force-with-lease`. Como el squash & merge descarta el historial granular de la rama
igual, el rebase es esencialmente cosmético.

## Pull Request

**El PR se abre solo con el visto bueno del usuario.** Terminar un cambio no
implica abrir el PR: el agente lo crea únicamente cuando el usuario lo pide
("abre el PR"), dice que quiere mergear/integrar el trabajo o responde que sí a
tu pregunta. **El agente pregunta una sola vez, cuando ya es hora de cerrar** (el
feature está terminado y verificado), si abre el PR; no lo menciona antes ni lo
repite en cada avance. Sin esa respuesta no lo abre. Mientras tanto: commit y push
a la rama. Esto evita PRs de features a medio terminar.

Antes de pedir revisión:
- El proyecto corre localmente.
- El flujo afectado está probado.
- No hay `.env` ni credenciales en el commit.
- El README está actualizado si aplica.
- El PR indica si requiere versión/release.

**Los checks de PR corren en la sesión, con el hook `reglas-pr`.**
PAUSA TEMPORAL (SHS-M36): con GitHub Actions en pausa, los checks de
`scripts/check-pr-rules.mjs` no corren en CI. Los corre, solo, un hook de
**Claude Code** (`.claude/hooks/reglas-pr.mjs`, SHS-M39 — no es un git hook):

- **Antes de cada `git push`, la rama** (SHS-M42): si el push toca `main` de un
  repo que no es el Vault (ni está en modo solo), queda denegado: `main` solo
  recibe merges desde `dev` por PR. El hook resuelve el repo real del push
  (`cd`, `git -C`) y reconoce el Vault por su ruta (`.claude/vault.local.json`,
  `VAULT_PATH` o `~/.claude/souclaude/vault.json`), por su remoto
  (`soubunker-vault`) o por su carpeta `00-System`, en los dos modos. Si aun así
  deniega un push al Vault, configúralo: `souclaude upgrade --vault-path <ruta>`;
  y el espejo va siempre por `souclaude vault-sync --push`.
- **Antes de cada `git push`, los secretos**: el grupo `secretos` sobre cada
  commit que el push subiría. Si falla, el push queda denegado con el motivo:
  sigue sus instrucciones (sacar el archivo de los commits sin pushear; si ya se
  había pusheado, avisar al usuario para rotar la credencial).
- **Al crear el PR o editar su body o su base**: los tres grupos contra el PR
  (`rama-commits` es informativo; `secretos` y `pr-metadata` bloquean). El
  resultado se publica como comentario en el PR — la evidencia para el revisor —
  y te vuelve como contexto.

No lo rodees: nada de `bash -c`, `node -e`, scripts ni otra tool para pushear o
crear el PR por fuera. Los PRs se crean y editan **solo** con `gh pr create` y
`gh pr edit`: el hook no ve el MCP de GitHub ni `gh api`. Si tras crear o editar
el PR no te llegó el resultado de `reglas-pr`, córrelo a mano:
`node .claude/hooks/reglas-pr.mjs --pr <url>`.

**Antes de abrir el PR, delegar el security review a un subagente** (`Agent`, tipo
`general-purpose`) en vez de correr `/security-review` inline. Instrúyelo a fondo:
que corra `/security-review` sobre el diff de la rama y devuelva los hallazgos
(o la ausencia de ellos) en un resumen claro. Mientras corre, el agente principal
puede seguir armando el resto del PR (plantilla, checklist).

Esto no es un capricho de estilo: correr el review en el mismo hilo hace que, tras
un volcado largo de resultados, el agente principal pierda el hilo y no retome el
PR. Delegarlo a un subagente convierte el resultado en un tool-result concreto que
exige una reacción explícita — no una instrucción de prosa que se puede diluir.

Al recibir el resultado del subagente:
- **Documentar** los hallazgos (o su ausencia) en la sección "Security review" de
  la plantilla del PR.
- **Sin hallazgos bloqueantes**: seguir directo con push/PR. El security review es
  un paso intermedio del mismo pedido, no un punto de checkpoint.
- **Con hallazgos bloqueantes**: parar y preguntar al usuario si quiere remediarlos
  antes de continuar. No abrir el PR con hallazgos sin remediar salvo que el
  usuario decida explícitamente continuar así — en ese caso, dejarlo registrado
  en el PR.

**Completa `.github/pull_request_template.md` de verdad.** Un PR cubre una o varias
tareas del milestone de la rama: en "Milestone y tareas relacionadas" van el ID del
milestone y la lista de tareas que este PR integra. Checkboxes tildadas porque
se hizo, no por rellenar. Nada de "N/A" genéricos: si una sección no aplica, se
**omite entera** (título incluido), no se deja con "N/A" ni vacía. **Excepción:
"Descripción del cambio", "Evidencia", "Impacto / Riesgos" y "Requiere versión /
release" van siempre** — las valida el check `pr-metadata`, que da FAIL si
faltan, están vacías, dicen "N/A" o conservan el texto guía de la plantilla.

**La plantilla no se aplica sola al abrir el PR por CLI.** Solo la web de GitHub la
precarga; `gh pr create` deja el cuerpo que le pases y nada más. El flujo correcto:
escribir la plantilla ya completada en un archivo temporal y abrir el PR con
`gh pr create --body-file <archivo>`. Un PR con la plantilla cruda o incompleta
(secciones con el texto guía intacto, casilla de versión sin marcar) **falla
`pr-metadata`**: la descripción tiene que quedar bien desde el alta.

**El PR de release `dev` → `main` lleva además la sección `## Release en GitHub`**
(la plantilla no la trae; la agregas tú al armar el cuerpo): el título y la
descripción corta del release, de donde salen el GitHub Release y el hito de la
ficha. Formato y reglas en "Cierre del release".

**Apenas creas el PR, el hook `reglas-pr` te devuelve el resultado de los
checks.** Con un FAIL en `secretos` o `pr-metadata`, el PR no está listo:
corrígelo en ese momento.

- Body o base: `gh pr edit <url> --body-file <archivo>` o
  `gh pr edit <url> --base dev` (cada edición vuelve a disparar el check y deja
  un comentario nuevo en el PR).
- Conflictos: `git fetch origin && git merge origin/dev`, push, y después
  `node .claude/hooks/reglas-pr.mjs --pr <url>` — un push no vuelve a disparar
  el check del PR.
- Secreto: sácalo en un commit nuevo (`git rm --cached`) y avisa al usuario: ya
  se pusheó, hay que rotar la credencial.
- `rama-commits` es informativo: no reescribas commits ya pusheados por su
  formato.

Si el FAIL no se arregla desde el body o la base (por ejemplo, `gh` sin
autenticar), o sigue tras dos rondas de corrección, **para y repórtalo al
usuario** — no reintentes en bucle.

Si piden correcciones: **pushear a la misma rama.** El PR se actualiza solo. Crear un
PR nuevo por cada corrección rompe la trazabilidad y duplica el ruido.

**Al editar el body de un PR a pedido del usuario, re-lanza en el mismo paso los jobs
de CI fallidos de ese PR.** Cambiar la descripción no re-dispara CI, y un PR suele
arrastrar checks en rojo por fallos transitorios que conviene reintentar. Detecta los
fallidos con `gh pr checks <pr>` y relánzalos con `gh run rerun <run-id> --failed` —
solo los jobs en estado `failure`, no el run completo. Si no hay jobs fallidos, edita
el body y no hagas nada más: no re-corras lo que ya está en verde ni informes de sobra.
PAUSA TEMPORAL (SHS-M36): mientras GitHub Actions esté en pausa no hay runs que
relanzar (`gh pr checks` sale vacío); el check lo vuelve a correr el hook
`reglas-pr` al editar el body.

Integración: **squash & merge**, y la hace el coordinador. Para un `refactor/` grande o
una migración, el coordinador puede optar por merge commit y lo registra en el PR.

Después del merge de un **PR parcial** (el milestone sigue abierto), quédate en la
rama y sincronízala:
```bash
git fetch origin && git merge origin/dev
```

Después del merge del **último PR** del milestone (esto sí lo puedes hacer):
```bash
git checkout dev && git pull origin dev && git branch -d <tu-rama>
```

## Versionamiento

SemVer con prefijo `v`: `v1.2.3`.

| Cambio | Regla |
|---|---|
| Corrección menor | PATCH · `v1.0.0 → v1.0.1` |
| Funcionalidad compatible | MINOR · `v1.0.1 → v1.1.0` |
| Cambio incompatible | MAJOR · `v1.1.0 → v2.0.0` |

El desarrollador **propone** la versión editando `version` en `package.json` como
parte del PR de release. Ese bump se commitea **directo en `dev`** — nunca en una
rama `chore` aparte solo para el bump; el PR de release `dev` → `main` ya lo lleva.
Tras el merge `dev` → `main`, en repos con el workflow
`tag-release.yml` instalado, este lee esa versión del commit de merge y
crea/pushea el tag inmutable `vX.Y.Z` y el tag móvil de la serie (`v3`) — es
idempotente: si el tag ya existe, no falla ni duplica. En repos sin el workflow,
el agente los crea y pushea en el mismo momento.

**PAUSA TEMPORAL (SHS-M36)**: mientras GitHub Actions esté en pausa,
`tag-release.yml` no se dispara y los tags los creas tú al publicar, después del
merge del release, con el mismo script:

```bash
git fetch origin && node scripts/tag-release.mjs --ref origin/main
```

`--ref` lee la versión del `package.json` de `origin/main` y taggea ese commit,
sin cambiar de rama ni tocar tu árbol de trabajo; es idempotente. En repos sin
`scripts/tag-release.mjs` (stack no Node), usa el script de tags del stack (skill
`harness-upgrade`) o créalos a mano: `vX.Y.Z` anotado y el móvil `vX` movido al
mismo commit. El GitHub Release lo crea `scripts/release-publicar.mjs` (ver
"Cierre del release").

## Cierre del release (automático tras el merge)

Aprobar el PR de release es lo único que hace el desarrollador: el agente cierra
el resto sin que nadie se lo pida. El **GitHub Release ya no es del coordinador**:
aprobado y mergeado el PR, se crea solo.

**Un solo texto para todo.** Al abrir el PR de release, su cuerpo lleva una
sección `## Release en GitHub` con tres líneas:

```
## Release en GitHub
Título: <hasta 6 palabras>
Descripción: <una frase de menos de 30 palabras>
Milestones: SHS-M44, SHS-M43
```

De ahí salen el nombre del release (`vX.Y.Z · <título>`), su cuerpo (`## Qué trae`
+ la frase + milestones y enlace al CHANGELOG) y el hito de la ficha del
Observatorio (`- AAAA-MM-DD · vX.Y.Z - <título> · <descripción>`): release y hito
no pueden desalinearse. Valida el texto antes de abrir el PR con
`node scripts/release-publicar.mjs --version X.Y.Z --titulo "..." --descripcion "..." --dry-run`
(rechaza más de 6 palabras en el título, 30 o más en la descripción, o más de 300
caracteres).

**Qué lo dispara — el desarrollador no pide nada:**

1. **Sesión abierta al abrir el PR**: quédate atento al merge. Sondea
   `gh pr view <n> --json mergedAt,state` cada pocos minutos (ScheduleWakeup o
   Monitor) hasta que se mergee; al mergearse, lanza el subagente de cierre. Si el
   PR se cierra sin merge, deja el hito y la ficha como en "Al confirmarse el
   merge y el tag" y avisa.
2. **Sesión cerrada**: el hook de SessionStart de la siguiente sesión detecta el
   release mergeado sin cerrar y te ordena lanzar el subagente.
3. **Con GitHub Actions activo**, `tag-release.yml` ya habrá creado el tag y el
   release (con `release-publicar.mjs --desde-pr`); el subagente igual verifica
   todo, porque el Vault y el espejo del tablero no los toca el workflow.

**Subagente de cierre de release.** Lánzalo con el Agent tool (tipo
general-purpose) y dale el número del PR de release y esta consigna:

1. **Confirmar el merge**: `gh pr view <n> --json mergedAt,baseRefName`. Sin merge
   a `main`, no hace nada.
2. **Tag**: `git fetch origin && node scripts/tag-release.mjs --ref origin/main`
   (idempotente).
3. **GitHub Release**: `node scripts/release-publicar.mjs --desde-pr <n>`
   (idempotente: si el release existe, lo actualiza). Si el texto del PR no valida,
   no lo inventa: devuelve el problema para preguntar al desarrollador.
4. **Vault y ficha** (solo si el repo tiene Vault conectado):
   `souclaude vault-sync` y **revisa antes los hitos** de la ficha del proyecto
   contra la plantilla oficial: cada línea de "Hitos" es
   `- AAAA-MM-DD · vX.Y.Z - Título · descripción` (fecha ISO real, título corto,
   descripción de hasta 300 caracteres), en orden cronológico y con un máximo de
   40. **Si hay algo que acomodar, no toca la ficha**: devuelve la lista
   (línea, problema, propuesta) y el agente principal se la pregunta al
   desarrollador. **Si todo está en regla**, agrega o verifica el hito del release
   con el mismo título y descripción del PR, revisa "Próxima versión" (regla de
   "Ficha del Observatorio") y publica con
   `souclaude vault-sync --push -m "docs: hito vX.Y.Z en la ficha del Observatorio" --paths Project-<PREFIJO>`.
5. **Espejo del tablero** (skill de sincronización instalada): revisa que lo
   publicado en el release esté reflejado con los estados correctos. Para cada
   milestone y tarea que salió (`Milestones:` del PR y `git log` entre el tag
   anterior y el nuevo): una tarjeta o tarea que estaba En review o En curso y
   cuyo PR se mergeó y salió en el release pasa a **Hecho en el Vault (primero) y
   a Done en el espejo**; un milestone con todas sus tareas cerradas y su PR final
   mergeado pasa a Hecho. Lo que no cuadre (estado sin evidencia, tarea faltante,
   sin dueño) **se reporta y se pregunta**, no se corrige en silencio. Al
   terminar, verifica que no haya duplicados ni tareas sin dueño.
6. **Reporte corto**: tag, URL del release, hito agregado, cambios de estado hechos
   y preguntas pendientes para el desarrollador.

Si el conector del espejo no está autorizado o no hay Vault conectado, el
subagente lo dice una vez y sigue con el resto: nada de esto bloquea el release.

## Ficha del Observatorio (`OBSERVATORIO.md` en el Vault)

**Esta sección aplica solo si el repo tiene el Vault conectado**
(`.claude/vault.local.json` existe y apunta a un Vault válido). Sin Vault no hay
ficha y no hay nada que mantener.

`npx souclaude` siembra `Project-<PREFIJO>/OBSERVATORIO.md` en el Vault desde la
plantilla canónica (`00-System/templates/OBSERVATORIO.md`). Reglas sobre ella:

- **Al instalar el harness**: si ya tienes contexto del proyecto — por la
  conversación, el README o el propio código — **rellena la ficha en ese mismo
  momento** (tagline, plataforma, resumen, por qué importa, equipo) y pushéala al
  Vault (push directo, sin PR). No la dejes vacía esperando a que el equipo la
  complete; solo queda vacía cuando de verdad no hay información. Si al rellenarla
  identificas hitos o milestones del proyecto (README, CHANGELOG, tags o lo que
  cuente el usuario), **no los cargues todos a ciegas en "Hitos"**: para cada uno
  evalúa si ya ocurrió o si es planificado a futuro — compara su fecha contra hoy,
  confirma en el repo (tags, releases publicados, PRs mergeados) que de verdad
  haya salido, o pregúntale al usuario si no queda claro. Lo que ya pasó va en
  "Hitos"; lo planificado a futuro va en "Próxima versión". Los hitos de la
  Roca no van en ninguna de las dos: van en "Planificación" (regla siguiente).
- **La Roca vigente alimenta "Planificación", solo si hace falta** — al
  instalar el harness y en cada `upgrade` (misma regla en la skill
  `harness-upgrade`). Esto **no es un paso que reescriba o pushee en cada
  corrida**: es una verificación que solo actúa cuando detecta una diferencia
  real. Busca `Roca_<trimestre>_<PREFIJO>.md` en `Project-<PREFIJO>/` (raíz o
  subcarpeta `roca/`/`rocas/` — la convención varía entre proyectos) y toma
  el trimestre vigente (el de `<trimestre>` más alto; si hay varios, el de
  fecha de modificación más nueva). Sin Roca, sigue la regla siguiente. Con
  Roca, sus hitos van **solo** en la sección "Planificación" de la ficha, con
  el formato de la plantilla del Vault (`00-System/templates/OBSERVATORIO.md`),
  una línea por hito:
  `- AAAA-MM-DD · <PREFIJO>-H<n> · <título tal como está en la Roca> · <marca>`
  - **Fecha**: la real si el hito ya se cumplió (columna Completed de "Alta
    rápida" o `fecha_real` del `.yaml`); si no, la planificada (Due date). Un
    hito sin fecha conocida no se incluye.
  - **Etiqueta**: siempre `<PREFIJO>-H<n>` (si la Roca dice "H1", escribe
    "OBS-H1"). El título va sin ese prefijo.
  - **Marca**: `cumplido` si el hito ya se cumplió. Si no, `on track` u
    `off track` solo si la Roca lo declara explícitamente; sin marca, el
    Observatorio la calcula por la fecha.
  - Van **todos** los hitos de la Roca, ordenados por fecha (máximo 40), sin
    responsable (la ficha no lleva nombres de personas) y sin inventar nada
    que la Roca no traiga.

  "Hitos" y "Próxima versión" son **solo de releases**: un hito de Roca nunca
  va ahí. Si una versión anterior del harness dejó líneas `<PREFIJO>-H<n>` en
  esas secciones, muévelas a "Planificación". Si la ficha no tiene la sección
  "Planificación" (fichas sembradas antes de que la plantilla la trajera),
  agrégala al final, con el encabezado y el comentario guía de la plantilla.
  **Compara contra las líneas que ya existen en "Planificación"** antes de
  tocar nada: si ya coinciden, no reescribas ni pushees. Actúa solo donde hay
  diferencia: agrega el hito que falta, corrige el que cambió de fecha, título
  o marca (por ejemplo, uno que se cumplió), o quita el que ya no está en la
  Roca vigente.
- **Sin Roca vigente, pregúntala una vez — no es bloqueante.** No todos los
  proyectos son Rocas. Si el proyecto no tiene Roca del trimestre en curso, al
  final del install/upgrade (sin frenar el resto del flujo) pregúntale al
  usuario si el proyecto tiene una y, si la tiene, que te la pase. Lo normal es
  que te pase **el export de la Roca desde Ninety/EOS** (un PDF con objetivo,
  alcance, entregables, criterios de aceptación, due date y estado de la Roca,
  y la tabla de Milestones Title / Completed / Due / Owner); léelo con `Read`.
  También sirve texto pegado. **Al subir la Roca al Vault, sus hitos se
  agregan a "Planificación" de la ficha**, sin inventar nada que el documento
  no diga:
  1. Crea `Project-<PREFIJO>/Roca_<trimestre>_<PREFIJO>.md` con todo el
     contenido del documento (objetivo, alcance por fase, entregables,
     criterios de aceptación, due date y estado) y la tabla "Alta rápida"
     Title / Due date / Completed, un `<PREFIJO>-H<n>` por milestone en el
     orden del documento. Crea también `Roca_<trimestre>_<PREFIJO>.yaml` según
     `00-System/templates/plantilla_apertura_roca.yaml`: llena lo que el
     documento trae (los hitos cumplidos con su `fecha_real`) y deja vacío lo
     que no trae (riesgos, restricciones…). Si tienes una skill de apertura de
     Roca, como `/rock-plan`, úsala.
  2. Fechas sin año (p. ej. "Sep 30"): toma el año de la fecha de creación o
     impresión del documento, y escríbelas en ISO `AAAA-MM-DD` (formato que
     exige la ficha). El `<trimestre>` (p. ej. `Q3Y26`) sale del
     documento; si es ambiguo, pregúntalo en vez de adivinarlo.
  3. Agrega sus hitos a "Planificación" de la ficha según la regla anterior.
  4. Pushea todo al Vault en el momento (Roca y ficha) con
     `souclaude vault-sync --push -m "..." --paths Project-<PREFIJO>` y
     reporta qué quedó en "Planificación".

  Si el usuario dice que el proyecto no es una Roca, no la tiene a mano o
  prefiere dejarla para después, sigue sin más: no es un error ni un bloqueo,
  y "Planificación" queda con su viñeta vacía. No insistas en la misma sesión.
- **Al abrir el PR de release `dev` → `main`**: **agrega el hito** del release
  en la sección "Hitos" de la ficha en ese mismo momento, con push directo al
  Vault — no esperes al merge: el coordinador mergea en un momento que no
  controlas y la sesión puede cerrarse antes de que llegue el aviso. Formato de
  la línea: `- AAAA-MM-DD · vX.Y.Z - <Título> · <descripción>` (fecha del día,
  versión propuesta en `package.json`, y el **mismo título y la misma
  descripción** de la sección `## Release en GitHub` del PR de release; la
  descripción, de menos de 30 palabras y nunca más de 300 caracteres). Antes de
  agregarla, **revisa los hitos que ya hay**: si alguno está fuera de formato
  (sin ` - Título`, sin fecha ISO, descripción larga, fuera de orden), no lo
  arregles por tu cuenta ni inventes títulos: pregúntale al desarrollador.
  **El push al Vault va siempre por
  `souclaude vault-sync --push -m "docs: hito vX.Y.Z en la ficha del Observatorio"
  --paths Project-<PREFIJO>`**, con el archivo editado y **sin commitear**: ese
  comando hace el ciclo completo (add → commit → pull → push). No uses
  `git add/commit/push` a mano sobre el Vault. Si `vault-sync` falla o no publica,
  no lo rodees con git manual: averigua por qué (`souclaude vault-sync` sin flags
  hace solo el pull; `--push` necesita el CLI global) y repórtalo para arreglarlo
  en el harness. **En el mismo momento, revisa
  toda "Próxima versión"** —no solo la línea que coincida en texto con el hito
  que acabas de agregar— contra lo que este release entrega de verdad
  (CHANGELOG o descripción del PR de release):
  - Si el release cumple una línea **completa**, quítala de "Próxima versión"
    — un mismo hito no puede figurar a la vez como cerrado en "Hitos" y como
    pendiente en "Próxima versión".
  - Si una línea agrupa varios hitos (p. ej. "Rediseño visual (OBS-M46) y
    galería de capturas (OBS-M39)") y el release solo cumple parte, **edítala**
    dejando solo lo que sigue pendiente en vez de borrarla entera; si no queda
    nada pendiente, ahí sí se quita.
  - Si no es claro si el release cumple una línea, déjala — no la borres a
    ciegas.
  Si "Próxima versión" queda vacía después, déjala vacía con su comentario guía
  de la plantilla; no borres la sección.
- **Al confirmarse el merge y el tag** (mientras Actions esté en pausa, el tag
  lo creas tú: ver "Versionamiento"; todo este cierre lo hace el subagente de
  "Cierre del release"): verifica el hito y corrige fecha o resumen si difieren
  de lo publicado. Si el PR de release se rechaza o se
  descarta, elimina el hito en la sesión que lo detecte y restaura en "Próxima
  versión" cualquier línea que hayas quitado o editado creyendo que este
  release la cumplía. El hito **no es opcional**: todo tag publicado tiene su
  línea en "Hitos", también los releases menores.
- **Cuando detectes un cambio importante del proyecto** — en un release o en
  cualquier otro momento: alcance, plataforma, resumen, por qué importa, equipo o
  próximos pasos que ya no reflejan la realidad — actualiza la sección afectada y
  pushea al Vault en el momento. La ficha no se revisa solo al taggear: se
  mantiene al día cuando el proyecto cambia de verdad. Los cambios menores sin
  impacto en la ficha no requieren tocarla.

## Secretos

Nunca en el repo. `.env.example` sin valores. Si una credencial se expone por accidente:
**rotarla**, no solo borrar el commit.

## Lo que esta guía NO define

No lo inventes. Si hace falta, pregunta:

- Formato del **título** del PR.
- **Scopes** de commit (`feat(api):`) — el formato es solo `tipo: descripción`.
- **Trailers** de commit (`Co-Authored-By`, `Signed-off-by`).
- `CHANGELOG.md` — el changelog es el `git log` de `main`.
- Ramas `release/*` — no existen.
- `BREAKING CHANGE` / `!` de Conventional Commits.
- Git hooks, `--no-verify` (el hook `reglas-pr` es de Claude Code, no de git:
  ver "Pull Request").
- Commits firmados: **no** son obligatorios hoy.
