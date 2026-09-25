# Guía del desarrollador — cómo trabajamos en SOUTEC

Bienvenido. Esta guía te dice **cómo desarrollar** en un repo de SOUTEC: el flujo con
Git y las herramientas que Claude Code ya tiene instaladas para ayudarte. Si la sigues,
tu código entra sin fricción y queda trazable.

Léela una vez entera. Después la usas de referencia.

---

## En una frase

**El modelo trabaja directo, sin ceremonia. Git/GitHub registra el HECHO, y las skills
de SOUTEC cuidan que se registre bien.**

---

## Día 1 — setup

1. Ten **git** y **Node ≥ 20** instalados.
2. Clona el repo en el que vas a trabajar. Si ya tiene una carpeta `.claude/` y un
   `CLAUDE.md`, **ya tiene el harness**: no hace falta nada más.
3. Si arrancas un repo desde cero (o uno viejo sin harness), instálalo:
   ```bash
   npx github:soutecdev/souclaude-harness#v3
   ```
   Corre igual en un repo vacío y en uno con años de código: en el legacy solo agrega la
   superficie de Claude, no toca tu código. El instalador te deja elegir con un checkbox
   qué skills instalar (`soutec-github` es obligatoria y entra siempre).
4. Abre el repo con Claude Code. Lo primero que Claude lee es `CLAUDE.md`.

---

## Las reglas de oro

Estas no se negocian. Si te acuerdas solo de esto, ya evitas el 90% de los problemas.

1. **Nunca commit, push ni merge directo a `main`.** Todo pasa por rama + Pull Request.
   Los hotfixes también. `main` solo recibe merges desde `dev`: tu rama nace de `dev`
   y tu PR apunta a `dev`; el paso `dev` → `main` es el release.
2. **Ramas con nombre descriptivo**: `tipo/descripcion-corta`. Si el trabajo tiene un ID
   de tarea en un tracker, va como prefijo del slug — pero no inventes IDs.
3. **Lo más simple que resuelva el problema.** Nada especulativo. Si escribiste 200
   líneas y podían ser 50, reescribe.
4. **Cambios quirúrgicos.** Cada línea que cambias traza al pedido. Nada de "ya que
   estoy, mejoro esto otro".
5. **Secretos jamás en el repo.** Ni `.env`, ni claves, ni tokens.

---

## Tu flujo diario

```
1. Tomas una tarjeta del kanban del Vault (y la mueves a En curso en ese momento)
2. Creas la rama                 ──►  feature/login-usuarios
3. Trabajas con Claude, commits chicos y frecuentes
4. Abres el PR draft tras 2-3 commits (no al final)
5. El coordinador revisa y hace el squash & merge
6. Se despliega y se registra en progress/history.md
```

---

## Las herramientas que ya tienes

Viven en `.claude/skills/`, versionadas con el repo. No hay que instalar nada. Cuáles
tienes depende de lo que se eligió al instalar el harness:

- `soutec-github` — el flujo Git/GitHub obligatorio (siempre está).
- `it-security-review` — security review con evidencia en PDF para IT.
- `security-report-standard` — el estándar de esos informes.
- `soutec-md-a-pdf` — cualquier Markdown a PDF con la identidad Soutec.
- `adr-new` — registra una decisión arquitectónica en `docs/decisions/` (`/adr-new`).
- `harness-upgrade` — actualiza el harness del repo (`/harness-upgrade`).

Las skills se activan solas cuando el contexto lo amerita; los comandos los invocas
con `/`.

---

## Dónde va cada cosa

| Qué | Dónde |
|---|---|
| Decisión arquitectónica con trade-off | `docs/decisions/` (`/adr-new`) |
| Gotcha que te costó más de 1 h | `docs/gotchas/` |
| Pattern que ya viste 3+ veces | `docs/patterns/` |
| Learning del día, nota suelta | `notes.md` |
| Progreso y protocolo del Vault | `progress/` |
| Contexto para Claude | `CLAUDE.md` (<200 líneas) |

Regla mental: si es algo que Claude necesita saber **antes** de empezar → `CLAUDE.md`.
Si es la historia de una decisión → ADR. Si es un gotcha de ayer → `notes.md`.

---

## Git — referencia rápida

```bash
# 1. Parte de dev actualizado y ramifica
git checkout dev && git pull origin dev
git checkout -b feature/login-usuarios

# 2. Commits: tipo: descripción breve (en español, sin scope)
git commit -m "feat: agregar validación de token expirado"
#   tipos: feat fix docs chore refactor test style build ci perf revert
#   un hotfix se commitea como fix:

# 3. Sincronizar con dev (merge, NO rebase por defecto)
git fetch origin && git merge origin/dev

# 4. Abrir el PR contra dev (completa la plantilla de verdad)
git push origin feature/login-usuarios
```

- **Nunca `git push --force`.** El squash & merge lo hace el coordinador, no tú.
- Tú **no** apruebas PRs ni creas repositorios. Los tags de versión los crea el
  agente al publicar, tras el merge de release `dev` → `main`.
- Si te piden correcciones: push a la **misma** rama. Nunca abras un PR nuevo.

El detalle completo (nombres de rama, tipos de commit, plantilla de PR, semver) está en
la skill `soutec-github`. Pregúntale a Claude "revisa mi cambio con soutec-github".

---

## Mantén el harness al día

De vez en cuando salen versiones nuevas (skills mejores, reglas nuevas). Para actualizar:

```
/harness-upgrade
```

o directo:

```bash
npx github:soutecdev/souclaude-harness#v3 upgrade --dry-run   # ver qué cambiaría
npx github:soutecdev/souclaude-harness#v3 upgrade              # aplicarlo
```

**Nunca te va a pisar un archivo que editaste tú.** Si un archivo tuyo difiere del nuevo,
la propuesta queda al lado como `<archivo>.new` y tú decides qué incorporar:

```bash
git diff --no-index CLAUDE.md CLAUDE.md.new
```

---

## Los errores que más se cometen

1. **Rama sin nombre descriptivo** (`arreglo`, `prueba-final`, `mi-feature`).
2. **Scope creep.** Tocaste un archivo que no traza al pedido → sácalo.
3. **PR sin la plantilla completa**, o abrir un PR nuevo por cada corrección.
4. **Tomar una tarjeta del kanban sin moverla a En curso** — otra máquina puede
   agarrar la misma.
5. **Commitear secretos.** Si una credencial se expone: rotarla, no solo borrar el
   commit.
