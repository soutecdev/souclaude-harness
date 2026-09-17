---
name: harness-upgrade
description: Actualiza el harness CCEM de este repo (skills, comandos, templates SDD, settings) a la última versión publicada, sin pisar nada que hayas editado tú. Actívate cuando el usuario pida actualizar, upgradear o traer la última versión del harness (ej. "actualiza el harness", "hay una versión nueva del harness", "upgradea el harness").
---

# /harness-upgrade

Estado actual del harness:

```!
npx -y github:ialvarezsoutec/souclaude-harness#v3 status
```

## Qué hacer

1. Muéstrale al usuario el estado de arriba, en una línea: qué versión tiene, cuál
   hay disponible, y qué archivos editó él.

2. Corre el upgrade en seco primero. **Siempre en seco primero.**

   ```
   npx -y github:ialvarezsoutec/souclaude-harness#v3 upgrade --dry-run
   ```

3. Muéstrale el plan y **espera su OK**. No apliques nada sin confirmación (P5).

4. Con el OK, aplicá:

   ```
   npx -y github:ialvarezsoutec/souclaude-harness#v3 upgrade
   ```

5. Si el upgrade dejó archivos `.new`, es porque esos archivos los editaste tú y el
   harness **no los pisa**. Ofrece revisar cada uno:

   ```
   git diff --no-index CLAUDE.md CLAUDE.md.new
   ```

   Ayúdalo a mergear lo que quiera incorporar, y después borrá el `.new`. Nunca
   copies el `.new` encima del original sin que él lo apruebe archivo por archivo.

## Tag-release fuera de Node

El harness solo distribuye `scripts/tag-release.mjs` y
`.github/workflows/tag-release.yml` en repos donde detecta Node (`package.json`).
Si el `init`/`upgrade` reporta *"No se instalaron por stack"* para esos dos
archivos, es tu trabajo escribirlos a mano para el stack real del proyecto — no
hay variantes empaquetadas por lenguaje: el contrato es siempre el mismo y vos lo
adaptás mejor que un template genérico.

1. **Fuente de versión**: leé el SemVer del archivo que ese stack usa para
   versionar (`pyproject.toml`/`setup.cfg` en Python, `Cargo.toml` en Rust, el
   `.csproj` en .NET, etc.). Si no hay una fuente de versión obvia, para y
   pregunta — no inventes un esquema.
2. **Tags**: creá el tag anotado e inmutable `vX.Y.Z` (falla si no es SemVer
   válido) y movés a la fuerza el tag móvil de la major, `vX`, al mismo commit.
3. **Idempotencia**: si `vX.Y.Z` ya existe, no falla ni duplica — solo lo
   reporta y sale en 0. El tag móvil sí se reasigna siempre.
4. **Disparo**: workflow de GitHub Actions en `pull_request` `closed` con
   `base: main`, condicionado a `github.event.pull_request.merged == true`,
   usando el runtime del stack detectado (no `actions/setup-node` si el
   proyecto no es Node).
5. **Nunca crea el GitHub Release**: eso lo sigue haciendo el coordinador a
   mano, igual que en el resto de la organización.

Usá `scripts/tag-release.mjs` y `.github/workflows/tag-release.yml` (el ejemplo
Node del propio harness) como referencia del contrato, no como plantilla a
copiar literal.

Si el `upgrade` marca esos archivos como `obsoleto` (por ejemplo porque el
harness los instaló sin condicionar por stack antes de SHS-M28, o el stack del
proyecto cambió), reemplazalos por la variante de tu stack en el mismo
momento — no dejes el script Node muerto en el repo.

## Qué NO hacer

- No corras `upgrade --force`. Pisa lo que el usuario escribió.
- No corras `--prune` salvo que él lo pida explícitamente: borra archivos.
- No edites `.claude/harness.json` a mano. Es el lockfile: lo gestiona el CLI.
