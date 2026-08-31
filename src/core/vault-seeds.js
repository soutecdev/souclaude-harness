// Semillas de una carpeta Project-<PREFIJO>/ del Vault.
//
// Van EMBEBIDAS aca y no en el manifest a proposito: manifest.files[] describe
// archivos con `dest` en el REPO destino, y el chequeo de huerfanos de verify()
// se dispara con cualquier entrada que no aterrice ahi. Tampoco se leen del
// propio Vault (00-System/templates/): un Vault recien clonado por el CLI no
// tiene por que traerlas, y un fallback embebido seria este mismo archivo con
// un segundo camino que mantener.
//
// Lo que estas constantes fijan no es "contenido de ejemplo" sino el CONTRATO
// DE FORMATO que el resto del harness ya asume: el frontmatter `kanban-plugin:
// board` y los NOMBRES EXACTOS de las columnas que leen el hook
// declarar-milestone.mjs y la skill vault-milestones. Cambiar una columna aca
// es cambiar el protocolo, no una plantilla.
//
// `<PROYECTO>` se reemplaza por el nombre de la carpeta (Project-SHS).

const MARCA_PROYECTO = /<PROYECTO>/g

// milestones.md: Backlog / En curso / Hecho. kanban.md agrega En review, que es
// la unica diferencia entre los dos tableros (docs/vault-guide.md §6).
const MILESTONES = `---
kanban-plugin: board
---

## Backlog

## En curso

## Hecho
`

const KANBAN = `---
kanban-plugin: board
---

## Backlog

## En curso

## En review

## Hecho
`

const SESSIONS = `# Sesiones — append-only. Una línea por sesión, siempre al final.
# fecha · rama o sesión · milestone · quién · máquina · tokens (in/out) · resultado
`

const HISTORY = `# Historial de <PROYECTO> — espejo del history.md del repo

Una línea por tarea o sesión cerrada, **siempre al final**. No edites líneas
existentes. Al resolver un conflicto de merge: conserva ambas líneas y ordena
por fecha.

Formato: \`- <fecha> · <tarea o rama> · <quién> · <resultado> · <referencia>\`
`

// plans/ nace vacia y git no versiona directorios vacios: sin un archivo
// adentro, la carpeta no sobrevive al commit y el primer plan la crearia de
// nuevo -- pero el tablero ya la habria mostrado como inexistente.
const GITKEEP = ''

// Ficha para el Observatorio: se siembra vacia y el equipo del proyecto la
// completa y actualiza (release con cambios importantes). No confundir con el
// README del repo tecnico -- OBS-M6 sincroniza secciones del README hacia el
// portal, esta ficha es aparte y vive solo en el Vault.
const OBSERVATORIO = `# Ficha para el Observatorio - <PROYECTO>

## Tagline
<!-- Una frase: qué es y para quién. Entre 20 y 200 caracteres. -->

## Plataforma
<!-- Dónde corre. Ej.: "App de escritorio (Windows · macOS)", "Servicio en Cloudflare Workers", "Robot + Jetson". -->

## Resumen
<!-- Uno a tres párrafos en prosa. Sin tablas, imágenes ni bloques de código. -->

## Por qué importa
<!-- Una razón por viñeta, una frase cada una (3 a 5). -->
-
-
-

## Próximos pasos
<!-- Un paso por viñeta. Si el repo usa Milestones de GitHub con fecha, dejar vacío. -->
-
-
-

## Equipo
<!-- Una línea por persona -->
- Nombre Apellido · @usuario-github · Rol

## Hitos
<!-- Una línea por hito -->
<!-- Si la versión coincide con un release de GitHub, manda esta fecha y descripción. -->
- AAAA-MM-DD · versión/release · Título/Descripción
`

// Ruta relativa a Project-<PREFIJO>/ -> contenido. El orden es el de la
// estructura documentada en docs/vault-guide.md §2.
export const SEMILLAS_PROYECTO = {
  'milestones.md': MILESTONES,
  'plans/.gitkeep': GITKEEP,
  'kanban.md': KANBAN,
  'sessions.md': SESSIONS,
  'progress/history.md': HISTORY,
  'OBSERVATORIO.md': OBSERVATORIO,
}

export function renderSemilla(contenido, proyecto) {
  return contenido.replace(MARCA_PROYECTO, proyecto)
}
