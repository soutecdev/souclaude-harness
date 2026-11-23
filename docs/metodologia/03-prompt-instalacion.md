# Prompt de instalación del harness

Un solo prompt instala el harness en **cualquier** punto de partida: un proyecto
que todavía no tiene repo, una carpeta sin git, un repo nuevo, uno con años de
código, uno con un `CLAUDE.md` hecho a mano o uno que ya tiene el harness. No hay
que elegir el caso ni sustituir variables: el agente diagnostica la carpeta,
deduce todo lo que puede e instala. **Lo único que decides tú es el prefijo del
proyecto**, y solo si el proyecto es nuevo en el Vault.

**Cómo se usa**: abre Claude Code en la carpeta del proyecto (si el proyecto nace
desde cero, crea una carpeta vacía y ábrelo ahí) y pega [el prompt](#el-prompt).

## Antes de pegar

- **La carpeta vive fuera de OneDrive.** OneDrive sincroniza `.git/` y lo corrompe.
  Si ya está adentro, el diagnóstico lo avisa y el agente te pregunta antes de seguir.
- **La máquina cumple los requisitos** de abajo. Si falta Node o git, el agente se
  detiene y te dice exactamente qué instalar. Si falta `gh` o su sesión, no hace
  falta que lo resuelvas antes: el agente lo instala con tu permiso y te guía por
  el inicio de sesión, que es lo único que tienes que hacer tú en el navegador.
- **Ten pensado el prefijo del proyecto**, si es nuevo: 2 a 6 letras mayúsculas,
  libre en el registro del Vault y **para siempre**. Es lo único que el agente te
  va a preguntar. Todo lo demás lo deduce y te lo muestra en un plan antes de
  instalar: modo equipo, Azure Boards como espejo del tablero, repo privado en
  `soutecdev`. Si algo de ese plan no te sirve, díselo ahí.

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

Se pega tal cual, sin editar. Para compartirlo sin esta página, el prompt solo
está en [prompt-instalacion.txt](prompt-instalacion.txt): ese archivo es la fuente
y el bloque de abajo se regenera desde él.

<!-- souclaude:gen prompt -->
```text
Instala el harness de Claude Code de SOUTEC en esta carpeta. Sigue las cinco fases
en orden, sin saltarte ninguna.

REGLAS DE TODA LA INSTALACIÓN
- El instalador se invoca SIEMPRE así: npx -y github:soutecdev/souclaude-harness#v3 <comando>
  Nunca con el nombre corto del paquete en npx: ese nombre no es el del harness.
- No tienes terminal interactiva: todo comando que escribe lleva --yes y las
  respuestas van por flags. Nunca uses --force ni --prune en esta instalación.
- Deduce todo lo que la fase 2 te dice que deduzcas y muéstramelo en el plan antes
  de instalar. Fuera de eso no adivines: si un dato no sale del diagnóstico ni de
  la fase 2, pregúntamelo.
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
4. Credenciales. Lo que puedas hacer tú, hazlo; lo que exige mi cuenta, guíame
   paso a paso, espera mi "listo" y compruébalo tú antes de seguir. Nunca me pidas
   un token ni una contraseña en el chat, ni los escribas en un archivo o comando.
   - Aviso gh (no está instalado): pregúntame si lo instalas. Con mi sí, en
     Windows: winget install --id GitHub.cli -e   y en macOS: brew install gh
     En Linux dame el enlace https://cli.github.com. Comprueba con gh --version;
     si la terminal todavía no lo ve, pídeme reabrir Claude Code y pegar de nuevo
     este prompt.
   - Aviso gh-auth (sin sesión): el login pasa por el navegador y no lo puedes
     hacer tú. Dame estos pasos, tal cual:
       1. Abre otra terminal y corre:
          gh auth login --hostname github.com --git-protocol https --web
       2. Copia el código que aparece, pulsa Enter y pégalo en el navegador.
       3. Inicia sesión con tu cuenta de la organización, autoriza y vuelve aquí.
     Cuando te diga "listo", corre gh auth status. Si falla, muéstrame el error y
     repite la guía. Si pasa, corre gh auth setup-git: así git usa esa misma
     sesión y no me pide credenciales al clonar ni al pushear.
   - Acceso al Vault, ya con sesión: corre
       gh api repos/soutecdev/soubunker-vault --jq .permissions.push
     Si no responde true, detente y dime que pida al coordinador acceso de
     escritura al Vault para mi usuario (sácalo con gh api user --jq .login).
5. Avisos que exigen mi respuesta antes de seguir:
   - onedrive: pregúntame si muevo la carpeta fuera de OneDrive antes de instalar.
   - arbol-sucio: pregúntame si commiteo o guardo mis cambios antes.
   - remoto-inaccesible o remoto-no-github: muéstramelo y pregúntame cómo seguir.
6. Si el caso es "harness-al-dia": no hay nada que instalar; salta a la fase 5.
   Si es "harness-desactualizado": aplica la skill harness-upgrade en vez de las
   fases 2 a 4, y cierra con la fase 5.

FASE 2 · PLAN (deduce todo; a mí pregúntame solo lo que se indica)
Arma el plan con estos valores, sin preguntármelos:
a) Modo: el de "harness.modo" si ya existe; si no, equipo.
b) Nombre del proyecto: "carpeta.nombre". Idioma de las respuestas: es. Tipo
   (backend, frontend, data, ml, automation, infra o integration): dedúcelo del
   código y de "carpeta.stack".
c) Skills: todas las de "catalogoSkills" que aplican al modo, con un solo espejo
   del tablero: azdo-sync (Azure Boards). Nunca jira-sync y azdo-sync a la vez.
d) Vault: la ruta, el nombre del proyecto, su dueño y mi alias los resuelve el
   instalador. No me los preguntes.
e) Repo de GitHub, solo si hay un pendiente crear-repo-github: nombre, el de la
   carpeta; organización, soutecdev; visibilidad, privada.
f) Protección de main, solo en modo equipo y si el repo ya existía en GitHub:
   gh api repos/<repo.github>/branches/main/protection
   Si devuelve reglas, alguien ya la administra: usa --no-github-protect y
   avísame. Si devuelve 404, la aplica el instalador.

Muéstrame el plan en una lista corta y hazme, juntas, solo las preguntas que
apliquen:
1. El prefijo, si hay un pendiente alta-prefijo: «¿Cuál es el prefijo del
   proyecto?» (2 a 6 letras mayúsculas; es para siempre). Si el que te doy está
   en "vault.prefijosRegistrados", pregúntame si este repo pertenece a ese
   proyecto: si te digo que sí va con --vault-project Project-XXX; si no, pídeme
   otro. Si no está registrado, es un proyecto nuevo: --vault-prefix XXX.
   Si hay un pendiente conectar-vault, todavía no se sabe si el Vault ya conoce
   este repo: instala primero (fase 4), repite el diagnóstico y aplica con
   upgrade --yes los flags del Vault de los pendientes que queden. El prefijo me
   lo preguntas ahí, y solo si alta-prefijo sigue pendiente.
2. Qué voy a construir, en una línea, solo si la carpeta no tiene código del que
   deducir el tipo.
3. La confirmación para crear el repo, solo si hay que crearlo (fase 3).
Cualquier otro valor del plan lo cambio yo si te lo pido; si no digo nada, sigue.

FASE 3 · PREPARAR GIT (solo los pendientes que haya)
- git-init: git init -b main
- crear-repo-github: repíteme nombre, organización y visibilidad del plan y espera
  mi "sí" explícito. Solo entonces:
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
Arma UN comando con el plan de la fase 2 y muéstramelo antes de correrlo.
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
Flags del Vault, según los pendientes del diagnóstico:
  --vault-clone               conectar-vault: lo clona solo, fuera del repo y de
                              OneDrive. No pases ninguna ruta.
  --vault-seed                declarar-proyecto que pide crear la carpeta
  --vault-project Project-XXX alta-prefijo y el repo pertenece a un proyecto que
                              ya existe
  --vault-prefix XXX          alta-prefijo y el proyecto es nuevo: lo da de alta
                              y siembra su carpeta
Lee la salida del instalador. Si dice "Alta de proyecto cancelada", el prefijo no
quedó registrado: muéstrame el motivo literal. Si el prefijo ya estaba tomado,
pídeme otro y repite con upgrade --yes --vault-prefix <nuevo>. Si no se pudo
sincronizar o publicar el Vault, detente: tengo que pedir acceso de escritura al
Vault al coordinador. Lo mismo si el Vault no se pudo clonar. En modo equipo la
instalación no está completa sin Vault.

FASE 5 · VERIFICAR Y CERRAR
1. Repite el diagnóstico (--json): no debe haber bloqueos. Lista los pendientes
   que queden.
2. Corre: npx -y github:soutecdev/souclaude-harness#v3 status
   Exit 0 o 2 es correcto (2 = hay archivos .new o ediciones mías por revisar);
   exit 1 significa que quedó algo sin aplicar: muéstramelo.
3. Commitea la instalación: chore: instala el harness souclaude v<versión>
   Agrega solo los archivos que escribió el instalador (los que lista su salida):
   nunca git add -A ni git add . — en la carpeta puede haber archivos míos o
   secretos. Muéstrame git status --short antes de commitear.
   .claude/vault.local.json no se commitea (es de esta máquina). Haz push de la
   rama. En modo equipo pregúntame, una sola vez, si abres el PR contra dev.
4. Lee el CLAUDE.md instalado y progress/README.md. Si la sección "Contexto" de
   CLAUDE.md quedó con el texto de plantilla, pregúntame en una línea qué hace el
   proyecto y complétala.
5. Dame el reporte final:
   - caso detectado, versión instalada, modo y skills;
   - Vault: ruta, proyecto declarado y si se dio de alta un prefijo nuevo;
   - lo que dedujiste por mí (modo, tipo, espejo del tablero, alias de
     contribuyente, dueño del proyecto) y cómo cambio cada cosa;
   - qué creaste en GitHub (repo, ramas, protección de main);
   - qué quedó pendiente y de quién es: autorizar el conector del tablero (/mcp,
     OAuth, lo hago yo), el merge del PR (coordinador), archivos .new por revisar;
   - mi primer paso: declarar o dar de alta el primer milestone en el Vault.
```
<!-- /souclaude:gen prompt -->

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

- **falta un requisito de máquina** (Node anterior a 22.4 o sin git). Con `gh`
  ausente o sin sesión no se detiene: lo instala con tu permiso, te guía por el
  inicio de sesión y sigue cuando comprueba que quedó;
- **la sesión está en un subdirectorio** del repo (el harness va en la raíz);
- **`.claude/harness.json` está dañado**;
- **no hay acceso de escritura al Vault**: lo comprueba antes de instalar y te dice
  qué usuario tiene que habilitar el coordinador.

En **modo solo** no se crea `dev`, no se protege `main` y no hay PR: el flujo de
ese modo es directo.

## Lo que el agente deduce por ti

No te lo pregunta: lo pone en el plan que te muestra antes de instalar, y lo
cambias diciéndoselo.

| Dato | De dónde sale | Cómo se cambia después |
|---|---|---|
| Ruta del Vault | La ya configurada en la máquina, un clon junto al repo o en `~/repos/soubunker-vault`; si no hay, lo clona ahí (nunca dentro de OneDrive) | `upgrade --vault-path <ruta>` |
| Nombre del proyecto en el registro | El nombre del repo | `--vault-project-name` al dar el alta |
| Dueño del proyecto | Tu usuario de GitHub | `--vault-owner` al dar el alta |
| Alias de contribuyente | El que esta máquina ya usa en otro repo o tu primer nombre de git | `upgrade --vault-quien <alias>` |
| Modo, tipo, idioma y skills | Equipo, el tipo que sale del código, español y todas las skills del modo con Azure Boards como espejo | `upgrade` con `--solo`, `--skills`… |
| Protección de `main` | Se aplica, salvo que el repo ya tenga una | `--no-github-protect` |

## Lo que el agente no decide por ti

- El **prefijo** del proyecto: te lo pregunta siempre que el proyecto sea nuevo en
  el Vault. El instalador lo valida contra el Vault recién sincronizado y, si no
  lo puede publicar, cancela el alta sin dejar nada a medias.
- **Crear el repo** en GitHub: propone nombre, organización y visibilidad, y espera
  tu confirmación explícita.
- Fusionar un archivo `.new` con el tuyo.
- Autorizar el conector del tablero (Jira o Azure Boards): es OAuth, una vez por
  máquina, desde `/mcp`.
- Aprobar y mergear el PR de instalación: es del coordinador.

## Después de instalar

- **Actualizar el harness** más adelante: no hace falta nada — al abrir una sesión,
  si hay versión nueva el harness se actualiza solo en segundo plano y te avisa al
  terminar; para hacerlo a mano, dile al agente "actualiza el harness" (skill
  `harness-upgrade`).
- **El primer milestone**: antes de cualquier código, el agente te pedirá declarar
  (o dar de alta) el milestone del Vault — es la regla central de la metodología.
- **El detalle de cada paso** (crear el proyecto en Jira, el primer milestone, un
  proyecto sin tablero externo) sigue en el
  [playbook de bootstrap](../bootstrap-proyecto-plantillas-prompts.md).
