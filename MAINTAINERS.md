# MAINTAINERS — cómo mantener y actualizar `souclaude-harness`

Guía para quien toca **el generador** (este repo), no para quien usa el harness en su
proyecto. Para eso, ver [docs/GUIA-DESARROLLADOR.md](docs/GUIA-DESARROLLADOR.md).

Diagrama del motor: [docs/arquitectura.excalidraw](docs/arquitectura.excalidraw)
(abrir en [excalidraw.com](https://excalidraw.com) o con la extensión de VS Code).

---

## Setup

```bash
npm install          # dos deps: @clack/prompts y picocolors
npm test             # node:test, sin dependencias de testing
node bin/cli.mjs init --dry-run --yes   # probar sin escribir nada
```

Requisitos: **Node ≥ 22.4** (el equipo trabaja con 24, ver `.nvmrc`) y git. No hay build step: el código que editas es el que se
publica.

---

## Mapa del repo

```
bin/cli.mjs              entrypoint (npx lo corre)
src/
  cli.js                 parseo de flags + dispatch + autodetección de comando
  ui.js                  prompts (clack); respeta --yes / CI=true
  commands/
    _shared.js           resolveVars() + planAndApply() -- el flujo común
    init · upgrade · status · adopt · verify · monitor · vault-sync
  core/
    manifest.js          carga templates/harness.manifest.json
    detect.js            detecta el stack del repo host + su enforcer
    hash.js              sha256 sobre contenido normalizado a LF
    render.js            sustitución {{VAR}}
    block.js             append-block (.gitignore)
    jsonmerge.js         merge-json (settings.json)
    lockfile.js          lee/escribe .claude/harness.json
    plan.js  ◄           EL MOTOR: clasifica cada archivo (la tabla)
    apply.js             ejecuta el plan (write guard + backup)
    fsx.js               lectura/escritura; esDestSeguro (nada sale del repo)
    verify.js            contrato del manifest + huerfanos (souclaude verify)
    vault.js · vault-sync.js · vault-seeds.js   conexion y espejo del Vault
    github-protect.js    proteccion de main via gh
    cli-global.js · version-remota.js · novedades.js   CLI global y avisos
  monitor/               panel de tokens (domain · application · adapters)
  migrations/index.js    transforms mecánicos versionados
templates/
  harness.manifest.json  ◄ qué archivos se emiten y con qué política
  base/                  el harness tal cual (con {{VARS}})
  fragments/gitignore/   fragmentos por stack
scripts/                 check-pr-rules · tag-release · release-publicar ·
                         gen-docs-metodologia (los tres primeros se distribuyen)
test/                    node:test + helpers
```

**El manifest es el centro de todo.** Casi ningún cambio de contenido toca código: se
edita `templates/` y, si hace falta, una línea en el manifest.

---

## Cómo actualizar — recetas

### 1. Cambiar el contenido de un archivo ya existente

Editas `templates/base/<ruta>` y listo. El efecto en repos ya instalados depende de la
**política** del archivo (ver [Cómo funciona](#cómo-funciona-por-detrás)):

- **`managed`** (skills, hooks, workflows, scripts): el `upgrade` lo sobrescribe solo si el
  usuario no lo tocó. Es lo normal para todo lo que el harness "posee".
- **`user-owned`** (`CLAUDE.md`, `notes.md`, PR template, CODEOWNERS, `jira.json`,
  `azdo.json`): mientras siga intacto se actualiza igual que un `managed`; en cuanto el
  dev lo edita (lo habitual) **no se pisa** y recibe un `.new`. Cámbialo sabiendo eso:
  para que una corrección llegue a un archivo ya editado hace falta una migración.

Después: `npm test`, y **sube la versión** (receta 6) para que `status` marque el upgrade.

### 2. Agregar un archivo nuevo al harness

1. Crea el template en `templates/base/<ruta>`. **Los dotfiles se guardan sin el punto**
   (`templates/base/gitignore`, no `.gitignore`) y el nombre real va en `dest`.
2. Agrega una entrada en `templates/harness.manifest.json` → `files[]` (la forma de cada entrada está en
   `schemas/harness.manifest.schema.json`; el manifest lo declara en `$schema`, así que el
   editor valida y autocompleta mientras escribes):
   ```json
   { "id": "mi-doc", "src": "base/docs/mi-doc.md", "dest": "docs/mi-doc.md",
     "render": true, "policy": "managed" }
   ```
   - `render: true` si el template usa `{{VARS}}`.
   - `when: "empty-repo"` si solo va en repos nuevos (como `src/`, `README.md`).
3. Si usas una variable nueva (`{{FOO}}`), resuélvela en `src/commands/_shared.js` →
   `resolveVars()`.
4. Agrega o extiende un test en `test/`.
5. Sube la versión (receta 6).

### 3. Agregar un stack o un fragmento de `.gitignore`

- `src/core/detect.js` → `SIGNATURES`: agrega el stack (con su `enforcer` para P2).
- `templates/fragments/gitignore/<stack>.txt`: el fragmento. Se concatena con `base.txt`
  cuando ese stack se detecta.

### 4. Deprecar o renombrar un archivo

- Sácalo de `manifest.files`.
- En repos que lo tenían, el motor lo detecta como **`obsolete`** (vía el lockfile) y lo
  ofrece con `--prune` (nunca lo borra solo — P6).
- Para detectarlo también en repos **sin lockfile** (copias a mano del Kit), agrégalo a
  `manifest.obsolete[]`: `{ "dest": "...", "reason": "..." }`. Así se avisó del
  `.claudeignore`.

### 5. Arreglar algo en un archivo `user-owned` ya instalado (migración)

El seed-merge y el hash-diff **solo agregan / sobrescriben lo intacto**; no reescriben lo
que el usuario editó. Para un cambio mecánico sobre lo que ya hay en disco (ej. remover
una clave inválida), agrega una migración en `src/migrations/index.js`:

```js
{
  id: 'v1-1-algo',
  to: '1.1.0',
  dest: '.claude/settings.json',
  describe: 'qué hace, en una línea (se muestra al usuario)',
  transform(content) { /* recibe lo de disco, devuelve lo corregido */ },
}
```

Corre **antes** de comparar, así el cambio aparece como un `update` normal. Que sea una
función chica. **Nada de un DSL de migraciones.**

### 6. Publicar una versión

1. Sube `harnessVersion` en `templates/harness.manifest.json` (y `version` en
   `package.json`, se mueven juntas).
2. Actualiza `CHANGELOG.md`, regenera `docs/metodologia` con
   `node scripts/gen-docs-metodologia.mjs` y sube la versión que citan `README.md`
   y `CLAUDE.md`: `verify`, la suite y el hook `reglas-pr` fallan si quedan atrás.
   Si agregaste una migración, ajusta su `to` a esta versión.
3. `npm run check` (`verify --strict` + la suite).
4. Release: **`main` solo recibe merges desde `dev`**. El trabajo entra a `dev` por PR
   de rama; el release es un PR de `dev` a `main` con la versión propuesta en el
   cuerpo.
5. Tags — **los crea `tag-release.yml`** al mergearse el release a `main`. La
   convención: un tag **inmutable** `vX.Y.Z` por release, y un tag **móvil por major**
   (`v1`, `v2`, `v3`) que apunta al último release de su serie. Un breaking sube el
   major y estrena su propio tag móvil; los tags móviles viejos quedan congelados en
   el último release de su serie, así ningún proyecto recibe un breaking sin pedirlo.
   Si el workflow no corrió, el agente corre el mismo script, que lee la versión de
   `origin/main`, crea el tag anotado y mueve el móvil (idempotente, sin cambiar de
   rama):
   ```bash
   git fetch origin && node scripts/tag-release.mjs --ref origin/main
   ```
6. **El aviso a los devs es automático** (SHS-M43): al abrir la siguiente sesión, el
   hook de SessionStart de cada consumidor compara su lockfile contra el último tag
   `vX.Y.Z` (git ls-remote con caché por máquina, TTL 24 h) y anuncia la versión
   nueva proponiendo la skill `harness-upgrade` — no hace falta avisar por mensaje
   privado. El upgrade lo corre cada dev
   (`npx github:soutecdev/souclaude-harness#v3 upgrade`, o con el tag exacto si el
   aviso ya dijo la versión). No hay registry ni publicación de npm. Para cambiar de
   major, editan la ref y corren `upgrade --prune` — la major nueva también se
   anuncia, con mensaje aparte, porque su migración es manual. ADR:
   `docs/decisions/20261008-aviso-de-version-en-sesion.md`.

   **La migración real de la organización es `#v1` → `#v3`.** El tag móvil `v2` nunca
   se creó: la serie 2 solo tiene el inmutable `v2.4.0`, así que todo proyecto
   instalado antes de la v3 apunta a `#v1`.

---

## Cómo funciona por detrás

La idea entera: **instalar, adoptar un repo legacy y migrar de versión son el mismo code
path.** No hay tres flujos; hay una tabla de clasificación.

### Las tres entradas

Para cada archivo del manifest, el motor mira tres cosas y las compara por hash:

1. **En disco** — el archivo actual (o ausente, o vacío).
2. **Lockfile** (`.claude/harness.json`) — el hash de lo que emitimos la última vez.
3. **Template** — lo que el harness querría emitir hoy.

El hash es `sha256(contenido normalizado a LF)`. Normalizar **antes** de hashear es lo que
evita que `autocrlf` de git y los editores de Windows marquen todo como "modificado".

### Las cuatro políticas (cómo se compara cada archivo)

| Política | Significado |
|---|---|
| `managed` | El harness manda. Se sobrescribe solo si el hash en disco coincide con el lockfile. |
| `user-owned` | Pensado para que el usuario lo edite. Intacto, se actualiza; una vez editado **nunca se pisa**: si el template cambió, se escribe `.new`. |
| `append-block` | El harness es dueño de un bloque delimitado dentro del archivo (`.gitignore`). Tus líneas no se tocan. |
| `merge-json` | Solo **agrega** claves que faltan (`settings.json`). Nunca pisa un valor que escribiste. Al cambiar de modo retira lo que el harness sembró para el modo anterior (`retirarSemilla`). |

### La clasificación (`src/core/plan.js`)

Comparando disco × lockfile × template, cada archivo recibe un veredicto:

| Veredicto | Cuándo | Acción |
|---|---|---|
| `create` | no existe, no está en el lockfile | escribir |
| `update` | intacto desde la última vez, el template cambió | sobrescribir (no pierdes nada) |
| `noop` | idéntico a lo deseado | no tocar |
| `local-edit` | lo editaste tú, el template no cambió | dejarlo |
| `conflict` | lo editaste tú **y** el template cambió | `.new` al lado |
| `foreign` | existe pero nunca lo escribimos nosotros | `.new` al lado |
| `restore` | lo escribimos y lo borraste | reescribir |
| `obsolete` | estaba en el lockfile, ya no en el manifest | ofrecer `--prune` |
| `migrate` | lo editaste tú (`local-edit`, `conflict` o `foreign`) y una migración cambia algo | solo el cambio de la migración, en el lugar, con backup; el hash del lockfile no se reclama |

### La ejecución (`src/core/apply.js`)

- **Write guard**: solo escribe lo que está en el plan que el usuario vio, y ninguna
  ruta del plan ni del lockfile puede salir del repo (`esDestSeguro`): si alguna lo
  intenta, no se aplica nada.
- **Leer antes de decidir**: un archivo que existe pero no se puede leer corta el plan
  antes de escribir; nunca se clasifica como ausente.
- **Backup**: copia todo lo que va a sobrescribir a `.claude/backup-<timestamp>/` antes de
  tocarlo.
- **Nunca pisa un archivo tuyo en silencio**: `conflict`/`foreign` van a `.new`;
  `local-edit`/`noop` no se escriben. La única excepción es `migrate`: el reemplazo
  puntual de una migración sobre un archivo tuyo, con backup y sin reclamar su hash.
- Al final, reescribe el lockfile con el hash de lo emitido.

### Detalles que importan

- **`init` / `upgrade` / `adopt` son el mismo motor.** Lo único que cambia es lo que
  `computePlan` encuentra en disco y en el lockfile. `adopt` además no escribe nada:
  solo anota en el lockfile los archivos que ya coinciden.
- **Greenfield es "sticky"**: si el repo era vacío se decide una vez, en el primer install,
  y queda en el lockfile (`greenfield: true`). Sin esto, la segunda corrida vería el repo
  ya poblado y marcaría `README.md` / `src/` como obsoletos.
- **Migraciones** (`src/migrations/`): transforms mecánicos que el hash-diff no puede
  expresar (remover una clave, renombrar). Corren sobre lo de disco antes de comparar.

---

## Tests

`node:test`, in-process (rápido), sin dependencias.

```bash
npm test
node --test "test/migrate.test.js"     # un archivo
npm run test:cobertura                  # cobertura del código del repo; falla bajo el piso (Node >= 22.8)
UPDATE_GOLDEN=1 npm test                # regenerar golden files (si los agregas)
```

Los dos invariantes que atrapan casi todos los bugs:

- **Idempotencia**: correr `init` dos veces → la segunda no escribe nada.
- **Pureza de `--dry-run`**: el árbol queda byte-idéntico.

Y el test más importante: **`NUNCA SE PISA`** — un archivo editado por el usuario nunca se
sobrescribe. Si tocas `apply.js` o `plan.js`, ese test es tu red de seguridad.

Los fixtures usan un directorio temporal **con un espacio en la ruta** a propósito: los
repos reales viven bajo OneDrive en `...\Soutec Ignacio Alvarez\...`.
