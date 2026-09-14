# ADR: Milestones, planes y sesiones con consumo en el Vault

**Fecha**: 2026-08-17
**Status**: accepted — superseded parcialmente por
`20260912-una-rama-por-milestone.md` (la rama Git es por milestone, no por tarea;
`kanban.md` y el resto del modelo siguen vigentes)
**Deciders**: Ignacio A

## Context

Con el harness 3.0 se eliminó el flujo SDD/rocas, pero el protocolo del Vault
(`progress/README.md` distribuido y `docs/vault-guide.md`) seguía escrito en esos
términos: espejos de specs, tarjetas movidas por agentes (`spec-author`, `implementer`,
`reviewer`) que ya no existen, y comandos `/rock-*` eliminados. Quedaban además tres
huecos operativos:

1. **El anti-solapamiento era solo a nivel tarea** (tarjeta del kanban). Dos máquinas
   podían trabajar el mismo **milestone** por planes o tareas distintas sin chocar
   nunca en una tarjeta, duplicando trabajo sin que el protocolo lo detectara.
2. **No había representación de planes**: un milestone puede intentarse por más de un
   camino (P1 fracasa, P2 lo releva) y esa historia no quedaba en ningún lado visible.
3. **El consumo por sesión no llegaba al Vault**: el ADR
   `20260810-monitor-snapshots-en-vault` autorizó solo agregados por (cuenta, máquina)
   y prohibió explícitamente datos por sesión o por proyecto. La pregunta "¿cuánto
   costó este milestone y quién lo trabajó?" no se podía responder desde el Vault.

## Decision

Modelo de tres niveles por proyecto en `Project-<PREFIJO>/`, más un registro de
sesiones:

- **`milestones.md`** — tablero Kanban (Obsidian) de milestones `<PREFIJO>-M<n>`. La
  tarjeta En curso lleva **dueño y máquina** (`@quién · <máquina>`) y el plan activo.
  Es la unidad de **claim** entre máquinas: el protocolo obliga a `pull --rebase` +
  lectura de este tablero **antes** de empezar; un milestone En curso con otro
  dueño/máquina → parar y preguntar.
- **`plans/`** — un archivo por plan (`<PREFIJO>-M<n>-P<n>-<slug>.md`), espejado al
  adoptarlo. Los planes descartados no se borran: la tarjeta del milestone apunta al
  vigente.
- **`kanban.md`** — tablero de tareas (`<PREFIJO>-M<n>-T<nnn>`), como hasta ahora,
  segundo nivel de claim.
- **`sessions.md`** — append-only, una línea por sesión al cerrarla: fecha,
  rama/sesión, milestone, quién, máquina, **tokens entrada/salida** y resultado. Los
  tokens salen del monitor local; sin dato, `n/d` y la línea se escribe igual.

Esto **amplía la excepción** del ADR 20260810: además de los snapshots agregados por
(cuenta, máquina) en `00-System/monitor/`, se autoriza una línea agregada **por sesión
y por proyecto** en `sessions.md`. La telemetría cruda (`model-router.jsonl`,
transcripts, eventos por mensaje) sigue prohibida.

El protocolo distribuido vive en `templates/base/progress/README.md` (managed) y la
doctrina en `docs/vault-guide.md`, reescrita para el harness 3.x.

## Alternatives considered

- **Lockfiles por milestone** (`.lock` con hostname): más maquinaria y peor legibilidad
  humana que una tarjeta con dueño+máquina; el kanban ya demostró el patrón.
- **Publicación automática por sesión desde el monitor** (extender
  `vault-monitor-publisher` con datos por sesión/proyecto): es el siguiente paso
  natural para que los tokens no dependan de la disciplina del agente, pero toca un
  camino con reglas estrictas de whitelist y merece su propio cambio. La línea
  `sessions.md` escrita por el agente es el contrato desde hoy; el publisher podrá
  llenarla o complementarla después.
- **Estado en el repo del proyecto**: contradice la razón de ser del Vault (visibilidad
  entre máquinas sin ensuciar el historial del repo; una tarjeta que espera un merge no
  refleja el ahora).

## Consequences

- Cualquier agente ve **quién trabaja qué milestone y desde qué máquina** con un
  `pull` + lectura de un archivo; el solapamiento se corta en el nivel donde ocurre.
- El costo por milestone/proyecto se vuelve consultable desde el Vault
  (`sessions.md`), complementando la vista por cuenta de `00-System/monitor/`.
- Los tableros heredados solo con `kanban.md` siguen funcionando: `milestones.md` se
  siembra al primer uso; no hay migración destructiva.
- La calidad del dato de tokens depende del agente hasta que el monitor lo automatice
  (registrado arriba como siguiente paso).
