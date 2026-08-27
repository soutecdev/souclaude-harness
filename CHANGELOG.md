# Changelog

El harness y el CLI se versionan juntos.

## [Unreleased]

## [3.8.0] — 2026-08-27

### Agregado

- **Instalación global del CLI desde `init`/`upgrade`** (SHS-M21-T001). Al instalar
  o actualizar el harness, el CLI ofrece dejar `souclaude` instalado globalmente
  desde GitHub (`npm install -g <repo>#v3`), de modo que `souclaude monitor` corra
  en cualquier terminal y no solo vía `npx` dentro del repo. Es idempotente —si ya
  está instalado en la misma versión no reinstala— y tiene bandera para el modo no
  interactivo. Documentado en el README y en la guía de onboarding.

- **Config del Vault a nivel máquina como fallback** (SHS-M21-T002).
  `~/.claude/souclaude/vault.json` —lo escribe `init`/`upgrade` al conectar el
  Vault— actúa como respaldo de `.claude/vault.local.json`. Así el CLI global
  publica snapshot y consumo, y lee al equipo, desde cualquier terminal aunque no
  esté parado sobre un repo consumidor. La línea de `sessions.md` sigue
  escribiéndose solo cuando hay `project` declarado.

### Corregido

- **Resolución de `npm` sin depender del directorio actual** (CWE-427). Las llamadas
  a `npm` de la instalación global se ejecutan con `cwd` explícito en el home del
  usuario, para no resolver binarios ni `node_modules` desde un directorio de
  trabajo que podría no ser confiable.


## [3.7.0] — 2026-08-26

### Agregado

- **Branch protection de `main` configurada por el CLI** (SHS-M17). `souclaude
  init`/`upgrade` aplican, siempre y sin preguntar, la protección de `main` vía
  `gh api`: PR obligatorio (sin exigir aprobaciones — nadie aprueba lo suyo), el
  check `reglas-pr` en verde, sin force-push ni borrado de la rama, alcanzando
  también a administradores. Si `gh` no está instalado/autenticado o falta permiso
  de admin en el repo, se reporta con un aviso accionable y el resto de
  init/upgrade sigue igual. Complementa a `check-pr-rules.mjs`: ese workflow
  bloquea el *merge* del PR; esto bloquea el *push* directo en el propio GitHub.

- **Tag automático de release al mergear el PR a `main`** (SHS-M19). Workflow
  `tag-release.yml` distribuido por el harness: dispara en `pull_request`
  `closed`+`merged` con base `main`, lee la versión de `package.json` en el
  commit de merge y crea/pushea el tag inmutable `vX.Y.Z` y el tag móvil de la
  serie (`vX`). Idempotente: si el tag ya existe, no falla ni duplica. No crea el
  GitHub Release —sigue siendo del coordinador—. Se dogfoodea en este repo y se
  distribuye vía el manifest a los repos consumidores.

### Corregido

- **La descripción del commit puede arrancar en mayúscula** (SHS-M17).
  `check-pr-rules.mjs` exigía que la descripción del commit empezara en
  minúscula, sin que la skill `soutec-github` lo pidiera — rechazaba siglas
  legítimas como "PR" o "API" al inicio. Ahora acepta cualquier letra.

- **PR a `main` solo puede venir de `dev`** (SHS-M17). `check-pr-rules.mjs`
  aceptaba cualquier rama con formato válido (`feature/`, `fix/`, `hotfix/`, etc.)
  como base de un PR contra `main`. Ahora un PR con base `main` solo pasa el
  check si la rama de origen es exactamente `dev`, sin excepción para hotfixes
  (`CLAUDE.md`: "los hotfixes también" pasan por `dev`).

- **CI determinista en ubuntu + Node 22** (SHS-M14). `node --test` corre los
  archivos de test en paralelo por defecto (concurrencia = CPUs); en Linux eso
  dejaba una ventana de carrera en la que el propio test runner corrompía su
  canal IPC (serialización estructurada sobre el pipe de stdout del proceso
  hijo), fallando con "Unable to deserialize cloned data" — no era un bug del
  código de los tests. CI ahora corre `npm run test:ci`
  (`--test-concurrency=1`); `npm test` local sigue en paralelo (rápido, y el
  bug no reproduce ahí de todos modos).

- **Backfill de archivos base del Vault en `upgrade`** (SHS-M18-T001).
  `asegurarProyecto()` cortaba en cuanto `vault.local.json` ya tenía `project`
  declarado, así que `sembrarProyecto()` —único lugar que escribía las semillas—
  nunca se volvía a llamar para un proyecto ya conectado: un archivo base
  agregado después (`OBSERVATORIO.md`, `progress/history.md`) quedaba huérfano
  para siempre en instalaciones viejas. Se extrae el bucle a
  `escribirSemillasFaltantes()` y se agrega `completarProyectoDeclarado()`, que
  la corre sin pisar lo existente y pushea solo si faltó algo, en las dos ramas
  donde el proyecto ya se resuelve sin sembrar (`declarado` en `vault.local.json`
  y `porRegistro` vía `id-registry.md`). Idempotente: sin archivos faltantes, no
  toca el Vault.

## [3.6.0] — 2026-08-24

Reglas de PR distribuidas por el harness (SHS-M17) y alta de proyectos del Vault
desde el CLI (SHS-M18).

### Agregado

- **Reglas de PR distribuidas vía el manifest.** `check-pr-rules.mjs` y su workflow
  (`reglas-pr`) entran al manifest: `souclaude init`/`upgrade` los instala y
  actualiza en los repos consumidores. Valida en CI, contra cada PR, las reglas
  deterministas de la skill `soutec-github` (formato de rama, formato de commits,
  ausencia de secretos, `base=dev`, `mergeable`, versión semver propuesta,
  secciones de la plantilla completas).
- **El PR se abre solo a pedido explícito del usuario.** La skill `soutec-github`
  fija que terminar un cambio no implica abrir el PR: se crea únicamente cuando el
  usuario lo pide o dice que quiere mergear/integrar. Mientras tanto, commit y push
  a la rama, reportando que está listo para PR.
- **Ficha `OBSERVATORIO.md` como semilla de proyecto.** Se crea vacía en
  `Project-<PREFIJO>/` al conectar cualquier repo al Vault, junto al resto de
  archivos base. La skill `soutec-github` recuerda revisarla y actualizarla en cada
  release `dev` → `main` con cambios importantes (tagline, plataforma, resumen,
  hitos). Es independiente del README del repo técnico.
- **Opción "Crear proyecto nuevo" al conectar el repo al Vault.** En el prompt
  interactivo que pregunta a qué `Project-<PREFIJO>/` pertenece el repo (varias
  carpetas, ninguna declarada), se puede dar de alta un prefijo nuevo en el
  momento: pide prefijo, nombre y dueño, agrega la fila a
  `00-System/id-registry.md`, la pushea y siembra la carpeta en el mismo paso. Esto
  cambia la regla anterior (el prefijo se pedía antes, a un coordinador) — ahora el
  CLI también puede darlo de alta.

### Corregido

- **`rama-formato` no rechaza el PR de release `dev` → `main`.** La regla exigía
  `tipo/descripcion-corta` también sobre la rama de un PR de release, cuya rama
  origen es siempre literalmente `dev` — nunca iba a cumplir ese patrón. Ahora
  reconoce la combinación rama=`dev` + base=`main` como la misma excepción que ya
  usa `pr-apunta-a-dev`.

### Problemas conocidos

- **CI no determinista en ubuntu + Node 22** (SHS-M14): el runner de `node --test`
  se cae con "Unable to deserialize cloned data" en `test/monitor-cmd.test.js`. Es un
  fallo del runner en esa combinación de la matriz, no del código publicado: la
  suite completa pasa en el resto de la matriz. Sigue en Backlog.

## [3.5.0] — 2026-08-21

Primer release publicado de la serie v3. La conexión del repo con su proyecto del
Vault queda cerrada de punta a punta (SHS-M5) y el panel en vivo se simplifica
(SHS-M12).

### Agregado

- **Siembra de la carpeta del proyecto en el Vault.** Un repo cuyo prefijo ya figura
  en `00-System/id-registry.md` pero que todavía no tiene carpeta en el Vault ahora
  la recibe: `Project-<PREFIJO>/` con `milestones.md`, `kanban.md`, `sessions.md`,
  `plans/` y `progress/history.md`. Antes solo se emitía un warning y el repo quedaba
  sin tablero donde declarar sus milestones — justo lo que el protocolo exige antes
  de tocar código. **El registro es la única autoridad**: un repo que no figura ahí
  no se siembra, y el prefijo ni se inventa ni se agrega desde el CLI. Escribir en el
  Vault es escribir en el repo compartido de la organización, así que nunca pasa sin
  decisión explícita: con TTY se confirma, y en modo desatendido hace falta
  `--vault-seed`. La publicación va por `pushSeguro` (add acotado, commit,
  `pull --rebase`, push).
- **Resolución del proyecto por el registro de prefijos, sin preguntar.** El CLI
  contrasta la identidad del repo (`name` de `package.json`, remoto git, carpeta)
  contra `00-System/id-registry.md` y persiste la carpeta si eso apunta a una sola
  que exista. La comparación es **exacta, sin fuzzy**: parecerse al nombre registrado
  no alcanza. Cierra el caso desatendido (`--yes`, CI) que quedaba abierto.
- Flag `--vault-project <Project-XXX>` para declarar la carpeta del proyecto en modo
  no interactivo (`--project` ya estaba tomado por los filtros del monitor).

### Corregido

- **El instalador declara la carpeta `Project-<PREFIJO>` en vez de dejar que se
  adivine.** `carpetaProyecto()` caía a un respaldo que infiere el proyecto de
  cuántas carpetas `Project-*` hay en el Vault: acierta con una sola y devuelve
  `null` con dos o más. El Vault tiene tres desde el 2026-08-19, así que **toda
  instalación sin `project` escrito a mano dejó de publicar las líneas de
  `sessions.md` sin un error visible** — se perdía el registro de consumo por
  contribuyente y proyecto. `asegurarProyecto()` ahora resuelve y **persiste** la
  carpeta al conectar el Vault, con la misma prioridad que `resolveSkills`:
  `--vault-project` explícito > lo ya declarado > una sola carpeta > preguntar.
  Nunca bloquea: lo irresoluble queda en warning.
- Si el registro asocia el repo a un proyecto cuya carpeta todavía no está en el
  Vault, ya no cae en "hay una sola, debe ser esa" — eso declaraba el proyecto de
  otro repo.

### Cambiado

- **El panel en vivo pierde el bloque VENTANAS.** El consumo propio por ventana
  (5h / 7d / Fable) queda solo en `souclaude monitor --usage`; el panel en vivo se
  reserva para el estado del momento.

### Problemas conocidos

- **CI no determinista en ubuntu + Node 22** (SHS-M14): el runner de `node --test`
  se cae con "Unable to deserialize cloned data" en `test/monitor-cmd.test.js`. Es un
  fallo del runner en esa combinación de la matriz, no del código publicado: la suite
  completa (497 tests) pasa en el resto de la matriz. Se corrige en 3.5.1.

## [3.4.0] — 2026-08-19

La línea de consumo por sesión de `sessions.md` deja de depender de la disciplina
del agente: la publica el propio monitor (SHS-M1-T002).

### Agregado

- **Publicación automática de `sessions.md`** desde el panel en vivo
  (`npx souclaude monitor`): cada sesión **con consumo** del proyecto actual publica
  su línea en `Project-<PREFIJO>/sessions.md` del Vault y la va actualizando de
  forma recurrente mientras la sesión sigue viva — misma cadencia (~5 min),
  backoff y filtro de secretos que los snapshots de `00-System/monitor/`.
  Idempotente por sesión vía registro local
  (`~/.claude/souclaude/sesiones-publicadas.json`); la línea se actualiza en el
  lugar solo si sigue byte a byte como la escribió el monitor —
  una línea editada a mano nunca se pisa. Autorizado por el ADR
  `20260817-milestones-planes-y-sesiones-en-vault` (la telemetría cruda sigue
  prohibida). `--no-publish` apaga snapshots y sesiones a la vez.
- Campo opcional `"quien"` en `.claude/vault.local.json`: el `@quién` de la línea
  automática (respaldo: alias de la cuenta). El milestone se infiere del nombre de
  la rama (`feature/SHS-M1-T002-...` → `SHS-M1`); sin patrón reconocible, `n/d`.

### Cambiado

- `progress/README.md` (managed) documenta la línea automática como piso del
  protocolo manual, no reemplazo.

## [3.1.0] — 2026-08-17

El Vault pasa de tablero de tareas a estado vivo de tres niveles por proyecto:
milestones (con claim entre máquinas), planes por milestone y registro de sesiones
con consumo de tokens.

### Agregado

- **`Project-<PREFIJO>/milestones.md`**: tablero Kanban de milestones
  (`<PREFIJO>-M<n>`). La tarjeta En curso lleva dueño **y máquina**; es la unidad de
  anti-solapamiento — un agente que encuentra el milestone En curso con otro
  dueño/máquina para y pregunta, antes incluso de mirar el kanban de tareas.
- **`Project-<PREFIJO>/plans/`**: un archivo por plan (`<PREFIJO>-M<n>-P<n>-<slug>.md`),
  espejado al adoptarlo. Los planes descartados no se borran: la tarjeta del milestone
  apunta al vigente.
- **`Project-<PREFIJO>/sessions.md`**: append-only, una línea por sesión al cerrarla —
  fecha, rama/sesión, milestone, quién, máquina, tokens entrada/salida y resultado.
  Amplía la excepción de telemetría del ADR 20260810 (ADR
  `20260817-milestones-planes-y-sesiones-en-vault`); la telemetría cruda sigue
  prohibida.
- **Skill `vault-milestones`** (opcional): analiza el tablero de milestones del Vault
  (foto, consistencia, diagnóstico) y guía su iteración — alta de milestones nuevos
  con ID secuencial, división y re-secuencia, cierre y cambio de plan — respetando el
  anti-solapamiento y el push inmediato del protocolo.

### Cambiado

- `progress/README.md` (managed) reescribe el protocolo del Vault con los tres niveles
  y el claim en dos pasos (milestone → tarea); `templates/base/CLAUDE.md` resume el
  flujo nuevo en "Los dos repos".
- `docs/vault-guide.md` se reescribe para el harness 3.x: se elimina la deriva del
  flujo SDD/rocas (agentes y comandos `/rock-*` que ya no existen) y se documentan los
  dos canales de consumo (sesiones por proyecto + snapshots del monitor por cuenta).

## [3.0.0] — 2026-08-17

El harness se simplifica por completo: se eliminan los agentes y el flujo SDD/CCEM
para que el modelo trabaje sin ataduras, y quedan solo las skills personalizadas de
SOUTEC, ahora seleccionables desde el CLI.

### Cambiado (breaking)

- **Sin agentes ni flujo SDD**: se eliminan `.claude/agents/` (orchestrator,
  spec-author, implementer, reviewer, security-evidence-compiler), `AGENTS.md`,
  `docs/constitution.md`, `specs/` (README y templates full/lite) y todas las skills
  CCEM (`ccem-core`, `ccem-sdd`, `ccem-planner`, `ccem-research`, `ccem-stack`,
  `ccem-prompting`, `ccem-model-router`, `ccem-rocas`, `rock-*`, `export-ninety`,
  `spec-new`, `constitution-check`). En un upgrade quedan marcados obsoletos y
  `--prune` ofrece borrarlos — nunca se borran solos.
- **Catálogo de skills reducido**: `soutec-github` (obligatoria), `it-security-review`,
  `security-report-standard`, `soutec-md-a-pdf` (nueva en el harness, antes solo
  repo-local), `adr-new` y `harness-upgrade`.
- **Comando `mode` eliminado**: sin flujo de agentes no hay modos `auto`/`manual`.
- `it-security-review` ya no delega en agentes: la remediación y la compilación de
  evidencia las hace el propio modelo, con el PDF vía `soutec-md-a-pdf`.
- Ramas sin ID de hito: formato `tipo/<slug>`; el ID de tracker es opcional.
- **Flujo de release `dev` → `main`**: las ramas de trabajo nacen de `dev` y su PR
  apunta a `dev`; `main` solo recibe merges desde `dev` (el PR de release). Los
  **tags de versión los puede crear el agente** tras ese merge (`vX.Y.Z` + tag móvil
  por major); `git tag` sale de `permissions.ask` en el settings emitido.

### Agregado

- **Selección de skills en el CLI**: `init` pregunta con un checkbox qué skills
  instalar (todas marcadas por defecto; `soutec-github` entra siempre). Sin modo
  interactivo, `--skills a,b`. La selección se persiste en `.claude/harness.json`
  y los upgrades la respetan; deseleccionar marca la skill obsoleta (`--prune`).
- **Soporte de archivos binarios en el manifest** (`"binary": true`): los assets PNG
  de `soutec-md-a-pdf` se copian y comparan byte a byte, sin normalización LF. El
  backup también copia bytes tal cual.

## [2.4.0] — 2026-08-11

`souclaude vault-sync`: la sincronización con el Vault deja de ser prosa y pasa a ser un
comando; el monitor publica el consumo al Vault por defecto; el CI queda alineado con el
requisito real de Node.

### Agregado

- **Comando `vault-sync`**: pull `--rebase` seguro por defecto (con `rebase --abort`
  defensivo), `--push -m "<msg>" [--paths a,b]` para espejos y kanban (add → commit →
  pull → push, jamás `--force`), `--status`. Exit codes 0/1/2/3 — los agentes distinguen
  "Vault sin configurar" (3) de "falló el sync" (1) y lo reportan en vez de omitirlo en
  silencio. El push ocurre dentro del proceso Node, así que no choca con el
  `permissions.ask` de `git push`. Helper reutilizable en `src/core/vault-sync.js`; el
  publisher del monitor lo adopta y borra su copia del patrón.
- **El monitor publica por defecto**: con `.claude/vault.local.json` presente y panel en
  vivo, los snapshots agregados (<1 KB, ADR 20260810) se publican sin flag; `--no-publish`
  es el opt-out por corrida. La sección CUENTAS de todo el equipo se llena sola.
- Los `.md` de agentes y `progress/README.md` invocan `vault-sync` en lugar de la
  secuencia git a mano; `.claude/settings.json` permite el comando sin prompt.

### Corregido

- **CI en Node 22/24 (antes 20)**: `parseArgs({ allowNegative: true })` requiere
  Node >= 22.4 (igual que `engines`), así que en Node 20 todo `--no-<flag>` salía con
  exit 2 y los tests de `vault` y `mode` fallaban solo en GitHub. La matriz ahora prueba
  22 (piso de `engines`) y 24 (versión de trabajo); `push` a `dev` también dispara CI;
  `package-lock.json` regenerado (estaba fosilizado en 1.0.0); `.nvmrc` y `.npmrc`
  (`engine-strict`) nuevos.
- **Timeout del fetcher con timer propio ref'd**: `AbortSignal.timeout` usa un timer
  unref'd y bajo `node --test` en Node 22 el event loop moría antes del abort, dejando
  la promesa colgada y cancelando en cascada los 8 tests del fetcher.

---

`souclaude monitor`: panel de consumo de tokens de Claude Code en la terminal.

### Agregado

- **Comando `monitor`**: panel de límites de plan, agentes vivos, sesiones,
  proyectos y desglose por tipo de token y por modelo, leído directamente de
  `~/.claude/projects/**/*.jsonl`. Modos `--once`, `--compact`, `--agents`,
  `--json` y panel en vivo con TTY (alternate buffer, resize, teclas). Sale
  0/1/2 según el peor límite de plan — pensado para un hook. No suma ninguna
  dependencia nueva.
- **Refresco propio de los límites de plan**: `cachedUsageUtilization` de
  `~/.claude.json` solo se reescribe cuando el humano corre `/usage` — medido
  con un poller sobre `fetchedAtMs`: cero refrescos en 12 minutos de actividad
  continua, y `claude auth status` tampoco lo toca. El monitor ahora consulta
  el mismo endpoint que usa Claude Code, `GET
  https://api.anthropic.com/api/oauth/usage`, con el token OAuth que Claude
  Code ya guarda, TTL de 5 minutos y caché propio en
  `~/.claude/souclaude/usage-cache.json`. Entre las dos fuentes gana la de
  lectura más reciente, entera: los campos nunca se mezclan. El endpoint es
  interno y no documentado — puede romperse con cualquier actualización de
  Claude Code — así que ante 401, 404, cambio de forma o timeout el monitor
  cae al caché y el panel muestra la edad real del dato, nunca inventa un
  número.
- **Flag `--no-refresh`**: desactiva la consulta a la API para CI, para
  `--claude-home` apuntando a un fixture, o cuando el humano prefiere no
  tocar la red. Ningún test sale a internet.
- **Reglas `deny` nuevas en `.claude/settings.json`**: `~/.claude/.credentials.json`
  (guarda, además del token de Claude, los OAuth de los conectores MCP de
  terceros — es probablemente el archivo más sensible de la máquina),
  `~/.ssh/**` y `~/.aws/credentials`, más las que `CLAUDE.md` ya daba por
  existentes (`*.key`, `*.pfx`, `credentials.json`, `secrets.json`).
- **18 tests nuevos** sobre el manejo del token con credenciales falsas
  reconocibles (suite total: 284 pass).

### Decisiones

- **Deduplicación por `message.id`**: varias líneas `assistant` de un mismo
  transcript comparten `message.id` y repiten el objeto `usage` completo. Sin
  deduplicar, el consumo se infla 2-3x — el síntoma es un número mal, no una
  excepción, así que la regla vive en el acumulador de dominio
  (`domain/consumo.js`), no en un adapter donde se pueda saltear.
- **Tokens medidos, costo estimado**: los tokens salen del `usage` de cada
  respuesta (dato real); el costo en USD sale de una tabla de precios local,
  porque la máquina no guarda lo que costó cada llamada (dato estimado). El
  panel lo declara en su propio pie para que nunca se confundan.

## [2.3.0] — no publicado

El Vault deja de ser un paso manual: el instalador lo conecta (y lo clona si hace falta), y
los agentes saben que trabajan contra **dos repos**.

### Agregado

- **Paso de Vault en el instalador** (`init` y `upgrade`): pregunta si tienes el Vault en
  esta máquina; si no, ofrece clonar
  `https://github.com/ialvarezsoutec/soubunker-vault.git` (URL declarada en el manifest,
  clave `vault.repo`) y deja la ruta escrita. Nunca bloquea: si el clone falla o lo
  cancelas, avisa con el comando manual y la instalación sigue devolviendo 0.
- **`.claude/vault.local.json`** — nueva fuente canónica de la ruta local del Vault,
  gitignorada (es config de máquina) y **legible por los agentes**. Reemplaza a `VAULT_PATH`
  del `.env` para ese uso: `.claude/settings.json` deniega `Read(./.env)`, así que ningún
  agente podía leerla de ahí. `VAULT_PATH` en `.env.example` queda solo para el runtime de
  la app. La ruta **no** va al lockfile: `.claude/harness.json` se commitea y viajaría a
  otra máquina. Al lockfile va solo `VAULT_REPO`, que es igual para toda la organización.
- **Flags nuevos**: `--vault-path <ruta>` (conecta sin preguntar), `--vault-repo <url>`
  (repo alternativo) y `--no-vault` (omite el paso). Con `--yes` o en CI **nunca se clona**:
  git clone es red y disco, y en CI correría en cada corrida.
- **Doctrina de los dos repos** (`progress/README.md`, replicada en `CLAUDE.md`, `AGENTS.md`
  y los cuatro agentes): el Vault es un repo git con su propio remoto y regla **opuesta** a
  la del repo de proyecto — **push directo a su `main`, sin PR**, porque el tablero refleja
  el ahora. Convención de commits del Vault: `chore:` para movimientos de kanban, `docs:`
  para espejos. Nunca `--force`, en ninguno de los dos.
- **Anti-solapamiento entre máquinas**: antes de tomar un task, el agente hace
  `git -C "<vault>" pull --rebase` y lee el kanban. Si la tarjeta ya está en "En curso" o
  "En review" **con otro dueño**, **para y pregunta al humano** — no la toma ni salta a otra
  por su cuenta. Los conflictos en `kanban.md` se resuelven conservando ambas tarjetas; dos
  rebases fallidos seguidos se anotan como `vault_skip` y se reportan.

### Corregido

- **`--no-backup` nunca funcionó**: el help lo documentaba pero `parseArgs` lo rechazaba como
  opción desconocida. Ahora se parsea con `allowNegative: true`, que habilita también
  `--no-vault`. Sube el requisito de Node de `>=20` a `>=22.4`.

### Nota de actualización

`CLAUDE.md` es `user-owned`: el `upgrade` **no** lo sobrescribe, deja `CLAUDE.md.new` al lado
(garantía P8). **Hay que mergear ese `.new`**: sin la sección "Los dos repos", el agente lee
"nunca push directo a `main`" sin matices y se niega a escribir en el Vault.

## [2.2.0] — no publicado

Progreso por disco formalizado, IDs de task amarrados al hito y costo por tarea en la
telemetría del router.

### Agregado

- **Carpeta `progress/` formalizada y emitida por el harness**: `progress/README.md`
  (managed — documenta la convención) y `progress/history.md` (user-owned — historial
  compartido append-only, una línea por task/sesión cerrada, con regla de resolución de
  merge en el encabezado). Subcarpeta `progress/<ID-hito>-<slug>/` por spec en marcha con
  `summary.md` (spec-author), `impl_summary.md` (implementer) y `review.md` (reviewer) —
  reemplaza la convención plana `spec_/impl_/review_<ID>.md`.
- **IDs de task `<PREFIJO>-H<n>-T<nnn>`** (ej. `TNP-H1-T001`), emitidos por el spec-author
  en la fase Tasks con **bloques de 100 por spec** según el orden de reserva en
  `/rock-plan` (1.er spec desde T001, 2.º desde T101) — cero colisiones entre specs en
  ramas paralelas. Footer `Refs: <ID-task>` obligatorio en el commit-por-task. La cadena
  de `ccem-planner` se extiende: Roca → Hito → Spec → **Task** → commit.
- **Costo por tarea en la telemetría del router**: `progress/model-router.jsonl` suma
  `task`, `tokens_in`, `tokens_out`, `costo_usd` y `medicion` (`medido`|`estimado`, con
  regla de honestidad: un estimado es orden de magnitud, nunca cifra contable), más la
  tabla de precios referencial en `ccem-model-router` §7 (único lugar a actualizar).
  `/rock-close` suma el bloque "Resumen de costo" (% medido primero, total después).
- **Regla de arquitectura**: si un task cambia la arquitectura (puerto nuevo, contrato
  público, dependencia entre capas), el cierre exige doc en `docs/` + ADR; el implementer
  actualiza docs y declara el ADR pendiente (sigue siendo del spec-author), y el reviewer
  rechaza sin ambas cosas.
- **`docs/vault-guide.md`** (solo este repo, no distribuido): guía de creación del Vault
  central multi-proyecto — estructura, archivos semilla (`id-registry.md`), quién escribe
  qué, relación Vault↔repos↔Ninety, concurrencia multi-persona.
- **Espejo al Vault y estado vivo (kanban)**: los artefactos SDD y los resúmenes de
  progreso se copian al Vault (`Project-<PREFIJO>/specs/` y `progress/`), y cada task
  tiene tarjeta en `Project-<PREFIJO>/kanban.md` (formato plugin Kanban de Obsidian) que
  los agentes mueven **al empezar** a trabajar — el tablero refleja el ahora, no el push
  final; por eso el Vault vive en un repo aparte. Ruta vía `VAULT_PATH` en `.env`
  (emitida en `env.example`); sin ella el espejo se omite sin bloquear y queda anotado en
  `history.md`. Doctrina en `progress/README.md`; `ccem-planner` distingue ahora qué
  cruza a Ninety (solo hito) vs al Vault (espejos + kanban).

### Cambiado

- `AGENTS.md`, los 4 agentes SDD y el orchestrator usan las rutas nuevas de `progress/` y
  agregan su línea a `history.md` al cerrar cada artefacto.
- Templates `tasks-template.md` y `tasks-lite-template.md` con IDs completos y la regla de
  numeración por bloques.

## [2.1.0] — no publicado

Soutec Model Router: cada subagente corre con el mejor modelo posible según el triángulo
Calidad / Velocidad / Costo. El orchestrator es el router; la política es declarativa.

### Agregado

- **Skill `ccem-model-router`** (distribuida por el manifest, policy managed): única fuente
  de verdad de la política de ruteo — clasificación de tarea (mecánica/estándar/compleja),
  checklist de señales de dificultad, matriz agente × clase → (modelo, effort), escalamiento
  excepcional (criterios objetivos + máximo 1 escalada por hito + fallback a `inherit`) y
  telemetría en `progress/model-router.jsonl` con revisión trimestral en `/rock-close`.
  El mapeo rol → alias (Decisiones→`fable`, Ejecución→`opus`, Volumen→`sonnet`) vive en
  una sola tabla, el único lugar a actualizar cuando cambie la familia de modelos.

### Cambiado

- **`orchestrator`**: la sección "Selección de modelo" pasa de prosa orientativa a protocolo
  de router obligatorio (clasificar → resolver overrides `model`/`effort` en la llamada
  Agent → escalar solo con criterios y presupuesto → registrar cada lanzamiento en JSONL).
- **`spec-author` y `reviewer`** suman `effort: high`, **`implementer`** suma
  `effort: medium` en el frontmatter — red de seguridad para invocaciones sin orchestrator.
  Se mantiene la decisión de **no** emitir `model:` en frontmatter: forzar un modelo rompe
  a quien no lo tiene; el modelo se decide por invocación con fallback a `inherit`.
- **`ccem-core`** enlaza su sección "Selección de modelo" con la política operable;
  **`/rock-close`** suma el paso "Revisión de política de modelos" (umbral de escaladas
  >10 %, rework por celda).

## [2.0.0] — no publicado

Capa de rocas: el **hito** reemplaza a Planner como emisor de IDs. Implementa la Fase 0 de la
Metodología de Roca v2.1.0 en el repo de código.

### BREAKING CHANGE

- **El emisor de IDs pasa de la tarjeta de Planner al hito** (`<PREFIJO>-H<n>`, ej. `REA-H3`),
  definido en el Paso 2 de la roca (`/rock-plan`). El hilo de trazabilidad es ahora
  `Roca → Hito → specs/<ID-hito>-<slug>/ → rama → PR → tag`. Los repos consumidores reciben la
  reescritura en el próximo `upgrade`. ADR: `docs/decisions/20260722-capa-rocas-hito-emisor-de-ids.md`
  (supersede al de orquestación solo en cuanto al emisor).

### Agregado

- **Paquete de skills `ccem-rocas`** (4 comandos, distribuidos por el manifest): `/rock-plan`
  (Paso 2, con las 7 reglas de construcción de hitos y el checklist de validación E1/E4),
  `/rock-status` (snapshot semanal derivado de GitHub; falla ante campos derivados editados a
  mano, E2/E3), `/rock-close` (cierre contra criterios congelados, exige evidencia por criterio,
  E5) y `/export-ninety` (contrato por fases con Ninety; Fase 0 manual).

### Cambiado

- **`ccem-planner` reescrito**: el hito es el emisor, el estado del trabajo se **deriva** de
  GitHub (rama/PR) en vez de un tablero, y el WIP pasa de "2-3 tarjetas por dev" a "**2 ramas
  vivas por persona**" (`git branch -r`). Conserva su nombre para no romper manifest/lockfile.
- **`spec-new`** suma el contrato de entrada hito → spec (criterios heredados, no-alcance,
  entregable, rollback) y deja de hablar de Planner. Corrige una referencia P7 → P9.
- **`soutec-github`**, los agentes `orchestrator`/`spec-author`/`implementer` y ambos `CLAUDE.md`
  pasan de "tarjeta de Planner" al hito como origen del trabajo.

### No incluido (tracks aparte)

- El repo Vault (`00-System`, `id-registry.md`, `plantilla_apertura_roca.yaml`), los jobs
  semanales (E2/E3 como cron), el cierre de hito con evidencia automatizado (E5) y la API de
  Ninety (Fases 1-3). P7/P8 de la constitución se dejan como placeholder a propósito
  (metodología §9).

## [1.2.0] — no publicado

Flujo de security review para IT y verificación de integridad del harness.

### Agregado

- **Agente `security-evidence-compiler`** en `.claude/agents/`: compila el security
  review, las remediaciones SDD y la evidencia de pruebas en un informe Markdown y PDF
  para IT. Contrato de activación explícito: solo corre cuando la skill
  `it-security-review` entrega `FINAL_SECURITY_GATE=PASSED`. `AGENTS.md` documenta la
  categoría nueva de "agentes especialistas bajo demanda" — con nombre descriptivo y
  contrato concreto, no casillas vacías.
- **Skills `it-security-review`** (el workflow del review, con su template de informe) y
  **`security-report-standard`** (el estándar interno del informe técnico para IT).
  Ambas se distribuyen por el harness: están en `templates/base/` y en el manifest.
- **Skill `soutec-md-a-pdf`** commiteada en `.claude/skills/`: renderiza el PDF de
  evidencia con la identidad corporativa. El ADR
  `docs/decisions/20260722-render-pdf-evidencia-via-skill-soutec-md-a-pdf.md` ya la
  referenciaba, pero los archivos no estaban en el repo.
- **Comando `souclaude verify`**: verificación de integridad del harness instalado
  (`src/commands/verify.js` + `src/core/verify.js`), con tests propios y test de
  dogfooding.

### Corregido

- La suite de pruebas corre en Node ≥ 22.

## [1.1.0] — 2026-07-21

Orquestación multi-agente: cuatro roles que siguen el flujo SDD de CCEM con separación de
responsabilidades y checkpoints humanos.

### Agregado

- **Cuatro agentes** en `.claude/agents/`, distribuidos por el harness: `orchestrator`
  (coordina, no escribe código), `spec-author` (redacta spec/plan/tasks, una fase por
  invocación), `implementer` (task por task, cada cambio con su test) y `reviewer` (aprueba
  o rechaza de forma **independiente**, sin `Write`/`Edit`).
- **`AGENTS.md`** en la raíz: el mapa del flujo multi-agente, los cuatro roles, y las reglas
  del harness que respetan **por referencia** (no las redefinen).
- El patrón se subordina a la constitución: los checkpoints humanos y "ningún agente se
  auto-aprueba ni marca `done`" son **P6 hecho producto**. El hilo sigue siendo el ID de
  Planner; no se introduce `feature_list.json` ni un segundo sistema de estado.

### Decisiones

- **Opt-in, no líder global.** La orquestación se invoca a demanda; no se fuerza a cada
  sesión vía `CLAUDE.md` — forzarlo secuestraría el proyecto consumidor (P9/P10). ADR:
  `docs/decisions/20260721-orquestacion-multiagente.md`.
- **Identificadores en inglés, prosa en español.** `name:`/`subagent_type` toca el framework
  → inglés kebab-case; el cuerpo instructivo que lee el dev → español.
- Patrón **derivado** de `betta-tech/harness-sdd` (repo sin LICENSE): se adopta el patrón, no
  la prosa — todo redactado original. Evaluado con `ccem-research`.

## [1.0.0] — 2026-07-15

Primera versión. Reemplaza la copia manual de la carpeta `Kit/`.

### Agregado

- CLI `souclaude` con `init`, `upgrade`, `status` y `adopt`. Se distribuye por
  `npx github:ialvarezsoutec/souclaude-harness#v1` — sin registry ni token.
- **Motor de migración**: un solo code path para instalar en un repo vacío, adoptar un
  repo legacy y migrar de una versión del harness a otra. Lockfile en
  `.claude/harness.json` con el hash de cada archivo emitido.
- **Garantía de no-sobrescritura**: un archivo editado por el usuario nunca se pisa; la
  propuesta del harness queda al lado como `.new`.
- Skills project-local en `.claude/skills/`: `ccem-core`, `ccem-sdd`, `ccem-planner`,
  `ccem-research`, `ccem-stack`, `ccem-prompting`, `soutec-github`.
- Comandos `/spec-new`, `/adr-new`, `/constitution-check`, `/harness-upgrade`.
- Templates SDD Lite, que el `specs/README.md` del Kit prometía y nunca existieron.
- `.github/pull_request_template.md` y `.github/CODEOWNERS` — **obligatorios en Fase 1**
  según la Guía Operativa Git v2.0, y que el Kit no emitía.
- La constitución prellena **P1 (Contratos antes que tecnologías)** y **P2 (Hexagonal
  con enforcement automático)**, con la herramienta de enforcement **derivada del stack
  detectado** (import-linter en Python, dependency-cruiser en Node, ArchUnit en Java…).

### Decisiones que resuelven contradicciones del corpus

- **Numeración canónica P1-P10.** El corpus numeraba los mismos dos principios
  universales de tres formas: CCEM v3.0 los llama #5/#6, el Kit P7/P8, y el doc de
  Arquitectura P9/P10. **Gana P9 (Simplicity First) y P10 (Surgical Changes)**, la del
  doc de Arquitectura. Pendiente: corregir el Kit y CCEM v3.0 para que coincidan.
- **Idioma**: el dominio se nombra en español (entidades, value objects, policies,
  métodos de puerto) porque *el puerto habla en lenguaje de dominio, no de framework*.
  Adaptadores, infraestructura y todo lo que toca frameworks, en inglés. La regla previa
  del Kit ("todo en inglés") contradecía al doc de Arquitectura.
- **La carpeta de spec lleva el ID de Planner**: `specs/<PLN-023>-<slug>/`, con el mismo
  slug que la rama. El Kit usaba solo el slug, lo que rompe el hilo de trazabilidad
  Planner ↔ specs ↔ rama ↔ commits ↔ PR ↔ release.
- **Skills project-local, no globales.** CCEM v3.0 dice `~/.claude/skills/`. Se eligió
  local: cero instalación por dev, versionadas con el código, funcionan en CI, y —
  decisivo — una skill global **no se puede actualizar por proyecto**, lo que dejaría al
  motor de migración sin nada que migrar.

### Estilo

- **Conjugación en español: tuteo, no voseo.** Estándar de la organización — aplica a
  toda respuesta de Claude, no solo al contenido del harness. `CLAUDE.md` ahora lo
  declara explícitamente. Se convirtió todo el texto en voseo argentino que traía el
  proyecto (skills, comandos, README, MAINTAINERS, guía del desarrollador, comentarios de
  código) a tuteo — ~250 formas corregidas en 3 pasadas de verificación.

### Corregido (respecto del Kit v0)

- **`.claude/settings.json` tenía 4 de 5 claves inválidas.** `effort`,
  `auto_confirm_destructive`, `display_tools` y `token_budget_warning` no existen en el
  schema de Claude Code: se ignoraban en silencio. El archivo parecía configurado y no
  hacía nada. Hay una migración que las remueve.
  **Ojo**: estas claves las prescribe el propio doc de Arquitectura (§14). Ese documento
  también hay que corregirlo, o los repos nuevos las van a volver a copiar.
- **`model: "opusplan"` no es un valor válido.** El harness ya no fija `model` a nivel
  proyecto: forzarlo rompe a quien no tenga ese modelo.
- **`.claudeignore` nunca fue una feature de Claude Code.** El archivo se ignora en
  silencio. La exclusión real de secretos se configura en `permissions.deny` de
  `settings.json`, que el harness ahora emite. El `.claudeignore` de un repo viejo se
  marca obsoleto y se ofrece borrarlo con `--prune`.
- **`plan-template.md` emitía el antipattern #15** del doc de Arquitectura: constitution
  alignment con checkboxes sin referenciar ADRs ("alignment teatral"). Ahora exige el
  ADR concreto que respalda cada principio.
- **`tasks-template.md` imponía 15-30 min sin escape hatch**, cuando el doc de
  Arquitectura ya había documentado la excepción para adaptadores (2-3 h si son un
  componente único y verificable en aislamiento). La excepción ahora está en el template
  y hay que justificarla al usarla.
- **`apply()` revertía en silencio las ediciones del usuario.** Escribía toda acción con
  `writePath`, incluidas las `local-edit` — si editabas una skill, el siguiente `upgrade`
  te la pisaba sin avisar. Era la violación más grave posible de la garantía central.
  Encontrado por los tests, no por inspección manual.
- **Un repo recién creado con `README.md` de 0 bytes quedaba con un `.new` para siempre.**
  Un archivo vacío ahora se trata como ausente: no hay nada del usuario que perder.
- **`DATE` se recalculaba en cada corrida.** Un `CLAUDE.md`/`constitution.md` intactos
  aparecían como `conflict` -> `.new` espurio con solo cruzar la medianoche, porque el
  contenido deseado cambiaba de fecha aunque nada real hubiera cambiado. Ahora es sticky,
  igual que `OWNER`: se siembra una vez al instalar y no se toca más. Encontrado
  dogfooding el propio harness sobre este repo.

### Pendiente (falta la fuente)

- `ccem-research` (los 7 criterios) y `ccem-stack` están escritos como reconstrucción, no
  desde la fuente. Los documentos que los contienen —
  `CCEM-External-Sources-Evaluation.md` y `CCEM-Project-Startup-Guide.md` — no están en
  el repo. **Reescribirlos apenas aparezcan**; los repos los reciben con
  `souclaude upgrade`.
