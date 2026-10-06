# La metodología SOUTEC con el harness — guía

Escrita para el desarrollador (o el responsable técnico) que adopta el harness en un
repo de SOUTEC. En una lectura sabes qué instala, cómo se trabaja y dónde está el
detalle de cada cosa.

<!-- souclaude:gen version -->
Documenta el **harness souclaude v3.16.2**. El sello lo regenera `node scripts/gen-docs-metodologia.mjs` y siempre coincide con la versión de `package.json`.
<!-- /souclaude:gen version -->

## La idea en una frase

**El modelo trabaja directo, sin ceremonia; Git/GitHub registra el hecho, el Vault
registra el estado, y las skills del harness cuidan que todo quede trazable.**

## Las tres piezas

| Pieza | Qué es | Regla de escritura |
|---|---|---|
| **El repo del proyecto** | Código, tests y progreso | Todo por rama + PR contra `dev`. Nunca directo a `main` |
| **El Vault** | El tablero vivo de todos los proyectos: milestones, planes, kanban y sesiones (repo aparte, `soubunker-vault`) | Push directo a `main`, sin PR: el tablero refleja el ahora |
| **El espejo del tablero** | La vista para la organización (Jira o Azure Boards, según la skill de sincronización instalada) | Se deriva del Vault, nunca al revés; jamás bloquea el trabajo |

La regla central que lo ata todo: **ningún trabajo sin milestone del Vault**. El
agente declara sobre qué milestone trabaja antes de tocar código (un hook de sesión
se lo recuerda al arrancar), y cada movimiento de tarjeta se pushea en el momento.

## Requisitos de máquina

<!-- souclaude:gen requisitos -->
- **Node.js ≥ 22.4** y **git** — corren el CLI del harness y el flujo de ramas.
- **GitHub CLI (`gh`) autenticado** (`gh auth status`) — con él el agente opera GitHub por ti, sobre todo abrir los Pull Requests.
- **Acceso de escritura al repo del Vault** de SOUTEC.
<!-- /souclaude:gen requisitos -->

## Instalación

<!-- souclaude:gen instalacion -->
```bash
npx github:soutecdev/souclaude-harness#v3
```

Opcional, una vez por máquina, el CLI global (habilita `souclaude status`, `souclaude monitor` y `souclaude vault-sync` desde cualquier repo):

```bash
npm install -g github:soutecdev/souclaude-harness#v3
```
<!-- /souclaude:gen instalacion -->

El instalador corre igual en un repo vacío y en uno con años de código: solo agrega
la superficie Claude, no toca tu código. Qué hace, en orden:

1. **Pregunta el modo de trabajo**: `equipo` (el flujo completo de esta guía) o
   `solo` (reglas relajadas para una sola persona: sin kanban ni espejo, con
   `worklog.md` como traza). Los flags `--equipo`/`--solo` lo fijan sin preguntar.
2. **Deja elegir las skills** con un checkbox (las obligatorias entran siempre).
3. **Instala la superficie**: `CLAUDE.md`, `.claude/` (settings, skills, hooks),
   la plantilla de PR, los scripts de checks y `progress/`.
4. **Conecta el Vault**: pide la ruta del clon local, escribe
   `.claude/vault.local.json` y siembra `Project-<PREFIJO>/` si no existe
   (milestones, kanban, sesiones y la ficha del Observatorio).
5. **Ofrece instalar el CLI global** `souclaude`, para el monitor y el
   `vault-sync` desde cualquier terminal.

Para actualizar más adelante no se repite nada de esto: se le pide al agente
("actualiza el harness") y la skill `harness-upgrade` corre el flujo completo.

## Las skills que puede instalar

<!-- souclaude:gen skills -->
| Skill | Modo | Qué hace |
|---|---|---|
| `soutec-github` | equipo · obligatoria | flujo Git/GitHub de SOUTEC |
| `soutec-github-solo` | solo · obligatoria | flujo Git fluido del modo solo |
| `it-security-review` | equipo y solo | workflow de security review para IT |
| `security-report-standard` | equipo y solo | estándar de informes de seguridad |
| `soutec-md-a-pdf` | equipo y solo | Markdown a PDF con identidad Soutec |
| `adr-new` | equipo y solo | documentar decisiones con ADRs |
| `harness-upgrade` | equipo y solo | actualizar el harness desde Claude |
| `vault-milestones` | equipo | análisis e iteración de milestones en el Vault |
| `jira-sync` | equipo | espejo del tablero del Vault en Jira vía MCP de Atlassian |
| `azdo-sync` | equipo | espejo del tablero del Vault en Azure DevOps Boards vía MCP |
<!-- /souclaude:gen skills -->

Las skills se aplican solas cuando el contexto lo amerita; no hay agentes ni flujos
fijos que operar.

## Cómo se trabaja, de punta a punta

```
milestone → plan → tarea → rama → PR → Vault → espejo del tablero
```

1. **Sincroniza el Vault** (`souclaude vault-sync`) y lee `milestones.md` y
   `kanban.md` del proyecto.
2. **Toma el milestone** (o da de alta uno en el Backlog si el pedido no corresponde
   a ninguno) y mueve la tarjeta a En curso **pusheando en ese momento**. Si está En
   curso con otro dueño u otra máquina: se para y se pregunta.
3. **Una rama por milestone**, nacida de `dev`: `tipo/M<n>-slug`
   (ej. `feature/M7-playbook-adopcion`). Las tareas del kanban son commits en esa
   rama — una tarea pasa a Hecho al pushear su commit, sin esperar el merge.
4. **Commits** `tipo: descripción breve`, en español.
5. **El PR apunta a `dev`** con la plantilla completada de verdad; el security
   review corre antes. Mergea el coordinador. `dev` → `main` es el release, también
   por PR, y el tag `vX.Y.Z` se crea después del merge.
6. **Cada movimiento del Vault se espeja** en el tablero externo en el mismo
   momento (skill de sincronización instalada). Si el conector no está autorizado,
   se reporta y el trabajo local sigue.
7. **Al cerrar la sesión**, una línea en `sessions.md` con quién, máquina, tokens y
   resultado — el monitor (`souclaude monitor`) la escribe solo si está corriendo.

## Dónde está el detalle

- [Onboarding del desarrollador](../onboarding-desarrollador.md) — la metodología
  completa paso a paso, incluido el alta de `gh`.
- [Guía del desarrollador](../GUIA-DESARROLLADOR.md) — el flujo Git diario y las
  reglas de oro.
- [Playbook de bootstrap](../bootstrap-proyecto-plantillas-prompts.md) — prompts por
  fase para cada casuística (proyecto nuevo, repo existente, integrante nuevo,
  máquina nueva).
- [Infografías](../infografias/) — una por casuística de adopción, imprimibles.
- [El protocolo del progreso](../../progress/README.md) — los tres niveles del Vault
  y el protocolo anti-solapamiento, al detalle.
