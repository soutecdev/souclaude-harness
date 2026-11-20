# ADR: El harness se instala siempre para Claude Code, Codex y Antigravity

**Fecha**: 2026-11-18
**Status**: accepted (soporte de Codex y Antigravity en prueba)
**Deciders**: Ignacio Alvarez (@ignacio), con propuesta y evaluación de alternativas de Claude

## Context

El harness solo servía para Claude Code: instrucciones en `CLAUDE.md`, skills en
`.claude/skills/` y hooks registrados en `.claude/settings.json`. En la
organización también se trabaja con Codex (OpenAI) y con Antigravity (Google), y
un mismo repo puede abrirse con más de una herramienta (SHS-M48).

Lo que cada herramienta lee, verificado contra su documentación el 2026-11-18:

| Pieza | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Instrucciones | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` |
| Hooks | `.claude/settings.json` | `.codex/hooks.json` | `.agents/hooks.json` |
| Contrato del hook | JSON por stdin, `hookSpecificOutput` | el mismo de Claude Code | propio (`toolCall`, `decision`) |

Restricciones: `CLAUDE.md` es `user-owned` (cada equipo lo adapta a su proyecto);
los repos viven en Windows bajo OneDrive, donde los enlaces simbólicos se rompen;
y ni Codex ni Antigravity están instalados en la máquina donde se desarrolló, así
que nada de esto se pudo probar contra la herramienta real.

## Decision

**Toda instalación emite la superficie de las tres herramientas, sin preguntar
cuál se usa.** No hay selección que guardar ni flag: `init` y `upgrade` dejan
siempre lo mismo.

1. **Instrucciones: un solo archivo de verdad.** `CLAUDE.md` sigue siendo la
   fuente. `AGENTS.md` (managed) es un puntero corto: manda a leer `CLAUDE.md`
   completo, da la tabla de equivalencias entre herramientas y repite las reglas
   duras por si los hooks no corren.
2. **Skills: una declaración, dos carpetas.** Cada entry de skill se declara una
   vez en el manifest, con `dest` bajo `.claude/skills/`. `loadManifest()` deriva
   su gemelo bajo `.agents/skills/` (`conSkillsParaAgentes`). Son copias
   generadas, no enlaces.
3. **Hooks: una lógica, un registro por herramienta.** La lógica vive una sola
   vez en `.claude/hooks/`. Codex usa el mismo contrato que Claude Code, así que
   `.codex/hooks.json` invoca esos scripts directamente. Antigravity usa otro
   contrato: `.agents/hooks/souclaude-antigravity.mjs` traduce la entrada y la
   salida y no decide nada.
4. **Los registros de hooks son `merge-json`**: si el equipo ya tenía hooks
   propios en esas herramientas, se conservan.

## Consequences

### Positivas
- Un repo sirve para cualquiera de las tres herramientas, o para varias a la vez,
  sin reinstalar ni elegir.
- Agregar una skill sigue siendo un solo alta: las dos carpetas no pueden quedar
  desparejas.
- Las reglas de `reglas-pr` (push a `main`, secretos) no se reescriben por
  herramienta.

### Negativas
- **Todo repo recibe archivos de herramientas que quizá no usa**: `AGENTS.md`,
  `.codex/`, `.agents/` y una segunda copia de las skills aparecen en el próximo
  `upgrade`.
- **`AGENTS.md` depende de que el agente obedezca «lee `CLAUDE.md`»**. Es una
  instrucción, no una carga garantizada; hay que confirmarlo con cada herramienta.
- **Sin probar contra las herramientas reales.** Los hooks se validaron con
  entradas simuladas según la documentación. Codex además omite los hooks de un
  proyecto hasta que el usuario los revisa y confía con `/hooks`.
- **En Antigravity no corre el check posterior a crear el PR** (`PostToolUse`):
  no hay equivalente documentado para devolverle contexto. Queda el modo manual
  (`node .claude/hooks/reglas-pr.mjs --pr <url>`) y los checks de GitHub Actions.
- **Las skills que solo corren a pedido** (`disable-model-invocation`) usan un
  campo de Claude Code. Codex y Antigravity pueden ignorarlo y activarlas solas.
- **Un `AGENTS.md` viejo del flujo SDD (harness 2.x) que el equipo editó no se
  pisa**: queda como está, con la propuesta en `AGENTS.md.new`.

### Neutras
- `AGENTS.md` sale de la lista de archivos obsoletos del manifest.
- Los permisos (`permissions.deny` de `settings.json`) y los conectores MCP no se
  trasladan en este milestone.

## Alternatives considered

### Alternativa A: preguntar al instalar qué herramientas se usan
**Pros**: cada repo recibe solo lo que usa; los repos existentes no cambian.
**Cons**: una pregunta más, un campo más en el lockfile, y sumar una herramienta
después exige un `upgrade` con flag.
**Por qué se descartó**: decisión del dueño del producto — el harness debe servir
para cualquier herramienta sin que nadie tenga que declararla.

### Alternativa B: `AGENTS.md` como fuente y `CLAUDE.md` que lo importa
**Pros**: el nombre neutral queda como archivo principal.
**Cons**: obliga a migrar el `CLAUDE.md` que cada equipo ya adaptó; es
`user-owned` y el harness no lo reescribe.
**Por qué se descartó**: riesgo alto sobre contenido que no es del harness.

### Alternativa C: generar `AGENTS.md` desde la plantilla de `CLAUDE.md`
**Pros**: el archivo queda completo, sin depender de que el agente lea otro.
**Cons**: no incluiría lo que el equipo agregó a su `CLAUDE.md`; dos archivos de
instrucciones que divergen en silencio.
**Por qué se descartó**: la divergencia es peor que el puntero.

### Alternativa D: enlace simbólico de `.agents/skills` a `.claude/skills`
**Pros**: cero duplicación en disco.
**Cons**: los symlinks se rompen en Windows con OneDrive y antivirus.
**Por qué se descartó**: mismo motivo que la regla de escritura plana del repo.

## References

- Guías de prueba: `docs/pruebas-multiherramienta/`
- [Codex: hooks](https://developers.openai.com/codex/hooks) · [Codex: skills](https://developers.openai.com/codex/skills)
- [Antigravity: hooks](https://antigravity.google/docs/hooks) · [Antigravity: plugins](https://antigravity.google/docs/plugins)
