# ADR: La documentación de la metodología vive en `docs/metodologia/` y no puede publicarse vieja

**Fecha**: 2026-10-07
**Status**: accepted
**Deciders**: Ignacio (dueño de SHS-M16) · sesión Claude (SHS-M16-P2)

## Context

La documentación de la metodología envejecía en silencio: las infografías de
casuística avisaban "el tag v3 no existe todavía" meses después de publicado, el
deck describía la 3.5.0, y el README de `docs/infografias/` confiaba en que "si esos
documentos cambian, estas infografías se actualizan con ellos" — sin nada que lo
hiciera cumplir. El pedido (2026-10-05): una carpeta de documentación compartible —
una guía, una infografía y un prompt de instalación — que un agente actualice
automáticamente cada vez que se suben cambios al harness, con la guía fiel a lo que
`npx souclaude` hace de verdad. La subida automática a SharePoint quedó descartada
por el usuario en el mismo pedido. Restricciones: GitHub Actions está en pausa
(SHS-M36, ADR 2026-09-21) y la regla del harness prohíbe workflows nuevos.

## Decision

**Docs-as-code con candado de frescura.** La carpeta `docs/metodologia/` del repo
del generador es la única fuente publicable (no se distribuye a consumidores). Sus
partes volátiles — versión, catálogo de skills, requisitos, comando de instalación —
viven entre marcadores `souclaude:gen` y las regenera
`scripts/gen-docs-metodologia.mjs` desde `package.json` y el manifest (determinista,
EOL-agnóstico, escritura plana, modo `--check`). "Automáticamente" se implementa
como **enforcement, no como memoria**: el test-candado de la suite,
`souclaude verify` y el hook `reglas-pr` (que **deniega el `git push`** con drift,
solo en el repo del generador) obligan a que el mismo cambio que toca el instalador
regenere la documentación — el agente de esa sesión la regenera y ajusta la prosa.
La prosa fuera de marcadores se revisa en cada release `dev` → `main` (regla en
CLAUDE.md). La difusión a SharePoint u otro canal es manual: se copia la carpeta.

## Consequences

### Positivas
- Es imposible publicar documentación con versión o catálogo viejos: el drift pone
  en rojo la suite, `verify` y el push. Debutó en su primer merge real: el bump a
  3.17.0 (SHS-M42) dejó los cuatro artefactos con drift y `--check` lo acusó.
- El costo de mantener la doc se paga en el PR que causa el cambio, no en una
  auditoría posterior.
- La carpeta se comparte tal cual (tres artefactos autocontenidos) o se exporta con
  `soutec-md-a-pdf`.
- Al revertir SHS-M36, el candado ya corre en CI sin trabajo extra (vive en la
  suite y en verify).

### Negativas
- La prosa fuera de los marcadores sigue dependiendo de la regla de release; lo que
  se repita o envejezca seguido debe migrar a sección generada.
- Un bloque generado nuevo exige tocar el script y sus tests.
- El hook suma una ejecución de Node por push en este repo (decenas de ms).

### Neutras
- SHS-M8 (envío automático a SharePoint) sigue en Backlog; esta decisión no lo
  bloquea ni lo exige.
- Las seis infografías de casuística permanecen en `docs/infografias/` con sus
  correcciones pendientes (SHS-M16-T005).

## Alternatives considered

### Alternativa A: workflow de GitHub Actions on push a `main`
**Pros**: trigger literal e independiente de la sesión.
**Cons**: Actions en pausa (SHS-M36); exigiría una app de Entra con secreto en el
repo; viola la regla "solo los workflows del harness".
**Por qué se descartó**: bloqueada dos veces hoy; el candado en suite/verify ya
cubre CI el día que Actions vuelva.

### Alternativa B: subida automática a SharePoint vía conector Microsoft 365
**Pros**: la carpeta compartida de la organización siempre al día.
**Cons**: depende de un conector autorizado por sesión/máquina; acopla el release a
un servicio externo.
**Por qué se descartó**: el usuario la descartó explícitamente; la carpeta en el
repo la reemplaza como fuente, y la copia a SharePoint queda manual.

### Alternativa C: paso manual en el protocolo de release, sin candado
**Pros**: cero código.
**Cons**: es exactamente lo que ya falló — el aviso "si esos documentos cambian,
actualiza las infografías" existía y las infografías envejecieron igual.
**Por qué se descartó**: depende de memoria humana; sin enforcement no hay
"automáticamente".

## References

- Plan SHS-M16-P2 (`Project-SHS/plans/SHS-M16-P2-carpeta-docs-autoactualizable.md`, Vault)
- CHANGELOG `[Sin publicar]` — entrada de SHS-M16-P2
- SHS-M26 (Backlog): el mismo patrón de candado para la deriva de copias de skills
- ADR 2026-09-21: pausa temporal de GitHub Actions (SHS-M36)
- ADR 2026-10-06: protección de `main` por repo en el hook (SHS-M42) — el hook que
  este ADR extiende
