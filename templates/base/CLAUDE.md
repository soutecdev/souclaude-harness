# CLAUDE.md — {{PROJECT_NAME}}

## Contexto

Proyecto de {{PROJECT_TYPE}}. Stack: {{STACK}}.
Dominio: [describir en 1-2 líneas qué hace este proyecto].

## Harness

Harness `{{HARNESS_VERSION}}`. Sin agentes ni flujos fijos: el modelo trabaja
directo. Las skills viven en `.claude/skills/` y se aplican solas cuando el
contexto lo amerita (se eligen al instalar con `npx souclaude`; `soutec-github`
es obligatoria y siempre está):

- `soutec-github` — flujo Git/GitHub obligatorio de SOUTEC.
- `it-security-review` — security review para IT (si está instalada).
- `security-report-standard` — estándar de informes de seguridad (si está instalada).
- `soutec-md-a-pdf` — Markdown a PDF con identidad Soutec (si está instalada).
- `adr-new` — documentar decisiones con ADRs (si está instalada).
- `harness-upgrade` — actualizar el harness (si está instalada).
- `vault-milestones` — análisis e iteración de milestones en el Vault (si está instalada).
- `jira-sync` — espejo del tablero del Vault en Jira vía MCP (si está instalada).

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

**Espejo en Jira** (si la skill `jira-sync` está instalada): cada movimiento de
tarjeta en el Vault se refleja en Jira **en el mismo momento** — Vault primero,
Jira inmediatamente después. Si el conector no está autorizado, se reporta y el
trabajo local sigue.

La ruta local del Vault está en `.claude/vault.local.json` (la escribe `npx souclaude`).
Antes de empezar a trabajar: `git -C "<vault>" pull --rebase` y lee
`Project-<PREFIJO>/milestones.md` y `kanban.md`. Si el milestone o la tarea ya está
**En curso** con otro dueño u otra máquina: **para y pregunta**. Al tomar o cerrar
algo, mueve la tarjeta y pushea **en ese momento**; al cerrar la sesión, agrega tu
línea (con tokens) a `sessions.md`. Protocolo completo en `progress/README.md`.
**Nunca `git push --force`, en ninguno de los dos.**

## Language

Responder siempre en {{LANGUAGE}}.

Cuando el idioma sea español, usar **español neutro** (estándar panhispánico), **no**
español rioplatense/argentino. Es el estándar de la organización — aplica a toda
respuesta, no solo al código.

- **Conjugación: tuteo (tú)**, nunca voseo (vos) ni tratamiento formal (usted). Los
  imperativos van en tuteo: `usa` (no "usá"), `ten` (no "tené"), `dilo` (no "decilo"),
  `fíjate` (no "fijate"), `empieza` (no "empezá"), `haz` (no "hacé").
- **Evita localismos rioplatenses** en la prosa ("che", "bárbaro", "recién ahí",
  "acordate", "de una"). Prefiere vocabulario entendible en toda Hispanoamérica.

**El dominio se nombra en el lenguaje del negocio (español)**: entidades, value objects
y métodos de puerto (`Ticket`, `ContextoDeNegocio`, `generar_respuesta`).
**Adaptadores, infraestructura y todo lo que toca frameworks: en inglés.**

## Reglas técnicas críticas

Reglas que causan errores si se omiten. Agregar/quitar según el proyecto.

### [Categoría — ej: API, Data, Deployment]
- [Regla concreta 1]
- [Regla concreta 2]

## Behavior expectations

- Si algo es ambiguo o parece mal: **para y pregunta.** No adivines ni reinterpretes.
- No modificar archivos fuera del scope pedido.
- No instalar dependencias sin confirmar.
- Reportar honestamente si algo falla. **Sin workarounds silenciosos.**
- No modificar un test para que pase. Si el test está mal, dilo y para.
- Cambios chicos y quirúrgicos: lo más simple que resuelva el pedido, sin
  refactors de regalo ni archivos fuera de scope.

## Memoria

| Qué | Dónde |
|---|---|
| Learning del día, gotcha fresco | `notes.md` |
| Decisión con trade-off | `docs/decisions/` (`/adr-new`, si está instalada) |

## Secretos

Jamás commitear `.env`, `*.pem`, `*.key`, `*.pfx`, `credentials.json`, `secrets.json`,
tokens ni contraseñas. `.claude/settings.json` ya deniega su lectura vía
`permissions.deny`.

## Referencias

`docs/decisions/` · `notes.md` · `progress/README.md`
