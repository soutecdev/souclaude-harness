# {{PROJECT_NAME}}

[Una línea: qué hace este proyecto.]

**Stack**: {{STACK}}
**Tipo**: {{PROJECT_TYPE}}
**Owner**: {{OWNER}}

## Setup

```bash
# [pasos para levantar el proyecto desde cero]
```

## Estructura

```
src/          código
tests/        tests
scripts/      utilidades de desarrollo
docs/         documentación técnica
  decisions/        ADRs (si la skill adr-new está instalada)
progress/     progreso del proyecto y protocolo del Vault
CLAUDE.md     contexto para Claude Code
notes.md      scratchpad persistente
```

## Trabajar con Claude Code

Este repo tiene el harness de SOUTEC instalado. Las skills viven en
`.claude/skills/`, versionadas junto al código, y se eligen al instalar con
`npx github:soutecdev/souclaude-harness#v3` (`soutec-github` es obligatoria y siempre está). No hay agentes
ni flujos fijos: el modelo trabaja directo, con el flujo Git de SOUTEC como
única regla dura.
