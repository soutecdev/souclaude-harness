# CLAUDE.md — souclaude-harness

## Contexto

Proyecto de automation. Stack: Node.js.
Dominio: el generador del harness de Claude Code de SOUTEC — un CLI (`npx souclaude`)
que instala y migra la superficie Claude (skills, settings, docs) en los repos de la
organización.

## Harness

Harness `3.0.0`. Sin agentes ni flujos fijos: el modelo trabaja directo. Las skills
viven en `.claude/skills/` y se aplican solas cuando el contexto lo amerita (en un
proyecto consumidor se eligen al instalar con `npx souclaude`; `soutec-github` es
obligatoria y siempre está):

- `soutec-github` — flujo Git/GitHub obligatorio de SOUTEC.
- `it-security-review` — security review para IT.
- `security-report-standard` — estándar de informes de seguridad.
- `soutec-md-a-pdf` — Markdown a PDF con identidad Soutec.
- `adr-new` — documentar decisiones con ADRs.
- `harness-upgrade` — actualizar el harness.
- `vault-milestones` — análisis e iteración de milestones en el Vault.
- `jira-sync` — espejo del tablero del Vault en Jira vía MCP de Atlassian.

## Git — reglas duras

**Estas reglas son sobre ESTE repo.** El Vault es un repo distinto y tiene su propio
protocolo — ver "Los dos repos" más abajo.

**Nunca** hagas commit, push ni merge directo a `main`. Todo pasa por rama + PR. Los
hotfixes también. **`main` solo recibe merges desde `dev`**: las ramas de trabajo
nacen de `dev` y su PR apunta a `dev`; el paso `dev` → `main` es el release, también
por PR.

- Ramas: `tipo/<slug>` (`feature/captura-lead`). Tipos: `feature` `fix` `hotfix`
  `docs` `chore` `refactor` `experiment`. Si hay un ID rastreable — tarea o
  milestone del Vault (`feature/SHS-M7-T006-playbook-adopcion`) o tarea de un
  tracker externo — va como prefijo del slug, pero **no inventes IDs**.
- Commits: `tipo: descripción breve` (español, sin scope). Tipos: `feat` `fix` `docs`
  `chore` `refactor` `test` `style` `build` `ci` `perf` `revert`. Un hotfix se commitea
  como `fix:`. Prohibidos: `update`, `cosas`, `ahora sí`.
- Sincronizar la rama: `git fetch origin && git merge origin/dev`. **Nunca
  `git push --force`.**
- **Yo no mergeo PRs, no los apruebo y no creo repositorios.** Eso es del coordinador.
  Los **tags de versión** (`vX.Y.Z` + tag móvil por major) sí puedo crearlos, solo al
  publicar y después del merge de release `dev` → `main`.
- **El PR se abre solo cuando el usuario lo pide explícitamente** o dice que quiere
  mergear. Trabajo terminado sin ese pedido: push a la rama y reportar, sin PR.
- **Si el pedido de PR incluye correr antes el security review, terminado el review
  no te detengas**: seguí directo con push/PR si no hay hallazgos que bloqueen. El
  security review es un paso intermedio del mismo pedido, no un punto de checkpoint —
  el usuario ya autorizó el PR al pedirlo. Si el review sí encuentra algo bloqueante,
  ahí parás y reportás.
- Al abrir el PR: completar `.github/pull_request_template.md` de verdad. Si piden
  correcciones, push a la **misma** rama — nunca un PR nuevo.

## Los dos repos

Trabajas contra **dos repos a la vez**, con reglas opuestas a propósito:

| | Este repo (proyecto) | El Vault |
|---|---|---|
| Qué va | Código, tests, progreso | Milestones, planes, kanban, sesiones |
| Cómo se escribe | Rama + PR. **Nunca** directo a `main` | **Push directo a `main`**, sin PR |
| Por qué | Todo cambio se revisa | El tablero refleja el ahora, no el último merge |

**Trazabilidad obligatoria**: todo trabajo pertenece a un **milestone del Vault**.
Antes de tocar código, declara al usuario sobre qué milestone vas a trabajar; si el
pedido no corresponde a ningún milestone existente, da de alta uno en el Backlog
(skill `vault-milestones`) **antes** de empezar. Trabajo sin milestone declarado es
una violación del protocolo, no una omisión menor.

**Espejo en Jira** (skill `jira-sync`): cada movimiento de tarjeta en el Vault se
refleja en Jira **en el mismo momento** — Vault primero, Jira inmediatamente
después. Si el conector no está autorizado, se reporta y el trabajo local sigue.

La ruta local del Vault está en `.claude/vault.local.json` (la escribe `npx souclaude`).
Antes de empezar a trabajar: `git -C "<vault>" pull --rebase` y lee
`Project-<PREFIJO>/milestones.md` y `kanban.md`. Si el milestone o la tarea ya está
**En curso** con otro dueño u otra máquina: **para y pregunta**. Al tomar o cerrar
algo, mueve la tarjeta y pushea **en ese momento**; al cerrar la sesión, agrega tu
línea (con tokens) a `sessions.md`. Protocolo completo en `progress/README.md`.
**Nunca `git push --force`, en ninguno de los dos.**

## Language

Responder siempre en **español neutro** (estándar panhispánico), **no** en español
rioplatense/argentino. Es el estándar de la organización — aplica a toda respuesta,
no solo al código.

- **Conjugación: tuteo (tú)**, nunca voseo (vos) ni tratamiento formal (usted). Los
  imperativos van en tuteo: `usa` (no "usá"), `ten` (no "tené"), `dilo` (no "decilo"),
  `fíjate` (no "fijate"), `empieza` (no "empezá"), `haz` (no "hacé").
- **Evita localismos rioplatenses** en la prosa ("che", "bárbaro", "recién ahí",
  "acordate", "de una"). Prefiere vocabulario entendible en toda Hispanoamérica.

**El dominio se nombra en el lenguaje del negocio (español)**; adaptadores,
infraestructura y todo lo que toca frameworks, en inglés.

## Reglas técnicas críticas

### Generador (este repo)
- El manifest (`templates/harness.manifest.json`) es la fuente de verdad de lo que se
  instala. Todo archivo nuevo en `templates/base/` necesita su entry — `npx souclaude
  verify` y el test de dogfood lo vigilan.
- Los archivos de skills con assets binarios llevan `"binary": true` en el manifest:
  sin eso, la lectura utf8 y la normalización LF corrompen los bytes.
- Escritura de archivos: siempre plana (nada de write-temp-then-rename): OneDrive y
  antivirus rompen el patrón "atómico" con EPERM.
- Tests: `npm test` (Node >= 22.4). Quita `NO_COLOR` del entorno antes de correr los
  tests de monitor-render.

## Economía de tokens

- **`/clear` entre tareas.** El estado vive en git, `progress/` y el Vault — no en la
  conversación.
- **Búsquedas amplias → subagente de solo-lectura (`Explore`).** El volcado queda en
  el subagente; a la sesión vuelve solo la conclusión.
- **Conectores MCP al mínimo.**

## Behavior expectations

- Si algo es ambiguo o parece mal: **para y pregunta.** No adivines ni reinterpretes.
- No modificar archivos fuera del scope pedido.
- No instalar dependencias sin confirmar.
- Reportar honestamente si algo falla. **Sin workarounds silenciosos.**
- No modificar un test para que pase. Si el test está mal, dilo y para.
- Cambios chicos y quirúrgicos: lo más simple que resuelva el pedido.

## Memoria

| Qué | Dónde |
|---|---|
| Learning del día, gotcha fresco | `notes.md` |
| Gotcha que costó >1 h | `docs/gotchas/` |
| Pattern que apareció 3+ veces | `docs/patterns/` |
| Decisión con trade-off | `docs/decisions/` (`/adr-new`) |

## Secretos

Jamás commitear `.env`, `*.pem`, `*.key`, `*.pfx`, `credentials.json`, `secrets.json`,
tokens ni contraseñas. `.claude/settings.json` ya deniega su lectura vía
`permissions.deny`.

## Referencias

`docs/decisions/` · `notes.md` · `progress/README.md`
