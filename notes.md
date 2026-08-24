# notes.md — souclaude-harness

Scratchpad persistente del proyecto. Lo que aprendiste y no quieres volver a
aprender: gotchas del stack, comandos que nunca te acuerdas, decisiones chicas que
no merecen un ADR, cosas que probaste y no funcionaron.

Lo que **no** va acá: decisiones arquitectónicas (van en `docs/decisions/`),
requisitos de features (van en `specs/`), convenciones del proyecto (van en
`CLAUDE.md` y `docs/constitution.md`).

---

## Gotchas

- **`soutec-md-a-pdf` usa ReportLab, no WeasyPrint.** La skill de MD→PDF de marca es
  Python puro (`reportlab` + `pillow` + `markdown`); no necesita Pango/Cairo. Un spec
  viejo la daba por frágil/WeasyPrint y proponía una gemela nativa: quedó obsoleto (ver
  `docs/decisions/20260722-render-pdf-evidencia-via-skill-soutec-md-a-pdf.md`).
- **Las skills globales se montan en una ruta efímera que `python.exe` nativo no lee.**
  En Windows/Git Bash, `ls`/`cat`/`cp` (MSYS) ven `…/local-agent-mode-sessions/…/skills/…`
  pero `python.exe` da `No such file` aun con la ruta Windows correcta. Solución:
  `cp -r "<skill-base>" "$(mktemp -d)"` y correr el script desde la copia.
- **`.claude/harness.json` es el lockfile del CLI; no editarlo a mano.** Si borras o
  cambias un archivo `managed`, el lockfile queda desincronizado hasta que el CLI lo
  reconcilie (`/harness-upgrade`).
- **El banner de sección de `soutec-md-a-pdf` tiene ancho fijo (~9.6 cm).** Un título `#`
  de más de ~28 caracteres se sale del banner (texto blanco sobre blanco = ilegible).
  Mantené cortos los títulos de sección.
- **La skill no pinta badges de color** en las tablas: severidad/estado quedan como texto.
  Cabecera azul + filas cebra, sí.
- **CI corre en Node 20, pero `package.json.engines` exige `>=22.4` — y es real, no
  decorativo.** `parseArgs({ allowNegative: true })` en `src/cli.js` necesita 22.4+ para
  que `--no-vault`/`--no-backup`/cualquier flag negado no explote. Hoy ningún paso de CI
  usa un flag negado, así que el desfase no se nota. El día que alguien agregue un test o
  un paso de CI que sí lo use, va a fallar **solo en CI** y no en local (donde cada quien
  corre Node más nuevo) — el síntoma no va a apuntar a la causa. Decisión del dueño
  (SHS-H2, 2026-07-31): no se sube CI ni se baja `engines` todavía. Si tocás CI, revisa
  esto primero.
  **Corolario (SHS-H4, 2026-08-10): "en local todos corren Node nuevo" no es cierto.** En
  al menos una máquina de trabajo el `node` del PATH es **v12.20.1**
  (`C:\Program Files\nodejs`), muy por debajo de `engines`. Ahí no corre **nada** del CLI:
  el top-level `await` de `bin/cli.mjs` tira `SyntaxError: Unexpected reserved word` y
  hasta `node --check` marca falso positivo en cualquier `??`. El síntoma parece un error
  de sintaxis del código que acabás de escribir, y no lo es. Antes de debuggear un
  `SyntaxError` raro, corré `node --version`.
- **(2026-08-04, monitor de tokens) Varias líneas `assistant` comparten `message.id` y
  repiten el objeto `usage` completo.** Una respuesta con un bloque `text` y uno
  `tool_use` se escribe como dos líneas que comparten `message.id` y `requestId`, y el
  `usage` de la respuesta entera va completo en cada una. Si sumas sin deduplicar,
  el consumo se infla 2-3x. El síntoma es un número mal, no una excepción — nada revienta,
  así que no se nota sin comparar contra el total real. Deduplica por `message.id` antes
  de acumular.
- **(2026-08-04, monitor de tokens) El slug de carpeta de `~/.claude/projects/` no es
  reversible a ruta.** Espacios y acentos colapsan a `-` al generar el nombre de carpeta,
  así que no hay forma de reconstruir la ruta real del proyecto a partir del slug. La ruta
  real está en el campo `cwd` de dentro de cada línea del `.jsonl` — léela de ahí, nunca
  del nombre de carpeta.
- **(2026-08-04, monitor de tokens) Claude Code escribe el mismo proyecto a veces como
  `C:\...` y a veces como `c:\...`.** Sin normalizar la clave (unidad en minúscula antes de
  usarla como key de agrupación), el panel mostraba el mismo proyecto dos veces con el
  consumo partido entre ambas entradas.
- **(2026-08-04, monitor de tokens) Con `setRawMode(true)`, Ctrl+C deja de generar
  `SIGINT`.** Llega como el byte `\u0003` dentro del stream de teclado. Si no lo
  interceptas explícitamente, la terminal queda sin cursor y sin echo al salir — hay que
  restaurar el modo de la TTY en un `finally`, no solo al final del flujo feliz.
- **(2026-08-04, monitor de tokens) Truncar un string ya coloreado rompe el layout.**
  `picocolors` inyecta códigos de escape ANSI que `String.length` cuenta como caracteres
  pero la terminal no dibuja. Si truncas después de colorear, el ancho visual queda mal
  aunque el conteo de `.length` parezca correcto. Trunca sobre el texto plano y colorea
  después, nunca al revés.
- **(2026-08-04, monitor de tokens) Junto a cada `agent-<id>.jsonl` hay un
  `agent-<id>.meta.json` con `agentType` y una `description` legible.** Es mejor fuente
  para mostrar el tipo de subagente que `attributionAgent`, que no siempre está presente
  ni es legible para un humano.
- **(2026-08-04, monitor de tokens) `cachedUsageUtilization` de `~/.claude.json` solo se
  refresca cuando el humano corre `/usage`.** Medido con un poller sobre `fetchedAtMs`:
  cero refrescos en 12 minutos de actividad continua. `claude auth status` tampoco lo
  toca, y no existen `claude usage` ni `claude status`. El panel llegaba a mostrar un
  dato de 20-50 minutos de antigüedad como si fuera el estado actual.
- **(2026-08-04, monitor de tokens) El endpoint real de límites de plan es `GET
  https://api.anthropic.com/api/oauth/usage`**, con `Authorization: Bearer <token>` y la
  cabecera `anthropic-beta: oauth-2025-04-20`. Es el mismo que usa Claude Code, pero es
  interno y no documentado: puede romperse con cualquier actualización suya.
- **(2026-08-04, monitor de tokens) Al manejar un token, no conservar el objeto de error
  es una garantía más fuerte y más barata de auditar que sanear mensajes de excepción.**
  Un mensaje de `fetch` fallido puede arrastrar la cabecera `Authorization` completa; en
  vez de intentar limpiar ese mensaje, `usage-fetcher.js` directamente no lo guarda en
  ningún lado — el `catch` devuelve `null` y listo.
- **(2026-08-04, monitor de tokens) `~/.claude/.credentials.json` no es solo el token de
  Claude: guarda los tokens OAuth de todos los conectores MCP de terceros** (GitHub,
  Slack, Notion, Figma, Datadog...). Es probablemente el archivo más sensible de la
  máquina — cualquier código que lo lea debe extraer un solo campo
  (`claudeAiOauth.accessToken`) y dejar morir el resto del objeto parseado en el mismo
  scope, sin que sobreviva al closure ni al valor de retorno.

## Comandos útiles

```bash
# Render de un .md a PDF con identidad Soutec (deps: pip install reportlab pillow markdown)
WORK="$(mktemp -d)"; cp -r "<skill-base>"/* "$WORK"/
python3 "$WORK/scripts/md_to_pdf.py" informe.md informe.pdf
rm -rf "$WORK"
```

## Descartado (y por qué)

- **Renderer embebido `render_security_report.py`** — eliminado en PLN-002: duplicaba el
  render de marca. Tenía badges de color y no dependía de nada, pero divergía del look
  oficial (sin isotipo/contraportada). Si hace falta un fallback sin la skill, está en el
  historial de git.
- **Skill gemela `soutec-md-a-pdf-nativo`** — no se creó: `soutec-md-a-pdf` ya es nativa.

## 2026-08-24 — SHS-M14 resuelto: `node --test` en paralelo corrompe su propio pipe IPC en ubuntu + Node 22

Diagnóstico de la causa raíz del "Unable to deserialize cloned data" que hacía
fallar `test/monitor-cmd.test.js` de forma no determinista, solo en
`ubuntu-latest` + Node 22. **No es un bug del código del test**: el propio
archivo ya evita el patrón peligroso conocido (interceptar `process.stdout.write`
global con un `await` en medio, documentado en su propia cabecera desde antes).

La causa real: `node --test` corre los archivos de test **en paralelo** por
defecto (concurrencia = CPUs disponibles), y cada proceso hijo le reporta al
proceso padre vía un canal IPC que usa serialización estructurada (V8
`structured clone`) sobre el mismo pipe de stdout del hijo. En Linux, con
varios procesos hijos activos a la vez, esto deja una ventana de carrera donde
el runner mismo corrompe su propio canal — no el test. Windows no lo reproduce
(comportamiento de pipes distinto) y Node 24 tampoco (cambios internos del test
runner entre versiones).

Fix: `npm run test:ci` (`node --test --test-concurrency=1`), usado solo en el
workflow de CI. `npm test` local queda sin tocar — en paralelo, rápido, y no
reproduce el bug de todos modos.

## 2026-08-24 — `check-pr-rules.mjs` (rama-formato) tuvo dos falsos positivos al debutar

Al distribuirse por primera vez (SHS-M17) contra PRs reales, `rama-formato` rechazó
dos casos legítimos que el regex no contemplaba:
1. **El PR de release `dev` → `main`**: la rama origen es literalmente `dev`, que
   nunca va a cumplir `tipo/descripcion-corta` (no es una rama de trabajo). Fix:
   excepción explícita `nombre === 'dev' && baseRefName === 'main'` (PR #48).
2. **Puntos en el slug**: `chore/bump-3.6.0` fallaba porque el regex solo admitía
   `[a-z0-9-]+`. Había precedente ya mergeado con puntos (`feature/SHS-M15-T001-bump-3.5.0`,
   previo a este check) y la skill `soutec-github` no los prohíbe. Fix: agregar `.` a
   la clase de caracteres (PR #49).

Moraleja: un check nuevo que reimplementa una convención documentada en prosa
(la skill) va a divergir de casos reales que la prosa nunca prohibió explícitamente.
Antes de exigir un check nuevo en CI, correrlo primero contra el historial real de
ramas mergeadas (`git log --all --format='%D' | grep -o 'origin/[^,]*'`) para
detectar estos huecos sin esperar a que un PR real los encuentre.

## 2026-08-24 — SHS-M18-T001: pendiente espejo a Jira (conector no autenticado)

Se movió SHS-M18-T001 a "En curso" en `Project-SHS/kanban.md` (backfill de archivos
base del Vault en `upgrade`). El conector MCP de Atlassian no está autenticado en
esta sesión (`ToolSearch` no devuelve `mcp__atlassian__searchJiraIssuesUsingJql` ni
el resto de las herramientas de Jira, solo `authenticate`/`complete_authentication`).
Pendiente: la próxima sesión con el conector autorizado debe reflejar en Jira este
movimiento (crear/transicionar el issue hijo de la épica SHS-M18 a In Progress).

## 2026-08-10 — Optimización de consumo de tokens
La telemetría de SHS-H3 mostró tareas estándar de 243k-319k tokens de salida. Causas:
contexto fijo grande (conectores MCP + relecturas completas de constitución/spec por cada
subagente) y rework (1 devolución ≈ duplica el costo del task). Cambios aplicados: sección
"Economía de tokens" en CLAUDE.md, tier `haiku` para tareas mecánicas en ccem-model-router,
reglas de lectura mínima en los 4 agentes, pre-flight anti-rework en el orchestrator.
Pendiente humano: desconectar conectores de claude.ai que este repo no usa.

## 2026-08-24 — jira-sync pendiente para SHS-M19
Alta de SHS-M19 (tag automático al mergear a main) en el Vault hecha y pusheada,
pero el conector MCP de Atlassian no está autorizado en esta sesión (no aparecen
herramientas Jira). Falta crear la épica SHS-M19 en Jira — próxima sesión con el
conector autorizado (`/mcp` → autenticar Atlassian), correr `jira-sync` sobre esta
tarjeta.
