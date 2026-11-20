# Prompt de instalación del harness

Un solo prompt instala el harness en **cualquier** punto de partida: un proyecto
que todavía no tiene repo, una carpeta sin git, un repo nuevo, uno con años de
código, uno con un `CLAUDE.md` hecho a mano o uno que ya tiene el harness. No hay
que elegir el caso ni sustituir variables: el agente diagnostica la carpeta, te
pregunta solo lo que no puede deducir e instala.

**Cómo se usa**: abre Claude Code en la carpeta del proyecto (si el proyecto nace
desde cero, crea una carpeta vacía y ábrelo ahí) y pega [el prompt](#el-prompt).

## Antes de pegar

- **La carpeta vive fuera de OneDrive.** OneDrive sincroniza `.git/` y lo corrompe.
  Si ya está adentro, el diagnóstico lo avisa y el agente te pregunta antes de seguir.
- **La máquina cumple los requisitos** de abajo. Si falta alguno, el agente se
  detiene y te dice exactamente qué instalar.
- **Ten a mano las decisiones que son de personas**, porque el agente te las va a
  preguntar: modo de trabajo (equipo o solo), qué tablero espeja el Vault (Jira o
  Azure Boards) y, si el proyecto es nuevo, el prefijo (2 a 6 letras mayúsculas,
  libre en el registro del Vault y **para siempre**) y la visibilidad del repo.

## Valores vigentes (generados — no los edites a mano)

<!-- souclaude:gen version -->
Documenta el **harness souclaude v3.21.0**. El sello lo regenera `node scripts/gen-docs-metodologia.mjs` y siempre coincide con la versión de `package.json`.
<!-- /souclaude:gen version -->

Requisitos de máquina:

<!-- souclaude:gen requisitos -->
- **Node.js ≥ 22.4** y **git** — corren el CLI del harness y el flujo de ramas.
- **GitHub CLI (`gh`) autenticado** (`gh auth status`) — con él el agente opera GitHub por ti, sobre todo abrir los Pull Requests.
- **Acceso de escritura al repo del Vault** de SOUTEC.
<!-- /souclaude:gen requisitos -->

Comando de instalación:

<!-- souclaude:gen instalacion -->
```bash
npx github:soutecdev/souclaude-harness#v3
```

El CLI global (habilita `souclaude status`, `souclaude monitor` y `souclaude vault-sync` desde cualquier repo) lo instalan y actualizan solos `init` y `upgrade`. Para instalarlo a mano, una vez por máquina:

```bash
npm install -g github:soutecdev/souclaude-harness#v3
```
<!-- /souclaude:gen instalacion -->

Skills disponibles al instalar:

<!-- souclaude:gen skills -->
| Skill | Modo | Qué hace |
|---|---|---|
| `soutec-github` | equipo · obligatoria | flujo Git/GitHub de SOUTEC |
| `soutec-github-solo` | solo · obligatoria | flujo Git fluido del modo solo |
| `it-security-review` | equipo y solo | workflow de security review para IT |
| `security-report-standard` | equipo y solo | estándar de informes de seguridad |
| `cloudflare-security-audit` | equipo y solo | auditoría de seguridad de Cloudflare (solo a pedido, con /cloudflare-security-audit) |
| `soutec-md-a-pdf` | equipo y solo | Markdown a PDF con identidad Soutec |
| `adr-new` | equipo y solo | documentar decisiones con ADRs |
| `harness-upgrade` | equipo y solo | actualizar el harness desde Claude |
| `vault-milestones` | equipo | análisis e iteración de milestones en el Vault |
| `jira-sync` | equipo | espejo del tablero del Vault en Jira vía MCP de Atlassian |
| `azdo-sync` | equipo | espejo del tablero del Vault en Azure DevOps Boards vía MCP |
<!-- /souclaude:gen skills -->

## El prompt

Se pega tal cual, sin editar:

```text
Instala el harness de Claude Code de SOUTEC en esta carpeta. Sigue las cinco fases
en orden, sin saltarte ninguna.

REGLAS DE TODA LA INSTALACIÓN
- El instalador se invoca SIEMPRE así: npx -y github:soutecdev/souclaude-harness#v3 <comando>
  Nunca con el nombre corto del paquete en npx: ese nombre no es el del harness.
- No tienes terminal interactiva: todo comando que escribe lleva --yes y las
  respuestas van por flags. Nunca uses --force ni --prune en esta instalación.
- No adivines ninguna decisión mía: si un dato no sale del diagnóstico, pregúntamelo.
- No toques código del proyecto: solo la superficie del harness.
- Si un comando falla, detente y muéstrame el error literal. Sin rodeos ni
  soluciones alternativas por tu cuenta.

FASE 1 · DIAGNÓSTICO (solo lectura)
1. Corre: npx -y github:soutecdev/souclaude-harness#v3 diagnostico --json
   Si el comando no arranca (no hay Node, o es anterior a 22.4), detente y dime que
   instale Node 22.4 o superior y reabra la terminal.
2. Si "bloqueos" no está vacío: detente, muéstrame cada bloqueo con su solución y
   no sigas hasta que te diga que está resuelto; entonces repite el diagnóstico.
3. Resúmeme en pocas líneas: el "caso", el "comando" que corresponde, los "avisos"
   y los "pendientes".
4. Avisos que exigen mi respuesta antes de seguir:
   - gh o gh-auth: dame la instrucción de su "solucion" y espera a que te confirme.
   - onedrive: pregúntame si muevo la carpeta fuera de OneDrive antes de instalar.
   - arbol-sucio: pregúntame si commiteo o guardo mis cambios antes.
   - remoto-inaccesible o remoto-no-github: muéstramelo y pregúntame cómo seguir.
5. Si el caso es "harness-al-dia": no hay nada que instalar; salta a la fase 5.
   Si es "harness-desactualizado": aplica la skill harness-upgrade en vez de las
   fases 2 a 4, y cierra con la fase 5.

FASE 2 · DECISIONES (pregúntame todo junto, una sola vez)
Pregunta solo lo que aplica al caso y el diagnóstico no resuelve:
a) Modo de trabajo: equipo (metodología completa) o solo (una sola persona). Si
   "harness.modo" ya lo trae, no lo preguntes.
b) Nombre del proyecto (propón "carpeta.nombre"), tipo (backend, frontend, data,
   ml, automation, infra o integration) e idioma de las respuestas (es o en).
c) Skills: muéstrame las de "catalogoSkills" que aplican al modo elegido y dime
   cuáles recomiendas para este proyecto. Las obligatorias entran siempre. Para el
   espejo del tablero se elige jira-sync O azdo-sync, nunca las dos.
d) Vault, según los pendientes:
   - conectar-vault: pregúntame si ya tengo un clon (y su ruta) o si lo clonas, y
     dónde. La ruta va fuera de este repo y fuera de OneDrive.
   - alta-prefijo: muéstrame "vault.proyectos" y pregúntame si este repo pertenece
     a uno de esos o es un proyecto nuevo. Si es nuevo, pídeme el prefijo (2 a 6
     letras mayúsculas, que no esté en "vault.prefijosRegistrados"; es para
     siempre), el nombre del proyecto y su dueño.
   - quien: pídeme mi alias de contribuyente.
   Si todavía no hay Vault en la máquina, estas dos últimas preguntas las haces
   después de conectarlo, repitiendo el diagnóstico.
e) Solo si hay un pendiente crear-repo-github: pregúntame si el repo ya existe en
   GitHub (y su URL) o si lo creas tú. Si lo creas, pídeme nombre, organización o
   cuenta y visibilidad (privado salvo que yo diga otra cosa).
f) Solo en modo equipo y si el repo ya existía con historia: pregúntame si la
   protección de main la administra la organización o ya tiene reglas propias. El
   instalador la reescribe entera; si te digo que sí, usa --no-github-protect.

FASE 3 · PREPARAR GIT (solo los pendientes que haya)
- git-init: git init -b main
- crear-repo-github: repíteme nombre, organización y visibilidad y espera mi "sí"
  explícito. Solo entonces:
  gh repo create <organización>/<nombre> --private --source . --remote origin
  (--public o --internal solo si te lo pedí). Si el repo ya existía:
  git remote add origin <url>
- primer-commit: es el único commit que va directo a main, porque sin él no puede
  nacer dev. Hazlo vacío: git commit --allow-empty -m "chore: inicio del repositorio"
  Si la carpeta ya tenía archivos (caso carpeta-sin-git), pregúntame antes si van
  en ese commit inicial o los dejo fuera del repo.
- pushear-main: git push -u origin main
- crear-dev (solo modo equipo): git switch -c dev   y   git push -u origin dev
- pushear-dev: git push -u origin dev
- Rama de instalación: en modo equipo, git switch dev y luego
  git switch -c chore/instalar-harness. Todo lo que sigue se commitea ahí, nunca en
  main ni en dev. En modo solo trabaja en main.

FASE 4 · INSTALAR
Arma UN comando con las decisiones de la fase 2 y muéstramelo antes de correrlo.
- comando "init":
  npx -y github:soutecdev/souclaude-harness#v3 init --yes --name "<nombre>"
    --type <tipo> --lang <es|en> <--equipo|--solo> --skills <a,b,c> <flags del Vault>
- comando "adopt" (ya hay un CLAUDE.md o .claude/ hechos a mano): son dos pasos.
  Primero adopt --yes --name "<nombre>" --type <tipo> --lang <es|en>, que no toca
  ningún archivo; después upgrade --yes <--equipo|--solo> --skills <a,b,c>
  <flags del Vault>. Lo que yo había escrito no se pisa: la propuesta del harness
  queda al lado como <archivo>.new. No los fusiones por tu cuenta: enuméralos y
  pregúntame.
- comando "upgrade" con caso "maquina-nueva": upgrade --yes <flags del Vault>.
  Aquí no se elige modo ni skills: ya están en el repo.
Flags del Vault, según lo decidido:
  --vault-path "<ruta>"       ya tengo el clon en esa ruta
  --vault-clone               clónalo (con --vault-path "<ruta>" si elegí dónde)
  --vault-project Project-XXX el repo pertenece a un proyecto que ya existe
  --vault-seed                el registro ya conoce el repo y falta su carpeta
  --vault-prefix XXX --vault-project-name "<nombre>" --vault-owner "@<dueño>"
                              proyecto nuevo: lo da de alta y siembra su carpeta
  --vault-quien "<alias>"     mi alias de contribuyente
Si el Vault no se puede clonar (sin acceso): detente y dime que pida acceso de
escritura al Vault al coordinador. En modo equipo la instalación no está completa
sin Vault.

FASE 5 · VERIFICAR Y CERRAR
1. Repite el diagnóstico (--json): no debe haber bloqueos. Lista los pendientes
   que queden.
2. Corre: npx -y github:soutecdev/souclaude-harness#v3 status
   Exit 0 o 2 es correcto (2 = hay archivos .new o ediciones mías por revisar);
   exit 1 significa que quedó algo sin aplicar: muéstramelo.
3. Commitea la instalación: chore: instala el harness souclaude v<versión>
   .claude/vault.local.json no se commitea (es de esta máquina). Haz push de la
   rama. En modo equipo pregúntame, una sola vez, si abres el PR contra dev.
4. Lee el CLAUDE.md instalado y progress/README.md. Si la sección "Contexto" de
   CLAUDE.md quedó con el texto de plantilla, pregúntame en una línea qué hace el
   proyecto y complétala.
5. Dame el reporte final:
   - caso detectado, versión instalada, modo y skills;
   - Vault: ruta, proyecto declarado y si se dio de alta un prefijo nuevo;
   - qué creaste en GitHub (repo, ramas, protección de main);
   - qué quedó pendiente y de quién es: autorizar el conector del tablero (/mcp,
     OAuth, lo hago yo), el merge del PR (coordinador), archivos .new por revisar;
   - mi primer paso: declarar o dar de alta el primer milestone en el Vault.
```

## Qué hace en cada caso

El diagnóstico (`souclaude diagnostico`) clasifica la carpeta en uno de estos
casos; el prompt hace lo que corresponde a cada uno.

| Caso | Punto de partida | Qué hace el agente |
|---|---|---|
| `proyecto-desde-cero` | Carpeta vacía, sin git ni repo | `git init`, crea el repo con `gh` tras tu confirmación, commit inicial, `dev`, e `init` en una rama con PR a `dev` |
| `carpeta-sin-git` | Archivos sueltos, sin git | Igual que el anterior, sin tocar tus archivos |
| `repo-sin-remoto` | Repo local sin `origin` | Crea o conecta el repo de GitHub, completa `main`/`dev` e `init` |
| `repo-vacio` | Repo recién creado, sin código | Commit inicial y `dev` si faltan; `init` emite además `src/`, `tests/` y `README` |
| `repo-con-codigo` | Repo con historia, sin harness | `init`: solo la superficie Claude, no toca tu código |
| `estructura-previa` | `CLAUDE.md` o `.claude/` hechos a mano | `adopt` y después `upgrade`; lo tuyo no se pisa, la propuesta queda en `.new` |
| `maquina-nueva` | Repo con harness, primera vez en esta máquina | `upgrade` para conectar el Vault y declarar el proyecto; no reinstala nada |
| `harness-desactualizado` | Repo con una versión anterior | Skill `harness-upgrade` |
| `harness-al-dia` | Repo con el harness vigente | Nada que instalar: solo verifica |

Y se detiene, con la instrucción exacta para resolverlo, cuando:

- **falta un requisito de máquina** (Node anterior a 22.4, sin git, `gh` ausente o
  sin autenticar);
- **la sesión está en un subdirectorio** del repo (el harness va en la raíz);
- **`.claude/harness.json` está dañado**;
- **no hay acceso al Vault**.

En **modo solo** no se crea `dev`, no se protege `main` y no hay PR: el flujo de
ese modo es directo.

## Lo que el agente no decide por ti

- El **prefijo** del proyecto y la **visibilidad** del repo: te los pregunta y, para
  crear el repo, espera tu confirmación explícita.
- Fusionar un archivo `.new` con el tuyo.
- Autorizar el conector del tablero (Jira o Azure Boards): es OAuth, una vez por
  máquina, desde `/mcp`.
- Aprobar y mergear el PR de instalación: es del coordinador.

## Después de instalar

- **Actualizar el harness** más adelante: no hace falta nada — al abrir una sesión,
  el harness avisa si hay versión nueva; o dile al agente "actualiza el harness"
  (skill `harness-upgrade`).
- **El primer milestone**: antes de cualquier código, el agente te pedirá declarar
  (o dar de alta) el milestone del Vault — es la regla central de la metodología.
- **El detalle de cada paso** (crear el proyecto en Jira, el primer milestone, un
  proyecto sin tablero externo) sigue en el
  [playbook de bootstrap](../bootstrap-proyecto-plantillas-prompts.md).
