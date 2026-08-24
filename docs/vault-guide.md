# Guía del Vault — centro de información multi-proyecto

> Esta guía vive en el repo del harness porque el Vault todavía no es un repo propio. El
> día que lo sea, esta guía **migra allá** y aquí queda solo un puntero. No se distribuye
> a los repos consumidores: el Vault es **uno por organización** (singleton). El
> protocolo operativo que ejecutan los agentes sí se distribuye, en el
> `progress/README.md` que instala el harness.

## 1. Qué es y qué no es

El Vault es la **vista ejecutiva y el estado vivo** de todos los proyectos: qué
milestones existen, cuál está trabajando quién y en qué máquina, con qué plan, qué
tareas se movieron hoy y cuánto costó cada sesión. Es esencial para orquestar múltiples
agentes con varias personas trabajando sobre los mismos repos, porque es la **fuente
única** de dos cosas que ningún repo puede poseer: los prefijos de proyecto y el estado
del trabajo entre máquinas.

El Vault vive en un **repo distinto** al de cada proyecto a propósito: toda la
visibilidad se acumula ahí sin ensuciar los repos de código, y la actualización
constante de estado no contamina el historial de ningún proyecto.

**No es** un repo de código: el código, los diffs, los tests y la evidencia técnica
viven en cada repo, que sigue siendo la **fuente de verdad técnica**. El Vault es la
vista.

## 2. Estructura de carpetas

```
Vault/
├── 00-System/                          # el sistema — no pertenece a ningún proyecto
│   ├── id-registry.md                  # AUTORIDAD de prefijos (ver §3)
│   └── monitor/                        # snapshots agregados de consumo por (cuenta, máquina)
│       └── <cuenta8>--<maquina8>.json  #   los escribe `souclaude monitor` (ADR 20260810)
└── Project-<PREFIJO>/                  # una carpeta por proyecto (Project-REA, Project-RAM…)
    ├── milestones.md                   # ESTADO VIVO — tablero de milestones (claim de nivel alto)
    ├── plans/                          # planes por milestone: <PREFIJO>-M<n>-P<n>-<slug>.md
    ├── kanban.md                       # ESTADO VIVO — tablero de tareas
    ├── sessions.md                     # append-only: una línea por sesión (quién, qué, tokens)
    ├── progress/
    │   └── history.md                  # espejo del historial del repo
    └── OBSERVATORIO.md                 # ficha del proyecto para el Observatorio de AI
```

Carpetas heredadas de series anteriores del harness (`specs/`, `roca_*.yaml`,
`evidence/`) pueden seguir existiendo — no se borran, pero el harness 3.x ya no las
escribe: los comandos `/rock-*` y el flujo SDD se eliminaron en 3.0.0. Si el equipo
mantiene la capa de rocas, la opera un humano.

## 3. El modelo: milestones → planes → tareas → sesiones

| Nivel | Artefacto | ID | Qué responde |
|---|---|---|---|
| Milestone | tarjeta en `milestones.md` | `<PREFIJO>-M<n>` | ¿Qué objetivos tiene el proyecto y quién trabaja cuál **ahora**? |
| Plan | archivo en `plans/` | `<PREFIJO>-M<n>-P<n>` | ¿Cómo se piensa llegar al objetivo? Puede haber varios: si P1 fracasa, P2 lo releva sin borrar la historia. |
| Tarea | tarjeta en `kanban.md` | `<PREFIJO>-M<n>-T<nnn>` | ¿Qué se está ejecutando hoy y en qué estado está? |
| Sesión | línea en `sessions.md` | — | ¿Quién trabajó, cuándo, sobre qué milestone y cuántos tokens costó? |

El **milestone** es la unidad de anti-solapamiento entre máquinas: su tarjeta lleva
dueño **y máquina** (`@nacho · PC01`). La **tarea** es la unidad de trabajo del día.
La **sesión** es la unidad de consumo.

### `00-System/id-registry.md` — la autoridad de prefijos

Fuente única de prefijos de proyecto. Solo se **agregan** filas; nunca se edita ni se
reutiliza una fila ajena. Un proyecto cerrado pasa a `retirado` — su prefijo jamás se
reutiliza (los IDs históricos lo referencian). Un agente que necesita un prefijo que no
existe **para y lo pide**: sin prefijo registrado no hay carpeta `Project-<PREFIJO>/`.

```markdown
| Prefijo | Proyecto | Dueño | Fecha de alta | Estado |
|---------|----------|-------|---------------|--------|
| REA     | Reachy   | [dueño] | [fecha]     | activo |
```

## 4. Quién escribe qué

| Artefacto | Quién | Cómo |
|---|---|---|
| `id-registry.md` | Humano (coordinador) | Agregar filas; jamás editar ajenas. |
| `milestones.md` | Humano define; **agentes mueven** | El humano crea/ordena los milestones; el agente mueve la tarjeta al tomar o cerrar uno, y **pushea en ese momento**. |
| `plans/` | **Agentes**, al adoptar un plan | Espejo del plan acordado en la sesión o en el repo. No se edita en el Vault: se corrige y se re-espeja. Los planes viejos no se borran. |
| `kanban.md` | **Agentes**, en vivo | Crear tarjetas al planificar; moverlas al cambiar el estado, con push inmediato. |
| `sessions.md` | **Agentes**, al cerrar cada sesión | Una línea append-only con milestone, dueño, máquina, tokens y resultado. |
| `progress/history.md` | **Agentes**, al cerrar tareas | Copia del `history.md` del repo. |
| `OBSERVATORIO.md` | **Agentes**, en release con cambios importantes | Se siembra vacía al crear el proyecto; se actualiza en el release `dev` → `main` (skill `soutec-github`) solo si el release trae cambios que la ficha deba reflejar — tagline, plataforma, resumen, hitos. No es un espejo del README del repo: es independiente del sync GitHub → Observatorio (`OBS-M6`). |
| `00-System/monitor/` | **Generado** (`souclaude monitor`) | Snapshots agregados por (cuenta, máquina); no se editan a mano. |

## 5. Relación Vault ↔ repos de código

La frontera es el **milestone**: en el Vault vive su estado y sus planes; en el repo
vive su ejecución (ramas, PRs, código, tests). Recuperar contexto desde cualquier
punto: buscar el ID (`REA-M3`) en el Vault da el objetivo, el plan activo y quién lo
trabaja; en GitHub da rama/PR/commits; en el repo, `grep -r REA-M3` da el detalle
técnico.

| Nivel | Vive en | Contiene |
|---|---|---|
| Vista + estado vivo (Vault) | Vault | Milestones con dueño/máquina, planes, kanban, sesiones con consumo, registro de prefijos, snapshots del monitor. |
| Técnico (repo) | Cada repo | **Fuente de verdad**: código, tests, `progress/history.md`, ADRs, evidencia técnica. |

## 6. Estado vivo — la regla central

Cuando un agente **empieza** a trabajar un milestone o una tarea, mueve su tarjeta
**en ese momento** y pushea. El tablero nunca depende de un push final: refleja el
ahora. Todo proyecto con el harness instalado está **constantemente** enviando su
progreso: claim del milestone al empezar, plan espejado al adoptarlo, tarjetas de
tareas al cambiar de estado, línea de sesión al cerrar. El protocolo paso a paso vive
en el `progress/README.md` de cada repo (lo instala el harness y lo mantiene
`souclaude upgrade`).

**Formato de los tableros**: compatible con el plugin **Kanban de Obsidian** —
frontmatter `kanban-plugin: board`, una tarjeta = una línea. `milestones.md` usa
columnas Backlog / En curso / Hecho; `kanban.md` agrega En review.

**Cómo llegan los agentes**: cada repo guarda la ruta local del Vault en
`.claude/vault.local.json`, que escribe el instalador (`npx souclaude`) y está
gitignorado — la ruta es de esa máquina. Si no hay ruta configurada o no existe, el
espejo se omite **sin bloquear el trabajo** y queda anotado en el `history.md` del
repo (`vault_skip`).

## 7. Concurrencia — varias personas, múltiples agentes

- **El Vault es un repo git** (`soubunker-vault`) con una regla **opuesta** a la de los
  repos de código: **push directo a `main`, sin PR**. No es un descuido, es la
  condición para que el tablero sea estado vivo — una tarjeta que espera el merge de un
  PR ya no refleja el ahora.
- **El claim es en dos niveles** (protocolo completo en `progress/README.md` de cada
  repo):
  1. `git -C "<vault>" pull --rebase` **antes** de empezar — sin este pull, dos agentes
     en máquinas distintas toman lo mismo sin enterarse.
  2. `milestones.md`: si el milestone está **En curso con otro dueño u otra máquina**,
     lo trabaja otro agente → **parar y preguntar al humano**. Nunca tomarlo, nunca
     moverlo, nunca saltar a otro por cuenta propia.
  3. `kanban.md`: misma regla a nivel tarea (En curso o En review con otro dueño).
  4. Mover tarjeta y **pushear en ese momento**: `chore: <ID> a En curso (@dueño ·
     <máquina>)`. `npx souclaude vault-sync --push` hace el ciclo seguro.
- **Conflictos**: una tarjeta/línea = una línea de archivo — conservar **ambas** y no
  borrar la de otro. Dos rebases fallidos seguidos → `vault_skip` en el `history.md`
  del repo y reportar; el trabajo local nunca se bloquea. **Nunca `git push --force`.**
- Cada persona/agente escribe **solo** las tarjetas, planes y sesiones de su proyecto y
  su trabajo: la partición por `Project-<PREFIJO>/` evita casi todos los conflictos.
- Los dos remotos **nunca se cruzan**: código, diffs y tests jamás al Vault; artefactos
  del Vault jamás al repo del proyecto.

## 8. Consumo de tokens — qué va y qué no

Dos canales, complementarios:

1. **`Project-<PREFIJO>/sessions.md`** — una línea por sesión, escrita por el agente al
   cerrar: fecha, rama/sesión, milestone, quién, máquina, tokens entrada/salida y
   resultado. Es el registro **por proyecto**: responde "¿cuánto costó este milestone y
   quién lo trabajó?". Si el agente no tiene el dato de tokens, escribe `n/d` — la
   línea va igual. (ADR `20260817-milestones-planes-y-sesiones-en-vault`.)
2. **`00-System/monitor/`** — snapshots **agregados** por (cuenta, máquina), <1 KB, que
   `souclaude monitor` publica automáticamente cada ~5 min: límites de plan y totales
   del día. Es el registro **por cuenta**: responde "¿cómo venimos de límites hoy?".
   (ADR `20260810-monitor-snapshots-en-vault`.)

**Sigue prohibido**: telemetría cruda (`model-router.jsonl`, transcripts, eventos por
mensaje), código, diffs, tests, logs y evidencia técnica pesada. La distinción: al
Vault van **estado y agregados legibles por humanos**; la materia prima técnica queda
en cada repo y en cada máquina.

## 9. Checklist de creación (primera vez)

1. Crear el repo `Vault/` con la estructura del §2.
2. Sembrar `00-System/id-registry.md` con los prefijos activos y su dueño.
3. Por cada proyecto activo, crear `Project-<PREFIJO>/` con `milestones.md` y
   `kanban.md` (frontmatter `kanban-plugin: board` + columnas vacías), `plans/`,
   `sessions.md`, `progress/history.md` y `OBSERVATORIO.md`. **No hace falta a
   mano**: si el prefijo ya está en `00-System/id-registry.md`, `npx souclaude`
   siembra la carpeta y la pushea al conectar el repo — confirma en interactivo,
   o `--vault-seed` sin TTY. Un prefijo que no está registrado no se siembra:
   primero va la fila (§3).
4. Si el Vault es un vault de Obsidian: instalar el plugin **Kanban** para ver los
   tableros.
5. En cada repo de proyecto: correr `npx souclaude` y aceptar el paso del Vault (clona
   y escribe `.claude/vault.local.json`). Sin interacción: `--vault-path <ruta>`.
6. Dar escritura al equipo y a los agentes, **sin revisión obligatoria en `main`**: el
   push directo es lo que mantiene vivo el tablero (§7).
7. Anunciar la regla de oro: **sin milestone en el Vault no hay trabajo** — todo
   empieza con una tarjeta que existe en `milestones.md`.
