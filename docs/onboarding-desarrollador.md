# Onboarding — metodología SOUTEC con el harness

Guía para el desarrollador que empieza a trabajar con el harness de Claude Code de
SOUTEC. Léela una vez de punta a punta; después, el propio harness te va
recordando las reglas (los agentes las reciben automáticamente en cada sesión).

## 1. Las tres piezas

| Pieza | Qué es | Dónde vive |
|---|---|---|
| **El repo del proyecto** | Código, tests y progreso. Todo cambio pasa por rama + PR | GitHub de SOUTEC |
| **El Vault** | El tablero vivo de TODOS los proyectos: milestones, planes, kanban y sesiones. Push directo a `main`, sin PR | `soubunker-vault` (repo aparte) |
| **Jira** | El espejo del Vault para la organización: cada tarea del kanban es un issue, etiquetado con su milestone | `https://dev-soutec.atlassian.net` |

La dirección del flujo es siempre la misma: **el Vault es la fuente de verdad**;
Jira se deriva del Vault, nunca al revés. Y el repo del proyecto solo lleva código
— los tableros jamás se commitean ahí.

## 2. Instalación (una vez por repo y por máquina)

**Requisitos de máquina** (una sola vez por máquina — el harness distribuye
archivos dentro del repo, pero no puede instalar software en tu equipo ni hacer
logins por ti; estos tres pasos son tuyos):

- **Node.js >= 22.4 y git** — corren el CLI del harness y el flujo de ramas.
- **GitHub CLI (`gh`)**: la herramienta oficial de GitHub para la terminal. `git`
  solo sabe de commits y ramas; `gh` es lo que le permite al agente operar GitHub
  mismo — sobre todo **abrir los Pull Requests por ti**, con la plantilla
  completa. Sin `gh` autenticado, el agente pushea la rama pero el PR queda para
  abrir a mano.

  ```bash
  winget install GitHub.cli   # macOS: brew install gh
  gh auth login               # y responde las preguntas así:
  ```

  El asistente de `gh auth login` pregunta varias cosas — respuesta por respuesta:

  | Pregunta | Respuesta |
  |---|---|
  | `Where do you use GitHub?` | **GitHub.com** (lo otro es para Enterprise autoalojado) |
  | `Preferred protocol for Git operations?` | **HTTPS** |
  | `Authenticate Git with your GitHub credentials?` | **Yes** |
  | `How would you like to authenticate?` | **Login with a web browser** |

  Luego te muestra un **código de un solo uso** (`XXXX-XXXX`): cópialo, presiona
  Enter, y en el navegador (`github.com/login/device`) pega el código, inicia
  sesión con tu cuenta de SOUTEC y dale **Authorize github**. Al volver a la
  terminal verás `✓ Logged in as <tu-usuario>`; confírmalo con `gh auth status`.
  Si la terminal no reconoce `gh` recién instalado, ábrela de nuevo (PATH).

  El login es una sola vez por máquina; el token queda guardado en tu perfil.
  Aprobar y mergear PRs sigue siendo del coordinador: `gh` no cambia quién
  decide, solo quién tipea.
- (Próximamente, milestone SHS-M10: `npx souclaude init/upgrade` verificará estos
  requisitos y avisará con el paso exacto si falta alguno.)

```bash
npx souclaude init        # en un repo nuevo (o `upgrade` en uno ya instalado)
```

- El instalador pregunta qué **skills** instalar (`soutec-github` es obligatoria;
  para esta metodología necesitas también `vault-milestones` y `jira-sync`).
- Conecta el **Vault**: si no está clonado en tu máquina, el CLI ofrece clonarlo.
  La ruta queda en `.claude/vault.local.json` (local, gitignorado). **Añade a mano
  el campo `"project"`** (`"project": "Project-<PREFIJO>"`): el CLI todavía no lo
  escribe, y sin él el hook de sesión no encuentra el tablero cuando el Vault
  tiene más de un proyecto — y no avisa.
- **Conector Jira** (una vez por máquina): abre Claude Code en el repo, corre
  `/mcp`, aprueba el servidor `atlassian` (lo trae el `.mcp.json` del harness) y
  completa el OAuth en el navegador. El token queda guardado entre sesiones.
- El proyecto Jira destino está en `.claude/jira.json` (commiteado). Convención:
  **un proyecto del Vault = un proyecto Jira**, con la clave igual al prefijo
  (`Project-SHS` → `SHS`).
- **CLI global `souclaude`** (una vez por máquina): al final, `init`/`upgrade`
  ofrecen instalarlo (`npm install -g github:ialvarezsoutec/souclaude-harness#v3`).
  Acéptalo: te deja el **monitor de tokens** a un comando de distancia en
  cualquier terminal —

  ```bash
  souclaude monitor          # panel en vivo: límites, sesiones, proyectos
  souclaude monitor --once   # un snapshot y sale
  souclaude monitor --usage  # consumo de TODO el equipo (córrelo dentro del repo)
  ```

  Funciona desde **cualquier carpeta**: al conectar el Vault, `init`/`upgrade`
  dejan también una config a nivel máquina (`~/.claude/souclaude/vault.json`),
  así el monitor publica tu consumo al Vault y ve las sesiones del resto del
  equipo estés donde estés. Solo la línea de tu sesión en `sessions.md` del
  proyecto requiere correrlo dentro del repo (fuera de un repo no se sabe a qué
  proyecto atribuirla). El global se actualiza aceptando la misma oferta en el
  próximo `souclaude upgrade`.

## 3. La regla central: trazabilidad por milestone

**Todo trabajo pertenece a un milestone del Vault.** Sin excepciones.

- Al arrancar cada sesión, un hook (`.claude/hooks/declarar-milestone.mjs`) le
  muestra al agente el tablero y le exige **declarar sobre qué milestone va a
  trabajar** antes de tocar código.
- Si el pedido no corresponde a ningún milestone existente, se **da de alta uno**
  en el Backlog (skill `vault-milestones`) antes de empezar.
- El milestone es la unidad de anti-solapamiento: si está **En curso con otro
  dueño u otra máquina, no se toca** — se para y se pregunta.

## 4. El ciclo de trabajo diario

1. **Sincroniza el Vault**: `git -C "<vault>" pull --rebase` (o
   `npx souclaude vault-sync`). Lee `Project-<PREFIJO>/milestones.md` y `kanban.md`.
2. **Toma el milestone/tarea**: mueve la tarjeta a En curso (con `@quién · máquina`)
   y **pushea el Vault en ese momento** — no al final. El agente lo hace solo.
3. **Espeja el plan**: todo milestone En curso tiene su plan en `plans/`
   (`<PREFIJO>-M<n>-P<n>-<slug>.md`). Los planes descartados no se borran.
4. **Trabaja en el repo**: rama `tipo/<slug>` **desde `dev`**, commits
   `tipo: descripción` en español. Nunca directo a `main` ni a `dev`;
   nunca `git push --force`.
5. **Cada movimiento de tarjeta se espeja en Jira al momento** (skill
   `jira-sync`): tomar una tarea la pone In Progress, cerrarla la pone Done,
   siempre con la etiqueta de su milestone. Si el conector no está autorizado, el
   trabajo local sigue y el espejo queda anotado como pendiente.
6. **Antes del PR**: corre `/security-review`, documenta el resultado en la
   plantilla del PR, y abre el PR **contra `dev`** completando la plantilla de
   verdad. El merge lo hace el coordinador (squash & merge) — nunca el autor.
7. **Al cerrar la sesión**: una línea en `sessions.md` del Vault (fecha, rama,
   milestone, quién, máquina, tokens, resultado). El agente la escribe solo.

## 5. Qué hace el agente por ti (y qué no)

Con el harness instalado, el agente hace **automáticamente**: declarar milestone,
mover tarjetas y pushear el Vault al momento, espejar a Jira, correr el security
review antes del PR y registrar la sesión. Las reglas viven en `CLAUDE.md`,
`progress/README.md` y las skills — no dependen de tu memoria.

Lo que el agente **no hace nunca** (es tuyo o del coordinador):

- Mergear o aprobar PRs (coordinador), crear repos (coordinador).
- El OAuth del conector Jira (tú, una vez por máquina).
- Decidir el alcance de un milestone nuevo: el agente lo propone, **tú lo apruebas**.

## 6. Referencias

- Protocolo completo del Vault: `progress/README.md` (en cualquier repo con el harness).
- Flujo Git/GitHub: skill `soutec-github` (`.claude/skills/soutec-github/SKILL.md`).
- Espejo Jira: skill `jira-sync` (`.claude/skills/jira-sync/SKILL.md`).
- Tableros: skill `vault-milestones` (`.claude/skills/vault-milestones/SKILL.md`).
