# Guía de prueba: el harness en Codex

Antes de empezar, prepara el repo de prueba como indica el [README](README.md).
Abre Codex en la raíz de ese repo. Anota la versión (`codex --version`): varias de
estas funciones dependen de ella.

Lo que el harness instaló para Codex:

- `AGENTS.md`, que remite a `CLAUDE.md`.
- `.agents/skills/`, con las skills.
- `.codex/hooks.json`, que registra tres hooks. Todos ejecutan scripts de
  `.claude/hooks/` con `node`.

## Prueba 1 — Las instrucciones se cargan

Pregúntale a Codex, en una sesión nueva:

> ¿Qué reglas de Git tiene este repo? ¿Puedo hacer push directo a main?

**Esperado:** responde con las reglas de `CLAUDE.md` (rama + Pull Request, nunca
push a `main`, ramas `tipo/slug`, commits `tipo: descripción`) y contesta en español.

**Lo que hay que observar:** si leyó `CLAUDE.md` por su cuenta al empezar, si lo
leyó recién cuando le preguntaste, o si no lo leyó y respondió solo con lo que dice
`AGENTS.md`. Esa diferencia es el dato más importante de esta prueba.

## Prueba 2 — Las skills aparecen

Lista las skills disponibles (en la interfaz de Codex, `/skills` o el selector `$`).

**Esperado:** aparecen las de `.agents/skills/`: `soutec-github`, `adr-new`,
`harness-upgrade`, `soutec-md-a-pdf`, `it-security-review`,
`security-report-standard`, `vault-milestones`, `jira-sync` y `azdo-sync`.

Después pídele algo que debería activar una:

> Necesito documentar una decisión de arquitectura: vamos a usar PostgreSQL en vez de MongoDB.

**Esperado:** usa la skill `adr-new` y propone un archivo en `docs/decisions/`.

## Prueba 3 — Las skills que solo corren a pedido

`it-security-review` está marcada para correr **solo cuando el usuario la invoca**.
Esa marca (`disable-model-invocation`) es un campo de Claude Code y no sabemos si
Codex lo respeta. Pídele algo genérico de seguridad, sin nombrar la skill:

> Revisa si este repo tiene algún problema de seguridad.

**Esperado:** Codex **no** ejecuta `it-security-review` por su cuenta.

**Si la ejecuta:** anótalo. Es una brecha conocida y hay que resolverla con el
mecanismo propio de Codex.

## Prueba 4 — Los hooks están registrados y hay que confiarlos

Abre `/hooks` en Codex.

**Esperado:** aparecen tres hooks del proyecto: uno de `SessionStart`
(`declarar-milestone.mjs`) y dos de `reglas-pr.mjs` (`PreToolUse` y `PostToolUse`
sobre `Bash`). Según la documentación, Codex los marca como no confiables y **los
omite hasta que los revisas y los apruebas**.

Apruébalos y anota:

- Si el proyecto también tuvo que marcarse como confiable.
- Si después de aprobarlos hizo falta reiniciar la sesión.
- Si en tu versión hubo que activar algo en la configuración para que los hooks
  existan (por ejemplo `hooks = true` en `[features]` de `config.toml`).

## Prueba 5 — El hook de inicio de sesión

Con los hooks aprobados, abre una sesión nueva y pregunta:

> ¿Sobre qué milestone vamos a trabajar?

**Esperado:** Codex conoce la regla de trazabilidad («todo trabajo pertenece a un
milestone del Vault») sin haberla leído de un archivo. En un repo de prueba sin
Vault, además debería decir que el Vault no está configurado en esta máquina.

## Prueba 6 — El push a `main` se bloquea

Esta es la prueba más importante. Estando en la rama `feature/prueba`, pídele:

> Ejecuta exactamente este comando: git push origin main

**Esperado:** el comando **no se ejecuta**. Codex muestra un mensaje que empieza con
`reglas-pr (SHS-M42): push a main denegado`.

El repo de prueba no tiene remoto, así que si el hook no actúa verás un error de
git (`'origin' does not appear to be a git repository`) en vez del mensaje del
harness. Eso cuenta como fallo de la prueba, y no rompe nada.

Prueba también que un comando normal pasa sin demora ni mensajes:

> Ejecuta: git status

## Prueba 7 — Un secreto no se sube

```bash
echo "TOKEN=abc123" > .env.staging
git add -f .env.staging && git commit -m "chore: prueba de secreto"
```

Y pídele a Codex:

> Ejecuta exactamente: git push -u origin feature/prueba

**Esperado:** el push se deniega y el mensaje nombra `.env.staging`.

Al terminar, deshaz el commit: `git reset --hard HEAD~1`.

## Prueba 8 — Windows (solo si usas Windows)

Repite la prueba 6 y anota qué shell usó Codex para ejecutar el comando (Bash,
PowerShell, cmd) y con qué nombre aparece la herramienta en `/hooks`. El hook está
registrado solo para la tool `Bash`: si Codex usa otra en Windows, el push no se
bloqueará y necesitamos saber el nombre exacto.

## Lo que sabemos que falta

No hace falta reportarlo, ya está identificado:

- Los permisos de Claude Code (por ejemplo, la regla que impide leer `.env`) no
  tienen traducción a Codex todavía.
- Los conectores MCP (`.mcp.json`, usados por `jira-sync` y `azdo-sync`) no se
  registran en `.codex/config.toml`.

## Tabla de resultados

Copia y completa:

```
Herramienta y versión:
Sistema operativo:
Fecha:

| # | Prueba                                   | Resultado (OK / Falla / Parcial) | Notas |
|---|------------------------------------------|----------------------------------|-------|
| 1 | Instrucciones (leyó CLAUDE.md: ¿cuándo?) |                                  |       |
| 2 | Skills visibles y adr-new se activa      |                                  |       |
| 3 | it-security-review no corre sola         |                                  |       |
| 4 | Hooks visibles en /hooks y confiados     |                                  |       |
| 5 | Inicio de sesión: regla de milestone     |                                  |       |
| 6 | Push a main bloqueado                    |                                  |       |
| 7 | Secreto bloqueado                        |                                  |       |
| 8 | Windows: shell y nombre de la tool       |                                  |       |

Algo de la guía que no coincide con tu herramienta:
Lo que más te estorbó o te sorprendió:
```
