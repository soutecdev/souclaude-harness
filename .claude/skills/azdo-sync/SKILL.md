---
name: azdo-sync
description: Sincroniza el tablero del Vault con Azure DevOps Boards vía el servidor MCP oficial de Azure DevOps - cada milestone es un Epic (con su descripción) y cada tarea del kanban es un work item hijo de ese Epic, etiquetado con su milestone; se crea o transiciona en el momento en que la tarjeta se mueve. Alternativa a jira-sync para equipos que usan Azure Boards en vez de Jira. Actívate SIEMPRE que muevas una tarjeta del kanban del Vault (alta, En curso, En review, Hecho), al dar de alta, tomar o cerrar un milestone, o cuando el usuario pida sincronizar, ver o actualizar el estado del proyecto en Azure Boards.
---

# azdo-sync — el Vault espejado en Azure Boards

El Vault es la fuente de verdad del progreso; Azure Boards es su **espejo para la
organización**. Esta skill mantiene ese espejo: **cada movimiento de tarjeta en el
Vault se refleja en Azure Boards en el mismo momento**, sin que el usuario lo pida
— igual que el push inmediato al Vault.

**Excluyente con `jira-sync`**: un proyecto usa una de las dos, no ambas — instala
la que corresponda a la herramienta real del equipo.

## Configuración

1. **Conector**: el harness distribuye la entrada `azure-devops` en `.mcp.json`
   cuando esta skill está seleccionada (se funde con la de `jira-sync` si
   ambas están instaladas — ninguna pisa a la otra). Es el paquete oficial de
   Microsoft (`@azure-devops/mcp`), corre local por `stdio` (no es un endpoint
   HTTP alojado como el de Atlassian) y necesita Node.js 20+.

   La organización llega como placeholder — **edita el `<org>` en `.mcp.json`
   una vez por repo** con la organización real de Azure DevOps; un upgrade
   posterior nunca lo pisa (merge-json solo agrega claves que faltan).

   **Autenticación — `envvar` con PAT es el método usado por SOUTEC.** El
   servidor MCP local oficial se ejecuta con:

   ```
   npx -y @azure-devops/mcp <org> --authentication envvar
   ```

   El PAT se proporciona mediante la variable de entorno `ADO_MCP_AUTH_TOKEN`,
   en texto original (no en base64). Nunca guardar ni commitear el PAT en
   `.mcp.json`, `.claude/azdo.json` ni ningún archivo del repositorio; el
   proceso de Claude debe heredarla del entorno.

   Entrada distribuida en `.mcp.json`:

   ```json
   "azure-devops": {
     "command": "npx",
     "args": [
       "-y",
       "@azure-devops/mcp",
       "<org>",
       "--authentication",
       "envvar"
     ]
   }
   ```

   Generar el PAT en Azure DevOps → ícono de usuario → **Personal Access
   Tokens** → **New Token**, scope **Work Items (Read, Write, & Manage)**. Si el
   tenant sí permite la app "Azure CLI" en Entra ID, `--authentication azcli`
   (sesión de `az login`, sin secretos en el archivo) es una alternativa válida
   — en ese caso edita `args` a mano para reemplazar `envvar` por `azcli`.
2. **Destino**: `.claude/azdo.json` (commiteado, no es secreto) define la
   organización y el proyecto:

```json
{
  "organization": "<org>",
  "project": "<proyecto-ADO>",
  "areaPath": "<proyecto-ADO>",
  "epicWorkItemType": "Epic",
  "taskWorkItemType": "Task"
}
```

Claves opcionales, que el proyecto suma cuando ya las acordó con el usuario:
`estados` (columna del Vault → State), `responsables` (`@quién` de la tarjeta →
correo para `System.AssignedTo`; un `@pendiente` sin entrada se queda sin
asignar) y `tablero` (nombre de la columna En Review y el campo de columna de
cada tablero, ver «La columna En Review»).

**Convención SOUTEC**: cada proyecto del Vault tiene su **propio proyecto en
Azure DevOps** dentro de la organización de la empresa. Si `.claude/azdo.json`
tiene otra cosa, manda el archivo.

**Tipos de work item por plantilla de proceso**: `epicWorkItemType` y
`taskWorkItemType` son configurables porque Azure DevOps no tiene un único juego
de tipos — depende de la plantilla del proyecto (Basic, Agile, Scrum, CMMI). Antes
del primer uso, confirma con el usuario los tipos y los estados reales del
proyecto (ver tabla de estados más abajo) y ajusta `azdo.json` si no coinciden con
los valores por defecto. En Basic los estados son To Do / Doing / Done y la tarea
es de tipo **Issue**.

**Degradación — nunca bloquees el trabajo local por Azure Boards**: si el
conector no está autorizado, `.claude/azdo.json` no existe o todavía tiene
placeholders, **dilo una vez, sugiere el paso que falta y sigue** con el trabajo
local y el Vault. El espejo pendiente se anota en `notes.md` para la próxima
sesión con conector.

## Mapeo Vault → Azure Boards

Jerarquía nativa de Azure Boards, para que el tablero agrupe por Epic en vez de
acumular work items sueltos:

**El Epic (milestone)** — cada milestone de `milestones.md` es un Epic, para que
el backlog de Azure Boards muestre todo lo que hay por delante y no solo las
tareas ya desglosadas:

| Vault | Azure Boards |
|---|---|
| Milestone (`<PREFIJO>-M<n>`) | Un **Epic** (`epicWorkItemType` de `azdo.json`) |
| Title | `<título corto del milestone>` (sin el ID — el ID va solo como badge; si `milestones.md` trae `:` tras el título, usa solo la parte antes del `:`) |
| Description | Un resumen para saber de qué trata + el texto original de la tarjeta (formato en «Descripción de los Epics») |
| Tags | `<PREFIJO>-M<n>` (es el badge que muestra el tablero, y la clave de idempotencia) |
| Dueño | `System.AssignedTo` (ver «Asignación») |
| Sus tareas | Work items **hijos** del Epic (vínculo `System.LinkTypes.Hierarchy-Forward`) |
| Columna en `milestones.md` (Backlog / En curso / Hecho) | State del Epic según «Estado del Epic»: To Do / Doing (o columna En Review) / Done — o New / Active / Closed, según la plantilla del proyecto |

**La tarea del kanban** — un work item estándar colgado de su Epic:

| Vault | Azure Boards |
|---|---|
| Tarea del kanban (`<PREFIJO>-M<n>-T<m>`) | Un work item de `taskWorkItemType` con **parent = el Epic de su milestone** |
| Milestone de la tarea | El **parent** + tag `<PREFIJO>-M<n>` (redundancia útil para consultas WIQL) |
| Title | `T<m> · <resumen corto>` (unas pocas palabras — nunca el texto completo de la tarjeta; sin el prefijo del milestone, ya está el parent Epic y el tag) |
| Description | El texto completo de la tarjeta del kanban (si es largo, va entero acá, nunca solo en el Title) |
| Identidad completa de la tarea | Tag `<PREFIJO>-M<n>-T<m>` (ID completo; clave de idempotencia, no vive en el Title) |
| Columna Backlog | State **New** (o **To Do** en Basic) |
| Columna En curso | State **Active** (o **Doing** en Basic) |
| Columna En review | La tarea **no usa la columna En Review por falta de merge**: se queda en Active/Doing con un comentario que anota el PR (ver «Estado del Epic») |
| Columna Hecho | State **Closed** (o **Done** en Basic) |
| Dueño de la tarjeta (`@quién`) | `System.AssignedTo` (ver «Asignación») |

**Estados por plantilla de proceso** — Azure DevOps no tiene estados fijos: varían
según Basic / Agile / Scrum / CMMI. **No asumas los nombres**: la primera vez que
sincronices en un proyecto, consulta sus estados reales (los del work item type
usado) y guarda el mapeo acordado con el usuario en `azdo.json` (`estados`). Si un
estado de la tabla no existe en el proceso del proyecto, usa el más cercano y
repórtalo.

La **clave de idempotencia es el Tag con el ID completo, no el Title** (el Title
solo lleva el título del milestone o el `T<m>` de la tarea, para que el tablero se
lea limpio): antes de crear, consulta con WIQL un work item del proyecto cuyos Tags
contengan ese ID exacto (`<PREFIJO>-M<n>` para milestones, `<PREFIJO>-M<n>-T<m>`
para tareas). Si existe, se actualiza/transiciona; si no, se crea. **Nunca
dupliques** work items.

## Asignación

- **Todo work item que crees queda asignado.** `System.AssignedTo` va en el mismo
  `create`: al dueño de la tarjeta (`@quién`, resuelto por `responsables` de
  `azdo.json`, que el conector recibe como correo) y, si la tarjeta no trae dueño,
  a quien lo crea.
- **Excepción acordada con el usuario**: las tarjetas Backlog sin dueño
  (`@pendiente`) pueden quedarse sin asignar. No las asignes a quien crea solo
  para llenar el campo; revisa si el Vault permite deducir un dueño claro (por
  ejemplo, una tarea suelta dentro de un milestone que ya tiene dueño) y, solo
  si es así, cambia primero el `@pendiente` en el Vault y después asigna.
- `add_child` no asigna ni pone tags: crea con `create` (tags y dueño incluidos)
  y luego vincula al Epic, o asigna después del `add_child`.
- Al terminar cada sincronización, verifica con WIQL que solo quede sin dueño lo
  que corresponde: `[System.AssignedTo] = ''` debe devolver únicamente tarjetas
  `@pendiente`.

## Estado del Epic (milestone)

**En Review es un estado del Epic, no de las tareas.**

| Epic | Cuándo |
|---|---|
| Doing | Tiene tareas pendientes. |
| **En Review** | **Todas sus tareas están en Done**, pero su PR está sin abrir, sin revisar o sin mergear. Un Epic sin merge **no puede estar en Done**: va a En Review. |
| Done | Su PR está mergeado. |

- **Las tareas no pasan a En Review por falta de merge.** Una tarea pasa a Done
  cuando su trabajo está hecho y subido (al pushear su commit a la rama del
  milestone).
- **En cuanto todas las tareas de un Epic estén en Done y su PR no esté
  mergeado, mueve el Epic a En Review sin esperar a que te lo pidan.** Vale
  también para los Epics de alcance abierto que estén visibles. Cuando el PR se
  mergea, el Epic pasa a Done.
- En Review en el Epic equivale, en el Vault, a un milestone En curso con todas
  sus tareas en Hecho y el PR sin mergear.
- Si el usuario cambia a mano el estado de una tarea en Azure Boards, respeta su
  decisión: refléjala en el Vault y no la «corrijas» con estas reglas. Si no
  está claro por qué la cambió, pregúntale.

## La columna En Review

Los tableros de Epics y de Issues llevan la columna **En Review** entre Doing y
Done. Azure Boards no deja crear estados nuevos desde la configuración del
tablero, así que la columna se asocia al estado **Doing**: mover un Epic a En
Review es cambiar su columna (campo `WEF_<id del tablero>_Kanban.Column`) y el
State sigue en Doing.

- El campo de columna es distinto en cada tablero (uno para Epics y otro para
  Issues). Descúbrelo leyendo un work item de cada tablero y anótalo en
  `azdo.json` (`tablero`).
- **Crearla, una vez por proyecto** (el conector MCP no lo expone: usa la API
  REST con el mismo PAT): lee las columnas actuales
  (`GET …/{equipo}/_apis/work/boards/{tablero}/columns`) y reenvíalas **completas,
  con sus `id`**, más la nueva (`columnType: inProgress`, `stateMappings` hacia
  Doing) con `PUT` a la misma ruta. La columna de salida (Done) no se puede
  recrear ni mover, y Azure no permite una columna a la derecha de ella.

## Epics de alcance abierto y Epics fuera del tablero

- **Los milestones de alcance abierto no salen en el tablero.** Son los
  recurrentes, que reciben pedidos sobre la marcha (rediseño visual, fixes
  puntuales, mantenimiento). No se ven «como Doing» y nunca pasan a Done.
- No se ocultan con una columna sino con un **área**: el equipo muestra solo el
  área raíz del proyecto, sin subáreas, y esos Epics van a la subárea
  `<Proyecto>\Alcance abierto`. Sus tareas se quedan en el área raíz, así que los
  pedidos nuevos sí se ven en el tablero de Issues.
- Si el usuario pide que un Epic que no es de alcance abierto deje de salir,
  muévelo a otra subárea excluida (`<Proyecto>\Fuera del tablero`). **No lo
  cierres ni lo borres** para esconderlo. Un Epic de alcance abierto puede
  quedar visible si el usuario lo pide expresamente.
- No decidas tú qué milestones son de alcance abierto: pregúntalo.

## El espejo tiene que estar completo

- **Cada milestone del Vault tiene su Epic**, en cualquier columna (Backlog, En
  curso, En review o Hecho). Incluye el historial: los milestones terminados
  antes de que existiera el espejo también se reflejan, con su estado real.
- **Cada tarea tiene su Issue** colgado de su Epic, también las que solo están
  descritas dentro de la tarjeta del milestone y no como tarjetas del kanban. No
  inventes tareas que el Vault no describe.
- Si falta una tarea en Azure, el Epic aparenta estar terminado. Antes de
  explicar por qué un Epic «con todo listo» no está en Done, confirma que el
  espejo esté completo.
- No modifiques (estado, dueño, descripción) los work items de otro dueño. El
  primer espejo de un milestone ajeno, con su dueño de tarjeta, sí es parte del
  espejo completo.
- **Al terminar un sync grande, verifica y reporta**: que no falte ningún
  milestone ni tarea; que no haya duplicados (la clave es el tag con el ID);
  que ninguna tarea quede sin Epic; que todo esté asignado según «Asignación»;
  y que los estados coincidan con las columnas del Vault.

## Orden de las tareas

Dentro de cada Epic las tareas van en orden de número: T001, T002, T003… Los
items creados por API no tienen rango, así que Azure los muestra por ID, es decir,
por orden de creación: crea las tareas en orden de número. Si igual quedan
desordenadas (un backfill, una tarea que faltaba), reordénalas con la acción
`reorder` de la tool de backlog (`parentId` = el Epic), que asigna el rango igual
que arrastrar una tarjeta.

## Descripción de los Epics

Cada Epic empieza con un resumen para saber de qué trata:

```
**De qué trata**
1 a 3 frases en lenguaje llano: qué problema resuelve y para quién.

**Qué incluye**
- 2 a 6 viñetas con las piezas principales.

**Estado**
Terminado / En curso / En review / Sin iniciar, más el dato clave (PR, release o qué falta).

---

**Tarjeta en el Vault** (<ID>, columna <columna>)

<texto original de la tarjeta>
```

- Solo hechos que estén en el Vault o que hayas verificado. Si la tarjeta está
  desactualizada (un PR que figura «pendiente» pero ya se mergeó), verifica en
  GitHub antes de escribir el estado.
- Español neutro con tuteo; sin hashes, conteos de tests ni rutas de archivo en
  el resumen.
- **Escapa `<` y `>` en `System.Description`** (`&lt;`, `&gt;`), aunque el campo
  esté en Markdown: el sanitizador de Azure toma `<768px` como una etiqueta sin
  cerrar y **corta todo lo que viene después**, y borra fragmentos tipo
  `<CLAVE>`. Después de escribir, compara lo guardado, decodificado, contra la
  fuente.

## Herramientas del conector

Las que importan del servidor MCP de Azure DevOps (búscalas con ToolSearch si
están diferidas — los nombres pueden variar de versión a versión, confírmalos con
la lista de tools disponible en runtime antes de asumirlos):

- Consulta / idempotencia: la tool de **WIQL** del dominio de work items (query
  por `[System.TeamProject] = '<proyecto>' AND [System.Tags] CONTAINS '<ID>'`).
  Devuelve solo IDs: para ver campos usa **get_batch** con `fields`.
- Lectura: **get** / **get_batch** de work items, **list_comments**.
- Escritura: **create** / **update** (para setear `System.State`,
  `System.AssignedTo`, `System.Tags`, `System.Description`), **add_child** para
  crear una tarea ya vinculada a su Epic (sin tags ni dueño: ver «Asignación»).
- Vínculos: la tool de **link** cuando el parent se agrega después de crear
  (`System.LinkTypes.Hierarchy-Forward` desde el Epic hacia la tarea).
- Comentarios: la tool de **comment add/update**.
- Lo que el conector no cubre (columnas del tablero, áreas por `AreaId`) va por la
  API REST con el mismo PAT, sin imprimirlo ni guardarlo.

El conector no permite borrar work items — coherente con la regla de nunca
borrar. **Asigna el área por `System.AreaId`**, no por `System.AreaPath`: por
REST la ruta puede fallar con `TF401347: Invalid tree name`.

## Cuándo sincronizar

En el mismo flujo en que tocas el Vault — el orden es siempre Vault primero
(fuente de verdad), Azure Boards inmediatamente después:

- **Alta de tarea** en el kanban → crear el work item en el state inicial con su
  tag y **parent = el Epic de su milestone** (si el Epic no existe, créalo
  primero).
- **Tomar una tarea** (→ En curso) → transicionar al state "en curso" del
  proceso (crear si falta).
- **Tarea a Hecho** → transicionar a Done. Si con eso todas las tareas del Epic
  están en Done y su PR no está mergeado, **mueve el Epic a En Review** en el
  mismo momento.
- **Tarea a En review** (uso opcional del kanban) → se queda en Doing con un
  comentario que anota el PR.
- **Milestone nuevo** → crear su Epic en el state inicial, con el resumen y el
  texto de la tarjeta y el tag `<PREFIJO>-M<n>`.
- **Milestone a En curso** → transicionar su Epic al state "en curso".
- **PR del milestone mergeado / milestone a Hecho** → verificar que todos sus work
  items hijos estén cerrados; si alguno no lo está, repórtalo antes de cerrar. Si
  está todo cerrado, transicionar el Epic a Done.

## Reglas

- **Azure Boards nunca es la fuente**: no muevas tarjetas del Vault para
  "igualar" el tablero de Azure. Si detectas divergencia (alguien movió el work
  item en Azure Boards), repórtala al usuario y deja que él decida — el Vault
  manda. La excepción es el propio usuario: su cambio a mano de una tarea se
  respeta y se refleja en el Vault (ver «Estado del Epic»).
- **No toques work items ajenos**: solo los que tienen el Tag con un ID del
  proyecto (`<PREFIJO>-M<n>` o `<PREFIJO>-M<n>-T<m>`). El resto del proyecto de
  Azure DevOps no es territorio de esta skill.
- No borres work items. Una tarea eliminada del Vault se comenta en su work item
  y se transiciona al state que el usuario indique (o al más parecido a
  "descartado" que tenga el proceso) — nunca delete.
- Reporta cada sincronización en una línea ("Azure Boards: SHS-M9-T001 →
  Active"), sin volcar payloads.

## Cómo leer el tablero cuando el usuario pregunta

- **Tareas Done que «no salen»**: el backlog oculta por defecto los hijos
  completados. Se ven activando «Completed child items» en las opciones de vista,
  en la columna Done del tablero de Issues o en la sección Related Work del Epic.
- **«Doing 2/5»**: es el límite de trabajo en curso (WIP) de la columna, solo un
  aviso visual que no bloquea nada. Se cambia o se quita (límite 0) si el usuario
  lo pide.
