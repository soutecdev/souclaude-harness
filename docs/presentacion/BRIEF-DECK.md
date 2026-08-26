# Brief del deck de la metodología — para generar desde Claude web

Documento autosuficiente para **regenerar la presentación desde cero** pegándolo en
claude.ai. Contiene el contenido completo de las 13 láminas y el sistema visual.

> **Cuándo usar esto y cuándo no.** El deck ya existe en este repo: `deck.html` (navegable)
> y `build-svg.mjs` (genera los SVG para Figma). Para **cambios puntuales**, edita esos
> archivos — no regeneres. Este brief sirve para producir una **versión alternativa**:
> otro formato, otra identidad visual, una variante corta para una charla de 15 minutos,
> o una maqueta que alguien va a terminar a mano.

---

## 1 · El encargo

Genera una presentación de **13 láminas en formato 16:9 (1920×1080)** que explique la
metodología de trabajo de SOUTEC con el harness `souclaude`.

**Audiencia**: el desarrollador que adopta el harness. No es para dirección ni para quien
mantiene el generador. Da por sentado que sabe git y trabajar con PRs; no da por sentado
que conozca el Vault, los milestones ni el espejo en Jira.

**Objetivo**: que quien la vea sepa **qué hacer el lunes** — de dónde sale el milestone
antes de tocar código, por qué el Vault se pushea directo a `main` y el proyecto no, qué
pasa cuando mueve una tarjeta, y qué comando corre para instalar.

**Tono**: preciso y sin épica. Nada de "revolucionar el desarrollo". Cada lámina defiende
un punto concreto y verificable.

---

## 2 · Sistema visual

### Paleta (tema claro)

| Rol | Hex | Uso |
|---|---|---|
| `surface` | `#FFFFFF` | Fondo de la lámina |
| `surface2` | `#F2F4F8` | Fondo de tarjetas, margen izquierdo |
| `surface3` | `#E7EAF0` | Cabecera de tablas |
| `ink` | `#13171E` | Títulos y texto fuerte |
| `ink2` | `#39424F` | Cuerpo de texto |
| `muted` | `#5C6573` | Pies, etiquetas, texto secundario |
| `line` | `#D2D7DF` | Separadores y bordes |
| `accent` | `#A8761C` | Acento (dorado): numeración, viñetas, marcas |
| `ok` | `#0F7A4A` | Verde: `init`, `create`, lo que sí pasa |
| `info` | `#2F6BA8` | Azul: `upgrade`, `update`, informativo |
| `hold` | `#B23A26` | Rojo: `conflict`, bloqueos, "para y pregunta" |
| terminal | fondo `#14181F`, texto `#DCE2EA` | Bloques de consola |

**Tema oscuro** (opcional): `surface #171B22` · `ink #E2E6EC` · `ink2 #B4BCC7` ·
`accent #D9A441` · `ok #3EA372` · `info #5A9AD6` · `hold #DB6A50`.

> **Decisión pendiente si te importa la marca.** Esta paleta es la del deck actual y usa
> un **acento dorado**. La identidad Soutec de las infografías usa **cian** (`#00A5BC`) y
> azul (`#00688F`). Los dos sistemas conviven hoy en el repo. Si quieres un deck alineado
> con las infografías, sustituye `accent` por el cian y ajusta `ok`/`info`/`hold` a la
> paleta de `docs/infografias/` (ver el brief de infografías).

### Tipografía

- **Títulos**: Georgia (serif), ~50 px sobre 1080 de alto. En la portada, ~82 px.
- **Cuerpo**: Segoe UI (sans), 16–21 px.
- **Datos, comandos y terminal**: Roboto Mono, 13–17 px.

### Anatomía de una lámina (no la portada)

- **Margen izquierdo** de ~88 px con el nombre del acto en vertical y su número romano.
- **Cabecera**: etiqueta del acto en mayúsculas + contador `NN / 13` a la derecha, sobre
  una línea fina.
- **Título** en serif, y debajo el cuerpo.
- **Pie** opcional: una línea en `muted` separada por una regla, con el matiz que no cabe
  en el cuerpo.

**Regla dura**: todo tiene que entrar en 1080 px de alto. Nada de scroll ni de texto
cortado.

---

## 3 · Los 7 actos

| # | Acto | Láminas |
|---|---|---|
| I | Qué es | 1–2 |
| II | Instalar | 3–4 |
| III | La regla | 5–6 |
| IV | El día | 7–9 |
| V | Tu código | 10 |
| VI | Visibilidad | 11–12 |
| VII | Empezar | 13 |

---

## 4 · Contenido lámina por lámina

### Lámina 1 · Portada

- **Eyebrow**: SOUTEC · Metodología de trabajo
- **Título**: El harness, de punta a punta
- **Bajada**: Cómo se instala en cualquier repo, cómo se declara el milestone antes de
  tocar código, y cómo el tablero compartido y el monitor de tokens vuelven visible el
  trabajo de todo el equipo.
- **Terminal**:
  ```
  # en cualquier repo, nuevo o legacy
  $ npx github:ialvarezsoutec/souclaude-harness#v3
  ```
- **Pie de datos**: souclaude-harness v3.5.0 · Node ≥ 22.4 + git · sin registry, sin token

---

### Lámina 2 · Tres capas que conviene no confundir

**Acto**: Qué es · **Formato**: tres tarjetas en fila.

| Etiqueta | Título | Contenido | Dónde vive |
|---|---|---|---|
| En tu repo | **El harness** | Las reglas y las skills que Claude aplica solo cuando el contexto lo amerita. Se commitean con el repo: quien clona, las tiene. | `CLAUDE.md`, `.claude/skills/` |
| Repo aparte | **El Vault** | El centro de información de *todos* los proyectos: milestones, planes, kanban y sesiones. Fuera del repo a propósito, para acumular visibilidad sin ensuciarlo. | `Project-<PREFIJO>/` |
| Para la organización | **Jira** | El espejo del Vault hacia afuera. Milestone = épica, tarea = issue hijo. Se sincroniza al mover la tarjeta, no al final del día. | conector MCP de Atlassian |

**Pie**: El Vault manda, Jira refleja. Si el conector no está autorizado, *se avisa y el
trabajo local sigue* — Jira nunca bloquea.

---

### Lámina 3 · Un comando. Siete verbos.

**Acto**: Instalar · **Formato**: dos columnas — tabla a la izquierda, terminal a la derecha.

**Tabla** (columnas: Comando / Qué hace):

| Comando | Color | Qué hace |
|---|---|---|
| `init` | ok | Instala. Sirve igual en un repo vacío y en uno con cinco años de código. |
| `upgrade` | info | Actualiza a la última versión y aplica las migraciones. |
| `status` | muted | Solo lectura. Salida 0 al día · 1 hay upgrade · 2 hay drift. |
| `adopt` | hold | Para una estructura hecha a mano. **No toca ningún archivo**: solo escribe el lockfile. |
| `monitor` | muted | Panel de consumo de tokens: límites, sesiones y proyectos. |
| `vault-sync` | info | Sincroniza con el Vault. Jamás `--force`. |

**Nota bajo la tabla**: Sin comando, *se autodetecta*: hay lockfile → `upgrade` · hay
estructura previa → `adopt` · repo limpio → `init`.

**Terminal**:
```
# ver el plan sin escribir un solo byte
$ npx …souclaude-harness#v3 --dry-run

create   CLAUDE.md
create   .claude/skills/soutec-github/
create   progress/README.md
noop     .gitignore (bloque ya presente)

→ 0 bytes escritos
```

**Viñetas bajo el terminal**:
- **--dry-run** imprime el plan y no escribe nada. El árbol queda byte-idéntico.
- **--yes** acepta los defaults; `--name --type --stack --lang` responden sin modo interactivo.

> El verbo número siete es `verify`, que audita el propio harness y no se usa desde un
> proyecto consumidor: por eso la tabla muestra seis y el título dice siete.

---

### Lámina 4 · Qué queda instalado

**Acto**: Instalar · **Formato**: árbol de archivos a la izquierda, tabla de skills a la derecha.

**Árbol** (monoespaciado, con anotaciones a la derecha):
```
CLAUDE.md                  las reglas del repo
.claude/
  settings.json            permisos y hooks
  skills/                  las que elegiste
  vault.local.json         no se commitea
  jira.json                proyecto destino
.github/
  pull_request_template.md
  CODEOWNERS
progress/
  README.md                el protocolo
  history.md               append-only
docs/decisions/            los ADR
```

**Tabla de skills** (Skill / Para qué):

| Skill | Color | Para qué |
|---|---|---|
| `soutec-github` | ok | **Obligatoria.** Ramas, commits y PR de SOUTEC. |
| `vault-milestones` | info | Analizar e iterar el tablero de milestones. |
| `jira-sync` | info | Espejar el Vault en Jira al mover la tarjeta. |
| `harness-upgrade` | muted | Actualizar el harness desde Claude. |
| `adr-new` | muted | Documentar decisiones con trade-off. |
| `it-security-review` | muted | Security review para IT. |
| `soutec-md-a-pdf` | muted | Markdown a PDF con identidad Soutec. |

**Nota**: Al instalar eliges con un checkbox. `soutec-github` se instala **siempre**, esté
o no en la lista.

**Pie**: Las skills son *project-local*: se commitean con el repo. No hay instalación por
persona ni por máquina.

---

### Lámina 5 · Nada de código sin milestone declarado

**Acto**: La regla · **Formato**: bajada arriba, luego terminal a la izquierda y viñetas a la derecha.

**Bajada**: Todo trabajo pertenece a un milestone del Vault. Antes de tocar código, el
agente **declara sobre cuál va a trabajar**. Si el pedido no corresponde a ninguno, se da
de alta uno en el Backlog *antes* de empezar.

**Terminal**:
```
# al arrancar la sesión, el hook recuerda el tablero

[harness] Trazabilidad obligatoria.

En curso (1):
  SHS-M5 · conexión con el Vault  @ignacio

Backlog: 6 milestone(s) pendiente(s).
```

**Viñetas**:
- Trabajo sin milestone declarado es *una violación del protocolo*, no una omisión menor.
- El milestone es la **unidad de anti-solapamiento** entre máquinas: si ya está En curso
  con otro dueño, paras y preguntas.
- El hook `SessionStart` lo recuerda solo — no depende de que alguien se acuerde.

**Pie**: La skill `vault-milestones` da de alta el milestone que falta, con el estándar
del tablero.

---

### Lámina 6 · Tres niveles: milestone, plan, tarea

**Acto**: La regla · **Formato**: cadena de cuatro eslabones arriba, lista clave-valor abajo.

**Cadena** (con flechas entre eslabones):

`Nivel alto: SHS-M5` → `Cómo llegar: SHS-M5-P1` → `El día: SHS-M5-T002` → `El trabajo: rama + PR`

**Clave-valor**:

| Archivo | Qué es |
|---|---|
| `milestones.md` | El tablero de milestones: qué se persigue. La tarjeta lleva dueño, máquina y el plan activo. |
| `plans/` | Un archivo por plan: qué se va a hacer, en qué orden y con qué criterio de éxito. Un milestone puede cambiar de plan — el viejo **no se borra**. |
| `kanban.md` | Las tareas del milestone en curso, en cuatro columnas: Backlog, En curso, En review, Hecho. |
| `sessions.md` | Append-only: una línea por sesión con quién, qué tocó y cuántos tokens costó. |

**Pie**: El milestone es la unidad de anti-solapamiento entre máquinas; la tarea es la
unidad de trabajo del día.

---

### Lámina 7 · El ciclo completo, sin saltos

**Acto**: El día · **Formato**: lista numerada de 7 pasos, a ancho completo.

1. `git -C "<vault>" pull --rebase` — el tablero primero, siempre. O `npx souclaude vault-sync`.
2. Lees `milestones.md`. Si el milestone está En curso con *otro dueño u otra máquina*: **paras y preguntas**.
3. Tomas la tarea, mueves la tarjeta a En curso y **pusheas en ese momento** — no en un push final.
4. Jira se sincroniza inmediatamente después. Vault primero, Jira detrás.
5. Rama desde `dev`: `feature/SHS-M5-T002-sembrar-carpeta`. El ID de la tarea va como prefijo del slug.
6. PR a `dev` con la plantilla completa de verdad. **Nunca** commit directo a `main`.
7. Al cerrar: tarjeta a Hecho, push inmediato, y tu línea en `sessions.md` con los tokens.

**Pie**: Cada movimiento se pushea al momento: el tablero refleja *el ahora*, no el último merge.

---

### Lámina 8 · Dos repos con reglas opuestas, a propósito

**Acto**: El día · **Formato**: tabla comparativa de tres columnas.

| | Repo del proyecto | Repo del Vault |
|---|---|---|
| **Qué va** | Código, tests, progreso | Milestones, planes, kanban, sesiones |
| **Cómo se escribe** | Rama + PR *(info)*. Nunca directo a `main` | Push directo a `main` *(ok)*, sin PR |
| **Por qué** | Todo cambio se revisa | El tablero refleja el ahora |
| **Ramas** | `tipo/<ID>-<slug>` desde `dev` | No hay: se escribe en `main` |
| **Release** | `dev` → `main` por PR, y recién ahí los tags | No aplica |

**Nota al pie del cuerpo**: Nunca se cruzan: código, diffs y tests jamás van al Vault; los
artefactos del Vault jamás se commitean en el proyecto. Y en ninguno de los dos: *nunca
`git push --force`*.

---

### Lámina 9 · Nadie pisa el trabajo de nadie

**Acto**: El día · **Formato**: tablero kanban de 4 columnas + viñetas debajo.

| Backlog | En curso | En review | Hecho |
|---|---|---|---|
| `REA-M3-T004` validar formulario · @pendiente | `REA-M3-T003` capturar lead al cierre · @sofia · PC04 *(destacada en rojo/hold)* | `REA-M3-T002` persistencia del ticket · @nacho · PR #18 *(acento)* | `REA-M3-T001` esqueleto del dominio · @nacho *(tachada, verde)* |
| `REA-M3-T005` reintento de envío · @pendiente | | | |

**Viñetas**:
- La tarjeta de *@sofia* está En curso en otra máquina: **no la tomas, no la mueves, no
  saltas a otra por tu cuenta**. Paras y preguntas.
- Una tarjeta = una línea. Al resolver un conflicto en los tableros, se conservan ambas y
  se ordena.

---

### Lámina 10 · Un archivo tuyo nunca se sobrescribe en silencio

**Acto**: Tu código · **Formato**: terminal + viñetas a la izquierda, tabla de veredictos a la derecha.

**Terminal**:
```
$ npx …souclaude-harness#v3 upgrade

update   .claude/settings.json
keep     CLAUDE.md  (lo editaste tú)
new      CLAUDE.md.new

→ tu version intacta
```

**Viñetas**:
- Si tocaste un archivo gestionado, el harness **no lo pisa**: deja la versión nueva al
  lado como `.new`.
- Comparas, te quedas con lo que sirve y borras el `.new`. La decisión es tuya.
- Antes de sobrescribir cualquier cosa hay copia en `.claude/backup-<ts>/`.

**Tabla de veredictos**:

| Situación | Veredicto | Color | Qué pasa |
|---|---|---|---|
| No está en disco | `create` | ok | Se crea. |
| Está, intacto, cambió el template | `update` | info | Se actualiza. |
| Está, intacto, sin cambios | `noop` | muted | Nada. |
| **Lo editaste tú**, sin cambios | `local-edit` | muted | Se respeta. |
| **Lo editaste tú**, cambió | `conflict` | hold | **Nunca se pisa** → `.new`. |
| Existía y lo borraste | `restore` | ok | Se reescribe. |
| Ya no está en el manifest | `obsolete` | hold | Solo con `--prune`. |

**Pie**: `--prune` exige tipear BORRAR y `--force` exige tipear FORCE. La herramienta
obedece las mismas reglas que instala.

---

### Lámina 11 · El tablero, espejado en Jira

**Acto**: Visibilidad · **Formato**: cadena arriba, clave-valor y viñetas en dos columnas.

**Cadena**: `Mueves: la tarjeta` → `Commit: al Vault` → `Push: a main` → `Y recién: Jira`

**Clave-valor**:

| | |
|---|---|
| **Milestone** | Una **épica**, con su descripción y la etiqueta `<PREFIJO>-M<n>`. |
| **Tarea** | Un **issue hijo** de esa épica. El ID en el summary es la clave de idempotencia: nunca se duplica. |
| **Columna** | Backlog → To Do · En curso → In Progress · En review → In Review · Hecho → Done. |

**Viñetas**:
- Se sincroniza **en el momento** en que mueves la tarjeta, no al final del día.
- **Jira nunca es la fuente.** Si alguien mueve un issue allá, se reporta la divergencia —
  no se toca el Vault para igualar.
- Sin conector autorizado: se avisa una vez y el trabajo local sigue.
- No se borran issues: una tarea eliminada se comenta y se cierra.

**Pie**: Cada proyecto del Vault tiene su propio proyecto en Jira, y la clave es el mismo
PREFIJO: `Project-SHS` → `SHS`.

---

### Lámina 12 · El equipo ve dónde se va el esfuerzo

**Acto**: Visibilidad · **Formato**: cuatro tarjetas de métrica en fila + viñetas.

| Métrica | Valor | Subtítulo |
|---|---|---|
| Ventana 5h | **38%** | del límite de la cuenta |
| Ventana 7d | **61%** | consumo propio del período |
| Sesiones | **3** | activas ahora en el equipo |
| Proyectos | **4** | publicando en el Vault |

**Viñetas**:
- `npx souclaude monitor` abre el panel en vivo; `--usage` da el informe completo con
  filtros por proyecto, contribuyente y cuenta.
- Con el panel abierto, **cada sesión publica sola su línea** en `sessions.md` y la
  actualiza mientras sigue viva.
- Una línea que editaste a mano *nunca se pisa*: el monitor solo actualiza la que escribió
  él, byte a byte.

**Pie**: Las cifras de arriba son de ejemplo, para mostrar la forma del panel. Los datos
reales salen del registro del Vault.

> **Importante**: estas cifras son inventadas para ilustrar el formato. No las presentes
> como telemetría real de ningún proyecto.

---

### Lámina 13 · Empezar hoy

**Acto**: Empezar · **Formato**: terminal + pasos a la izquierda, referencias a la derecha.

**Terminal**:
```
# repo nuevo o con años de código
$ npx github:…souclaude-harness#v3

# ya lo tenías instalado
$ npx …#v3 upgrade --dry-run
$ npx …#v3 upgrade --prune
```

**Pasos numerados**:
1. Instala y elige tus skills. `soutec-github` viene siempre.
2. Conecta el Vault: se clona y se declara tu `Project-<PREFIJO>`.
3. Antes de la primera línea de código: **declara tu milestone**.

**Referencias (clave-valor)**:

| Dónde | Qué encuentras |
|---|---|
| `progress/README.md` | El protocolo completo: los dos repos, el anti-solapamiento y el formato de los tableros. |
| `CLAUDE.md` | Las reglas duras del repo: ramas, commits, PR y qué no se hace nunca. |
| `docs/infografias/` | Una master de la metodología y una por caso de adopción, listas para imprimir. |
| `docs/decisions/` | Los ADR: por qué las cosas son como son. |

**Nota**: Si algo es ambiguo o parece mal: *para y pregunta*. No adivines.

**Pie**: Los proyectos instalados antes de la v3 apuntan a `#v1`: editas la ref a `#v3` y
corres `upgrade --prune`. El tag móvil `v2` nunca existió.

---

## 5 · Qué NO debe aparecer

El deck anterior describía una metodología que la versión 3.0.0 **eliminó**. Si generas
contenido, no incluyas nada de esto:

- Agentes con roles (`orchestrator`, `spec-author`, `implementer`, `reviewer`)
- `AGENTS.md`, `docs/constitution.md`, la carpeta `specs/`
- El flujo SDD / CCEM y los "checkpoints humanos" entre spec, plan y tasks
- El *model-router* y `progress/model-router.jsonl`
- Comandos `/rock-close`, `/spec-new`, `/constitution-check`
- El comando `mode` (auto/manual): no existe sin agentes

---

## 6 · Datos verificables (no los cambies)

- Versión actual: **3.5.0**. Tags publicados: `v1`, `v1.0.0`, `v1.1.0`, `v2.4.0`,
  `v3.5.0`, `v3`.
- Requisitos: **Node ≥ 22.4** y git. No hay registry ni token: se instala desde un tag de
  GitHub.
- El tag móvil **`v2` nunca se creó**: los proyectos instalados antes de la v3 apuntan a
  `#v1`, y esa es la migración real (`#v1` → `#v3`).
- Skills del catálogo: las 8 de la lámina 4, con `soutec-github` obligatoria.
- El Vault es `soubunker-vault`, un repo aparte con push directo a `main`.

---

## 7 · Formato de salida sugerido

Pídele a Claude **una página HTML autocontenida** (CSS inline, sin dependencias externas)
con una lámina por sección, navegación por teclado (`←` `→`) y adaptación al tema del
sistema. Es el formato del deck actual y el que mejor se proyecta sin instalar nada.

Alternativas válidas según para qué lo quieras:

- **Un SVG por lámina** de 1920×1080, si vas a importarlas a Figma para terminar el diseño.
- **Markdown con separadores** (`---`), si vas a pasarlo por Marp o reveal.js.
- **Un documento con identidad Soutec** (portada, franjas azules, contraportada), si en vez
  de proyectar quieres circularlo como PDF: para eso usa la skill `soutec-md-a-pdf`, que ya
  produce ese formato.

---

**Fuentes de verdad de este contenido**: `progress/README.md` (el protocolo),
`CLAUDE.md` (las reglas), `templates/harness.manifest.json` (el catálogo de skills),
`CHANGELOG.md` (versiones) y `MAINTAINERS.md` (release y tags).
Si esos documentos cambian, este brief se actualiza con ellos.
