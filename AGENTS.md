# AGENTS.md — souclaude-harness

Este archivo lo leen las herramientas de IA que siguen el estándar `AGENTS.md`
(Codex, Antigravity y otras). Lo genera el harness de SOUTEC (`3.20.0`):
no lo edites a mano, se actualiza con `npx souclaude upgrade`.

## Las instrucciones del proyecto están en `CLAUDE.md`

**Antes de hacer cualquier otra cosa, lee completo el archivo `CLAUDE.md` de la raíz
de este repo y síguelo como si fuera este mismo archivo.** Ahí están las reglas del
proyecto: Git y Pull Requests, trazabilidad con el Vault, idioma, secretos y las
reglas técnicas propias del repo. Valen igual para cualquier herramienta de IA; el
nombre del archivo es histórico, no una restricción.

Hay un solo archivo de instrucciones a propósito: el equipo adapta `CLAUDE.md` a
cada proyecto, y una segunda copia quedaría desactualizada.

## Equivalencias para tu herramienta

`CLAUDE.md` se escribió pensando en Claude Code. Donde nombre algo propio de esa
herramienta, aplica lo equivalente en la tuya:

| `CLAUDE.md` dice | En Codex, Antigravity u otra herramienta |
|---|---|
| Skills en `.claude/skills/` | Las mismas skills están en `.agents/skills/`. |
| «Claude Code», «la sesión de Claude» | Tu herramienta y tu sesión. |
| Invocar una skill con `/nombre` o con la tool `Skill` | Tu mecanismo de skills; si no la activa, lee su `SKILL.md` y síguela. |
| Subagentes (`Agent`, `Explore`) | Tu mecanismo de delegación, o hazlo tú mismo. |
| Archivos bajo `.claude/` (`vault.local.json`, `harness.json`, `jira.json`, `azdo.json`) | Son configuración del harness, no de Claude: léelos y úsalos igual. |
| Hooks `reglas-pr` y de inicio de sesión | Registrados también para Codex (`.codex/hooks.json`) y Antigravity (`.agents/hooks.json`). Ver abajo. |

## Si los hooks no corren en tu herramienta

Los hooks hacen cumplir dos cosas: que ningún `git push` toque `main` ni suba
secretos, y que cada sesión empiece sabiendo en qué milestone se trabaja. Tu
herramienta puede no ejecutarlos (por ejemplo, Codex los omite hasta que el
usuario los revisa y confía con `/hooks`). **Las reglas valen igual aunque nada
las bloquee**:

- Nunca hagas `git push` a `main`, ni `git push --force`.
- Nunca subas `.env`, llaves, tokens ni credenciales.
- Al empezar, averigua el milestone en curso como indica `CLAUDE.md` antes de
  tocar código.
- Tras crear o editar un Pull Request, corre los checks a mano si existen:
  `node .claude/hooks/reglas-pr.mjs --pr <url-del-pr>`.

El soporte de Codex y Antigravity está **en prueba**: si algo de este archivo no
coincide con lo que hace tu herramienta, repórtalo al coordinador del harness.
