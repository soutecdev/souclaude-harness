# Bootstrap de un proyecto SOUTEC desde cero — plantillas de prompts

Secuencia reutilizable para levantar un proyecto nuevo con el harness `souclaude`, el Vault y Jira. Derivada de la puesta en marcha de **Chatbot Spacar** (19-ago-2026), incluidos los tropiezos reales de esa corrida.

Cada fase trae: el prompt para copiar, qué te va a preguntar el agente, qué debe quedar hecho al terminar, y los errores conocidos que hay que esquivar.

Las fases 0–6 describen el caso base (proyecto nuevo desde cero). Las demás casuísticas reutilizan estas fases y están al final del documento:

| Casuística | Sección |
|---|---|
| Proyecto nuevo desde cero | Fases 0–6 |
| Repo existente que adopta el harness | Casuística 2 |
| Integrante nuevo en proyecto adoptado | Casuística 3 (→ guía de onboarding) |
| Máquina nueva | Casuística 4 |
| Actualizar el harness | Casuística 5 (→ skill `harness-upgrade`) |
| Proyecto sin Jira todavía | Casuística 6 |

---

## Cómo usar este documento

1. Rellena la tabla de variables de abajo.
2. Sustituye los `{{PLACEHOLDER}}` en cada prompt antes de pegarlo.
3. Ejecuta las fases **en orden**, empezando por la 0. La 3 depende de la 2, y la 6 de la 4 y la 5.
4. No pegues varias fases juntas: cada una tiene puntos de decisión que conviene resolver antes de seguir.

### Variables

| Variable | Qué es | Ejemplo |
|---|---|---|
| `{{REPO}}` | Nombre del repositorio en GitHub | `chatbot-spacar` |
| `{{PROYECTO}}` | Nombre legible del proyecto | `Chatbot Spacar` |
| `{{PREFIJO}}` | Prefijo de 2-4 letras. Nombra `Project-<PREFIJO>/` en el Vault **y** es la clave del proyecto en Jira | `CSC` |
| `{{RUTA_LOCAL}}` | Dónde vive el repo en tu disco. **Fuera de OneDrive** | `C:\Users\tu-usuario\dev\chatbot-spacar` |
| `{{RUTA_VAULT}}` | Dónde clonas el Vault. **Fuera de OneDrive** | `C:\Users\tu-usuario\dev\soubunker-vault` |
| `{{HARNESS_REPO}}` | Repo del harness | `https://github.com/ialvarezsoutec/souclaude-harness` |
| `{{VAULT_REPO}}` | Repo del Vault | `https://github.com/ialvarezsoutec/soubunker-vault` |
| `{{JIRA_SITE}}` | Sitio de Atlassian | `https://dev-soutec.atlassian.net` |

### Prerrequisitos de máquina

Verifícalos antes de empezar; si falta alguno, las fases fallan a mitad de camino:

- `gh` instalado y autenticado (`gh auth status`).
- Node **≥ 22.4** (el harness lo exige; su `.nvmrc` pide 24).
- Acceso de escritura al repo del Vault.

Las decisiones y altas previas (prefijo, visibilidad, proyecto Jira) van en la
**Fase 0**. El conector MCP de Atlassian se autoriza recién en la **fase 5**: el
`.mcp.json` que lo habilita lo instala el harness en la fase 2, antes no existe.

---

## Fase 0 · Decisiones previas (sin agente)

Todo lo de esta fase es de las personas, no del agente: son las decisiones de
"Lo que no se delega". Resolverlas ahora evita que las fases siguientes se frenen
a mitad de camino esperando una respuesta.

| Decisión | Quién | Qué dejar resuelto |
|---|---|---|
| Visibilidad del repo | Coordinador + dueño | Privado salvo razón explícita; público es irreversible en la práctica |
| Prefijo `{{PREFIJO}}` | Coordinador | 2-4 letras, **libre** en `00-System/id-registry.md` del Vault; es para siempre |
| Stack inicial | Dueño del proyecto | Si no está decidido, se pedirá andamiaje genérico en la fase 1 |
| Rutas locales | Cada integrante | `{{RUTA_LOCAL}}` y `{{RUTA_VAULT}}` **fuera de OneDrive** |
| Proyecto en Jira | Quien tenga permisos en el sitio | Ver el paso a paso de abajo |

**Crear el proyecto en Jira** (manual, ~2 minutos — el conector MCP de Atlassian
no expone creación de proyectos, así que el agente no puede hacerlo):

1. En `{{JIRA_SITE}}`: **Proyectos → Crear proyecto → Kanban** (gestionado por
   el equipo / team-managed).
2. Nombre: `{{PROYECTO}}`. Clave: **`{{PREFIJO}}`** — la misma del Vault; esa
   igualdad es la convención en la que descansa `jira-sync`.
3. Al tablero por defecto (Por hacer / En curso / Listo) agrégale la columna
   **En revisión**, entre En curso y Listo. Si no existe, `jira-sync` degrada
   "En review" a En curso y el espejo pierde fidelidad.

---

## Fase 1 · Repositorio y andamiaje base

```
Crea en GitHub un repositorio para el proyecto que se llame {{REPO}} y encárgate de
la configuración local inicial y del primer commit/push.

El proyecto es: {{PROYECTO}}.

Antes de crear nada, verifica si el repositorio ya existe: si existe y está vacío,
reutilízalo en vez de duplicarlo. Trabaja en {{RUTA_LOCAL}}.
```

**Te va a preguntar:** visibilidad (privado salvo que haya razón para lo contrario) y stack. Si el stack no está decidido, pide un andamiaje genérico: es preferible a condicionar la arquitectura antes de tiempo.

**Debe quedar:** `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`, `README.md`, primer commit y push.

> **Ojo — OneDrive.** Si el repo queda dentro de una carpeta sincronizada, OneDrive sincroniza también `.git/` y eso corrompe el índice y genera copias en conflicto. Trabaja fuera del área sincronizada.

---

## Fase 2 · Instalar el harness

```
Quiero instalar el harness de Claude Code de SOUTEC en este proyecto. Vive en
{{HARNESS_REPO}}.

Antes de ejecutar nada:
1. Verifica qué tags y ramas existen realmente. El comando que documenta el README
   puede apuntar a un tag que todavía no está publicado.
2. Corre un --dry-run y muéstrame el plan antes de escribir un solo byte.
3. Si instalas desde una rama en vez de un tag, anota el commit exacto en el mensaje
   del commit: las ramas se mueven y el lockfile no lo registra.

Confírmame desde qué ref vas a instalar antes de hacerlo.
```

**Debe quedar:** `CLAUDE.md`, `.claude/` (settings, skills, hook, lockfile), `.github/` (plantilla de PR y CODEOWNERS), `docs/decisions/`, `progress/`, `notes.md`, y el bloque gestionado añadido al `.gitignore` sin tocar tus líneas.

> **Nota de versión.** El tag `v3` existe desde el release **v3.5.0** (21-ago-2026) y es el que hay que usar. Antes de esa fecha no existía —los tags publicados llegaban a `v2.4.0` y v3.x vivía en `dev`—, así que un proyecto instalado desde `dev` en ese período debe repuntar a `#v3` y correr `souclaude upgrade --prune`. Lo mismo para los que quedaron en `#v1`: el tag móvil `v2` nunca se creó.

---

## Fase 3 · Adoptar el flujo Git (la fase que se olvida)

El harness no es solo archivos: trae reglas que cambian cómo se trabaja **desde ese momento**, incluso sobre lo que ya hiciste. Ejecútala antes de commitear la fase 2.

```
Ya instalaste el harness, así que ahora rige la skill soutec-github. Léela completa y
reencuadra el trabajo según esas reglas antes de commitear:

1. Crea la rama dev si no existe. main solo recibe merges desde dev.
2. Mueve el trabajo del harness a una rama propia nacida de dev, con PR contra dev.
3. Revisa si algo que ya escribiste (README incluido) contradice la guía y corrígelo
   en el mismo cambio.
4. Corre /security-review antes de abrir el PR y documenta los hallazgos.
5. Completa la plantilla de PR de verdad: las casillas que no apliquen se dejan sin
   marcar y explicadas, y las secciones que no apliquen se omiten enteras.

No mergees el PR: dime cuándo está listo.
```

**Debe quedar:** ramas `main` y `dev` en remoto, rama de trabajo con PR abierto contra `dev`, plantilla completada y security review documentado.

> **Por qué importa.** En la corrida original el primer commit fue directo a `main` y el README afirmaba que las ramas entraban a `main` por PR — las dos cosas contra la guía. Se detectó justo aquí. Sin esta fase, el proyecto arranca con el método equivocado y se propaga.

---

## Fase 4 · Conectar el Vault y dar de alta el proyecto

```
Conecta el Vault a este proyecto y da de alta Project-{{PREFIJO}}.

1. Clona {{VAULT_REPO}} en {{RUTA_VAULT}} (fuera de OneDrive) y conéctalo con
   souclaude upgrade --vault-path.
2. Verifica que el prefijo {{PREFIJO}} esté registrado en 00-System/id-registry.md.
   Si no lo está, agrégalo — solo agregar filas, nunca editar las ajenas.
3. Crea Project-{{PREFIJO}}/ con milestones.md, kanban.md, sessions.md y plans/,
   replicando el formato real de un proyecto existente del Vault, no el de la
   documentación.
4. Comprueba que el hook de SessionStart lee el tablero. Si no lo encuentra,
   arréglalo.
5. Pushea directo a main del Vault: ese repo no usa PR.

Los tableros nacen vacíos: no inventes milestones.
```

**Debe quedar:** el hook imprimiendo el tablero de `Project-{{PREFIJO}}` al arrancar.

> **Problema conocido.** `souclaude upgrade --vault-path` escribe solo `path` y `repo` en `.claude/vault.local.json`. Falta `project`, y el hook únicamente autodetecta la carpeta cuando el Vault tiene **un solo** `Project-*`. Con dos o más queda ciego y **no da error**. Añádelo a mano:
>
> ```json
> {
>   "path": "{{RUTA_VAULT}}",
>   "repo": "{{VAULT_REPO}}",
>   "project": "Project-{{PREFIJO}}"
> }
> ```
>
> Ese archivo está ignorado a propósito: la ruta es de cada máquina, así que **cada integrante repite este paso en la suya**.

---

## Fase 5 · Configurar el espejo en Jira

```
Configura el proyecto Jira destino de este repositorio.

- Sitio: {{JIRA_SITE}}, proyecto {{PREFIJO}} (la convención es projectKey = prefijo
  del Vault).
- Actualiza .claude/jira.json y verifica que el conector MCP de Atlassian responde y
  que el proyecto existe.
- El cambio va por rama y PR contra dev, con /security-review previo.
```

**Debe quedar:** `.claude/jira.json` sin placeholders y el conector verificado.

> **Al llegar aquí, autoriza el conector**: escribe `/mcp` en una sesión interactiva y autentica Atlassian. Es OAuth — el agente no puede hacerlo por ti, y antes de la fase 2 no existía el `.mcp.json` que lo habilita. El proyecto Jira destino ya debe existir (Fase 0): la skill `jira-sync` sincroniza issues *dentro de* un proyecto existente, no lo crea.
>
> Si el conector no está autorizado, no bloquea: el trabajo local y el Vault siguen, y el espejo pendiente queda anotado en `notes.md`.

---

## Fase 6 · Primer milestone

```
Crea el primer milestone del proyecto: definir los milestones del proyecto.

Declara sobre qué milestone vas a trabajar antes de tocar nada. El milestone va a En
curso con su plan en plans/ y sus tareas en el kanban — un milestone En curso sin plan
es una inconsistencia que la propia skill vault-milestones marca.

Las tareas salen de las decisiones pendientes reales del proyecto, no de suposiciones.
Sincroniza con Jira en el mismo flujo: Vault primero, Jira inmediatamente después, y
verifica idempotencia antes de crear issues. Cierra con la línea de sesión en
sessions.md.
```

**Debe quedar:** milestone `{{PREFIJO}}-M1` En curso con plan `P1`, su rama `feature/M1-<slug>` creada desde `dev` (una rama por milestone; las tareas son commits en ella) y tareas `{{PREFIJO}}-M1-T00n`; los issues correspondientes en Jira con la etiqueta del milestone; y la línea de sesión registrada.

> **Cómo se ve el milestone en Jira.** Desde SHS-M7-T005, cada milestone tiene su **tarjeta madre**: un issue propio (labels `<PREFIJO>-M<n>` + `milestone`) con la descripción del milestone, y sus tareas vinculadas con "relates to". Un milestone sin tareas igualmente aparece en Jira como su tarjeta madre en To Do.

---

## Casuística 2 · Repo existente que adopta el harness

La secuencia es la misma salvo el arranque: **la fase 1 no aplica** (el repo ya
existe) y la **fase 2 cambia de comandos**. Las fases 0, 3, 4, 5 y 6 se ejecutan
igual que arriba — la 3 es todavía más importante aquí, porque el repo trae
historia y costumbres propias que probablemente contradigan la guía.

Antes de empezar, dos verificaciones:

- El repo está **fuera de OneDrive**. Si vive en una carpeta sincronizada,
  muévelo primero (mismo motivo que en la fase 1).
- Decide en la fase 0 el prefijo y el proyecto Jira igual que para un proyecto
  nuevo: la adopción no exime de nada de eso.

La fase 2 se bifurca según lo que el repo ya tenga:

**Ruta A — el repo no tiene nada de Claude** (ni `CLAUDE.md` ni `.claude/`):
se instala directo. `souclaude init` detecta el repo existente y emite **solo la
superficie Claude** — no toca el código del proyecto.

```
Quiero instalar el harness de Claude Code de SOUTEC en este proyecto ya existente.
Vive en {{HARNESS_REPO}}.

Este repo no tiene superficie Claude previa. Antes de ejecutar nada verifica qué
tags y ramas existen realmente, corre un --dry-run y muéstrame el plan. Confirma
que el plan emite solo la superficie Claude y no toca el código del proyecto.
```

**Ruta B — el repo ya tiene estructura previa** (un `CLAUDE.md` escrito a mano,
una copia vieja del Kit, skills sueltas): **no instales encima**. El comando
`souclaude adopt` existe para esto: no escribe ni un archivo salvo el lockfile
(`.claude/harness.json`) — registra qué archivos ya coinciden byte a byte con el
harness y deja en paz el resto.

```
Este repo ya tiene estructura Claude hecha a mano y quiero adoptarlo al harness
de SOUTEC ({{HARNESS_REPO}}) sin perder nada de lo que hay.

1. Corre souclaude adopt --dry-run y muéstrame el plan: qué archivos ya coinciden
   con el harness y cuáles difieren.
2. Ejecuta souclaude adopt y después souclaude upgrade --dry-run.
3. Ejecuta souclaude upgrade: lo que difiera del harness debe quedar como
   propuesta en archivos .new al lado del original, nunca pisado.
4. Lístame los .new generados con un resumen de qué cambia en cada uno, y los
   mergeamos juntos: yo decido qué se conserva de lo viejo.
```

**Debe quedar:** la misma superficie que en la fase 2 normal, más el merge
resuelto de cada `.new` (sin `.new` huérfanos en el árbol).

> **Por qué adopt y no init.** Adoptar un archivo modificado sería decirle al
> próximo `upgrade` "esto es salida intacta del harness, písalo tranquilo" — y le
> borraría el trabajo al equipo. `adopt` solo reclama lo byte-idéntico; todo lo
> demás pasa por `.new` y decisión humana. Si el repo ya tiene un harness
> instalado (existe `.claude/harness.json`), `adopt` no hace nada y el camino es
> `souclaude upgrade`.

Después de la fase 2, sigue con la **fase 3** tal cual está arriba, con un
énfasis extra: pide además que el agente revise las costumbres ya instaladas
(¿se commiteaba directo a `main`? ¿existe `dev`? ¿el README describe otro flujo?)
y las reencuadre en el mismo cambio.

---

## Casuística 3 · Integrante nuevo en un proyecto ya adoptado

No repitas nada de este playbook: el proyecto ya está montado. El camino es otro
documento — **`docs/onboarding-desarrollador.md`** (la guía de la metodología:
las tres piezas, la regla de trazabilidad, el ciclo diario). Léela primero de
punta a punta; después ejecuta la **casuística 4** para dejar tu máquina lista.

Lo único que el proyecto debe darte de antemano: acceso de escritura al repo del
proyecto y al Vault, y usuario en el sitio Jira. Eso es del coordinador, no tuyo.

---

## Casuística 4 · Máquina nueva (integrante nuevo o existente)

Todo lo de esta lista es **por máquina**, no por proyecto — si ya trabajas en
otra máquina, nada de esto se hereda solo. En orden:

1. **Requisitos**: Node ≥ 22.4, git, y `gh` autenticado (`gh auth status`; el
   paso a paso del login está en la guía de onboarding).
2. **Clona el repo del proyecto** en una ruta **fuera de OneDrive**.
3. **Clona el Vault** ({{VAULT_REPO}}) también fuera de OneDrive y conéctalo:
   `npx souclaude upgrade --vault-path {{RUTA_VAULT}}`.
4. **Añade a mano `"project"`** a `.claude/vault.local.json` (problema conocido
   de la fase 4: el CLI no lo escribe y el hook queda ciego en silencio si el
   Vault tiene más de un proyecto):

   ```json
   { "path": "{{RUTA_VAULT}}", "repo": "{{VAULT_REPO}}", "project": "Project-{{PREFIJO}}" }
   ```

5. **Autoriza el conector Jira**: `/mcp` en sesión interactiva → autenticar
   Atlassian (OAuth, una vez por máquina).
6. **Verifica**: abre una sesión nueva — el hook de SessionStart debe imprimir el
   tablero de `Project-{{PREFIJO}}`. Si no lo hace, el paso 3 o 4 quedó mal.

Prompt de verificación para cerrar:

```
Verifica que esta máquina quedó bien conectada a la metodología: gh autenticado,
Vault clonado y conectado con el campo project en vault.local.json, conector de
Atlassian respondiendo y hook de sesión leyendo el tablero. Repórtame qué está
bien y qué falta, sin arreglar nada todavía.
```

---

## Casuística 5 · Actualizar el harness en un proyecto ya adoptado

No uses este playbook: el flujo vive en la skill **`harness-upgrade`** y en el
comando `souclaude upgrade` (con `souclaude status` para ver qué cambió antes).
Regla de siempre: el upgrade va por rama + PR contra `dev`, como cualquier cambio.

> Mientras el tag `v3` no esté publicado (problema 1), los upgrades llegan desde
> la rama `dev`: anota el commit exacto en el mensaje, igual que en la fase 2.

---

## Casuística 6 · Proyecto sin Jira (o conector sin autorizar)

La metodología degrada a propósito: **Jira nunca bloquea el trabajo local**. Sin
proyecto Jira o sin conector autorizado, todo lo demás sigue igual — Vault,
milestones, kanban, sesiones — y cada espejo pendiente queda anotado en
`notes.md` para la próxima sesión con conector.

Cuando Jira llegue (proyecto creado según la fase 0, conector autorizado según la
fase 5), se ponen al día los espejos con una sincronización completa:

```
El proyecto Jira {{PREFIJO}} ya existe y el conector está autorizado. Sincroniza
todo el tablero del Vault en Jira desde cero: tarjetas madre de todos los
milestones y issues de todas las tareas, con sus estados actuales. Verifica
idempotencia antes de crear cada issue — si algo ya existe, actualízalo en vez de
duplicarlo. Al final, repórtame el mapeo tarjeta → issue.
```

---

## Prompts auxiliares

**Aprobar un merge** (el autor no mergea; esto lo dice el coordinador):

```
Mergea el PR #{{N}} con squash & merge. Asegúrate de que el commit resultante conserve
el cuerpo del mensaje: el squash genera un commit nuevo.
```

**Corregir un PR ya abierto:**

```
Aplica estas correcciones al PR #{{N}} y pushea a la misma rama — nunca abras un PR
nuevo, rompe la trazabilidad: {{CORRECCIONES}}
```

**Auditar el tablero:**

```
Analiza el tablero de Project-{{PREFIJO}} en el Vault: foto del estado,
inconsistencias y diagnóstico. Repórtalo, no lo ejecutes: propón y yo decido.
```

---

## Verificación final

- [ ] `main` y `dev` existen en remoto; `main` solo recibió merges desde `dev`.
- [ ] `souclaude status` sale con exit code 0.
- [ ] El hook de `SessionStart` imprime el tablero de `Project-{{PREFIJO}}`.
- [ ] `.claude/vault.local.json` tiene el campo `project`.
- [ ] `.claude/jira.json` sin placeholders y conector verificado.
- [ ] Prefijo `{{PREFIJO}}` registrado en `id-registry.md`.
- [ ] Milestone en curso con plan y tareas; issues espejados en Jira.
- [ ] Línea de sesión en `sessions.md`.
- [ ] Nada sensible commiteado (`.env`, claves, tokens).

---

## Lo que no se delega

Decisiones que el agente debe consultar, no resolver solo:

| Decisión | Por qué |
|---|---|
| Visibilidad del repositorio | Público es irreversible en la práctica: queda indexado |
| Prefijo del proyecto | Es para siempre; nombra el Vault y Jira, y no se reutiliza |
| Alcance de cada milestone | El tablero refleja compromisos reales, no suposiciones |
| Merge y aprobación de PR | El autor no mergea ni aprueba lo suyo |
| Autorización del conector MCP | Es OAuth: solo la persona puede |

---

## Problemas abiertos del harness (19-ago-2026)

Cuatro cosas que van a repetirse en cada proyecto hasta que se arreglen en origen:

1. **El tag `v3` no existe.** El comando de instalación del README falla tal cual está escrito. *(Pendiente a propósito: el tag se publica cuando todo esté listo.)*
2. **`upgrade --vault-path` no escribe el campo `project`.** El hook queda ciego en silencio en cuanto el Vault tiene más de un proyecto.
3. **`CODEOWNERS` referencia equipos `@org-soutec/...`**, que solo existen en organizaciones de GitHub. En una cuenta personal nunca resuelven: la aprobación obligatoria **no se aplica y no avisa**. Sumado a la falta de branch protection, la regla de "el coordinador mergea" queda sin respaldo técnico. *(En camino: la organización va a incorporar seguridad en los repos vía cuentas de equipo de GitHub — al migrar, los equipos de CODEOWNERS resuelven y este problema y su raíz desaparecen.)*
4. ~~**El prefijo `SHS` no está en `id-registry.md`**~~ **Resuelto** (20-ago-2026): registrado en el Vault.

Los cuatro tienen la misma raíz en el caso 3: mientras los repositorios vivan en una cuenta personal y no en una organización de GitHub, el gobierno que la metodología describe no puede aplicarse técnicamente.
