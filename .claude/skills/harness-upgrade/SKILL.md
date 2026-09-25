---
name: harness-upgrade
description: Actualiza el harness CCEM de este repo (skills, comandos, templates SDD, settings) a la última versión publicada, sin pisar nada que hayas editado tú. Actívate cuando el usuario pida actualizar, upgradear o traer la última versión del harness (ej. "actualiza el harness", "hay una versión nueva del harness", "upgradea el harness").
---

# /harness-upgrade

Una sola instrucción del usuario dispara todo el flujo: buscar la versión nueva,
aplicarla, borrar lo que ya no se usa y mergear lo que corresponda de los `.new`.
No hace falta que el usuario pida cada paso por separado.

## Qué hacer

1. **Estado actual.** Corre:

   ```
   npx -y github:soutecdev/souclaude-harness#v3 status
   ```

   Si ya está en la última versión y no hay archivos obsoletos ni `.new`
   pendientes, avisa eso en una línea y termina — no hay nada más que hacer,
   salvo verificar el CLI global (sección "CLI global `souclaude`", más
   abajo) y el paso 5 (ficha del Observatorio): esa verificación corre
   igual aunque el harness no haya cambiado, pero solo **actúa** si encuentra
   una diferencia real contra la Roca — no es un paso que reescriba o pushee
   en cada corrida.

2. **Diagnóstico en seco**, siempre antes de tocar nada:

   ```
   npx -y github:soutecdev/souclaude-harness#v3 upgrade --dry-run --prune
   ```

   El plan distingue dos grupos de obsoletos: los que se pueden borrar sin
   preguntar (contenido del harness, intacto desde que lo escribió) y los que tú
   editaste (exigen revisión, nunca se borran solos). Usa ese plan para armar el
   resumen del paso 3 — no le pidas OK al usuario todavía.

3. Aplica directo, sin esperar confirmación intermedia:

   ```
   npx -y github:soutecdev/souclaude-harness#v3 upgrade --prune
   ```

   Esto actualiza los archivos que no editaste, deja `.new` al lado de los que sí
   editaste y **borra sin preguntar** los obsoletos que nunca tocaste. Los
   obsoletos que sí editaste **no se borran solos**: quedan reportados para que
   los revises en el paso 4.

   El mismo `upgrade` instala o actualiza solo el CLI global `souclaude` si
   falta o está en otra versión. Apenas termine, verifícalo según la sección
   "CLI global `souclaude`" (más abajo) y resuelve cualquier fallo antes de
   seguir: sin ese CLI no hay `souclaude vault-sync` ni `souclaude monitor`.

4. **Si el upgrade dejó archivos `.new`**, es porque el harness cambió una
   sección que tú también habías editado. Revisa cada uno:

   ```
   git diff --no-index CLAUDE.md CLAUDE.md.new
   ```

   Mergea por hunk, nunca el archivo entero:
   - Hunks en secciones propias del harness (reglas de Git, "Los dos repos",
     Language, Behavior expectations, y equivalentes en otros archivos
     gestionados) → toma la versión del `.new`.
   - Hunks en secciones que el usuario llenó (Contexto, Reglas técnicas
     críticas, contenido específico del proyecto) → conserva el original, **sin
     tocarlo**.
   - Si un hunk es ambiguo, conserva el original y avísalo en el reporte final
     en vez de decidir por tu cuenta.

   Borra el `.new` después de mergear. Nunca copies un `.new` entero encima del
   original sin pasar por esta revisión hunk por hunk.

5. **Ficha del Observatorio, solo si hace falta.** Si el repo tiene el Vault
   conectado (`.claude/vault.local.json`), verifica si "Próxima versión" de
   `Project-<PREFIJO>/OBSERVATORIO.md` ya refleja la Roca vigente del proyecto
   — el mismo chequeo que al instalar el harness, detallado en la skill
   `soutec-github` (sección "Ficha del Observatorio"): busca
   `Roca_<trimestre>_<PREFIJO>.md`, toma el trimestre vigente, y compara sus
   hitos de producto contra las líneas con etiqueta `<PREFIJO>-H<n>` que ya
   están en "Próxima versión". **Si ya coinciden, no hay nada que hacer** —
   esto no es un paso que reescriba o pushee en cada upgrade. Solo si falta,
   cambió o sobra una línea, corrígela y pushea al Vault en el momento. Sin
   Vault conectado o sin Roca, tampoco hay nada que hacer — no lo preguntes.

6. **Reporte final.** Avísale al usuario, en un resumen corto:
   - versión anterior → versión nueva.
   - CLI global `souclaude`: ya estaba al día, se instaló o actualizó (con qué
     versión), o qué quedó sin resolver y por qué.
   - qué se borró sin preguntar (obsoletos sin editar).
   - qué obsoletos editados quedaron pendientes de revisión (con la ruta).
   - qué `.new` se mergearon y qué se preservó de lo suyo en cada uno.
   - cualquier archivo que se saltó por stack (ver sección de abajo).
   - qué cambió en "Próxima versión" de OBSERVATORIO.md, si algo cambió.

   Si no hubo nada relevante que avisar más allá de "actualizado a la última
   versión", con esa línea alcanza.

## CLI global `souclaude`

`init` y `upgrade` instalan o actualizan el CLI global solos (fuera de CI), así
que casi siempre ya está listo. Verifícalo siempre, aunque el harness no haya
cambiado:

```
souclaude --version
```

Tiene que existir y mostrar la misma versión que `harnessVersion` de
`.claude/harness.json`. Si no la muestra, instálalo o actualízalo:

```
npm install -g github:soutecdev/souclaude-harness#v3
```

Si falla, diagnostica y resuelve; no te quedes en el aviso. Causas conocidas:

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `souclaude: command not found`, pero `npm ls -g souclaude-harness` lo muestra | La carpeta de binarios globales de npm no está en el `PATH` | Obtén la carpeta con `npm prefix -g` (en Windows los binarios quedan ahí mismo; en macOS/Linux, en `<prefix>/bin`). Agrégala al `PATH` del usuario y prueba de nuevo con una terminal nueva. |
| `EACCES` / `permission denied` (macOS/Linux) | El prefijo global de npm es del sistema (`/usr/local`) | **Nunca uses `sudo`.** `npm config set prefix ~/.npm-global`, agrega `~/.npm-global/bin` al `PATH` y reinstala. |
| `EPERM` / `EBUSY` (Windows) | Un `souclaude monitor` en ejecución bloquea los archivos del paquete | Cierra el monitor y reinstala. |
| Error de `git` o `Repository not found` / `403` | Falta `git` o no hay credenciales de GitHub con acceso a `soutecdev/souclaude-harness` | Con `git ls-remote https://github.com/soutecdev/souclaude-harness.git` confirma el acceso. Si falta autenticación, pide al usuario que corra `! gh auth login`. |
| `ETIMEDOUT` / `ENOTFOUND` | Sin red o con proxy | Reintenta una vez. Si sigue, revisa `npm config get proxy` y repórtalo. |
| La instalación termina pero `souclaude --version` sigue viejo | Otro `souclaude` gana en el `PATH` (un `npm link`, otra instalación) o quedó una versión en caché | `where souclaude` (Windows) o `which -a souclaude` para ver cuál gana; `npm uninstall -g souclaude-harness` y reinstala. |
| `Unsupported engine` o errores de sintaxis al correr | Node menor a 22.4 | Actualizar Node es decisión del usuario: repórtalo con la versión actual (`node --version`). |

Después de cada corrección, vuelve a correr `souclaude --version`. Si tras dos
intentos sigue fallando, para y repórtalo con el error exacto: el harness del
repo quedó bien igual, lo que falta es la máquina.

## Único punto donde SÍ hay que parar

- Un obsoleto que el usuario editó no se borra sin que él lo apruebe. Repórtalo
  en el paso 5 y pregúntale si quiere que lo borres.
- Un hunk ambiguo de un `.new` no se resuelve solo: se deja como está y se
  reporta.

Fuera de esos dos casos, el flujo completo corre sin pedir OK intermedio — para
eso es "una sola instrucción".

## Tag-release fuera de Node

El harness solo distribuye `scripts/tag-release.mjs` y
`.github/workflows/tag-release.yml` en repos donde detecta Node (`package.json`).
Si el `init`/`upgrade` reporta *"No se instalaron por stack"* para esos dos
archivos, es tu trabajo escribirlos a mano para el stack real del proyecto — no
hay variantes empaquetadas por lenguaje: el contrato es siempre el mismo y tú lo
adaptas mejor que un template genérico.

1. **Fuente de versión**: lee el SemVer del archivo que ese stack usa para
   versionar (`pyproject.toml`/`setup.cfg` en Python, `Cargo.toml` en Rust, el
   `.csproj` en .NET, etc.). Si no hay una fuente de versión obvia, para y
   pregunta — no inventes un esquema.
2. **Tags**: crea el tag anotado e inmutable `vX.Y.Z` (falla si no es SemVer
   válido) y mueve a la fuerza el tag móvil de la major, `vX`, al mismo commit.
3. **Idempotencia**: si `vX.Y.Z` ya existe, no falla ni duplica — solo lo
   reporta y sale en 0. El tag móvil sí se reasigna siempre.
4. **Disparo**: workflow de GitHub Actions en `pull_request` `closed` con
   `base: main`, condicionado a `github.event.pull_request.merged == true`,
   usando el runtime del stack detectado (no `actions/setup-node` si el
   proyecto no es Node).
5. **Nunca crea el GitHub Release**: eso lo sigue haciendo el coordinador a
   mano, igual que en el resto de la organización.

Usa `scripts/tag-release.mjs` y `.github/workflows/tag-release.yml` (el ejemplo
Node del propio harness) como referencia del contrato, no como plantilla a
copiar literal.

Si el `upgrade` marca esos archivos como `obsoleto` (por ejemplo porque el
harness los instaló sin condicionar por stack antes de SHS-M28, o el stack del
proyecto cambió), reemplázalos por la variante de tu stack en el mismo
momento — no dejes el script Node muerto en el repo.

## Qué NO hacer

- No corras `upgrade --force`. Pisa lo que el usuario escribió.
- No borres un obsoleto editado sin su OK explícito.
- No edites `.claude/harness.json` a mano. Es el lockfile: lo gestiona el CLI.
