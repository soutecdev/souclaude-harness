# Prueba del harness en Codex y Antigravity

El harness de SOUTEC ahora se instala para tres herramientas de IA a la vez: Claude
Code, Codex y Antigravity. El soporte de Claude Code es el de siempre. **El de
Codex y Antigravity está en prueba**: se construyó contra la documentación de cada
herramienta y con entradas simuladas, sin haberlo corrido en la herramienta real.
Esta carpeta es para quienes van a hacer esa prueba.

- [Guía para Codex](codex.md)
- [Guía para Antigravity](antigravity.md)

Cada guía tiene nueve pruebas y toma entre 30 y 45 minutos.

## Qué instala el harness para cada herramienta

| Pieza | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Instrucciones | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` |
| Registro de hooks | `.claude/settings.json` | `.codex/hooks.json` | `.agents/hooks.json` |

Tres cosas que conviene saber antes de empezar:

- **`AGENTS.md` es un puntero.** Las instrucciones del proyecto están en
  `CLAUDE.md`; `AGENTS.md` le dice a tu herramienta que lo lea y cómo traducir lo
  que es propio de Claude Code.
- **Las skills son las mismas** en las dos carpetas, archivo por archivo.
- **Los hooks reutilizan los scripts de `.claude/hooks/`.** Por eso esa carpeta
  tiene que existir aunque no uses Claude Code.

## Preparar el repo de prueba

Necesitas Node 22.4 o superior, `git` y tu herramienta instalada. Usa un repo
desechable, no uno de trabajo:

```bash
mkdir prueba-harness && cd prueba-harness
git init -b main
npx github:soutecdev/souclaude-harness#feature/M48-harness-multiherramienta init --yes --name prueba --type backend --lang es
git add -A && git commit -m "chore: instalar harness"
git checkout -b feature/prueba
```

Si la rama ya se integró, cambia `#feature/M48-harness-multiherramienta` por `#v3`.

Comprueba que quedaron estos archivos antes de abrir tu herramienta:

```bash
ls AGENTS.md CLAUDE.md .codex/hooks.json .agents/hooks.json .agents/skills
```

## Cómo reportar

Copia la tabla de resultados del final de tu guía, complétala y envíasela al
coordinador del harness (Ignacio Alvarez). Para cada prueba que falle, incluye:

1. La versión de la herramienta y tu sistema operativo.
2. Qué hiciste y qué esperabas.
3. Qué pasó: el mensaje literal o una captura.

Un «no funcionó» con el mensaje exacto sirve más que una explicación larga. Si
algo de la guía no coincide con lo que ves en tu herramienta (un menú que no
existe, un nombre distinto), también es un resultado: anótalo.
