---
title: Revisión de Seguridad — {{PROJECT}}
header: Revisión de Seguridad – IT
subtitle: {{PROJECT}}
date: {{DATE}}
author: Centro de Monitoreo Soutec
confidential: true
url: www.soutec-group.com
---

<!--
Referencia estructural del informe de evidencia. El estilo (portada con
isotipo, banners cyan, índice con folios, contraportada) lo pone la skill `soutec-md-a-pdf`
al renderizar; aquí va Markdown limpio. Reglas de autoría: la guía de esa skill
(`references/guia-autoria-md.md`). Contenido y trazabilidad: `security-report-standard`.

- El título, subtítulo, fecha y sello CONFIDENCIAL salen del front-matter de arriba;
  rellena {{PROJECT}} y {{DATE}} con datos reales. Como hay `title`, TODOS los `#` del
  cuerpo son secciones numeradas (franja cyan). Usa `##`/`###` solo para sub-temas.
- Los títulos de sección (`#`) deben ser CORTOS (≤ ~28 caracteres): el banner cyan tiene
  ancho fijo y un título largo se sale del banner (texto blanco sobre blanco = ilegible).
- Sustituye cada {{PLACEHOLDER}} con evidencia real y verificada. No inventes resultados,
  no rebajes severidades y no elimines hallazgos corregidos del historial.
- Callouts `> [!TIPO]`: Nota/Info = cyan, Conforme/OK = verde, Importante/Advertencia/
  Atención = amarillo, Peligro/Crítico = magenta. 3-4 por informe bastan.
- Las tablas salen con cabecera azul y filas cebra. La skill NO pinta badges de color:
  severidad/estado (Critical, PASSED, REMEDIATED…) se leen como texto, no como pill.
  Mantén ≤ 6-7 columnas y celdas concisas; si una tabla necesita más, parte la info.
- Este comentario no se renderiza. Nunca uses afirmaciones absolutas ("la aplicación es
  segura", "certificada").
-->

> [!CONFORME] Resumen general
> {{EXECUTIVE_CONCLUSION}}

# Estado de la revisión

| Campo | Valor |
|---|---|
| Proyecto | {{PROJECT}} |
| Estado | {{STATUS}} |
| Fecha de la revisión | {{DATE}} |
| Rama | {{BRANCH}} |
| Commit inicial | {{INITIAL_COMMIT}} |
| Commit final | {{FINAL_COMMIT}} |
| Alcance | {{SCOPE}} |
| Aprobación de IT | PENDING |

# Resumen para IT

{{EXECUTIVE_SUMMARY}}

> [!IMPORTANTE]
> Este informe no reemplaza un pentest formal, una auditoría externa ni la validación de
> infraestructura de producción. Es un insumo para que IT tome su propia decisión
> informada sobre el paso a producción.

# Sobre el proyecto

{{PROJECT_IDENTIFICATION}}

# Qué se revisó y metodología

{{ATTACK_SURFACE}}

- **Método de revisión**: comando nativo `/security-review` de Claude Code.
- **Ciclos de remediación SDD ejecutados**: {{REMEDIATION_CYCLES}}.
- **Pruebas obligatorias**: {{TEST_SUMMARY}}.

# Alcance y limitaciones

{{SCOPE_AND_LIMITATIONS}}

# Resultado de la revisión final

{{FINAL_REVIEW}}

# Hallazgos por severidad

| Severidad | Iniciales | Remediados | Abiertos |
|---|---:|---:|---:|
| Critical | {{INITIAL_CRITICAL}} | {{FIXED_CRITICAL}} | 0 |
| High | {{INITIAL_HIGH}} | {{FIXED_HIGH}} | 0 |
| Medium | {{INITIAL_MEDIUM}} | {{FIXED_MEDIUM}} | {{OPEN_MEDIUM}} |
| Low | {{INITIAL_LOW}} | {{FIXED_LOW}} | {{OPEN_LOW}} |
| Informativo | {{INITIAL_INFO}} | — | {{OPEN_INFO}} |

> [!CONFORME]
> Ningún hallazgo `Critical` o `High` queda abierto al cierre de esta revisión.

# Trazabilidad Critical/High

Registro técnico de cada hallazgo grave detectado y su remediación. No se elimina un
hallazgo de esta tabla por haber sido corregido — el historial de corrección es parte
de la evidencia.

| ID | Severidad | Activo afectado | Requisito/spec | Cambio aplicado | Prueba | Estado |
|---|---|---|---|---|---|---|
| {{ID}} | {{SEVERITY}} | {{AFFECTED_ASSET}} | {{SPEC_REF}} | {{CHANGE}} | {{TEST_REF}} | REMEDIATED |

> [!NOTA]
> {{REMEDIATION_TRACEABILITY_NOTE}}

# Evidencia de pruebas

| Comando | Propósito | Resultado | Evidencia |
|---|---|---|---|
| {{COMMAND}} | {{PURPOSE}} | PASSED | {{EVIDENCE}} |

# Hallazgos Medium/Low/Info

{{REMAINING_FINDINGS}}

# Riesgo residual y condiciones

{{RESIDUAL_RISK}}

# Recomendación para IT

{{IT_RECOMMENDATION}}

# Índice de evidencia

{{EVIDENCE_INDEX}}

# Declaración de assurance

> [!NOTA]
> En la revisión final automatizada no se identificaron hallazgos Critical o High dentro
> del alcance y las limitaciones declaradas. Este informe habilita la evaluación final de
> IT, pero no sustituye un pentest formal, la validación de infraestructura de producción
> ni la aprobación corporativa de despliegue.
