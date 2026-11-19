# Guía de prueba: el harness en Antigravity

Antes de empezar, prepara el repo de prueba como indica el [README](README.md).
Abre ese repo como workspace en Antigravity. Anota la versión y cuál de las tres
superficies usas (App, IDE o CLI): los hooks se configuran igual en las tres, pero
conviene saber en cuál se probó.

Lo que el harness instaló para Antigravity:

- `AGENTS.md`, que remite a `CLAUDE.md`.
- `.agents/skills/`, con las skills.
- `.agents/hooks.json`, que registra dos hooks.
- `.agents/hooks/souclaude-antigravity.mjs`, un adaptador: Antigravity entrega y
  espera los datos del hook en un formato distinto al de Claude Code, y este
  archivo traduce entre los dos. La lógica real está en `.claude/hooks/`.

## Prueba 1 — Las instrucciones se cargan

En una conversación nueva, pregunta:

> ¿Qué reglas de Git tiene este repo? ¿Puedo hacer push directo a main?

**Esperado:** responde con las reglas de `CLAUDE.md` (rama + Pull Request, nunca
push a `main`, ramas `tipo/slug`, commits `tipo: descripción`) y contesta en español.

**Lo que hay que observar:** si leyó `CLAUDE.md` por su cuenta al empezar, si lo
leyó recién cuando le preguntaste, o si respondió solo con lo que dice `AGENTS.md`.
Revisa también en Customizations > Rules si `AGENTS.md` figura como regla cargada.

## Prueba 2 — Las skills aparecen

Abre Customizations y busca las skills del workspace.

**Esperado:** aparecen las de `.agents/skills/`: `soutec-github`, `adr-new`,
`harness-upgrade`, `soutec-md-a-pdf`, `it-security-review`,
`security-report-standard`, `vault-milestones`, `jira-sync` y `azdo-sync`.

Después pídele algo que debería activar una:

> Necesito documentar una decisión de arquitectura: vamos a usar PostgreSQL en vez de MongoDB.

**Esperado:** usa la skill `adr-new` y propone un archivo en `docs/decisions/`.

## Prueba 3 — Las skills que solo corren a pedido

`it-security-review` está marcada para correr **solo cuando el usuario la invoca**.
Esa marca (`disable-model-invocation`) es un campo de Claude Code y no sabemos si
Antigravity lo respeta. Pídele algo genérico de seguridad, sin nombrar la skill:

> Revisa si este repo tiene algún problema de seguridad.

**Esperado:** Antigravity **no** ejecuta `it-security-review` por su cuenta.

**Si la ejecuta:** anótalo. Es una brecha conocida.

## Prueba 4 — Los hooks están registrados

Abre el panel de hooks (App: Settings > Customizations > Hooks; IDE: panel lateral
del agente, Customizations > Hooks; CLI: `/hooks`).

**Esperado:** aparecen dos hooks del workspace, `souclaude-reglas-pr` y
`souclaude-inicio-de-sesion`, ambos habilitados.

Anota si Antigravity te pidió aprobar o confiar en los hooks del workspace antes
de ejecutarlos. La documentación no lo aclara.

## Prueba 5 — El hook de inicio de sesión

Abre una conversación nueva y pregunta:

> ¿Sobre qué milestone vamos a trabajar?

**Esperado:** Antigravity conoce la regla de trazabilidad («todo trabajo pertenece
a un milestone del Vault») sin haberla leído de un archivo. En un repo de prueba
sin Vault, además debería decir que el Vault no está configurado en esta máquina.

## Prueba 6 — El push a `main` se bloquea

Esta es la prueba más importante. Estando en la rama `feature/prueba`, pídele:

> Ejecuta exactamente este comando en la terminal: git push origin main

**Esperado:** el comando **no se ejecuta**. Antigravity muestra un motivo que
empieza con `reglas-pr (SHS-M42): push a main denegado`.

El repo de prueba no tiene remoto, así que si el hook no actúa verás un error de
git (`'origin' does not appear to be a git repository`) en vez del mensaje del
harness. Eso cuenta como fallo de la prueba, y no rompe nada.

Prueba también que un comando normal pasa sin demora ni mensajes:

> Ejecuta: git status

Si el push no se bloqueó, corre esto en una terminal del repo y pega la salida en
tu reporte. Simula lo que Antigravity debería enviarle al hook:

```bash
echo '{"toolCall":{"name":"run_command","args":{"CommandLine":"git push origin main"}}}' | node .agents/hooks/souclaude-antigravity.mjs reglas-pr
```

Si ahí sí sale `{"decision":"deny",...}`, el adaptador funciona y el problema está
en cómo Antigravity lo invoca: el nombre real de la herramienta de terminal, la
carpeta desde la que corre el hook o el formato de `.agents/hooks.json`.

## Prueba 7 — Un secreto no se sube

```bash
echo "TOKEN=abc123" > .env.staging
git add -f .env.staging && git commit -m "chore: prueba de secreto"
```

Y pídele a Antigravity:

> Ejecuta exactamente: git push -u origin feature/prueba

**Esperado:** el push se deniega y el motivo nombra `.env.staging`.

Al terminar, deshaz el commit: `git reset --hard HEAD~1`.

## Prueba 8 — Windows (solo si usas Windows)

Repite la prueba 6 con un comando encadenado y anota qué shell usa Antigravity en
su terminal (PowerShell, cmd, Git Bash):

> Ejecuta exactamente: cd . ; git push origin main

El adaptador supone PowerShell en Windows. Si es otra, dilo.

## Lo que sabemos que falta

No hace falta reportarlo, ya está identificado:

- **El check automático tras crear un Pull Request no corre en Antigravity.** En
  Claude Code y Codex, al crear el PR se validan las reglas y el resultado vuelve
  al agente. Aquí hay que correrlo a mano:
  `node .claude/hooks/reglas-pr.mjs --pr <url-del-pr>`.
- Los permisos de Claude Code (por ejemplo, la regla que impide leer `.env`) no
  tienen traducción a Antigravity todavía.
- Los conectores MCP (`.mcp.json`, usados por `jira-sync` y `azdo-sync`) no se
  registran para Antigravity.

## Tabla de resultados

Copia y completa:

```
Herramienta, superficie (App / IDE / CLI) y versión:
Sistema operativo:
Fecha:

| # | Prueba                                   | Resultado (OK / Falla / Parcial) | Notas |
|---|------------------------------------------|----------------------------------|-------|
| 1 | Instrucciones (leyó CLAUDE.md: ¿cuándo?) |                                  |       |
| 2 | Skills visibles y adr-new se activa      |                                  |       |
| 3 | it-security-review no corre sola         |                                  |       |
| 4 | Hooks visibles y habilitados             |                                  |       |
| 5 | Inicio de sesión: regla de milestone     |                                  |       |
| 6 | Push a main bloqueado                    |                                  |       |
| 7 | Secreto bloqueado                        |                                  |       |
| 8 | Windows: shell de la terminal            |                                  |       |

Algo de la guía que no coincide con tu herramienta:
Lo que más te estorbó o te sorprendió:
```
