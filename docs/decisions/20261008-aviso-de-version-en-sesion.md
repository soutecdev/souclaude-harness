# ADR: El aviso de versión nueva del harness viaja en el hook de sesión, no por mensaje privado

**Fecha**: 2026-10-08
**Status**: accepted
**Deciders**: Ignacio A (@ignacio), con evaluación de alternativas de Claude

## Context

Hasta hoy, publicar un release del harness terminaba en un paso humano: avisar
por mensaje privado a cada desarrollador para que le pidiera a su agente
"actualiza el harness" (MAINTAINERS.md, paso 6 de «Publicar una versión»). El
sistema no tenía ningún canal propio: el CLI nunca consulta a un remoto cuál es
la última versión — `souclaude status` compara contra el manifest del CLI que
lo ejecuta, así que un CLI servido viejo por la caché de npx del tag móvil
(`#v3`) decía «al día» sin estarlo.

Las piezas para un canal automático ya existían: la versión instalada de cada
consumidor vive commiteada en `.claude/harness.json` (lockfile); la verdad de
«última versión» son los tags inmutables `vX.Y.Z` del repo del harness,
consultables con un `git ls-remote` de solo lectura usando las mismas
credenciales de GitHub con las que el consumidor ya instala el harness; los
hooks de SessionStart (`declarar-milestone.mjs` en modo equipo,
`worklog-solo.mjs` en modo solo) ya hacen red best-effort al arrancar (pull del
Vault, fetch del repo) con timeout corto y sin romper jamás la sesión; y el
estado por máquina ya tiene casa en `~/.claude/souclaude/` (vault.json,
usage-cache con TTL y backoff). El ejecutor también existía: la skill
`harness-upgrade` corre el flujo completo con una sola instrucción. Lo único
que faltaba era el disparador.

Restricciones: GitHub Actions está en pausa (SHS-M36) y los workflows por repo
están prohibidos; el harness no se publica en npm (repo privado, acceso por
GitHub); y la cultura de revisión exige que todo cambio en un consumidor pase
por rama + PR — nada puede auto-instalarse.

## Decision

Los dos hooks de SessionStart comparan, al arrancar cada sesión, la
`harnessVersion` del lockfile contra el último tag `vX.Y.Z` del repo del
harness, y si hay versión nueva lo anuncian con un banner accionable que
propone la skill `harness-upgrade` (la major nueva lleva mensaje aparte: su
migración es manual). La consulta es `git ls-remote --tags --refs` con timeout
de 5 s, `GIT_TERMINAL_PROMPT=0` y caché por máquina en
`~/.claude/souclaude/version-check.json` (TTL 24 h; ante fallo, backoff de 1 h
y se usa lo último conocido): una consulta por máquina y por día. El aviso
calla por completo sin red, sin credenciales, sin lockfile (o `0.0.0`) y en el
repo del propio generador.

Además, `souclaude status` y `souclaude upgrade` leen esa caché y delatan al
CLI en ejecución cuando quedó detrás del último release (el caso de la caché de
npx), y la skill `harness-upgrade` usa el tag exacto (`#vX.Y.Z`) en vez del
móvil (`#v3`) cuando el aviso ya dijo cuál es la última versión.

El upgrade en sí no cambia: lo corre el agente con el visto bueno del usuario y
termina en rama + PR del consumidor.

## Consequences

### Positivas
- El canal deja de ser humano: cada máquina se entera sola (a lo sumo un día de
  caché después del release) y el aviso aparece exactamente donde se actúa — la
  sesión del agente que puede correr `harness-upgrade`.
- Cero infraestructura nueva: ni registry, ni bots, ni workflows (compatible
  con la pausa SHS-M36); reutiliza las credenciales de GitHub que el consumidor
  ya tiene por instalar vía `npx github:…`.
- `status`/`upgrade` dejan de decir «al día» cuando el CLI cacheado está viejo.

### Negativas
- Arranque en frío: el mecanismo llega a los consumidores dentro de un upgrade,
  así que la adopción inicial necesita un último aviso por el canal viejo.
- Una consulta de red por máquina y por día; en máquinas sin credenciales ni
  red el aviso simplemente nunca aparece (aceptado: esas máquinas tampoco
  podrían instalar la versión nueva).
- El TTL de 24 h puede demorar el anuncio hasta un día.

### Neutras
- La caché vive junto al resto del estado de máquina
  (`~/.claude/souclaude/version-check.json`); `SOUCLAUDE_CLAUDE_HOME` y
  `SOUCLAUDE_HARNESS_REMOTO` la redirigen en tests.
- Un consumidor anclado a `#v1` sigue viendo los parches de su major y se
  entera de las majors nuevas con el mensaje aparte.

## Alternatives considered

### Alternativa A: el Vault como canal
**Pros**: el hook ya sincroniza el Vault al arrancar (cero red extra) y
`Project-SHS/OBSERVATORIO.md` ya registra los releases; legible para humanos.
**Cons**: exige formalizar un marcador legible por máquina en el Vault y crea
una segunda fuente de verdad que puede derivar de los tags (la real); deja
afuera los repos sin Vault configurado.
**Por qué se descartó**: los tags ya son la verdad y consultarlos cuesta lo
mismo que el pull del Vault que el hook ya hace. El registro humano en el
Observatorio se mantiene como complemento, no como mecanismo.

### Alternativa B: PRs automáticos tipo Dependabot
**Pros**: la actualización llega como diff revisable, sin iniciativa del dev.
**Cons**: Actions está en pausa (SHS-M36) y los workflows por repo están
prohibidos; requiere inventario de consumidores y un token con write en todos;
el merge hunk-por-hunk de los `.new` necesita criterio que un bot no tiene.
**Por qué se descartó**: inviable hoy por las dos reglas vigentes. Reevaluable
al despausar Actions, como workflow instalado por el harness.

### Alternativa C: auto-upgrade silencioso en SessionStart
**Pros**: nadie tiene que hacer nada.
**Cons**: viola rama + PR y «sin workarounds silenciosos»; pisa árboles de
trabajo a mitad de un feature; el upgrade tiene pasos con criterio (.new,
obsoletos editados).
**Por qué se descartó**: incompatible con la cultura de revisión de la
organización.

## References

- Milestone SHS-M43 del Vault (tarjeta y tareas T001–T004).
- CHANGELOG `[3.17.0]` y `templates/base/claude/hooks/*.mjs` (implementación).
- `src/core/version-remota.js`, `src/commands/status.js`,
  `src/commands/upgrade.js` (CLI atrasado).
- `docs/decisions/20260921-pausa-github-actions.md` (por qué sin workflows).
- MAINTAINERS.md «Publicar una versión» (el paso 6 que este ADR reemplaza).
