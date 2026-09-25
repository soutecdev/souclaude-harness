# CLAUDE.md — {{PROJECT_NAME}}

## Contexto

Proyecto de {{PROJECT_TYPE}}. Stack: {{STACK}}.
Dominio: [describir en 1-2 líneas qué hace este proyecto].

## Harness — modo solo (single coder)

Harness `{{HARNESS_VERSION}}` instalado en **modo solo**: la superficie para
trabajo individual. Sin metodología de equipo: no hay milestones ni kanban que
declarar, no hay validación de PR y no se espeja ningún tablero externo
(Jira/Azure Boards). La única obligación de registro es el **worklog del Vault**
(ver "El Vault"). Las skills viven en `.claude/skills/` y se aplican solas cuando
el contexto lo amerita. Para volver a la metodología completa:
`npx souclaude upgrade --equipo`.

## Git — modo fluido

No hay proceso de revisión: cuando el trabajo está terminado y probado, **puedes
mergear y pushear directo a `dev` y a `main`**. El PR es opcional — sin plantilla
ni aprobaciones — para cuando el usuario lo pida o sirva como registro de un
cambio grande.

Recomendaciones (no bloquean; mantienen el historial legible):

- Ramas simples `tipo/<slug>` (`feature/captura-lead`, `fix/timeout-api`). Tipos:
  `feature` `fix` `hotfix` `docs` `chore` `refactor` `experiment`. Un cambio
  trivial puede ir directo a `dev`.
- Commits: `tipo: descripción breve` (español, sin scope). Tipos: `feat` `fix`
  `docs` `chore` `refactor` `test` `style` `build` `ci` `perf` `revert`.
- Flujo típico: rama desde `dev` → commits → merge a `dev`; cuando hay algo
  publicable, merge `dev` → `main` (y tag `vX.Y.Z`, si el proyecto versiona).
- `git push --force` no está bloqueado en este repo, pero evítalo sobre `dev` y
  `main`: reescribir historia es mala idea aunque trabajes solo.
- **GitHub Actions: solo los workflows que instala el harness.** No crees ni
  modifiques workflows en `.github/workflows/` (tests, lint, build, deploy ni
  checks extra). Si el proyecto necesita CI propia, se pide al coordinador y se
  evalúa en el harness. Esta sí es regla dura, no recomendación.

## El Vault — traza mínima

El trato del modo solo: fluidez total a cambio de que la organización siga viendo
**en qué se está trabajando**.

- **Al empezar cada bloque de trabajo**, agrega una línea con fecha a
  `Project-<PREFIJO>/worklog.md` del Vault con el objetivo del bloque
  («2026-09-15 · migrando auth a OAuth») y pushea en el momento con
  `souclaude vault-sync --push -m "docs: worklog" --paths Project-<PREFIJO>`
  (permitido sin confirmación; requiere el CLI global:
  `npm install -g github:soutecdev/souclaude-harness#v3`). Si el objetivo cambia,
  otra línea. Es una línea honesta por bloque — no un tablero.
- `sessions.md` y el monitor de tokens (`souclaude monitor`) siguen funcionando
  exactamente igual que en modo equipo, sin pasos manuales.
- La ruta local del Vault está en `.claude/vault.local.json` (la escribe
  `npx souclaude`).
- El Vault es un repo compartido de la organización: ahí se escribe con push
  directo a `main` y **jamás `git push --force`**, en ningún modo.

## Language

Responder siempre en {{LANGUAGE}}.

Cuando el idioma sea español, usar **español neutro** (estándar panhispánico), **no**
español rioplatense/argentino. Es el estándar de la organización — aplica a toda
respuesta, no solo al código.

- **Conjugación: tuteo (tú)**, nunca voseo (vos) ni tratamiento formal (usted). Los
  imperativos van en tuteo: `usa` (no "usá"), `ten` (no "tené"), `dilo` (no "decilo"),
  `fíjate` (no "fijate"), `empieza` (no "empezá"), `haz` (no "hacé").
- **Evita localismos rioplatenses** en la prosa ("che", "bárbaro", "recién ahí",
  "acordate", "de una"). Prefiere vocabulario entendible en toda Hispanoamérica.

**El dominio se nombra en el lenguaje del negocio (español)**: entidades, value objects
y métodos de puerto (`Ticket`, `ContextoDeNegocio`, `generar_respuesta`).
**Adaptadores, infraestructura y todo lo que toca frameworks: en inglés.**

## Reglas técnicas críticas

Reglas que causan errores si se omiten. Agregar/quitar según el proyecto.

### [Categoría — ej: API, Data, Deployment]
- [Regla concreta 1]
- [Regla concreta 2]

## Behavior expectations

- Si algo es ambiguo o parece mal: **para y pregunta.** No adivines ni reinterpretes.
- No modificar archivos fuera del scope pedido.
- No instalar dependencias sin confirmar.
- Reportar honestamente si algo falla. **Sin workarounds silenciosos.**
- No modificar un test para que pase. Si el test está mal, dilo y para.
- Cambios chicos y quirúrgicos: lo más simple que resuelva el pedido, sin
  refactors de regalo ni archivos fuera de scope.

## Memoria

| Qué | Dónde |
|---|---|
| Learning del día, gotcha fresco | `notes.md` |
| Decisión con trade-off | `docs/decisions/` (`/adr-new`, si está instalada) |

## Secretos

La única regla dura del modo solo. Jamás commitear `.env`, `*.pem`, `*.key`,
`*.pfx`, `credentials.json`, `secrets.json`, tokens ni contraseñas.
`.claude/settings.json` ya deniega su lectura vía `permissions.deny`.

## Referencias

`docs/decisions/` · `notes.md` · `Project-<PREFIJO>/worklog.md` (Vault)
