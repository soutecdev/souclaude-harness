# Prompt de instalación del harness

Para adoptar el harness en un repo (nuevo o con historia), pega el prompt de abajo
en Claude Code **abierto en ese repo**. Antes, dos cosas:

1. **Decisiones previas de personas** (no del agente): el prefijo del proyecto
   (2-4 letras, nombra `Project-<PREFIJO>/` en el Vault y la clave en el espejo del
   tablero), la visibilidad del repo y el proyecto destino del espejo. El detalle
   está en la Fase 0 del [playbook de bootstrap](../bootstrap-proyecto-plantillas-prompts.md).
2. **El repo y el Vault viven fuera de OneDrive**, y la máquina cumple los
   requisitos (ver abajo).

## Valores vigentes (generados — no los edites a mano)

<!-- souclaude:gen version -->
Documenta el **harness souclaude v3.16.2**. El sello lo regenera `node scripts/gen-docs-metodologia.mjs` y siempre coincide con la versión de `package.json`.
<!-- /souclaude:gen version -->

Requisitos de máquina:

<!-- souclaude:gen requisitos -->
- **Node.js ≥ 22.4** y **git** — corren el CLI del harness y el flujo de ramas.
- **GitHub CLI (`gh`) autenticado** (`gh auth status`) — con él el agente opera GitHub por ti, sobre todo abrir los Pull Requests.
- **Acceso de escritura al repo del Vault** de SOUTEC.
<!-- /souclaude:gen requisitos -->

Comando de instalación:

<!-- souclaude:gen instalacion -->
```bash
npx github:soutecdev/souclaude-harness#v3
```

Opcional, una vez por máquina, el CLI global (habilita `souclaude status`, `souclaude monitor` y `souclaude vault-sync` desde cualquier repo):

```bash
npm install -g github:soutecdev/souclaude-harness#v3
```
<!-- /souclaude:gen instalacion -->

Skills disponibles al instalar:

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

## El prompt

Sustituye `{{PREFIJO}}` y `{{RUTA_VAULT}}` antes de pegar:

```text
Instala el harness de Claude Code de SOUTEC en este repo.

1. Corre el comando de instalación del harness (npx, tag mayor vigente) en modo
   equipo. En el checkbox de skills deja las obligatorias y elige las que
   correspondan a este proyecto; si dudas, pregúntame antes de confirmar.
2. Cuando pida el Vault: el clon local está en {{RUTA_VAULT}} y el proyecto es
   {{PREFIJO}} (si la carpeta Project-{{PREFIJO}} no existe, que el instalador la
   siembre).
3. Acepta instalar el CLI global souclaude.
4. Al terminar: verifica la instalación (souclaude status), lee el CLAUDE.md
   instalado y progress/README.md, y dime en dos líneas qué quedó instalado y
   cuál es el primer paso del protocolo que me toca a mí.

No toques código del proyecto: solo la superficie del harness.
```

## Después de instalar

- **Integrante nuevo o máquina nueva**: no se reinstala nada — sigue las
  casuísticas 3 y 4 del [playbook](../bootstrap-proyecto-plantillas-prompts.md).
- **Actualizar el harness** más adelante: dile al agente "actualiza el harness"
  (skill `harness-upgrade`).
- **El primer milestone**: antes de cualquier código, el agente te pedirá declarar
  (o dar de alta) el milestone del Vault — es la regla central de la metodología.
