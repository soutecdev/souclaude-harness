---
name: soutec-github
description: Flujo Git/GitHub obligatorio de SOUTEC (Guía Operativa v2.0). Aplicar SIEMPRE antes de crear una rama, commitear, pushear o abrir un Pull Request en un repo de SOUTEC. Cubre nombres de rama tipo/ID-tarea, commits Conventional Commits, la plantilla obligatoria de PR, squash & merge, semver vX.Y.Z y las reglas de secretos.
---

# SOUTEC — Git & GitHub

> *"Primero disciplina, luego automatización. Automatizar el desorden solo produce
> caos más rápido."* — Guía Operativa v2.0

## Reglas inviolables

Estas no se negocian, ni siquiera en un hotfix.

- **Nunca `git push origin main`.** `main` es producción. Nadie trabaja directo sobre
  `main` — tampoco el coordinador ni los administradores.
- **`main` solo recibe merges desde `dev`.** Las ramas de trabajo nacen de `dev` y su
  PR apunta a `dev`; el paso `dev` → `main` es el release, también por PR. Ninguna
  rama de trabajo mergea directo a `main`.
- **Nunca hacer merge de un PR propio.** El autor del cambio no mergea. El squash &
  merge lo hace el coordinador o el aprobador suplente.
- **Nunca aprobar un PR.** Nadie aprueba lo suyo.
- **Nunca `git push --force`.** Solo `--force-with-lease`, solo sobre rama propia, y
  solo si se usó rebase. Con la política por defecto (merge) no hay force-push nunca.
- **Nunca commitear secretos**: `.env`, `*.pem`, `*.key`, `*.pfx`, `credentials.json`,
  `secrets.json`, tokens, contraseñas, llaves privadas.
- **Nunca crear una rama sin nombre descriptivo.** Formato `tipo/descripcion-corta`. Si
  el trabajo tiene un ID rastreable — tarea o milestone del Vault, o tarea de un
  tracker externo — va como prefijo del slug (`feature/SHS-M7-T006-playbook-adopcion`,
  `feature/REA-123-captura-lead`); si no lo hay, el slug solo. **No inventes IDs.**
- **Nunca crear repositorios.** Eso es del coordinador. Los **tags de versión**
  (`vX.Y.Z` y el tag móvil por major) sí puede crearlos el agente, únicamente al
  publicar y después del merge de release `dev` → `main`.
- **Un hotfix NO es un bypass.** Aun en máxima criticidad: rama + Pull Request.

## Antes de tocar código

```bash
git checkout dev
git pull origin dev           # siempre partir de dev actualizado
git checkout -b tipo/descripcion-corta
```

Chequeo previo: ¿leíste el README? ¿tienes el `.env` local configurado?

## Nombre de rama

```
tipo/descripcion-corta          # o tipo/ID-descripcion-corta si hay ID rastreable
```

El **ID** va en mayúsculas como prefijo del slug y puede ser cualquiera de estos
(en orden de preferencia — usa el más específico que exista, y **no inventes IDs**):

- **Tarea del Vault**: `feature/SHS-M7-T006-playbook-adopcion`
- **Milestone del Vault** (si aún no hay tarea desglosada): `fix/SHS-M10-chequeo-gh`
- **Tracker externo**: `feature/REA-123-captura-lead`

| Tipo | Uso |
|---|---|
| `feature/` | Nueva funcionalidad |
| `fix/` | Corrección de error no crítico |
| `hotfix/` | Corrección urgente sobre producción |
| `docs/` | Documentación |
| `chore/` | Mantenimiento, dependencias o configuración |
| `refactor/` | Mejora interna sin cambiar comportamiento |
| `experiment/` | Pruebas, POC, IA o laboratorio |

```
feature/captura-lead
fix/error-integracion-odoo
hotfix/correccion-produccion
refactor/mejorar-estructura-api
experiment/prueba-modelo-rag
```

**Prohibidos**: `cambios`, `prueba`, `final`, `final-final`, `arreglo`, o el nombre de
una persona.

## Commits

```
tipo: descripción breve del cambio
```

Sin scope. Sin ID de tarea en el mensaje (el ID va en la rama y en el PR).
Descripciones en español.

| | | |
|---|---|---|
| `feat` | `fix` | `docs` |
| `chore` | `refactor` | `test` |
| `style` | `build` | `ci` |
| `perf` | `revert` | |

```
feat: agregar endpoint de consulta de órdenes
fix: corregir error de autenticación con Odoo
refactor: reorganizar servicio de conexión a BD
```

**Ojo**: no existe el tipo de commit `hotfix`. Un hotfix **se commitea como `fix:`**.

**Prohibidos**: `update`, `fix`, `cosas`, `ya`, `ahora sí`.
*Git tiene memoria; no le demos material para novela de misterio.*

## Sincronizar con dev

**Por defecto, merge.** Simple, no reescribe historia, no requiere force-push.

```bash
git fetch origin
git merge origin/dev
# resolver conflictos si los hay
git push origin <tu-rama>
```

Rebase es opcional y solo para uso avanzado: nunca sobre rama compartida, y con
`--force-with-lease`. Como el squash & merge descarta el historial granular de la rama
igual, el rebase es esencialmente cosmético.

## Pull Request

**El PR se abre solo a pedido explícito del usuario.** Terminar un cambio no
implica abrir el PR: el agente lo crea únicamente cuando el usuario lo pide
("abre el PR") o dice que quiere mergear/integrar el trabajo. Mientras tanto:
commit y push a la rama, y reportar que está listo para PR. Esto evita PRs de
features a medio terminar.

Antes de pedir revisión:
- El proyecto corre localmente.
- El flujo afectado está probado.
- No hay `.env` ni credenciales en el commit.
- El README está actualizado si aplica.
- El PR indica si requiere versión/release.

**Antes de abrir el PR, correr la skill nativa `/security-review`** sobre el cambio y
documentar los hallazgos en la sección "Security review" de la plantilla del PR. Si
`/security-review` encuentra vulnerabilidades: **parar y preguntar al usuario** si
quiere remediarlas antes de continuar con el PR. No abrir el PR con hallazgos sin
remediar salvo que el usuario decida explícitamente continuar así — en ese caso,
dejarlo registrado en el PR.

**Completa `.github/pull_request_template.md` de verdad.** Checkboxes tildadas porque
se hizo, no por rellenar. Nada de "N/A" genéricos: si una sección no aplica, se
**omite entera** (título incluido), no se deja con "N/A" ni vacía.

**La plantilla no se aplica sola al abrir el PR por CLI.** Solo la web de GitHub la
precarga; `gh pr create` deja el cuerpo que le pases y nada más. El flujo correcto:
escribir la plantilla ya completada en un archivo temporal y abrir el PR con
`gh pr create --body-file <archivo>`. Un PR con la plantilla cruda o incompleta
**falla el check `reglas-pr` de CI** (secciones con el texto guía intacto, casilla
de versión sin marcar), así que la descripción tiene que quedar bien desde el alta.

Si piden correcciones: **pushear a la misma rama.** El PR se actualiza solo. Crear un
PR nuevo por cada corrección rompe la trazabilidad y duplica el ruido.

Integración: **squash & merge**, y la hace el coordinador. Para un `refactor/` grande o
una migración, el coordinador puede optar por merge commit y lo registra en el PR.

Después del merge (esto sí lo puedes hacer):
```bash
git checkout dev && git pull origin dev && git branch -d <tu-rama>
```

## Versionamiento

SemVer con prefijo `v`: `v1.2.3`.

| Cambio | Regla |
|---|---|
| Corrección menor | PATCH · `v1.0.0 → v1.0.1` |
| Funcionalidad compatible | MINOR · `v1.0.1 → v1.1.0` |
| Cambio incompatible | MAJOR · `v1.1.0 → v2.0.0` |

El desarrollador **propone** la versión en el PR de release. Tras el merge
`dev` → `main`, el **agente puede crear** el tag inmutable `vX.Y.Z` y mover el tag
móvil de la serie (`v3`), y pushearlos. Los releases de GitHub siguen siendo del
coordinador.

Tras el release, revisa si `Project-<PREFIJO>/OBSERVATORIO.md` del Vault necesita
actualizarse — tagline, plataforma, resumen, hitos u otra sección que el release
cambie de forma relevante. Solo si hubo cambios importantes: editarla y pushear al
Vault en el momento (push directo, sin PR — ver `progress/README.md`). Un release
menor sin impacto en la ficha no requiere tocarla.

## Secretos

Nunca en el repo. `.env.example` sin valores. Si una credencial se expone por accidente:
**rotarla**, no solo borrar el commit.

## Lo que esta guía NO define

No lo inventes. Si hace falta, pregunta:

- Formato del **título** del PR.
- **Scopes** de commit (`feat(api):`) — el formato es solo `tipo: descripción`.
- **Trailers** de commit (`Co-Authored-By`, `Signed-off-by`).
- `CHANGELOG.md` — el changelog es el `git log` de `main`.
- Ramas `release/*` — no existen.
- `BREAKING CHANGE` / `!` de Conventional Commits.
- Git hooks, `--no-verify`.
- Commits firmados: **no** son obligatorios hoy.
