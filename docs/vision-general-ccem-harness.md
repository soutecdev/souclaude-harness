# Visión general — CCEM/SDD y souclaude-harness

> ⚠️ **Este documento predata el harness v2.0.0 y describe el modelo Planner.** A partir de
> v2.0.0 (capa de rocas), **el emisor de IDs es el hito** (`<PREFIJO>-H<n>`), no Planner: la
> roca nace en la reunión trimestral, se descompone en hitos, y el hito emite el ID que amarra
> spec ↔ rama ↔ PR. Donde este texto diga "tarjeta de Planner", léase "hito". Fuentes vigentes:
> `docs/decisions/20260722-capa-rocas-hito-emisor-de-ids.md`, la skill `ccem-planner` y el
> paquete `ccem-rocas`. Este documento se reescribe en una tarjeta aparte.

> Documento de referencia interno. Explica **con profundidad** qué es hoy la metodología
> CCEM, cómo encaja el Spec-Driven Development (SDD) dentro de ella, y qué es y cómo
> funciona el `souclaude-harness` que la empaqueta y la distribuye.
>
> No reemplaza a las fuentes de verdad (`docs/constitution.md`, las skills de
> `.claude/skills/`, `AGENTS.md`): las **resume y las conecta** para que se entienda el
> todo. Cuando haya conflicto, mandan esas fuentes.
>
> Estado del repo al escribir: harness **v1.1.0**, rama `dev`.

---

## 0. Mapa mental en una frase

**Planner ordena el QUÉ. CCEM diseña el CÓMO técnico. Git/GitHub registra el HECHO. El ID
de la tarjeta de Planner es el hilo que amarra los tres.**

Alrededor de esa frase hay tres capas que conviene no confundir:

| Capa | Qué es | Dónde vive |
|---|---|---|
| **CCEM** | La *metodología*: principios, flujo SDD, prompting anti-hack, trazabilidad, criterios de research. | `.claude/skills/`, `docs/constitution.md` |
| **La orquestación multiagente** | Un *patrón de ejecución* que hace cumplir CCEM con 4 roles separados, y se activa según la complejidad del pedido. | `.claude/agents/`, `AGENTS.md` |
| **souclaude-harness** | El *CLI/instalador* que emite y mantiene al día todo lo anterior en cualquier repo. | `src/`, `templates/`, `bin/cli.mjs` |

CCEM es el método. La orquestación es *una forma de ejecutarlo*. El harness es el *vehículo
de distribución*. Este documento recorre las tres.

---

## 1. Qué es CCEM

CCEM es la metodología de trabajo con Claude Code de SOUTEC. No es una sola cosa: es un
conjunto de **skills** (instrucciones que Claude carga solo cuando el contexto lo amerita),
**comandos** (`/spec-new`, `/adr-new`, …) y una **constitución** de principios
no-negociables. Todo eso se versiona *dentro de cada repo*, en `.claude/`.

Su objetivo es combatir los dos fracasos típicos de un agente de código:

1. **Código que "se ve bien pero no funciona"** — se ataca invirtiendo la jerarquía: el
   *intent* (la especificación) es la fuente de verdad, no el código. Eso es SDD.
2. **Degradación silenciosa** — over-engineering y scope creep — se ataca con dos
   principios universales (P9 Simplicity, P10 Surgical) más enforcement automático.

### 1.1 Los 6 principios rectores (`ccem-core`)

El fundamento conceptual. Cuatro vienen de Karpathy; dos los agregó la comunidad para
frenar anti-patterns propios de LLMs. Los principios **5 y 6 son además P9 y P10 de la
constitución**: universales, no editables.

1. **Context is king.** Los LLMs son *pattern-completion engines*. Un prompt vago obliga a
   adivinar entre miles de asunciones. Antes de pedir algo: *¿tiene toda la info para saber
   qué quiero?* Si no, el contexto va **antes** de la instrucción. Referencias con `@` en
   vez de pegar archivos enteros.
2. **Think before coding.** Ante ambigüedad real, parar y preguntar. **Pero calibrado:** en
   tareas triviales, preguntar de más *baja* la calidad. Preguntar una vez, al inicio, y
   solo si la ambigüedad es real.
3. **Goal-driven execution.** Verificar que la tarea se completó *como se pidió*, no que el
   código corrió. Riesgo concreto: degradar "ejecutá X" a "así harías X".
   **Verificación = ejecutar + validar output + confirmar intención.**
4. **Delegation over Guidance.** Tratar a Claude como un ingeniero senior al que se le
   delega, no un junior al que se le dicta. *¿Esta decisión la tomaría un senior en el que
   confío?* → delegar y verificar el output, no supervisar el proceso.
5. **Simplicity First (P9).** Mínimo código que resuelve el problema. Nada especulativo.
   Test mental: *¿un senior diría que esto está sobre-complicado?*
6. **Surgical Changes (P10).** Tocar solo lo necesario; limpiar solo el propio desorden.
   *Cada línea cambiada debe trazar directamente al request.* Dead code ajeno: se menciona,
   no se borra.

Operacionalización: el **auto-check de 6 preguntas** (Context / Think / Goal / Delegation /
Simplicity / Surgical) antes de cada respuesta sustantiva.

**Selección de modelo** (primer eje de optimización): escalar el modelo al problema —
*Decisiones* (el más capaz: diseño, refactors arquitectónicos, root-cause), *Ejecución*
(intermedio: workflows medianos), *Volumen* (rápido: subagentes en paralelo). Patrón
*Advisor Strategy*: el ejecutor trabaja y el modelo de decisiones aconseja en los momentos
críticos (~400-700 tokens/consulta; medirlo antes de adoptarlo). Y una prohibición dura:
**nunca "optimize at all costs"** en un prompt o `CLAUDE.md` — empuja a sacrificar
correctitud por velocidad.

### 1.2 Spec-Driven Development (`ccem-sdd`)

El corazón operativo de CCEM. **El intent es la fuente de verdad, no el código.** Cuando
algo cambia, se actualiza la spec y se *regenera* el plan; no se parchea el código dejando
la doc mintiendo.

```
FASE 0 · una vez por proyecto
  Constitución  → docs/constitution.md  (principios no-negociables)

FASE 1 · el QUÉ y el POR QUÉ            15-30 min
  Specify       → spec.md   · user journeys, outcomes. SIN tech stack.

FASE 2 · el CÓMO técnico                30-45 min
  Plan          → plan.md   · stack, arquitectura, data contracts, risks, ADRs

FASE 3 · descomposición accionable      15-30 min
  Tasks         → tasks.md  · chunks de 15-30 min, testeables en aislamiento

FASE 4
  Implement     → task por task, review incremental (NUNCA en batch al final)
```

Los artefactos viven en `specs/<ID>-<slug>/`. Se crean con `/spec-new`. Típicamente 8-12
tasks por feature.

**Cuándo aplicar SDD importa tanto como cuándo no.** La matriz de decisión:

| Trabajo | SDD |
|---|---|
| Feature nueva, nuevo componente productivo, nuevo producto | Completo (4 fases) |
| Refactor >3 archivos o >1 sistema, migración de schema/arquitectura | Completo (+ rollback plan) |
| Ajuste a componente existente, optimización de performance | **Lite** |
| Bug fix puntual, cosmético, spike, script one-off, hotfix, typo | **No** — hacelo directo |

Si cae en "No", *decilo y hacé el trabajo*: ceremonia que no sirve viola P9.

**SDD Lite** comprime la ceremonia (~45 min vs 2-3 h) con `spec-lite/plan-lite/tasks-lite`,
invocado con `/spec-new <slug> --lite`. **Los checkpoints humanos son los mismos**: lo que
se comprime es la ceremonia, no el control.

**Reglas duras de SDD:** en `spec.md` no va tech stack (si aparece "usamos Postgres", eso
es `plan.md`); los non-goals son tan importantes como los goals; si el plan contradice la
constitución, se corrige el plan.

### 1.3 Trazabilidad Planner ↔ CCEM ↔ Git (`ccem-planner`)

**Todo trabajo empieza con un ID de tarjeta de Planner.** Sin ID: se pide, no se inventa
(incluye hotfixes — la urgencia cambia la prioridad, no el procedimiento). El ID es el hilo:

```
Tarjeta Planner → specs/<ID>-<slug>/ → rama tipo/<ID>-<slug> → commits → PR → tag → Done
        └───────────────── el MISMO ID en todos ─────────────────┘
```

Prefijos por proyecto: `RAM` (Ramón), `REA` (Reachy), `PAC` (Paco), `ALF` (Alfred), `PLN`
(transversal), `SP` (SharePoint). **La carpeta de spec lleva el mismo slug que la rama**,
para que `grep -r <ID> specs/` y `git log --grep=<ID>` devuelvan lo mismo.

El SDD (4 fases) vive dentro de un ciclo de **8 fases** de Planner: Backlog → Plan Semana
(máx 2-3 tarjetas/dev) → Doing+Specify → Plan técnico → Tasks → Implement+PR → Despliegue
(coordinador) → Done+Retro. **La tarjeta no se mueve a Done sin registro de despliegue.**

### 1.4 Prompting Anti-Hack (`ccem-prompting`)

Cómo pedir trabajo sin dejar puertas para *simular* que terminó. El núcleo es una frase
(Opus 4.7 System Card §6.2.2.2):

> *"If anything is unclear, ambiguous, or seems wrong, stop and ask me — do not guess,
> reinterpret, or decide on your own what I 'probably meant.'"*

Le da al modelo una **salida legítima** cuando el camino correcto no está claro; sin ella,
la única forma de "cumplir" es inventar. (Con la misma calibración de siempre: no aplicarlo
a tareas triviales.)

Un prompt de task tiene 4 bloques: **Objetivo** (resultado observable, no "que pasen los
tests"), **Contexto** (antes de la instrucción, con `@`), **Restricciones** (que *nombran
los atajos específicos*: no tocar el test, no hardcodear, no mockear lo que se prueba, no
tragar errores con try/except) y **Verificación** (un comando que puede *fallar* si el
trabajo está mal). Pattern maestro: **verificación falsable** — un criterio que no puede
fallar no es un criterio.

### 1.5 Evaluar herramientas antes de adoptarlas (`ccem-research`)

Antes de sumar cualquier dependencia/MCP/CLI/servicio, se responde por escrito una grilla
de **7 criterios**: (1) problema real, (2) alternativa en la stdlib, (3) **costo de
contexto** — el más olvidado: un MCP inyecta sus tools en *cada* turno para siempre, un CLI
cuesta cero hasta que lo llamás, (4) salud del proyecto, (5) superficie de seguridad, (6)
costo de salida — *preferí lo que se puede desinstalar*, (7) quién la mantiene acá. Output:
una recomendación breve (adoptar/no/spike) + los 3 criterios que decidieron. Si es
significativa → ADR. Bandera roja: justificar con "es el estándar de la industria" = no
respondiste ninguno de los 7.

### 1.6 Convenciones y `CLAUDE.md` (`ccem-stack`)

`CLAUDE.md` **no es documentación**: es el prompt que Claude lee en cada sesión, cada línea
cuesta tokens para siempre. Filtro: una regla va **si y solo si omitirla causa un error**
(sí: "las migraciones se corren con X"; no: "usamos TypeScript"). Límite duro **<200
líneas**. Las reglas **se cosechan**, no se escriben al empezar: cuando Claude comete un
error por no saber algo del proyecto, esa es la regla que faltaba. Si comete el mismo error
dos veces, la regla no está o está mal escrita — se arregla el archivo, no se corrige a mano
otra vez.

### 1.7 Flujo Git/GitHub obligatorio (`soutec-github`)

Guía Operativa v2.0. *"Primero disciplina, luego automatización."* **Reglas inviolables (ni
en hotfix):** nunca push/merge/approve sobre `main`; nunca `--force` (solo
`--force-with-lease` sobre rama propia con rebase); nunca commitear secretos; nunca rama sin
ID; nunca crear repos/tags/releases (eso es del coordinador); un hotfix no es un bypass.

- **Rama:** `tipo/ID-descripcion-corta`. Tipos: `feature` `fix` `hotfix` `docs` `chore`
  `refactor` `experiment`. Prohibidos: `cambios`, `prueba`, `final`, nombres de persona.
- **Commit:** `tipo: descripción` en español, **sin scope**, sin ID en el mensaje (va en la
  rama y el PR). No existe el tipo `hotfix` → se commitea como `fix:`.
- **PR:** completar la plantilla *de verdad*; correcciones → misma rama, no un PR nuevo;
  integración por **squash & merge** que hace el coordinador.
- **SemVer** `vX.Y.Z`: el dev *propone* la versión en el PR, el coordinador *crea* el tag.

### 1.8 Los comandos (skills invocables con `/`)

| Comando | Qué hace |
|---|---|
| `/spec-new <ID> <slug> [--lite]` | Crea la rama y `specs/<ID>-<slug>/` con spec/plan/tasks desde templates; entrevista por Goals/Non-goals; para en el checkpoint. Sin ID válido: para y lo pide. |
| `/adr-new <título>` | Registra una decisión en `docs/decisions/YYYYMMDD-<slug>.md`. Entrevista Context y Alternatives. Los ADR son **inmutables**: una decisión nueva supersede, no edita. |
| `/constitution-check` | Audita el diff actual contra P1-P10 con archivo y línea. Veredicto por principio (cumple/viola/no aplica). Correr antes del PR. |
| `/harness-upgrade` | Actualiza el harness del repo. Corre `status`, luego `upgrade --dry-run`, espera OK, aplica. Nunca `--force` ni `--prune` sin pedido explícito. |

---

## 2. La constitución (P1-P10)

Vive en `docs/constitution.md`. Los principios son **no-negociables**: si el plan o los
tasks los contradicen, **se corrige el plan, no la constitución**. Cualquier excepción
requiere ADR explícito. **Numeración canónica P1-P10**; P9 y P10 son universales y no se
editan.

| # | Principio | Núcleo |
|---|---|---|
| **P1** | Contratos antes que tecnologías | Los puertos del dominio son inmutables; las tecnologías detrás, intercambiables. Un framework **nunca** es un puerto. No crear puertos "por si acaso". |
| **P2** | Hexagonal con enforcement automático | `adapters → application → domain`, nunca al revés. El dominio jamás importa frameworks. Enforcement en CI que **bloquea el merge**. *Sin enforcement, hexagonal es teatro.* |
| **P3** | Medir antes de optimizar | No se optimiza sin métrica base + telemetría. Nunca "optimize at all costs". |
| **P4** | Modularidad por capas, no por features | La modularidad la da la separación de capas (P2), no agrupar por feature. |
| **P5** | Observabilidad desde el día uno | Trace ID por request, logging estructurado. Agregarla después cuesta 10× más. |
| **P6** | Human-in-the-loop en acciones sensibles | No hay autonomía total sobre sistemas externos. Las acciones destructivas requieren aprobación humana explícita, antes. Backup antes de migración irreversible. |
| **P7** | *[específico del proyecto]* | Placeholder a completar por proyecto. |
| **P8** | *[específico del proyecto]* | Placeholder a completar por proyecto. |
| **P9** | **Simplicity First** (universal) | Mínimo código. Nada especulativo. Combate el over-engineering de los LLMs. |
| **P10** | **Surgical Changes** (universal) | Cada línea traza al request. Combate el scope creep. |

> P9 y P10 son el antídoto contra la degradación: el enforcement automático captura las
> violaciones explícitas (un `import` prohibido en `domain/`); Simplicity y Surgical
> capturan las sutiles (mover una clase "para reorganizar", abstracciones especulativas).

Standards asociados: **naming** (puertos `Port`/`UseCase`, adaptadores `Adapter` con la
tecnología por delante, dobles `Fake`; **dominio en español**, adaptadores/infra en
inglés); **testing** (tres niveles unit/integration/e2e, **fakes no mocks**, cobertura ≥80%,
un adaptador se testea como una unidad); **docs** (`CLAUDE.md` <200 líneas, ADR inmutables);
**security** (secretos nunca en el repo; exclusión real vía `permissions.deny` de
`settings.json` — `.claudeignore` no existe y se ignora en silencio; credencial expuesta se
**rota**).

> **Las dos reglas que más se violan sin querer:** P2 (modificar la config del enforcement
> para que un check pase es *hacer trampa*: se corrige el código, no la regla) y P10 (si una
> línea no traza al request, no va).

---

## 3. La orquestación multiagente (opt-in)

Novedad de la **v1.1.0**. Hasta entonces el trabajo de agentes era de un solo hilo: un mismo
Claude especificaba, implementaba, se revisaba y decidía cuándo terminó — fundiendo roles
que el método separa a propósito y dejando el Anti-Hack sin un revisor independiente.

El patrón (derivado de `betta-tech/harness-sdd`, adaptado a CCEM) introduce **cuatro roles**
en `.claude/agents/`, cada uno con herramientas acotadas a propósito:

| Agente | Rol | ¿Escribe código? | Herramienta clave |
|---|---|---|---|
| `orchestrator` | Descompone y coordina; hace respetar los checkpoints. | ❌ | `Agent` (lanza a los otros) |
| `spec-author` | Redacta spec/plan/tasks, **una fase por invocación**. | ❌ | `Write`/`Edit` (solo en `specs/`) |
| `implementer` | Implementa task por task, cada cambio con su test. | ✅ | `Write`/`Edit` |
| `reviewer` | Aprueba o rechaza de forma **independiente**. | ❌ | **sin** `Write`/`Edit`: dictamina |

**La separación es el punto:** quien especifica no implementa, y quien implementa **no se
aprueba a sí mismo**. El `reviewer` sin `Write` es enforcement real, no una recomendación.

### 3.1 El flujo — tres checkpoints humanos, no uno

```
tarjeta Planner (ID) ─► rama tipo/<ID>-<slug>
        │
        ▼
spec.md ─► ⏸ HUMANO ─► plan.md ─► ⏸ HUMANO ─► tasks.md ─► ⏸ HUMANO ─► implement ─► review ─► PR
```

Hasta que spec, plan y tasks estén aprobados, la rama **solo admite commits `docs:`**.
Durante implement, el review es **incremental (task por task), nunca en batch al final**. Si
el `reviewer` devuelve `CHANGES_REQUESTED`, vuelve al `implementer` con el veredicto; no se
cierra nada hasta `APPROVED`.

Los checkpoints humanos y "ningún agente se auto-aprueba ni marca `done`" son **P6 hecho
producto**.

### 3.2 Cómo se activa

Hay **dos puertas**. La formal es que el usuario lo pida: `/spec-new <ID> <slug>` —que crea
la rama, la carpeta y los tres artefactos— o el pedido en palabras ("actúa como
`orchestrator` para la tarjeta PLN-XXX"). Ahí se monta el flujo sin discutir la
clasificación.

La segunda es el **triaje por complejidad**: ante todo pedido que implique escribir código, la
sesión lo clasifica contra la matriz de `ccem-sdd` antes de tocar nada. Un cambio cosmético o
un fix puntual se hace directo —montar el flujo ahí viola P9—; una feature nueva, una
integración externa o un cambio de contrato entran al flujo completo. Cubre el caso que antes
se caía: el pedido complejo que nadie marcó como tal. El triaje está en `AGENTS.md` y
`CLAUDE.md`.

Como un subagente de Claude Code no siempre puede lanzar otros subagentes, en la práctica
**la sesión principal adopta el rol `orchestrator`** y desde ahí lanza a los demás.

### 3.3 Resultados por disco, no por chat

Cada agente escribe su resultado en un archivo versionado y devuelve **solo una referencia**
(`spec_ready -> specs/<ID>-<slug>/spec.md`, `done -> progress/impl_<ID>.md`,
`APPROVED -> progress/review_<ID>.md`). El contenido vive en el repo, no en la conversación:
queda trazable y no se pierde entre sesiones.

### 3.4 Por qué así (ADR `20260721-orquestacion-multiagente`)

- **D1 — Opt-in, no líder global.** Forzarlo vía `CLAUDE.md` secuestraría el proyecto
  consumidor (viola P9/P10).
- **D2 — Identificadores en inglés, prosa en español.** `name:`/`subagent_type` tocan el
  framework → inglés kebab-case; el cuerpo instructivo que lee el dev → español.
- **D3 — `AGENTS.md` como `managed`.** El harness posee el doc de flujo; el upgrade lo
  mantiene fresco (si el usuario lo edita, no se pisa: queda `.new`).
- **D4 — Derivar el patrón, no la prosa.** El repo de referencia no declara LICENSE → "all
  rights reserved" sobre su *texto*. Los patrones no son copyrightables; la prosa sí. Todo
  se redactó original.

Costo de motor: cero. Es **contenido** (templates + manifest), no lógica nueva; se revierte
con `git revert`.

---

## 4. El souclaude-harness (el CLI/instalador)

CLI para instalar y migrar el harness CCEM en cualquier repo — uno nuevo, uno legacy de
cinco años, o uno con una versión vieja del harness. Se distribuye sin registry ni token:

```bash
npx github:soutecdev/souclaude-harness#v3
```

Solo hace falta git y Node ≥20. **El harness y las skills son project-local**: se commitean
con el repo, quien clona los tiene, y el `upgrade` los mantiene al día proyecto por proyecto.
(Elección deliberada frente a skills globales: una skill global no se puede actualizar por
proyecto, lo que dejaría al motor de migración sin nada que migrar.)

### 4.1 Comandos del CLI

| Comando | Qué hace |
|---|---|
| `souclaude init` | Instala. Sirve igual en un repo vacío y en uno con años de código. |
| `souclaude upgrade` | Actualiza a la última versión. Aplica migraciones. |
| `souclaude status` | Solo lectura. Exit `0` = al día · `1` = hay upgrade · `2` = drift. |
| `souclaude adopt` | Para una estructura hecha a mano. **No toca ningún archivo**: solo escribe el lockfile. |

Sin comando, **autodetecta**: hay lockfile → `upgrade`; hay estructura previa (`CLAUDE.md`,
`.claude`, …) → `adopt`; repo limpio → `init` ([src/cli.js](src/cli.js)). Flags que
importan: `--dry-run` (imprime el plan, escribe cero bytes), `--yes`, `--force`, `--prune`,
`--no-backup`, `--verbose`, y `--name/--type/--stack/--lang` para responder sin modo
interactivo.

### 4.2 La garantía central: un archivo tuyo nunca se sobrescribe en silencio

Es la propiedad más importante del motor, y la razón de que **init, adopción de legacy y
migración de versión sean el mismo code path**. No hay tres flujos: hay una tabla de
veredictos ([src/core/plan.js](src/core/plan.js)). El motor clasifica cada archivo cruzando
tres cosas: qué hay en disco, qué dice el **lockfile** (`.claude/harness.json`) que había, y
qué querría emitir el harness hoy.

| En disco | En el lockfile | ¿Cambió el template? | Veredicto | Qué pasa |
|---|---|---|---|---|
| no está | no está | — | `create` | se crea |
| **está** | no está | — | `foreign` | **nunca se pisa** → `.new` al lado |
| está, intacto | está | no | `noop` | nada |
| está, intacto | está | sí | `update` | se actualiza (no perdés nada: no lo habías tocado) |
| está, **editado por vos** | está | no | `local-edit` | se respeta, no se toca |
| está, **editado por vos** | está | sí | `conflict` | **nunca se pisa** → `.new` al lado |
| lo escribimos, lo borraste | está | — | `restore` | se reescribe |
| está | ya no en el manifest | — | `obsolete` | se ofrece con `--prune` + doble confirmación |

Salvaguardas adicionales, todas subordinadas a la propia constitución (P6/P10): backup de
todo lo sobrescrito en `.claude/backup-<timestamp>/`; `--prune` exige tipear `BORRAR`;
`--force` exige tipear `FORCE`. Para los dos archivos que el harness **no posee del todo**:
`.gitignore` (solo es dueño de un bloque delimitado; tus líneas nunca se tocan — política
`append-block`) y `.claude/settings.json` (solo **agrega** claves que faltan; nunca pisa un
valor tuyo — política `merge-json`).

### 4.3 Anatomía del motor

`souclaude-harness` es en sí mismo un proyecto Node hexagonal-simple. Piezas clave en
[src/core/](src/core/):

- **`plan.js`** — calcula el plan de acciones (la tabla de veredictos de arriba). Corazón
  del motor.
- **`manifest.js`** — lee `templates/harness.manifest.json`: la lista declarativa de qué
  archivo se emite, desde qué template, con qué política y si se renderiza.
- **`apply.js`** — ejecuta el plan (escribe, respeta `.new`, hace backup).
- **`lockfile.js`** — lee/escribe `.claude/harness.json` (versión + hash de cada archivo).
- **`hash.js`** — hashing y normalización para comparar contenido de forma estable.
- **`render.js`** — sustituye variables (`PROJECT_NAME`, `STACK`, `OWNER`, `DATE`…) en los
  templates marcados `render: true`.
- **`block.js`** / **`jsonmerge.js`** — implementan `append-block` (.gitignore) y
  `merge-json` (settings.json).
- **`detect.js`** — detecta stack y package manager.
- **`migrations/index.js`** — transforma lo que hay en disco *antes* de comparar, para que
  un fix de una versión vieja aparezca como un `update` normal.

**Políticas de archivo** (columna `policy` del manifest):

| Política | Significado | Ejemplos |
|---|---|---|
| `user-owned` | Se siembra una vez; si el usuario lo edita, no se pisa. | `CLAUDE.md`, `docs/constitution.md`, `notes.md`, PR template |
| `managed` | El harness es dueño; el upgrade lo mantiene fresco (edición → `.new`). | skills, agentes, `AGENTS.md`, templates de spec/ADR |
| `merge-json` | Solo agrega claves faltantes. | `.claude/settings.json` |
| `append-block` | Solo gestiona un bloque delimitado. | `.gitignore` |

### 4.4 Qué instala

```
CLAUDE.md                     contexto del proyecto (user-owned, <200 líneas)
AGENTS.md                     mapa del flujo multiagente (managed)
docs/constitution.md          principios P1-P10 (user-owned)
docs/decisions/               ADRs + template
specs/                        SDD: templates full y lite
notes.md                      scratchpad persistente
.claude/
  settings.json               permisos y deny de secretos (merge-json)
  harness.json                lockfile: versión + hash de cada archivo
  skills/   ccem-core, ccem-sdd, ccem-planner, ccem-research, ccem-stack,
            ccem-prompting, soutec-github, spec-new, adr-new,
            constitution-check, harness-upgrade
  agents/   orchestrator, spec-author, implementer, reviewer
.github/    pull_request_template.md, CODEOWNERS
.gitignore  bloque gestionado, tus líneas intactas
```

### 4.5 Tests e invariantes

Se prueba con `node:test`, sin dependencias de testing, sobre repos temporales reales
(incluido uno con un **espacio en la ruta**, porque los repos de SOUTEC viven bajo OneDrive
— este mismo repo). Los dos invariantes que atrapan casi todo:

- **Idempotencia:** correr `init` dos veces no cambia nada la segunda vez.
- **Pureza de `--dry-run`:** el árbol queda byte-idéntico.

Varios de los bugs más graves los encontraron los tests o el dogfooding, no la inspección
manual (p. ej. `apply()` revertía en silencio ediciones del usuario; `DATE` recalculándose
cada día generaba `.new` espurios).

### 4.6 Versionado y publicación

El harness y el CLI **se versionan juntos** (`package.json` y `harness.manifest.json` en la
misma versión). La organización consume el tag móvil `#v3` y recibe los parches sin hacer
nada. Publicar: `git tag vX.Y.Z && git tag -f v3 && git push …`.

---

## 5. Un caso real de punta a punta: PLN-001

La propia orquestación multiagente se construyó **con** el método (dogfooding). El rastro
completo está en el repo y sirve de ejemplo canónico:

- **Tarjeta:** `PLN-001` (transversal).
- **Rama:** `feature/PLN-001-orquestacion-agentes`.
- **Spec:** [specs/PLN-001-orquestacion-agentes/spec.md](specs/PLN-001-orquestacion-agentes/spec.md)
  — QUÉ y POR QUÉ, sin stack; goals priorizados, non-goals explícitos (no motor automático,
  no `feature_list.json`, no cambiar P1-P10), user journeys, success criteria medibles.
- **Plan y Tasks:** `plan.md` y
  [tasks.md](specs/PLN-001-orquestacion-agentes/tasks.md) — 12 tasks (T1-T12) de 15-30 min,
  un commit por task, con dependencias, verificación y checkpoints humanos. T1 = ADR; T2-T6
  = los 4 agentes + `AGENTS.md`; T7-T9 = manifest + versión + tests; T10-T11 = dogfooding
  (aplicar el harness a este repo); T12 = `/constitution-check` + cierre.
- **ADR:** [docs/decisions/20260721-orquestacion-multiagente.md](docs/decisions/20260721-orquestacion-multiagente.md)
  — decisión, alternativas descartadas, grilla `ccem-research`.
- **Resultado:** spec en status `implemented`, harness bumpeado a `1.1.0`, PR mergeado
  (commit `fa7789a`).

Leer esos cuatro archivos en orden (spec → plan → tasks → ADR) es la forma más rápida de ver
CCEM/SDD funcionando de verdad.

---

## 6. Glosario rápido

| Término | Qué es |
|---|---|
| **CCEM** | La metodología completa (skills + comandos + constitución). |
| **SDD** | Spec-Driven Development: el flujo de 4 fases dentro de CCEM. |
| **souclaude-harness** | El CLI que emite y mantiene CCEM en cada repo. |
| **Harness** | Coloquialmente, el conjunto de archivos que el CLI instala en un repo. |
| **Skill** | Instrucción en `.claude/skills/` que Claude carga solo cuando aplica. |
| **Comando** | Skill invocable explícitamente con `/` (`disable-model-invocation`). |
| **Agente** | Rol de subagente en `.claude/agents/` con herramientas acotadas. |
| **Constitución** | `docs/constitution.md`: principios no-negociables P1-P10. |
| **ADR** | Architecture Decision Record, inmutable, en `docs/decisions/`. |
| **Lockfile** | `.claude/harness.json`: versión + hash de cada archivo emitido. |
| **`.new`** | Propuesta del harness al lado de un archivo tuyo que difiere; vos decidís. |
| **ID de Planner** | El hilo (`PLN-023`…) que amarra tarjeta ↔ spec ↔ rama ↔ commits ↔ PR ↔ release. |

---

## 7. Estado actual y pendientes conocidos

- **Versión:** harness/CLI en **3.5.0**, publicado bajo los tags `v3.5.0` y el móvil
  `v3`. El resto de este documento describe la arquitectura de la era 1.x: los
  mecanismos (manifest, motor de plan, migraciones) siguen vigentes, pero los ejemplos
  y el recorrido de un caso real no se actualizaron a la v3 — para el flujo de trabajo
  vigente, `docs/GUIA-DESARROLLADOR.md` y `docs/onboarding-desarrollador.md`.
- **P7 y P8 de la constitución** son placeholders: cada proyecto los completa con su
  principio propio.
- **P2** deja pendiente completar la ruta del archivo de config del enforcement en cada repo.
- **`ccem-research` y `ccem-stack`** están escritos como reconstrucción, no desde su fuente
  original (`CCEM-External-Sources-Evaluation.md` y `CCEM-Project-Startup-Guide.md`, que no
  están en el repo). A reescribir cuando aparezcan; los repos los reciben con `upgrade`.
- **Corpus a reconciliar:** el doc de Arquitectura de SOUTEC todavía prescribe claves de
  `settings.json` inválidas (§14) y numeraciones de principios distintas; hay que corregirlo
  o los repos nuevos volverán a copiarlas.

---

### Fuentes de verdad (leer el original cuando importe)

`docs/constitution.md` · `.claude/skills/*/SKILL.md` · `.claude/agents/*.md` · `AGENTS.md` ·
`docs/GUIA-DESARROLLADOR.md` · `README.md` · `CHANGELOG.md` ·
`templates/harness.manifest.json` · `src/core/plan.js` · `specs/PLN-001-orquestacion-agentes/`
