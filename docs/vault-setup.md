# Runbook — crear el Vault y conectarlo con Obsidian

> Procedimiento concreto (una sola vez, por organización). La doctrina —qué es el Vault,
> quién escribe qué, qué NO va— vive en [vault-guide.md](vault-guide.md). Aquí van los
> comandos y los pasos de Obsidian. El Vault es **singleton**: se hace una vez y todos los
> proyectos apuntan al mismo.

## 0. Decisión previa: ¿repo git o carpeta sincronizada?

| Opción | Cuándo | Trade-off |
|---|---|---|
| **Repo git** (recomendado) | Varias personas y agentes escribiendo | Historial, PRs para lo estratégico, sin conflictos silenciosos. Es lo que asume la §7 de la guía. |
| Carpeta sincronizada (OneDrive/SharePoint) | Una sola persona, arranque rápido | Sin historial ni PRs; convención manual para evitar pisar archivos. Migrable a git después. |

Este runbook cubre el camino **repo git**. Si arrancas con carpeta, salta la §1 y usa la
carpeta directamente como base del §2.

## 1. El repo del Vault

> **El Vault ya existe**: `https://github.com/ialvarezsoutec/soubunker-vault.git`. Es
> singleton — no se crea otro. Lo normal, en una máquina nueva, es **clonarlo**:
>
> ```powershell
> git clone https://github.com/ialvarezsoutec/soubunker-vault.git
> ```
>
> Y ni eso hace falta a mano: `npx souclaude` en cualquier repo de proyecto pregunta si lo
> tienes y lo clona por ti (§4). El resto de esta sección es **la creación desde cero**, que
> ya se hizo una vez y se conserva como referencia.

El Vault es un repo **aparte** de cualquier proyecto (nunca dentro de un repo de código).

**PowerShell (Windows — shell por defecto):**

```powershell
# 1. Carpeta local del Vault, fuera de los repos de código
New-Item -ItemType Directory Vault
Set-Location Vault
git init

# 2. Estructura base (§2 de la guía). En PowerShell, -p no existe:
#    New-Item -Force crea toda la ruta intermedia sin error si ya existe.
New-Item -ItemType Directory -Force 00-System\templates, evidence

# 3. Semillas del sistema (§3 de la guía)
#    - 00-System\id-registry.md         → tabla de prefijos activos
#    - 00-System\metodologia-roca.md     → copia de referencia v2.1.0
#    - 00-System\templates\plantilla_apertura_roca.yaml
#    (crea estos tres archivos con el contenido de la guía)

# 4. Higiene git
".obsidian/workspace*`n.obsidian/cache`n.trash/" |
  Set-Content -Encoding utf8 .gitignore

git add .
git commit -m "chore: estructura semilla del Vault (00-System, evidence)"
```

**Bash / macOS / Linux (equivalente):**

```bash
mkdir Vault && cd Vault
git init
mkdir -p 00-System/templates evidence
printf '.obsidian/workspace*\n.obsidian/cache\n.trash/\n' > .gitignore
git add .
git commit -m "chore: estructura semilla del Vault (00-System, evidence)"
```

**Sobre `.gitignore` y Obsidian**: versiona `.obsidian/` (plugins y config compartida)
**menos** los archivos de estado local por máquina (`workspace*`, `cache`). Así el plugin
Kanban y su configuración viajan con el repo y nadie lo instala dos veces.

Luego crea el remoto en GitHub (yo no creo repos ni remotos — eso lo hace el coordinador).
**No pongas revisión obligatoria en `main`**: los agentes pushean directo para mantener el
tablero vivo (§4). La capa de vista (kanban, espejos) se particiona sola por
`Project-<PREFIJO>/`, y la estratégica se cuida por convención.

## 2. Sembrar los proyectos

Una carpeta por proyecto activo, con un `kanban.md` vacío listo para el plugin:

**PowerShell (Windows):**

```powershell
New-Item -ItemType Directory -Force Project-REA\specs, Project-REA\progress

# Here-string de una sola cita ('@ ... '@) = contenido literal, sin expandir $.
# El cierre '@ debe ir pegado al margen izquierdo (columna 0), sin sangría.
@'
---
kanban-plugin: board
---

## Backlog

## En curso

## En review

## Hecho
'@ | Set-Content -Encoding utf8 Project-REA\kanban.md
```

**Bash / macOS / Linux (equivalente):**

```bash
mkdir -p Project-REA/specs Project-REA/progress
cat > Project-REA/kanban.md <<'EOF'
---
kanban-plugin: board
---

## Backlog

## En curso

## En review

## Hecho
EOF
```

Repite por cada prefijo de `id-registry.md`. Los `roca_*.yaml` **no** se crean a mano:
nacen en la próxima `/rock-plan`.

## 3. Conectar con Obsidian

Obsidian trabaja sobre una carpeta local: el "vault de Obsidian" es, literalmente, la
carpeta `Vault/` que acabas de clonar. No hay import ni sync propietario.

1. **Abrir la carpeta como vault**: Obsidian → `Open folder as vault` → elige la carpeta
   `Vault/` (el clon local del repo).
2. **Instalar el plugin Kanban**: `Settings → Community plugins → Browse` → busca
   **Kanban** (de mgmeyers) → `Install` → `Enable`. Con el repo versionado (§1), si otra
   persona ya lo instaló, al hacer `git pull` el plugin llega en `.obsidian/plugins/` y
   solo hay que habilitarlo.
3. **Ver los tableros**: abre cualquier `Project-<PREFIJO>/kanban.md`. Con el plugin
   activo se renderiza como tablero; sin él, se ve como Markdown plano (las columnas son
   `## Backlog`, `## En curso`, `## En review`, `## Hecho`).
4. **Opcional — Git dentro de Obsidian**: plugin **Obsidian Git** para hacer
   pull/commit/push sin salir de la app. Útil para los dueños de roca que no viven en la
   terminal. La regla de `main` protegido sigue aplicando: lo estratégico va por PR.

**Importante**: Obsidian y git son capas independientes sobre la misma carpeta. Obsidian
edita archivos; git los versiona. No hay conflicto entre ambos mientras respetes la
partición por proyecto de la §7 de la guía.

## 4. Conectar cada repo de código al Vault

**Lo hace el instalador.** Al correr `npx souclaude` (harness ≥ 2.3.0) en un repo de
proyecto, después de aplicar el plan aparece el paso del Vault:

1. *¿Tienes el Vault clonado en esta máquina?*
   - **Sí** → pide la ruta local y la valida (busca `00-System/`).
   - **No** → propone clonarlo junto al repo (`../soubunker-vault`) y lo clona.
2. Escribe la ruta en **`.claude/vault.local.json`** del repo. Ese archivo está
   gitignorado: la ruta es de **esta máquina** y no debe viajar a la de otro.

Sin modo interactivo:

```powershell
npx souclaude upgrade --vault-path "C:/ruta/a/soubunker-vault"
npx souclaude init --no-vault          # omitir el paso por completo
npx souclaude init --vault-repo <url>  # clonar otro repo (casos raros)
```

Con `--yes` o en CI el paso **nunca clona**: solo usa `--vault-path` si se lo pasas. Si no
hay Vault conectado, el espejo se **omite sin bloquear el trabajo** y queda anotado como
`vault_skip` en el `history.md` del repo (§6 de la guía).

> **Por qué no es el `.env`**: `.claude/settings.json` deniega `Read(./.env)`, así que un
> agente no puede abrirlo — `VAULT_PATH` ahí nunca fue legible para ellos. En `.env.example`
> se conserva comentada, pero solo para el runtime de la aplicación.

### Los dos repos

Cada agente pushea a **dos remotos distintos** y las reglas son opuestas a propósito:

| | Repo del proyecto | Repo del Vault |
|---|---|---|
| Cómo se escribe | Rama + PR. **Nunca** directo a `main` | **Push directo a `main`**, sin PR |
| Por qué | Todo cambio se revisa | El tablero refleja el ahora, no el último merge |

Antes de tomar un task, el agente hace `git -C "<vault>" pull --rebase` y lee
`Project-<PREFIJO>/kanban.md`: si la tarjeta ya está "En curso" con otro dueño, **para y
pregunta**. Es el anti-solapamiento entre máquinas. El protocolo completo (convención de
commits del Vault y resolución de conflictos del kanban) vive en el `progress/README.md`
que el harness instala en cada repo.

Consecuencia operativa: **el `main` del Vault no puede estar protegido con revisión
obligatoria** — bloquearía el push directo y el tablero dejaría de ser estado vivo. La
disciplina de la capa estratégica (`00-System/`, `roca_*.yaml`) queda por convención: solo
se agregan filas, cada roca tiene un dueño, y lo estratégico se revisa en la reunión, no en
un PR.

## 5. Checklist final

- [ ] `Vault/` es un repo git aparte, con `main` protegido para lo estratégico.
- [ ] `00-System/` tiene `id-registry.md` (prefijos con dueño), `metodologia-roca.md` y
      `templates/plantilla_apertura_roca.yaml`.
- [ ] Una `Project-<PREFIJO>/` por proyecto activo, cada una con `kanban.md` semilla.
- [ ] `.gitignore` ignora el estado local de Obsidian, versiona el resto de `.obsidian/`.
- [ ] Obsidian abre la carpeta como vault y el plugin **Kanban** está habilitado.
- [ ] Cada repo de código corrió `npx souclaude` y tiene su `.claude/vault.local.json`.
- [ ] El `main` del Vault **no** exige revisión: los agentes pushean directo (§4).
- [ ] Regla de oro anunciada: **sin milestone del Vault no hay rama, y una rama por
      milestone** (las tareas son commits en esa rama, no ramas propias).
