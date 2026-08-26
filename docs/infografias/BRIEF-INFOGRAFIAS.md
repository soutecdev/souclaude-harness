# Brief de las infografías — para generar desde Claude web

Documento autosuficiente para **regenerar las siete infografías** pegándolo en claude.ai:
una **master** de la metodología y **seis casuísticas** de adopción.

> **Lee primero la sección 2.** Las infografías que hay hoy en el repo contienen **cuatro
> datos que quedaron obsoletos** el 2026-08-21, cuando se cerró SHS-M5 y se publicó la
> v3.5.0. Este brief ya trae el texto corregido: si generas desde aquí, sale bien.

---

## 1 · El encargo

Genera **siete infografías**, cada una como un **HTML autocontenido** (CSS inline, sin
dependencias externas) que se abra directo en el navegador y se imprima o exporte a PDF
en **A4 vertical**.

| Archivo | Cuándo se usa |
|---|---|
| `00-metodologia-master.html` | Presentar la metodología completa: las tres piezas, el Vault de tres niveles, la trazabilidad por milestone y el ciclo diario |
| `01-proyecto-nuevo.html` | Bootstrap de un proyecto desde cero (fases 0–6) |
| `02-repo-existente.html` | Un repo ya existente adopta el harness (rutas A/B: `init` vs `adopt`) |
| `03-integrante-nuevo.html` | Se suma una persona a un proyecto ya adoptado |
| `04-maquina-nueva.html` | Dejar lista una máquina nueva |
| `05-actualizar-harness.html` | Actualizar el harness en un proyecto ya adoptado |
| `06-sin-jira.html` | Proyecto sin Jira o conector sin autorizar: degradación y catch-up |

**Audiencia**: el desarrollador que adopta el harness. Se leen e imprimen; no se proyectan
(para proyectar está el deck, ver `docs/presentacion/BRIEF-DECK.md`).

**Tono**: operativo. Cada infografía responde "qué hago yo, en qué orden, y qué tiene que
quedar cuando termine".

---

## 2 · Correcciones obligatorias respecto de las infografías actuales

Estos cuatro puntos **estaban vigentes cuando se escribieron y ya no lo están**. El texto
corregido está incorporado en las secciones de contenido; se listan aquí para que no se
reintroduzcan por copiar de los HTML viejos.

| # | Dónde | Decía (obsoleto) | Debe decir |
|---|---|---|---|
| 1 | `01-proyecto-nuevo`, fase 2 | "El README documenta `#v3` pero ese tag **no existe** (verificado 19-ago-2026, HTTP 422)… instala desde la rama `dev`" | El tag `v3` **existe** desde la v3.5.0 (21-ago-2026). Se instala desde `#v3`. |
| 2 | `01-proyecto-nuevo`, fase 4 | "el CLI no escribe el campo `project` en `vault.local.json` — agrégalo a mano o el hook queda ciego" | El instalador **lo escribe solo**: lo resuelve por el `id-registry` o lo pregunta, y lo persiste. |
| 3 | `04-maquina-nueva`, paso 4 | "Añade a mano `project` a `.claude/vault.local.json` (el CLI aún no lo escribe)" | El paso manual **desaparece**: `souclaude upgrade --vault-path <ruta>` ya deja el campo escrito. |
| 4 | `05-actualizar-harness` | "Mientras el tag `v3` no esté publicado: los upgrades llegan desde la rama `dev` del harness" | Los upgrades llegan del tag `#v3`. La advertencia sobre ramas móviles ya no aplica. |

**Además**, todas ganan un dato nuevo que antes no existía: si el prefijo del repo ya está
en `00-System/id-registry.md` y la carpeta del proyecto **todavía no existe en el Vault**,
el instalador **la siembra** (con confirmación, o con `--vault-seed` en modo desatendido).

---

## 3 · Sistema visual — identidad Soutec

### Paleta

| Rol | Hex | Uso |
|---|---|---|
| `--cyan` | `#00A5BC` | Acento principal, títulos de sección, números de fase |
| `--blue` | `#00688F` | Títulos, barras de encabezado |
| `--deep` | `#004F64` | Fondo de cabecera, texto sobre claro |
| `--carbon` | `#3D4543` | Títulos secundarios |
| `--body` | `#2C3331` | Cuerpo de texto |
| `--grey` | `#6B7472` | Texto secundario, pies |
| `--rule` | `#D8DDE0` | Líneas y bordes |
| `--zebra` | `#F3F7F8` | Fondo alterno de filas y cajas |
| `--codebg` | `#F1F4F5` | Fondo de bloques de código |
| `--green` | `#47B45A` | Lo que sí se hace, verificaciones OK |
| `--yellow` | `#F2D13F` | Avisos ("ojo con esto") |
| `--magenta` | `#C81E54` | Errores típicos, lo que nunca se hace |

### Tipografía y formato

- **Fuente**: `"Segoe UI", system-ui, -apple-system, sans-serif`. Código en monoespaciada.
- **Página**: A4 vertical con estilos de impresión (`@media print`), márgenes que no corten
  contenido, sin fondos oscuros a sangre que gasten tóner.
- **Cabecera**: logotipo "soutec" arriba a la izquierda, sobre el título.
- **Pie**: `SOUTEC · metodología con harness souclaude · SHS-M7-T008` + la referencia
  documental de esa infografía.

### Elementos recurrentes

- **Fases numeradas** con el número grande en cian a la izquierda.
- **Cajas "Debe quedar"** (verde): el resultado verificable de cada fase.
- **Cajas "Ojo"** (amarillo): la trampa concreta de ese paso.
- **Bloques de código** con fondo `--codebg`.
- **Listas de dos columnas** para contrastar (lo que sí / lo que no).

---

## 4 · Infografía 00 · La metodología SOUTEC con el harness

**Subtítulo**: Cómo se organiza el trabajo asistido por agentes: arquitectura, trazabilidad
y ciclo diario · infografía master

### Sección "Las tres piezas" (arquitectura)

Tres tarjetas, con la cadena `Repo → progreso → Vault → espejo inmediato → Jira` debajo.

| Pieza | Contenido | Regla |
|---|---|---|
| 📁 **Repo del proyecto** | Código, tests y progreso. El harness (`npx souclaude`) instala aquí la superficie Claude: `CLAUDE.md`, skills, hooks y la config del conector Jira. | Todo cambio por rama + PR contra `dev`. Nunca directo a `main`. |
| 🗄 **El Vault** | El tablero vivo de TODOS los proyectos: milestones, planes, kanban y sesiones. Repo aparte (`soubunker-vault`), fuente de verdad del progreso. | Push directo a `main`, sin PR: el tablero refleja el ahora. |
| 📊 **Jira** | El espejo del Vault para la organización: cada milestone es una épica y cada tarea un issue hijo, sincronizados al mover cada tarjeta. | Se deriva del Vault, nunca al revés. Jira jamás bloquea el trabajo. |

### Sección "El Vault: tres niveles" — `Project-<PREFIJO>/`

- **`milestones.md`** — El claim de nivel alto: qué se comprometió · unidad de
  anti-solapamiento entre máquinas
- **`plans/` + `kanban.md`** — Un plan por archivo (P1, P2…) y sus tareas como tarjetas:
  Backlog / En curso / En review / Hecho
- **`sessions.md`** — Append-only: una línea por sesión con quién, máquina, tokens y
  resultado (el monitor la escribe solo)

### Sección "La regla central"

> **Todo trabajo pertenece a un milestone del Vault. Sin excepciones.**

Un hook de sesión muestra el tablero al arrancar y el agente declara sobre qué milestone
trabaja antes de tocar código. Si no existe, se da de alta en el Backlog primero. Milestone
En curso con otro dueño u otra máquina → se para y se pregunta.

### Sección "El ciclo de trabajo diario"

1. **Sincroniza el Vault**: `git pull --rebase` y lee `milestones.md` + `kanban.md`.
2. **Toma la tarjeta**: a En curso con `@quién · máquina` y push del Vault en ese momento,
   no al final.
3. **Espeja el plan**: todo milestone En curso tiene su plan en `plans/`. Los descartados
   no se borran.
4. **Trabaja en el repo**: rama `tipo/<ID>-slug` desde `dev`, commits `tipo: descripción`
   en español.
5. **Espeja Jira al momento** (skill `jira-sync`): tomar = In Progress, cerrar = Done.
   Vault primero, Jira después.
6. **Antes del PR**: `/security-review`, plantilla completada de verdad, PR contra `dev`.
   Mergea el coordinador.
7. **Al cerrar la sesión**: línea en `sessions.md` (tokens incluidos) — el monitor la
   publica solo si está corriendo.
8. **Release**: `dev` → `main` también por PR; el tag `vX.Y.Z` se crea después del merge.

### Sección "Qué hace el agente — y qué no se delega"

**El agente lo hace automáticamente**
- Declarar el milestone al arrancar la sesión
- Mover tarjetas y pushear el Vault al momento
- Espejar cada movimiento en Jira
- Security review antes de cada PR
- Registrar la sesión con su consumo de tokens

**Decisiones de personas, nunca del agente**
- Mergear o aprobar PRs, crear repositorios (coordinador)
- Visibilidad del repo y prefijo del proyecto (para siempre)
- Alcance de cada milestone: el agente propone, tú apruebas
- El OAuth del conector Jira (una vez por máquina)

**Pie**: Referencias: `docs/onboarding-desarrollador.md` · `progress/README.md`

---

## 5 · Infografía 01 · Proyecto nuevo desde cero

**Subtítulo**: Las siete fases del bootstrap: del repo vacío al primer milestone espejado
en Jira · playbook completo en `docs/bootstrap-proyecto-plantillas-prompts.md`

### Fase 0 · Decisiones previas sin agente — de las personas

Visibilidad del repo (privado salvo razón explícita) · prefijo de 2-4 letras, libre en
`id-registry.md` del Vault, **para siempre** · rutas locales fuera de OneDrive · crear el
proyecto Jira a mano (Kanban team-managed, clave = PREFIJO, con columna **En revisión**).

> **Ojo**: el conector MCP no crea proyectos Jira — este alta es manual, ~2 minutos, y sin
> la columna En revisión el espejo pierde fidelidad.

### Fase 1 · Repositorio y andamiaje base

El agente crea el repo en GitHub (o reutiliza uno vacío existente) y deja el andamiaje
inicial con primer commit y push.

**Debe quedar**: `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`, README y
primer push.

> **Ojo — OneDrive**: si el repo queda en carpeta sincronizada, OneDrive corrompe `.git/`.
> Trabaja fuera del área sincronizada.

### Fase 2 · Instalar el harness  ← **CORREGIDA**

Correr `--dry-run` y revisar el plan antes de escribir un byte.

```
npx github:ialvarezsoutec/souclaude-harness#v3 --dry-run
npx github:ialvarezsoutec/souclaude-harness#v3
```

**Debe quedar**: `CLAUDE.md`, `.claude/` (settings, skills, hooks, lockfile), `.github/`,
`docs/decisions/`, `progress/`, `notes.md`.

> **Cambió el 21-ago-2026**: el tag `v3` **ya existe** (release v3.5.0). La advertencia
> anterior —"instala desde la rama `dev` porque el tag no existe"— quedó sin efecto.
> Instalar desde un tag es preferible a instalar desde una rama: las ramas se mueven y el
> lockfile no registra el commit.

### Fase 3 · Adoptar el flujo Git *(la fase que se olvida)*

El harness trae reglas que rigen desde ya, incluso sobre lo hecho: crear `dev`, mover el
trabajo a una rama propia con PR contra `dev`, corregir lo que contradiga la guía (README
incluido) y correr `/security-review` antes del PR.

**Debe quedar**: `main` y `dev` en remoto, rama de trabajo con PR abierto contra `dev`,
plantilla completada de verdad.

### Fase 4 · Conectar el Vault y dar de alta el proyecto  ← **CORREGIDA**

Clonar el Vault fuera de OneDrive, conectarlo (`souclaude upgrade --vault-path`), registrar
el prefijo en `id-registry.md` y crear `Project-<PREFIJO>/` con tableros vacíos: **no se
inventan milestones**.

**Debe quedar**: el hook de `SessionStart` imprimiendo el tablero al arrancar, y
`.claude/vault.local.json` con su campo `project`.

> **Cambió el 21-ago-2026**: el CLI **ya escribe el campo `project`**. Lo resuelve
> contrastando la identidad del repo contra `00-System/id-registry.md`, o lo pregunta si
> hay varias carpetas y hay terminal. El paso manual desapareció.
>
> **Nuevo**: si el prefijo está registrado y la carpeta `Project-<PREFIJO>` todavía no
> existe en el Vault, el instalador **la siembra** con sus cuatro archivos base — con
> confirmación en modo interactivo, o con `--vault-seed` en desatendido. El registro es la
> única autoridad: un repo que no figura ahí no se siembra.

### Fase 5 · Configurar el espejo en Jira

Completar `.claude/jira.json` (sitio + clave = prefijo) por rama y PR. Recién aquí se
autoriza el conector: `/mcp` → autenticar Atlassian (OAuth, solo la persona puede).

**Debe quedar**: `jira.json` sin placeholders y el conector respondiendo.

### Fase 6 · Primer milestone

Definir los milestones reales del proyecto: el primero va a En curso con su plan en
`plans/` y sus tareas en el kanban, espejado en Jira en el mismo flujo (Vault primero,
Jira después, idempotente).

**Debe quedar**: milestone M1 En curso con plan P1 y tareas; su épica e issues en Jira; la
línea de sesión en `sessions.md`.

### Verificación final — el bootstrap está completo cuando…

- `main` y `dev` existen; `main` solo recibió merges desde `dev`
- `souclaude status` sale con exit code 0
- El hook de sesión imprime el tablero del proyecto
- `vault.local.json` tiene el campo `project`
- `jira.json` sin placeholders y conector verificado
- Prefijo registrado en `id-registry.md`
- Milestone En curso con plan y tareas, espejado en Jira
- Línea de sesión en `sessions.md` · nada sensible commiteado

---

## 6 · Infografía 02 · Repo existente que adopta el harness

**Subtítulo**: Misma secuencia que el proyecto nuevo, con dos diferencias: la fase 1 no
aplica y la fase 2 se bifurca según lo que el repo ya tenga

### Qué cambia respecto del caso base

Las fases 0, 3, 4, 5 y 6 se ejecutan igual. La fase 1 no aplica (el repo ya existe) y la
fase 2 cambia de comandos. La fase 3 —adoptar el flujo Git— es aquí **todavía más
importante**: el repo trae historia y costumbres propias que probablemente contradigan la
guía (¿se commiteaba directo a `main`? ¿existe `dev`? ¿el README describe otro flujo?). Se
revisan y reencuadran en el mismo cambio.

- **Antes de empezar**: el repo debe estar fuera de OneDrive. Si vive en una carpeta
  sincronizada, muévelo primero — OneDrive corrompe `.git/`.
- La adopción **no exime de la fase 0**: prefijo del Vault y proyecto Jira se deciden igual
  que para un proyecto nuevo.

### Fase 2, bifurcada: ¿qué tiene el repo hoy?

**Ruta A · El repo no tiene nada de Claude**

Ni `CLAUDE.md` ni `.claude/`: se instala directo con `souclaude init`.
- Correr `--dry-run` y revisar el plan antes de escribir.
- Confirmar que el plan emite solo la superficie Claude — no toca el código del proyecto.

Resultado: la misma superficie que en la fase 2 de un proyecto nuevo.

**Ruta B · Ya hay estructura Claude previa**

Un `CLAUDE.md` a mano, una copia vieja del Kit, skills sueltas: **no instales encima**.
Para esto existe `souclaude adopt`.
- `adopt --dry-run`: qué coincide y qué difiere.
- `adopt`: reclama solo lo byte-idéntico (escribe únicamente el lockfile).
- `upgrade`: lo que difiere queda como propuesta en archivos `.new` al lado del original —
  nunca pisado.
- Merge de cada `.new` con decisión humana: tú eliges qué se conserva.

> **Por qué `adopt` y no `init`**: adoptar un archivo modificado le diría al próximo
> `upgrade` "písalo tranquilo" — y borraría el trabajo del equipo. Si ya existe
> `.claude/harness.json`, `adopt` no hace nada: el camino es `upgrade`.

### Después de la fase 2

- **Fase 3 · Flujo Git**: reencuadrar historia y costumbres: crear `dev`, rama + PR,
  corregir README y hábitos que contradigan la guía.
- **Fases 4 y 5 · Vault y Jira**: alta de `Project-<PREFIJO>` en el Vault y espejo Jira,
  igual que el caso base.
- **Fase 6 · Primer milestone**: milestones reales del proyecto — sin `.new` huérfanos en
  el árbol antes de cerrar.

---

## 7 · Infografía 03 · Integrante nuevo en un proyecto ya adoptado

**Subtítulo**: El proyecto ya está montado: tu camino es leer, conectar tu máquina y
empezar a trabajar — no repetir el bootstrap

### La idea en una frase

No repitas nada del playbook de bootstrap. El proyecto, el Vault y Jira ya existen. Tu
incorporación son tres pasos: leer la guía de la metodología, dejar tu máquina lista y
arrancar por el tablero.

### El camino

**1 · Lee la guía de onboarding** — `docs/onboarding-desarrollador.md`, de punta a punta,
una vez. Ahí están:
- Las tres piezas (repo · Vault · Jira) y sus reglas opuestas
- La regla de trazabilidad por milestone
- El ciclo de trabajo diario, paso a paso

Después el harness te recuerda las reglas solo — los agentes las reciben en cada sesión.

**2 · Deja tu máquina lista** — Ejecuta la casuística 4 · Máquina nueva completa:
requisitos (Node, git, `gh` autenticado), clonar repo y Vault fuera de OneDrive, conectar
el Vault, y autorizar el conector Jira con `/mcp`.

**3 · Arranca por el tablero** — Abre una sesión: el hook imprime el tablero de
`Project-<PREFIJO>`. Todo trabajo se declara sobre un milestone; las tarjetas En curso de
otros no se tocan — se pregunta primero.

### Lo que el proyecto te da de antemano

**Accesos previos — los gestiona el coordinador, no tú**
- Acceso de escritura al repo del proyecto en GitHub
- Acceso de escritura al Vault (`soubunker-vault`)
- Usuario en el sitio Jira de la organización

Si te falta alguno, pídelo antes de empezar: sin escritura al Vault no puedes mover
tarjetas, y sin usuario Jira el espejo queda pendiente (anotado en `notes.md` — nunca
bloquea).

### El error típico

Re-ejecutar el bootstrap "para estar seguro". Crear repos, tableros o proyectos Jira que ya
existen rompe la idempotencia del espejo y duplica estructura. Si algo parece faltar o
estar mal montado, **repórtalo al coordinador** — no lo re-crees por tu cuenta.

---

## 8 · Infografía 04 · Máquina nueva

**Subtítulo**: Integrante nuevo o existente: todo lo de esta lista es por máquina, no por
proyecto — nada se hereda solo de tu otra computadora

### La premisa

El harness distribuye archivos dentro del repo, pero **no puede instalar software en tu
equipo ni hacer logins por ti**. Estos pasos son tuyos, una sola vez por máquina; después
el token de `gh`, la conexión del Vault y el OAuth de Jira quedan guardados.

### Los pasos, en orden  ← **CORREGIDA** (eran seis, ahora son cinco)

**1 · Requisitos**: Node ≥ 22.4, git, y GitHub CLI autenticado. Sin `gh` el agente pushea
la rama pero el PR queda para abrir a mano.
```
winget install GitHub.cli
gh auth login   # GitHub.com · HTTPS · browser
gh auth status  # ✓ Logged in
```

**2 · Clona el repo del proyecto** en una ruta **fuera de OneDrive** — las carpetas
sincronizadas corrompen `.git/` y generan copias en conflicto.

**3 · Clona el Vault y conéctalo**, también fuera de OneDrive:
```
git clone <VAULT_REPO> <RUTA_VAULT>
npx souclaude upgrade --vault-path <RUTA_VAULT>
```
Esto deja `.claude/vault.local.json` con la ruta **y con el campo `project`**: el CLI lo
resuelve solo contra `00-System/id-registry.md`, o lo pregunta si hay varias carpetas.

> **Cambió el 21-ago-2026**: antes había que agregar `"project"` a mano y, si te olvidabas,
> el hook quedaba ciego **sin dar error**. Ese paso manual ya no existe. Si quieres
> forzarlo, `--vault-project Project-<PREFIJO>`.

**4 · Autoriza el conector Jira**: en una sesión interactiva de Claude Code escribe `/mcp`
y autentica Atlassian (OAuth en el navegador, una vez por máquina — solo la persona puede).

**5 · Verifica**: abre una sesión nueva — el hook de `SessionStart` debe imprimir el
tablero de `Project-<PREFIJO>`. Si no aparece, el paso 3 quedó mal.

> **Recuerda**: `vault.local.json` está gitignorado a propósito — la ruta es de cada
> máquina. Cada integrante repite estos pasos en la suya; no se copia de otra computadora.

### Cierre: la verificación asistida

**Prompt para pegarle al agente.** Antes de dar la máquina por lista, pídele el diagnóstico
completo — que reporte, sin arreglar nada todavía:

```
Verifica que esta máquina quedó bien conectada a la metodología: gh autenticado,
Vault clonado y conectado con el campo project en vault.local.json, conector de
Atlassian respondiendo y hook de sesión leyendo el tablero. Repórtame qué está
bien y qué falta, sin arreglar nada todavía.
```

---

## 9 · Infografía 05 · Actualizar el harness

**Subtítulo**: El flujo vive en la skill `harness-upgrade` y el comando `souclaude upgrade`
— el playbook de bootstrap no aplica aquí

### La premisa

El upgrade es un cambio como cualquier otro: va por **rama + PR contra `dev`**, con la
plantilla completada. Lo que cambia es la mecánica de archivos — el harness distingue lo
suyo intacto de lo que el equipo modificó, y **nunca pisa lo segundo**.

### El flujo

**1 · Mirar antes de tocar** — Qué versión hay instalada y qué cambió en el harness desde
entonces. El lockfile `.claude/harness.json` registra qué archivos son salida intacta.
```
npx souclaude status
```

**2 · Upgrade en rama** — Rama desde `dev` (`chore/harness-vX.Y.Z`) y ejecutar. Lo intacto
se actualiza en el lugar; lo modificado por el equipo queda como propuesta `.new` al lado
del original.
```
npx souclaude upgrade
```

**3 · Merge humano y PR** — Revisar cada `.new` con decisión humana (qué se adopta, qué se
conserva), sin dejar `.new` huérfanos, y abrir el PR contra `dev` con `/security-review`
previo.

### La regla de los `.new`

**✓ Lo que hace el upgrade** — Actualiza solo los archivos que siguen **byte-idénticos** a
lo que el harness emitió. Lo que el equipo tocó queda intacto, con la versión nueva al lado
como `archivo.new` para comparar y decidir.

**✗ Lo que nunca hace** — Pisar un archivo modificado por el equipo. Adoptar un archivo
cambiado como "intacto" le diría al próximo upgrade que puede sobrescribirlo — y borraría
trabajo real.

### Reglas rápidas  ← **CORREGIDA**

- Los upgrades llegan del **tag `#v3`**, que apunta al último release de la serie 3. Los
  proyectos que quedaron en `#v1` editan la ref y corren `upgrade --prune`: el tag móvil
  `v2` nunca se creó.
- El detalle operativo completo está en la skill `harness-upgrade` — el agente la aplica
  solo al pedirle el upgrade.
- Un upgrade que trae archivos nuevos de skills con assets binarios respeta el flag
  `"binary"` del manifest — no es asunto del consumidor, pero explica por qué jamás se
  editan a mano los assets instalados.
- Después del merge a `dev`, el repo queda apuntando a la versión nueva en
  `.claude/harness.json`; `souclaude status` debe salir limpio.

> **Cambió el 21-ago-2026**: la advertencia "mientras el tag `v3` no esté publicado, los
> upgrades llegan desde la rama `dev`" quedó sin efecto con el release v3.5.0.

---

## 10 · Infografía 06 · Proyecto sin Jira (o conector sin autorizar)

**Subtítulo**: La metodología degrada a propósito: el espejo espera, el trabajo nunca — y
cuando Jira llega, se pone al día de una vez

### El principio

Jira **nunca bloquea** el trabajo local. Sin proyecto Jira o sin conector autorizado, todo
lo demás sigue exactamente igual: Vault, milestones, kanban, planes y sesiones. Cada espejo
que no pudo hacerse queda anotado en `notes.md` para la próxima sesión con conector — se
reporta una vez y se sigue.

### Mientras no hay Jira

**Sigue funcionando igual**
- Trazabilidad por milestone y hook de sesión
- Tableros del Vault con push inmediato
- Planes en `plans/` y líneas de `sessions.md`
- Flujo Git completo: ramas, PRs, security review
- Monitor de tokens y su registro en el Vault

**Queda pendiente, anotado**
- Épicas de milestones e issues de tareas
- Transiciones de estado (In Progress / Done)
- La visibilidad del proyecto para la organización

El agente lo dice **una vez**, sugiere el paso que falta y sigue — sin workarounds
silenciosos ni reintentos infinitos.

### Cuando Jira llega: ponerse al día

1. **Proyecto Jira** — Se crea a mano según la fase 0 del bootstrap: Kanban team-managed,
   clave = PREFIJO del Vault, columna **En revisión** agregada. El conector MCP no crea
   proyectos.
2. **Conector autorizado** — Cada integrante: `/mcp` → autenticar Atlassian (OAuth, una vez
   por máquina). El destino queda en `.claude/jira.json`, commiteado y sin placeholders.
3. **Sincronización completa** — Todo el tablero del Vault se espeja de una vez: épicas de
   todos los milestones, issues de todas las tareas, estados actuales. **Idempotente**: lo
   que ya existe se actualiza, jamás se duplica.

**Prompt del catch-up** — pégalo cuando el conector ya responda:

```
El proyecto Jira <PREFIJO> ya existe y el conector está autorizado. Sincroniza
todo el tablero del Vault en Jira desde cero: tarjetas madre de todos los
milestones y issues de todas las tareas, con sus estados actuales. Verifica
idempotencia antes de crear cada issue — si algo ya existe, actualízalo en vez de
duplicarlo. Al final, repórtame el mapeo tarjeta → issue.
```

---

## 11 · Datos verificables (no los cambies)

- Versión del harness: **3.5.0**. Tag móvil vigente: **`v3`**. El tag `v2` **nunca existió**.
- Requisitos: **Node ≥ 22.4** y git. Sin registry ni token.
- El Vault es `soubunker-vault`, repo aparte con **push directo a `main`**.
- El proyecto Jira de cada proyecto del Vault usa **el mismo PREFIJO como clave**:
  `Project-SHS` → `SHS`.
- El instalador **escribe** `project` en `vault.local.json` y **siembra** la carpeta del
  proyecto si el prefijo está en el `id-registry` y la carpeta no existe.
- `00-System/id-registry.md` es la **única autoridad** sobre prefijos: no se inventan ni se
  agregan desde el CLI.

---

**Fuentes de verdad de este contenido**: `docs/bootstrap-proyecto-plantillas-prompts.md`
(el playbook por casuística), `docs/onboarding-desarrollador.md`, `progress/README.md` (el
protocolo) y las skills `jira-sync` y `harness-upgrade`.
Si esos documentos cambian, este brief se actualiza con ellos.
