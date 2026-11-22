# Changelog

El harness y el CLI se versionan juntos.

## [3.21.0] — 2026-11-22

Dos cambios en este release: el harness se instala con un único prompt que cubre
todos los puntos de partida (SHS-M53) y se actualiza solo en la sesión cuando sale
una versión nueva (SHS-M43).

### Nuevo

- **`souclaude diagnostico`**: comando de solo lectura que dice en qué caso de
  instalación está la carpeta — proyecto desde cero, carpeta sin git, repo sin
  remoto, repo vacío, repo con código, estructura Claude hecha a mano, máquina
  nueva, harness desactualizado o al día —, qué comando corresponde, qué bloquea
  (Node anterior a 22.4, sin git, subdirectorio del repo, lockfile dañado), qué
  conviene resolver (`gh` ausente o sin autenticar, carpeta en OneDrive, cambios
  sin commitear, Vault mal conectado) y qué pasos no hace el instalador (`git
  init`, crear el repo, commit inicial, rama `dev`, conectar el Vault, dar de alta
  el prefijo). Con `--json` lo lee un agente. Exit 1 si hay bloqueos. La URL del
  remoto se informa sin credenciales embebidas.
- **Prompt único de instalación** en `docs/metodologia/03-prompt-instalacion.md`:
  se pega tal cual, sin sustituir variables. El agente diagnostica, pregunta solo
  lo que no se puede deducir, prepara git, instala por flags y verifica.
- **Alta de un proyecto nuevo del Vault sin terminal interactiva**:
  `--vault-prefix <XXX> --vault-project-name "<nombre>" [--vault-owner <@dueño>]`
  agrega la fila al registro de prefijos y siembra `Project-<XXX>`. Antes solo se
  podía desde el flujo interactivo, que un agente no tiene. `--vault-quien <alias>`
  registra el contribuyente por la misma vía.

- **El harness se actualiza solo en la sesión, sin pedir confirmación**
  (SHS-M43-T005). Cuando el aviso de SessionStart detecta una versión nueva de la
  misma major, ordena lanzar en segundo plano el subagente `harness-upgrader`. El
  procedimiento es agnóstico a la herramienta: vive en la nueva sección «Modo
  autónomo» de la skill `harness-upgrade` (instalada para Claude Code, Codex y
  Antigravity). En Claude Code lo lanza el nuevo `.claude/agents/harness-upgrader.md`
  (managed, un envoltorio que remite a la skill); en otra herramienta, la sesión
  lanza su propio subagente con esa consigna o, si no puede, la corre ella misma.
  Usa el tag exacto, no toca secciones del usuario ni hunks ambiguos de los `.new`,
  commitea solo los archivos del upgrade en la rama actual (sin push) y cierra con
  «Harness actualizado: vX a vY». En `main`, `master` o con HEAD suelto el aviso solo
  avisa; sin la skill instalada queda el aviso manual (ADR
  `20261120-upgrade-automatico-con-subagente.md`).

### Cambios

- **El agente puede crear el repo de un proyecto que nace desde cero**, con
  `gh repo create` y únicamente después de que el usuario confirme de forma
  explícita nombre, organización y visibilidad. Fuera de ese caso sigue sin crear
  repositorios. Cambia la regla en `CLAUDE.md`, la skill `soutec-github` y el
  onboarding.
- **`init` y `adopt` se niegan a instalar en un subdirectorio de un repo**: el
  harness va en la raíz. En una carpeta sin git instalan igual, y lo avisan.
- **La skill `harness-upgrade` corre `upgrade --prune --yes`**, en el flujo manual
  y en el modo autónomo: sin terminal interactiva el `--yes` es obligatorio. El
  modo autónomo suma `--no-github-protect --no-vault`: un upgrade que nadie pidió
  no reescribe la protección de `main` ni escribe en el Vault.

### Correcciones

- **Sin terminal interactiva y sin `--yes`, el CLI moría con código 13** y un aviso
  de Node («unsettled top-level await») que no decía qué hacer. Ahora termina con
  un error que nombra los flags a pasar, antes de escribir nada.
- **Con un Node anterior a 22.4 el CLI fallaba con un `SyntaxError`** que no
  mencionaba la versión. `bin/cli.mjs` la comprueba primero y dice cuál hace falta.
- **`--enforcer` era rechazado como opción desconocida** aunque el instalador lo
  leía.
- Documentación que contradecía al código: el campo `project` de
  `vault.local.json` (lo escribe el instalador, no se añade a mano), el largo del
  prefijo (2 a 6 letras) y las preguntas que hace el instalador.

## [3.20.0] — 2026-11-18

Dos cambios en este release: el endurecimiento del harness tras una auditoría
completa (SHS-M49) y la instalación para varias herramientas de IA (SHS-M48).

### Seguridad

- **El hook `reglas-pr` y los scripts de `scripts/` dejaban de correr, en silencio y
  con exit 0, si se invocaban por una ruta con un enlace simbólico** (un proyecto
  abierto por un symlink o junction, `/tmp` y `/var` en macOS): la guarda de «soy el
  script de entrada» comparaba `import.meta.url` contra `process.argv[1]` tal cual,
  y Node resuelve los enlaces del script de entrada. Con eso, la protección de
  `main` y el check de secretos quedaban apagados sin aviso, y un check de CI podía
  salir verde sin haber corrido. Ahora se comparan rutas reales.
- **El hook ve el `git push` aunque venga envuelto, agrupado o anidado**
  (`command git push`, `env … git push`, `(git push)`, `if …; then git push; fi`,
  `bash -c "…"`, `eval`, `xargs`, `iex`): antes solo lo reconocía como primera
  palabra del segmento, y `command`/`time`/`nohup` además casan con la regla allow
  `Bash(git push:*)`, así que ese push a `main` pasaba sin pregunta. Cuando el
  destino no se puede leer del comando (`$RAMA`, `$(…)`, un comodín, un alias de git
  en línea) el hook **pregunta** (`ask`) en vez de dejarlo pasar; `$(git branch
  --show-current)` se resuelve como la rama actual.
- **El push forzado se pregunta en modo equipo esté donde esté el flag**
  (`git push origin x --force`, `-uf`, `+refspec`, `--force-with-lease`): las reglas
  `ask` de `settings.json` son de prefijo y solo veían el flag justo después de
  `git push`.
- **El check de secretos ya no se evade renombrando**: `git mv notas.txt .env`
  figuraba como renombrado (R) y el filtro solo miraba agregados (A). Se suman las
  llaves privadas SSH (`id_rsa`, `id_ed25519`…) y los `.p12`.
- **Nada se lee, escribe ni borra fuera del repo**: una clave `../algo` en
  `.claude/harness.json` (que se commitea y llega por PR) hacía que `--prune` borrara
  ese archivo sin confirmar. Las rutas del lockfile y del manifest se validan, y
  `apply()` se niega a aplicar un plan que se salga del repo.
- **`--force` pide tipear `FORCE`**, como prometían el README y el `--help`: no
  existía, y `upgrade --force --yes` sobrescribía archivos editados sin confirmación
  escrita. `--yes` no la implica y en CI se deniega.
- **Ninguna plantilla ni mensaje del CLI manda ya a correr `npx souclaude`**: fuera
  de este repo, npx busca ese nombre en el registro público, donde no es del harness
  y está libre para registrar. Quedaban 16 líneas que lo nombraban; un test lo
  impide de ahora en adelante. Se usa `npx github:soutecdev/souclaude-harness#v3` o el CLI global.
- `git clone` del Vault lleva `--` antes de la URL (venía de un flag o del lockfile);
  el `fetch` de límites del monitor no sigue redirecciones con el token puesto.
- `settings.json` deniega también la lectura de `.env` en subcarpetas
  (`Read(./**/.env)`), y el `.gitignore` emitido ignora cualquier `.env.*` salvo las
  plantillas (`.env.example`…), igual que el check de secretos.
- **El hook de inicio de sesión muestra el contenido del Vault como dato**:
  rotulado, sin caracteres de control ni invisibles, en una línea y acotado a 240
  caracteres. Antes inyectaba las tarjetas tal cual en el contexto de la sesión de
  todo el equipo. Un `project` de `vault.local.json` que no sea una carpeta
  `Project-<PREFIJO>` ya no se usa como ruta (ni en los hooks ni en el CLI).
- **El hook pregunta antes de borrar `dev` en el remoto** (`git push origin
  --delete dev`, `:dev`) en modo equipo: casaba con la regla allow de `git push`.
- **El hook ve también el push que lanza otro programa y dos formas poco comunes de
  escribirlo**: `start git push …` (cmd y Git Bash), `Start-Process`/`saps`,
  `Invoke-Command`/`icm` y `Start-Job` en PowerShell, `git send-pack` y el refspec
  `:` a secas (el «matching»: sube todas las ramas que coinciden, `main` incluida).
  Si lo que se alcanza a leer toca `main`, se deniega; el resto de lo que lanzan
  esos programas se pregunta. Sigue sin verse el push que hace un script u otro
  programa por dentro: la barrera de `main` es la protección de rama en GitHub.
- **El hook sigue la carpeta del push solo con el `cd` que de verdad llega a él.**
  Tomaba por bueno cualquier `cd` anterior, también el que corre en otro proceso:
  `cd <vault> | cat; git push origin main` (o con `&`, o seguido de `cd -` o
  `popd`) se evaluaba en el Vault —que está exento— y pasaba, y con una carpeta
  sin reglas se salteaba el check de secretos. Ahora no mueven la carpeta el `cd`
  de una tubería, el que va al fondo, el de un subshell o una sustitución
  (`(cd x)`, `$(cd x)`) ni el que va detrás de un envoltorio que no es del shell
  (`nohup cd x`); `cd -`, `pushd`/`popd` y `Push-Location`/`Pop-Location` se
  siguen. Si la carpeta no se puede leer del comando (`cd "$DESTINO"`,
  `git -C "$DIR"`), si el `cd` puede no haber corrido (el de un `if`, un bucle,
  el cuerpo de una función o lo que sigue a un `&&`) o si depende del shell
  (`command cd x` no cambia de carpeta en zsh), el hook lo evalúa donde está y
  **pregunta**, o deniega si ahí toca `main`. Lo mismo si la carpeta no existe:
  ese `cd` falla, y con la ruta del Vault mal escrita `cd ../vualt; git add -A;
  git commit -m …; git push` hacía todo eso en el proyecto, sin revisar. No
  pregunta si las dos carpetas posibles son del mismo repo (`cd src && npm test
  && cd ..; git push`); `~`, `$HOME`, `$PWD` y `$(git rev-parse
  --show-toplevel)` sí se resuelven. Un comando cortado por una expresión se lee entero: en `git push
  $(echo origin) main`, `main` se ve y se deniega.
- **El check de secretos del hook corre en cada repo al que el comando pushea**,
  no solo en el primero: en `git -C <vault> push origin main; git push`, el push
  del proyecto quedaba sin revisar.
- **El cuerpo de un heredoc ya no se lee como comandos.** Un documento escrito
  con `cat > guia.md <<'EOF'` que tuviera una línea `git push origin main` se
  denegaba, y un `cd` suelto en ese texto movía la carpeta del push que viniera
  después. Del heredoc sin comillas se leen las sustituciones, que bash sí
  ejecuta: `cat > guia.md <<EOF` con un `git push origin main` entre backticks
  hace ese push, y ahora se ve. Lo mismo un here-string de PowerShell. El `)` de
  un patrón de `case` ya no se toma por el cierre de un subshell.
- **Una redirección pegada al refspec ya no esconde el push**: `git push origin
  main>/dev/null` pasaba. Tampoco `cmd //c`, que es como hay que escribirlo
  desde Git Bash.
- **Un comentario ya no esconde un push.** El apóstrofo de `# don't …` abría
  una comilla que se tragaba las líneas siguientes: el push que hubiera en ellas
  no se veía, y con él se apagaban la protección de `main` y el check de
  secretos. Ahora un `#` al comienzo de una palabra descarta el resto de la línea
  (en bash y en PowerShell), y nombrar un push en un comentario deja de contar
  como hacerlo.
- **El hook acota lo que lee de un comando.** Con un comando de cientos de KB
  (decenas de miles de `cd`, o de expresiones anidadas) leerlo costaba el
  cuadrado de su largo y podía pasar del plazo del hook, que entonces no frena
  nada. La ruta, la pila de `pushd`, la relectura de comandos cortados y la de
  comandos anidados quedan acotadas; lo que no se alcanza a leer, y una expresión
  sin cerrar, se preguntan.
- **Un push escrito tras una continuación de línea ya no pasa sin verse.** En
  `git add -A && \` + salto + `git push origin main` —la forma habitual de
  escribir un comando largo— la barra y el salto quedaban como una palabra
  delante de `git`, y el hook no veía ese push: ni la protección de `main` ni
  el check de secretos corrían. Estaba así desde el hook original. Ahora la
  continuación de línea no deja nada, tampoco en medio de una palabra
  (`git pu\`+salto+`sh`) ni con el backtick de PowerShell.
- **El hook lee también lo que se ejecuta dentro de comillas dobles**
  (`echo "$(git push origin main)"`, un mensaje de commit con
  `` `git push origin main` `` entre backticks, que bash ejecuta), las comillas
  `$'…'` (su `\'` no cierra: `git commit -m $'fix: don\'t' && git push origin
  main` escondía el push), la definición `function f { … }`, las asignaciones
  que siguen a `then`, `do` o `{` (`then GIT_TRACE=1 git push origin main`) y
  las funciones definidas en el mismo comando: llamarlas es correr su cuerpo, y
  la que pasa sus argumentos (`retry() { "$@"; }; retry git push origin main`)
  es un envoltorio más. Un `<<` dentro de una expresión aritmética
  (`$((1<<n))`) ya no se toma por un heredoc que escondía las líneas
  siguientes, ni el heredoc que queda sin cuerpo dentro de una sustitución; el
  literal de un arreglo (`x=(git push origin main)`) no es un comando.
- **La carpeta del push se contrastó con bash y zsh de verdad**, con miles de
  comandos armados al azar y un `git` de mentira que anota dónde corre. De ahí
  salen las reglas nuevas: el `cd` que sigue a un `||` puede no correr, también
  para lo que lo acompaña en la misma lista (`ls || cd <vault> && git push
  origin main`); con `!` delante se invierte; una lista mandada al fondo
  (`cd x && … &`) deja o no su `cd` según el shell; definir una función no
  mueve nada y llamarla sí; al salir de un bloque también quedan en duda la
  pila de `pushd` y la carpeta de `cd -`; el `)` de un patrón de `case`, una
  palabra `case` suelta o un arreglo ya no cierran antes de tiempo el subshell
  que los contiene; y de una carpeta que todavía no existe y que no crea un
  `mkdir` del mismo comando (un clon, un worktree) no se conoce el repo: ese
  push se pregunta, y si nombra `main` se deniega.
- **El guion que un shell recibe por su entrada se lee como comandos.** Al
  pasar a leer el cuerpo de un heredoc como texto, `bash <<'EOF'` con un
  `git push origin main` adentro había dejado de verse, y el hook original sí
  lo frenaba. Ahora se lee el guion de `bash`, `sh` o `zsh` sin `-c` ni
  archivo, venga de un heredoc, de un here-string (`bash <<< '…'`) o de la
  tubería (`cat <<EOF | sh`, `echo '…' | bash`), y también `source
  /dev/stdin`, `eval "$(cat <<'EOF' … EOF)"`, la acción de un `trap` y lo que
  envuelven `coproc`, `repeat` y `nocorrect`. Una función definida en un
  subshell o en otro proceso (`bash -c`, un guion por la entrada) ya no se da
  por definida afuera, y una lista como `cd x && make && cd -` puede terminar en
  cualquiera de sus pasos: si falla `make`, el push siguiente corre en x.
- **Un push que puede correr en una de dos carpetas conocidas se evalúa en las
  dos** —reglas de rama y check de secretos— y vale lo más estricto, en vez de
  preguntar: `npm ci && cd scripts && npm test; cd ..; git push` deja de
  preguntar, y con la sesión en el Vault `true && cd <proyecto>; git push` se
  deniega si el proyecto está parado en `main`.
- **Lo que el hook no alcanza a revisar se pregunta; nunca pasa en silencio**:
  más pushes distintos que el tope (primero se evalúan los que nombran `main`),
  más de 12 ramas o tags para el check de secretos (antes eran 4, y el resto
  pasaba con un aviso), un comando que no se pudo leer con certeza (un heredoc
  sin cierre) o un `git` que no responde dentro del plazo de la revisión (45 s;
  el hook está registrado con 60).
- **Lo que encontró la cuarta lectura del hook.** Una cuarta verificación
  independiente y el contraste con bash y zsh hallaron más formas de que el push
  corra en otra carpeta que la prevista; todas se corrigen: un `return`, `exit`,
  `break` o `continue` que sale antes de una función, de un guion leído con
  `source` o de un bucle; una función definida dentro de un `if`, tras un `&&`,
  en un grupo o dentro de otra función, que se lee al llamarla y donde se la
  llama (y que no queda definida si se la definió en una tubería); `unset -f`,
  `unfunction` y un alias del mismo comando; `pushd -n`, `popd +N`, `dirs -c`,
  `cd -N`, `cd` a secas (va a la carpeta personal) y las opciones de un solo
  shell (`cd -q`, `noglob cd`); `HOME=`, `OLDPWD=` o `CDPATH=` delante del `cd`,
  y una redirección que falla; varios heredocs para un mismo shell (zsh los
  concatena); la sintaxis de zsh (`if x { … }`, `always`, `for i (…)`);
  `&\`+salto+`&`, que es `&&`; y lo que sigue a `echo $(date)` ya no se lee
  como otro comando. Se ve el push escondido en un escape (`$'\x70ush'`), en
  `env -S`, en un arreglo de PowerShell o en un subcomando que sale de una
  variable (si el comando habla de un push), y `GIT_DIR` o `--git-dir` dejan
  la carpeta en duda.
- **Las funciones se leen con los argumentos de cada llamada**, como los
  entienden bash y zsh (`"$@"`, `"$*"`, `$1` con y sin comillas, un argumento
  vacío): `git() { command git -C <proyecto> "$@"; }; git push origin main` se
  deniega, y una función que pasa sus argumentos a otro programa (`op run --
  "$@"`, `ssh host "$@"`) sigue mostrando el push. Una asignación entre
  comillas (`"X"=1 cd x`) no es una asignación; `X+=1 cd x` sí.
- **Un error del hook al leer un push ya no lo deja pasar**: si la lectura
  falla, se pregunta (unos mil `eval` encadenados agotaban la pila del lector,
  y el push pasaba sin revisar). Los `eval` encadenados tienen su propio tope.
- **Cambiar de rama en el mismo comando ya no esquiva la protección de
  `main`.** El hook leía la rama actual antes de que el comando corriera, así
  que `git checkout main && git push` o `git switch main && git merge … && git
  push` subían `main` sin que nada los frenara (pasaba desde la primera versión
  del hook). Ahora sigue `git checkout`, `git switch` y `git branch -m` del
  mismo comando; si no se sabe a qué rama cambia (`git checkout -`, `gh pr
  checkout`), pregunta.
- **El check de secretos revisa también la rama o el tag que el mismo comando
  crea** (`git switch -c x && git push -u origin x`, `git tag v1 && git push
  origin v1`): antes no existían al revisar, y el push pasaba con un aviso de
  que no se pudo validar.
- **El hook lee las opciones de `git push` como git**: `heads/main` y
  `HEAD:heads/main` son `main`; `--al`, `--mi` y `--del` son `--all`,
  `--mirror` y `--delete`; en `-uo x`, `x` es el valor de `-o`. Si el mismo
  comando cambia la configuración que decide adónde va el push (`-c
  remote.origin.push=…`, `-c push.default=matching`, `git config remote…`, `git
  remote add`, `GIT_CONFIG_*`), un push sin refspec se pregunta y uno a `main`
  ya no pasa por ser del Vault. Un remoto con `/` en el nombre ya no se toma por
  la URL del Vault, y cuenta la URL de push (`pushurl`) del remoto.
- **Un push escondido detrás de otro programa se ve o se pregunta**:
  `caffeinate`, `exec -a`, `env -u`, `find -exec`, `script`, `eval --` y el
  `=git` de zsh se leen desde el `git`; un programa que sale de una variable
  (`$G push`, `"${arr[@]}"`), un argumento con un `git push` escrito que el
  programa puede correr (`perl -e`, `git rebase -x`) y un alias de git definido
  en el mismo comando se preguntan. En PowerShell, `-EncodedCommand` se
  decodifica y se preguntan los alias, `& $x`, `& (…)` y los bloques armados
  como texto.
- **Más formas de mover la carpeta que bash y zsh leen distinto**: un `&&`,
  `||` o `|` al final de la línea sigue en la siguiente (también tras una línea
  en blanco o un comentario); `#` tras cerrar un subshell es un comentario;
  `cd --foo x` y `cd x/no-existe/..` fallan; `~-`, `~1` y `cd -P` con `..` no
  se resuelven del texto; `mkdir` sin `-p` no crea las carpetas de arriba. Lo
  que el hook no sigue —un `trap` que cambia de carpeta, las funciones que el
  shell corre solo (`chpwd`, `TRAPEXIT`…), opciones como `autopushd`, `disable
  cd`, `OLDPWD`, `DIRSTACK`, `cdpath`, los archivos de inicio de otro shell, o
  permisos y enlaces simbólicos creados en el mismo comando— deja la carpeta en
  duda: el push a `main` se deniega y el resto se pregunta.
- **Un comando de más de 64 KB que habla de un push o de un PR se pregunta sin
  leerlo** (leer uno de 500 KB podía pasarse del plazo del hook), y la respuesta
  del hook ya no se corta: una de más de 64 KB llegaba truncada y dejaba de ser
  JSON.
- **Skill `soutec-md-a-pdf`**: del HTML crudo del Markdown solo pasa el marcado
  conocido, y el `href` de un enlace va escapado (antes, un `href` con comillas
  cerraba la etiqueta e inyectaba otra, p. ej. un `<img src="file://…">`). El
  texto de los títulos —secciones y subtítulos— se escapa antes de volver a entrar
  al índice.
- **Monitor**: lo que se lee del registro compartido del Vault entra saneado
  (`--usage` lo imprimía tal cual en la terminal) y con los números validados;
  una sesión sin carpeta de trabajo conocida ya no publica como «proyecto» la ruta
  local codificada (lo pedía el ADR 20260820).

### Corregido

- **El check `reglas-rama-commits` ya no sale rojo en el PR de release** (SHS-M50). El
  workflow de CI corre ese grupo sin `--pr` y pasa la base por `GITHUB_BASE_REF`, pero
  `check-pr-rules.mjs` solo miraba la base del PR: la excepción del release
  `dev` → `main` nunca aplicaba y el check fallaba en todos los releases. Ahora
  toma la base del contexto del check. De paso, en CI también se detecta un PR a
  `main` que no venga de `dev`.

- **«Un archivo tuyo nunca se sobrescribe en silencio» ahora vale también si el
  archivo no se puede leer.** Un error de lectura (archivo abierto por otro programa,
  retenido por el antivirus, placeholder de OneDrive sin conexión) se trataba como
  «no existe» y el motor escribía encima, sin `.new` y sin backup. El plan se
  detiene antes de escribir nada.
- **El CI de todo PR de release (`dev` → `main`) salía rojo**: dos tests heredaban
  `GITHUB_BASE_REF=main` del evento y fallaban en sus repos temporales. El de
  v3.18.1 se fusionó así.
- **La suite ya no depende de la máquina**: no llama a `gh` con la sesión real del
  desarrollador (103 invocaciones; pasa de ~54 s a ~7 s), no depende de que haya una
  terminal (dos tests de color fallaban con la salida por tubería en macOS/Linux) ni
  de `NO_COLOR`.
- Un `settings.json` guardado con BOM (PowerShell 5.1) abortaba el upgrade; un
  `.claude/harness.json` con marcadores de conflicto de git se trataba como «repo sin
  harness» sin avisar. El primero se tolera; el segundo es un error claro.
- Ajustar el `timeout` de un hook del harness hacía que el siguiente upgrade lo
  registrara por duplicado (corría dos veces). Los grupos de hooks se reconocen por
  tool + comando.
- El hook de SessionStart se registraba con una ruta relativa y sin plazo: si la
  sesión había cambiado de carpeta, el de un resume/clear/compact no encontraba el
  script. Pasa a `${CLAUDE_PROJECT_DIR}` con plazo de 60 s (migración incluida).
- El git del Vault (`vault-sync`, publicación del monitor) tiene plazo y no espera
  credenciales cuando nadie puede contestar: un pull colgado bloqueaba para siempre.
- Con `--prune`, lo borrado se respalda siempre y el respaldo se informa (con
  `--no-backup` se copiaba igual pero no se decía).
- La prosa de skills, `CLAUDE.md`, README y MAINTAINERS que seguía dando GitHub
  Actions por pausado (pendiente desde 3.18.1), el comentario que el hook publica en
  cada PR, y «Node ≥ 20» donde el requisito real es 22.4. Los `CLAUDE.md` ya
  instalados se corrigen en el lugar con una migración.
- **Monitor**: reintentar una publicación tras un `push` fallido duplicaba la
  línea en `sessions.md` y en `usage/*.jsonl`, y cada actualización de una sesión
  añadía una línea en blanco al final del archivo. Una respuesta 200 del endpoint
  de límites con otra forma se tomaba como «límites vacíos» y le ganaba 5 minutos
  al caché válido: ahora cuenta como fallo, y al caché propio solo llegan los
  cuatro campos conocidos. Pulsar Ctrl+C dos veces seguidas no salía del panel.
- **Skill `soutec-md-a-pdf`**: una lista anidada tumbaba el render (`TypeError`);
  ahora se aplana, con un guion por nivel. Un título como «2026 Roadmap» perdía el
  número; los títulos con `&` o comillas salían con entidades (`&amp;`); un enlace
  relativo o de ancla abortaba el PDF (sale como texto); un archivo con BOM no
  encontraba su título; un comentario en el front-matter quedaba dentro del valor.
  Si falta una dependencia, lo dice con el paquete a instalar en vez de un
  traceback, y `--to pdf` ya no exige `python-docx`. La skill indica un entorno
  virtual y deja de sugerir `--break-system-packages`.
- **Skill `soutec-md-a-pdf`, probada de punta a punta con sus bibliotecas reales.**
  Un bloque de código más alto que una página abortaba el PDF (`LayoutError`):
  ahora continúa en la página siguiente. En Windows los mensajes de la skill salían
  en la página de códigos de la consola y las tildes llegaban rotas a quien los lee
  como UTF-8 (lo encontró el CI de Windows): la salida es siempre UTF-8. Una imagen
  en el cuerpo desaparecía sin dejar rastro: queda como «[Imagen: …]». Un
  `--client-logo` que no es PNG o JPG se rechaza con un mensaje claro.
  `requirements.txt` fija las versiones con las que se probó.
- **`souclaude status` ya no dice «hay un upgrade disponible» para siempre.** Una
  propuesta `.new` ya escrita y al día contaba como cambio pendiente: en cualquier
  repo con un archivo propio que el harness no pisa (su README, un `CLAUDE.md`
  editado) `status` salía con 1 y mandaba a correr un `upgrade` que no tenía nada
  nuevo que escribir. Ahora cuenta como drift (exit 2, igual que una edición local)
  y `status` dice qué propuestas esperan revisión. Si el `.new` falta o quedó
  viejo, sigue siendo un cambio pendiente (exit 1).
- **Un release que no sube la versión deja de pasar en silencio**: si el tag
  `vX.Y.Z` ya existe en otro commit que el que se publica, `tag-release.mjs` lo
  avisa en su salida y, dentro de Actions, como anotación del workflow. Sigue
  saliendo 0: un release puede no requerir versión.
- La guía `docs/vault-setup.md` todavía decía que lo estratégico del Vault iba por
  PR y nombraba el comando `/rock-plan`, eliminado en la 3.0.0.
- **Cambiar de modo deja `settings.json` como el modo nuevo lo necesita.** El merge
  solo agrega, así que tras `upgrade --solo` quedaban el `deny` de `gh pr merge` (que
  le gana al `allow` del modo solo: no se podía mergear), los `ask` del push forzado,
  los checks de PR y el hook `declarar-milestone`, apuntando a un archivo que
  `--prune` acababa de borrar. Ahora el cambio de modo retira lo que sembró el modo
  anterior —solo lo que sigue idéntico; lo que agregaste o reescribiste queda— y el
  resultado es el de una instalación de cero en ese modo, como describe el ADR
  20260915. Vale también para un lockfile anterior al modo solo que elige `solo`.
- Las guías, infografías y láminas de `docs/` seguían nombrando `npx souclaude` (el
  nombre corto, libre en el registro público) y el paso manual de agregar
  `"project"` a `vault.local.json`. El test que prohíbe el nombre corto ahora las
  cubre.

### Agregado

- **El harness se instala para Claude Code, Codex y Antigravity** (SHS-M48). Toda
  instalación emite la superficie de las tres herramientas, sin preguntar cuál se
  usa: un mismo repo puede trabajarse con más de una. **El soporte de Codex y
  Antigravity está en prueba**: se construyó contra su documentación y con entradas
  simuladas, sin correrlo en la herramienta real. Las guías para quienes lo prueben
  están en `docs/pruebas-multiherramienta/`.
  - **Instrucciones**: `AGENTS.md` (managed) remite a `CLAUDE.md`, que sigue siendo
    el único archivo de instrucciones, y trae la tabla de equivalencias entre
    herramientas. Sale de la lista de archivos obsoletos.
  - **Skills**: cada skill se emite también en `.agents/skills/`, la carpeta que
    leen Codex y Antigravity. Se declara una sola vez en el manifest;
    `loadManifest()` deriva el gemelo.
  - **Hooks**: `.codex/hooks.json` registra `reglas-pr` y el hook de inicio de
    sesión con los mismos scripts de `.claude/hooks/` (Codex usa el contrato de
    Claude Code). Para Antigravity, `.agents/hooks.json` y el adaptador
    `.agents/hooks/souclaude-antigravity.mjs`, que solo traduce su formato.
  - **Los repos ya instalados reciben estos archivos en su próximo
    `upgrade`.** Un `AGENTS.md` o un `hooks.json` que ya existían no
    se pisan: el primero queda con la propuesta en `AGENTS.md.new` y los segundos
    se funden.
  - Fuera de este cambio: permisos (`permissions.deny`) y conectores MCP para
    Codex y Antigravity; en Antigravity tampoco corre el check automático tras
    crear el PR. Decisión y alternativas en
    `docs/decisions/20261118-harness-para-varias-herramientas-de-ia.md`.
- `souclaude verify` valida el contrato del manifest entry por entry (policy,
  modos, `when`, skill, rutas, binarios sin `binary: true`, seeds JSON inválidos).
- Test que exige que las copias de este repo (`.claude/`, `scripts/`, workflows)
  sean idénticas a su template, y macOS en la matriz de CI.
- `npm run check`, `npm run verify`, `npm run docs:check`, `npm run test:cobertura`;
  `.gitattributes` y `.editorconfig`.
- `--no-github-protect`: `init`/`upgrade` no tocan la protección de `main` en
  GitHub. Sin él, en modo equipo la reescriben entera en cada corrida.
- Pruebas de la skill `soutec-md-a-pdf` (`test/python/`, solo biblioteca estándar)
  enganchadas a la suite, y tabla de variables de entorno en el README.
- **Esquemas JSON del manifest y del lockfile** (`schemas/`): el contrato de forma
  que el editor usa para validar y autocompletar; el manifest lo declara en
  `$schema`. Un test comprueba que el manifest real y el lockfile que escribe `init`
  los cumplen y que sus listas de políticas y modos son las del código. Las reglas
  que dependen del disco siguen en `souclaude verify`.
- **El check de secretos avisa de credenciales pegadas en el contenido**: cabeceras
  de clave privada y tokens con prefijo propio (AWS, GitHub, Anthropic, Slack,
  Google, npm) en las líneas que se agregan. Es informativo: no cambia el resultado
  del check ni imprime el valor, y sin hallazgos la salida es la de siempre. El hook
  lo muestra en la tabla del PR («OK, con avisos») y se lo pasa al agente. Corre
  al validar el PR (en la sesión y en CI), no antes de cada push: ahí se sigue
  mirando solo el nombre de los archivos, que es lo que bloquea. Tiene su propio
  plazo (8 s) y leer el diff no ejecuta los filtros `textconv` del repo. No
  reemplaza a un escáner de secretos ni a la protección de push de GitHub.
- **Aviso previo al merge del release**: si el PR `dev` → `main` propone una versión
  y `package.json` dice otra, `pr-metadata` lo avisa antes del merge (no bloquea).
- **Piso de cobertura**: `npm run test:cobertura` mide solo el código del repo
  (sin `test/`) y falla por debajo de 89 % de líneas, 79 % de ramas o 90 % de
  funciones (requiere Node >= 22.8). CI lo corre en una celda de la matriz, por
  ahora como paso informativo.
- Tests de los comandos `status` y `verify` y de la protección de `main`
  (`github-protect.js`), que casi no tenían: fijan los códigos de salida, el cuerpo
  exacto que se le envía a GitHub y que los checks requeridos sigan siendo los
  jobs de los workflows instalados. El typedef `Snapshot` del monitor vuelve a
  coincidir con lo que la fuente devuelve, y un test lo mantiene así.
## [3.19.0] — 2026-11-18

### Agregado

- **Skill opcional `cloudflare-security-audit`** (SHS-M47): la skill `security-audit`
  de Cloudflare ([cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
  licencia MIT) queda disponible en el selector de `npx souclaude`. Es una auditoría
  de seguridad en seis fases con hallazgos verificados de forma independiente.
  - Lleva el nombre de Cloudflare para que el origen quede a la vista, e incluye el
    `LICENSE` del origen y un `ORIGEN.md` con el commit copiado y las diferencias.
  - **Solo corre a pedido**, con `/cloudflare-security-audit`
    (`disable-model-invocation: true`): no se activa sola ni interfiere con
    `it-security-review` ni con el `/security-review` nativo.
  - Los archivos son los del origen sin cambios, salvo el encabezado de `SKILL.md`;
    no se distribuyen los tests de los validadores.
  - La auditoría completa necesita Linux, macOS o WSL: los validadores del origen
    no corren en Windows nativo (ver `ORIGEN.md`). El modo guía sí funciona.
  - Un repo ya instalado la suma con `npx souclaude upgrade --skills <lista completa>` (la
    selección de skills existente no cambia sola).

## [3.18.1] — 2026-11-10

### Cambiado

- **Se reactiva GitHub Actions** (SHS-M45, revierte la pausa SHS-M36). Los 5
  workflows de este repo y los 4 distribuidos (`reglas-*`, `tag-release`) recuperan
  sus triggers; `tag-release.yml` vuelve a crear solo el tag y el GitHub Release al
  mergear `dev` → `main`. La protección de `main` vuelve a exigir los checks
  `reglas-secretos` y `reglas-pr-metadata` (se reaplica con `npx souclaude upgrade`;
  en este repo la actualiza el coordinador a mano). La regla de «solo los workflows
  del harness» sigue vigente. La prosa de las skills que habla de la pausa queda
  por actualizar.

## [3.18.0] — 2026-11-10

### Agregado

- **El release se cierra solo tras el merge** (SHS-M44). Aprobar el PR de release
  `dev` → `main` es lo único que hace el desarrollador: el agente cierra el tag, el
  GitHub Release, el hito en la ficha `OBSERVATORIO.md` del Vault y el espejo del
  tablero. El texto sale de una sola fuente, la sección `## Release en GitHub` del
  cuerpo del PR (título de hasta 6 palabras y descripción de menos de 30).
  - `scripts/release-publicar.mjs` (managed, stack Node): valida el texto y crea o
    actualiza el GitHub Release de forma idempotente; `--desde-pr` lo lee del PR y
    `--dry-run` imprime el release y el hito sin tocar GitHub.
  - `tag-release.yml` crea además el GitHub Release tras el tag (sigue en pausa,
    SHS-M36, con el resto de los workflows).
  - El hook de SessionStart de equipo detecta un release mergeado sin cerrar (falta
    el tag, el GitHub Release o el hito; ventana de 14 días) y ordena lanzar el
    subagente de cierre.
  - La skill `soutec-github` define el «Cierre del release» y el subagente: revisa
    los hitos de la ficha y, si algo está fuera de formato, pregunta en vez de tocar;
    si todo está en regla agrega el hito. Revisa además que el espejo del tablero
    refleje lo que salió (en review que salió en el release pasa a Hecho/Done).
  - **Cambia una regla**: los GitHub Releases dejan de ser «del coordinador».
  - El hito de la ficha pasa al formato oficial `AAAA-MM-DD · vX.Y.Z - Título ·
    descripción`. ADR `docs/decisions/20261110-release-automatico-observatorio.md`.

## [3.17.0] — 2026-10-08

### Agregado

- **Aviso automático de versión nueva al inicio de sesión** (SHS-M43). Los hooks de
  SessionStart (equipo y solo) comparan la versión instalada del lockfile contra el
  último tag `vX.Y.Z` del repo del harness — `git ls-remote` de solo lectura, con
  caché por máquina en `~/.claude/souclaude/version-check.json` (TTL 24 h; ante
  fallo, backoff de 1 h y se usa lo último conocido) — y, si hay versión nueva, la
  anuncian proponiendo la skill `harness-upgrade`. La major nueva lleva mensaje
  aparte (su migración es manual). Silencio total sin red, sin credenciales, sin
  lockfile o en el repo del propio generador: la sesión jamás se corta por el
  aviso. Con esto, el canal de difusión de releases deja de ser el mensaje privado.
  ADR `docs/decisions/20261008-aviso-de-version-en-sesion.md`.
- **`status` y `upgrade` delatan al CLI atrasado** (`src/core/version-remota.js`):
  leen esa misma caché y avisan cuando el CLI en ejecución quedó detrás del último
  release publicado — el caso de la caché de npx del tag móvil `#v3`, con el que
  `status` decía «al día» comparando contra su propio manifest.
- **Las novedades del release, a la vista al terminar el `upgrade`** (SHS-M43-T004):
  el CHANGELOG viaja dentro del paquete y, cuando el upgrade deja instalada una
  versión más nueva, el CLI imprime en un recuadro las entradas de las versiones
  recién instaladas (hasta 3; si quedan más, lo dice); la skill `harness-upgrade`
  abre su reporte final con esas novedades en una caja de guiones, para que lo
  nuevo no pase inadvertido.
- **`docs/metodologia/`: la carpeta publicable de la metodología, con candado de
  frescura** (SHS-M16-P2). Tres artefactos — la guía, la infografía master (mudada
  desde `docs/infografias/`) y el prompt de instalación — llevan secciones generadas
  desde `package.json` y el manifest entre marcadores `souclaude:gen`
  (`scripts/gen-docs-metodologia.mjs`, determinista y EOL-agnóstico, con `--check`).
  La documentación vieja no se publica: el test-candado de la suite, `souclaude
  verify` y el hook `reglas-pr` — que deniega el `git push` con drift, solo en el
  repo del generador — exigen regenerarla en el mismo cambio que toca el instalador.
  La difusión a SharePoint queda manual, copiando la carpeta (SHS-M8 sigue en
  Backlog).

### Cambiado

- La skill `harness-upgrade` se activa también desde el aviso de sesión, usa el tag
  exacto (`#vX.Y.Z`) en sus comandos cuando el aviso ya dijo cuál es la última
  versión (esquiva la caché de npx del tag móvil) y suma ese caso a su tabla de
  problemas; dos referencias de pasos desfasadas desde M38 quedan corregidas.
  Tras este `upgrade`, reinicia Claude Code: cambian los dos hooks de SessionStart.
- **La protección de `main` vive en el hook `reglas-pr`, por repo** (SHS-M42). Antes de
  cada `git push`, el hook resuelve la carpeta real del push (cwd, `cd`, `-C`) y deniega
  —con una razón accionable— todo push que toque `main` (refspec, `HEAD:main`,
  `dev:main`, `:main`, `--delete`, `--all`/`--mirror`, o la rama actual y su upstream
  cuando no hay refspec) salvo que el repo sea el Vault o esté en modo solo, donde el
  agente mergea y pushea `main` a propósito. El Vault se reconoce por su ruta
  configurada (`.claude/vault.local.json`, `VAULT_PATH` o
  `~/.claude/souclaude/vault.json`, en ese orden), por su remoto (`soubunker-vault`, el
  repo que declara el manifest, o el `repo` de esa config) o por su carpeta
  `00-System`: un clon del Vault se pushea a `main` en los dos modos, con cualquier
  forma del comando, aunque la máquina no tenga `vault.local.json`. Si aun así un push
  al Vault quedara denegado, la razón dice cómo configurarlo. ADR
  `docs/decisions/20261006-proteccion-de-main-por-repo-en-el-hook.md`.
- `CLAUDE.md` (plantilla), skill `soutec-github` y `progress/README.md` describen la
  regla nueva. Tras el `upgrade` hay que reiniciar Claude Code para que cargue el hook
  y los permisos nuevos.

### Corregido

- `package.json` pasa a `"private": true`: el repo no se publica en npm y nada
  impedía un `npm publish` accidental (la instalación por `npx github:…` y el CLI
  global no cambian).
- README: la versión mínima real de Node es 22.4 (como exige `engines`), no 20.
- **El push al Vault ya no queda denegado por las reglas de `main` del `settings.json`**
  (SHS-M42). Las tres reglas `deny` por texto (`Bash(git push origin main*)`,
  `Bash(git push * main)`, `Bash(git push * *:main*)`) no saben en qué repo corre el
  comando: `cd <vault> && git push origin main` quedaba denegado aunque en el Vault el
  push directo a `main` es el protocolo, y una regla `deny` no la anula ningún hook ni
  un permiso dado por chat. Según el agente escribiera `cd … &&` (denegado) o `git -C …`
  (pasaba), el bloqueo parecía aleatorio. Las reglas salen de las plantillas (equipo y
  solo) y la migración `v3-settings-main-por-hook` las quita de los `settings.json` ya
  instalados al correr `upgrade`.
- **`git -C <ruta> push` esquivaba el hook `reglas-pr`** y, con él, el check de
  secretos: el filtro `if: Bash(git push:*)` del PreToolUse solo ve los subcomandos que
  empiezan por `git push`. El hook pasa a correr en cada comando de shell (se filtra
  solo; cuesta unas decenas de milisegundos de Node por comando) y la misma migración
  quita el `if` viejo para que el bloque nuevo no quede duplicado al lado.
- **Rutas MSYS en Git Bash sobre Windows**: `cd /c/Users/… && git push` dejaba la
  carpeta sin resolver (`C:\c\Users\…`) y el push sin revisar. El hook las traduce a su
  forma nativa antes de resolverlas.

## [3.16.2] — 2026-09-29

### Corregido

- **`souclaude vault-sync --push` ya no deja varados los commits locales del Vault**
  (SHS-M40-T004). Con el árbol limpio, el comando respondía «nada que espejar» aunque
  el Vault tuviera un commit hecho a mano sin subir, y ese commit nunca llegaba al
  remoto. Ahora, si el árbol está limpio pero la rama va adelantada del remoto
  (`ahead`), hace el `pull --rebase` y el `push`; solo responde «nada que espejar»
  cuando de verdad no hay nada pendiente. Cubierto con pruebas (limpio al día,
  limpio adelantado, adelantado y atrasado, push fallido, árbol sucio).

### Cambiado

- **Skill `soutec-github`: el hito de release se publica con `vault-sync --push`.**
  La sección de la ficha del Observatorio indica el comando exacto, que el archivo se
  edita sin commitear, la prohibición de `git add/commit/push` a mano sobre el Vault
  y que, si `vault-sync` no publica, se averigua la causa y se repara en el harness
  en vez de rodearlo. Ambas copias de la skill quedan idénticas.

## [3.16.1] — 2026-09-29

### Cambiado

- **Skill `azdo-sync`: incorpora las consideraciones de Azure Boards del usuario**
  (SHS-M40-T003). La skill dice ahora lo que el equipo ya hacía a mano en el tablero:
  el Epic (no la tarea) pasa a la columna **En Review** cuando todas sus tareas están en
  Done y su PR no está mergeado, y a Done solo con merge; las tareas pasan a Done al
  subir su trabajo, nunca a En Review por falta de merge. Añade las secciones de
  asignación (incluida la excepción de las tarjetas `@pendiente`), la creación de la
  columna En Review por REST, los Epics de alcance abierto y fuera del tablero (por
  subárea, no por columna), el espejo completo con su checklist de verificación, el
  orden de las tareas, el formato de resumen de la descripción de los Epics y los
  gotchas de Azure (escapar `<` y `>`, área por `AreaId`). Reemplaza dos reglas que
  contradecían lo anterior («los estados son independientes» y «En review → Resolved
  o Active con comentario»). Ambas copias de la skill quedan idénticas y `azdo.json` del
  repo anota la columna En Review y los campos de columna de cada tablero.

## [3.16.0] — 2026-09-29

### Agregado

- **Hook `reglas-pr`: los checks de PR corren en la sesión del agente** (SHS-M39-T003).
  Con GitHub Actions en pausa (SHS-M36), nada validaba los PRs. Un hook de Claude Code
  (`.claude/hooks/reglas-pr.mjs`, registrado en el `settings.json` de equipo) corre
  `check-pr-rules.mjs` en el momento en que importa. Antes de cada `git push` revisa
  el grupo `secretos` sobre cada commit que el push subiría y, si falla, deniega el
  push. Al crear o editar un PR (`gh pr create`, `gh pr edit` con body o base) corre
  los tres grupos contra el PR, publica el resultado como comentario en el PR (la
  evidencia para el revisor) y se lo devuelve al agente: bloquea si fallan `secretos`
  o `pr-metadata`; `rama-commits` sigue siendo informativo. Modo manual para después
  de un push correctivo: `node .claude/hooks/reglas-pr.mjs --pr <url>`. Falla abierto
  ante problemas de infraestructura, pero lo avisa; no hace nada en repos sin el
  script. Tras el `upgrade`, hay que reiniciar Claude Code para que cargue el hook. ADR
  `docs/decisions/20260928-checks-de-pr-en-la-sesion.md`.

### Cambiado

- **`check-pr-rules.mjs` corre bien fuera de Actions** (SHS-M39-T001). Con `--pr <n|url>`,
  base, rama y cabeza (`headRefOid`) salen del PR, no del checkout local. El flag nuevo
  `--sin-pushear` revisa commit por commit lo que un push subiría. `mergeable: UNKNOWN`
  se relee mientras el PR está abierto. Si `gh` o `git` fallan, sale `[ERROR]` con exit 2,
  distinto de un FAIL de regla (exit 1). La versión se compara con los tags del remoto
  (`ls-remote`). Sin `--pr`, el comportamiento para los workflows no cambia.
- **Las instrucciones dejan de atribuir checks y tags a Actions** (SHS-M39-T004). La skill
  `soutec-github` explica el hook y qué hacer ante un FAIL, y dice que los tags los crea
  el agente mientras dure la pausa. En `harness-upgrade`, el tag-release de stacks no
  Node se genera pausado y el reporte pide reiniciar Claude Code si se sumaron hooks.
  `CLAUDE.md`, README y MAINTAINERS se actualizaron en consecuencia. Los párrafos de la
  pausa llevan el marcador `PAUSA TEMPORAL (SHS-M36)`.

### Corregido

- **Seguridad, modo solo: los merges directos a `dev`/`main` nunca se revisaban por
  secretos** (SHS-M39-T006). `reglas-secretos.yml` solo se disparaba en `pull_request`, y
  en modo solo el agente mergea y pushea sin PR, así que la única regla dura del modo
  nunca se aplicó en ese camino (antes de la pausa tampoco). Ahora `settings-solo.json`
  cablea el hook `reglas-pr` en el PreToolUse de `git push`: se deniega todo push que
  subiría un archivo de credenciales, incluidos los commits que trae un merge local. El
  flujo de PR sigue siendo solo de equipo.
- **Endurecimiento de `reglas-pr` tras el security review** (SHS-M39-T006):
  - el hook ejecuta siempre el `check-pr-rules.mjs` de su propio proyecto, nunca el del
    repo destino del comando (`cd <repo ajeno> && git push` ya no ejecuta código ajeno
    antes del prompt de permisos);
  - los pushes de tags, `--tags`, `--all` y `--mirror` también se revisan;
  - `--cabeza` no acepta opciones de git;
  - el modo manual solo comenta en PRs del repo de `origin`.
- **`tag-release.mjs` fallaba con el tag móvil local desactualizado** (SHS-M39-T002).
  `git fetch --tags` sin `--force` muere con «would clobber existing tag» (git ≥ 2.20)
  antes de crear nada; ahora usa `--force`. La opción nueva `--ref origin/main` taggea
  ese commit sin cambiar de rama:
  `git fetch origin && node scripts/tag-release.mjs --ref origin/main`.
- **Falsos negativos y positivos del grupo `secretos`** (SHS-M39-T001). `.env.example`
  (y `sample`/`template`/`dist`), que el propio harness siembra, dejó de contar como
  secreto. Las rutas con tildes o ñ se detectan: git las escribía entre comillas y
  ningún patrón las reconocía.
- **La skill mandaba omitir secciones que el check exige** (SHS-M39-T004).
  «Descripción del cambio», «Evidencia», «Impacto / Riesgos» y «Requiere versión /
  release» van siempre en el PR.

## [3.15.2] — 2026-09-25

### Corregido

- **Los hitos de la Roca van a «Planificación» de la ficha del Observatorio** (SHS-M38-T006).
  La plantilla del Vault (`00-System/templates/OBSERVATORIO.md`, OBS-M61) sumó la sección
  «Planificación» para los hitos de roca y dejó «Hitos» y «Próxima versión» solo para
  releases, así que la regla de 3.15.1 (cumplidos a «Hitos», pendientes a «Próxima
  versión») y la de 3.15.0 (Roca en «Próxima versión») contradecían la plantilla. Ahora
  las skills `soutec-github` (equipo y solo) y `harness-upgrade` llevan **todos** los
  hitos de la Roca a «Planificación» con el formato de la plantilla
  (`- AAAA-MM-DD · <PREFIJO>-H<n> · título · cumplido`: fecha real y marca `cumplido` si
  se cumplió; si no, la fecha planificada), mueven ahí las líneas `<PREFIJO>-H<n>` que
  una versión anterior haya dejado en «Hitos» o «Próxima versión», y agregan la sección
  si la ficha no la tiene.
- **Sin Roca, no hay bloqueo.** No todos los proyectos son Rocas: el agente pregunta una
  vez al final del install/upgrade y, si el usuario no la entrega, sigue sin más
  («Planificación» queda con su viñeta vacía).

## [3.15.1] — 2026-09-25

### Corregido

- **Sin Roca vigente, el install/upgrade la pide y la carga en el Vault** (SHS-M38-T004
  y T005, hotfix). Las skills `harness-upgrade` y `soutec-github` (equipo y solo) decían
  «sin Roca, no hay nada que hacer — no lo preguntes», así que un upgrade en un proyecto
  sin Roca terminaba sin mencionarla. Ahora, al final del flujo y sin bloquearlo, el
  agente pide al usuario su Roca —normalmente el export de Ninety/EOS en PDF, con la
  tabla de Milestones Title / Completed / Due / Owner—, la carga completa en
  `Project-<PREFIJO>/Roca_<trimestre>_<PREFIJO>.md` y `.yaml` (según
  `00-System/templates/plantilla_apertura_roca.yaml`, sin inventar lo que el documento
  no trae) y la pushea al Vault.
- **La Roca alimenta también «Hitos» de la ficha del Observatorio.** Los hitos de
  producto de la Roca se clasifican por estado: los completados van a «Hitos» con su
  fecha de completado y los pendientes a «Próxima versión» con su due date, nunca en
  las dos secciones a la vez; en cada upgrade, un hito que se completó pasa de
  «Próxima versión» a «Hitos».

## [3.15.0] — 2026-09-25

### Agregado

- **`init`/`upgrade` instalan el CLI global solos** (SHS-M35-T004). Si `souclaude`
  falta o está en otra versión, `init` y `upgrade` lo instalan o actualizan sin
  preguntar, también con `--yes`; en CI se sigue exigiendo `--cli-global` y
  `--no-cli-global` lo omite. Tras el `npm install -g` se verifica la versión que
  quedó instalada en vez de dar el éxito por supuesto. La skill `harness-upgrade`
  verifica `souclaude --version` y trae una guía para diagnosticar y resolver fallos
  (PATH, EACCES/EPERM, acceso a GitHub, red, versión vieja que gana en el PATH, Node
  viejo). Es lo que deja listo el CLI global que necesita el ciclo del Vault por
  `vault-sync` (ver abajo).

### Cambiado

- **La Roca alimenta «Próxima versión» del Observatorio** (SHS-M38). Las skills
  `soutec-github` (equipo y solo) y `harness-upgrade` clasifican los hitos al instalar
  (lo ya ocurrido va a «Hitos», lo planificado a «Próxima versión»), toman los hitos de
  producto de la Roca vigente solo cuando hay una diferencia real, sin reescribir ni
  pushear en cada upgrade, y el PR de release depura «Próxima versión» contra lo que
  el release entrega.

- **Remoto canónico `soutecdev`** (SHS-M37, cubre SHS-M20-T001). Las URLs de repo y de
  Vault (`package.json`, manifest, `cli-global.js`, `cli.js`, skill `harness-upgrade`,
  README y docs) dejan de apuntar a `ialvarezsoutec`; el histórico de este changelog
  y los registros de `specs/` y `progress/` se conservan tal cual.
- **El agente pregunta antes de abrir el PR.** `CLAUDE.md` (local y plantilla) y la skill
  `soutec-github` pasan de «solo a pedido explícito» a «con el visto bueno del usuario»:
  el agente pregunta una sola vez, cuando ya es hora de cerrar el feature, si abre el
  PR; sin respuesta afirmativa no lo abre.
- **El ciclo del Vault corre sin confirmación por `vault-sync`** (SHS-M37-T002). Las
  plantillas de `settings.json` (equipo y solo) permiten `souclaude vault-sync:*` (el CLI
  global; la copia local, además, `npx souclaude` y `node bin/cli.mjs`), y el protocolo
  (`CLAUDE.md` de ambos modos, `progress/README.md`, skill `vault-milestones`, el hook del
  modo solo, el aviso del hook `declarar-milestone` cuando no pudo sincronizar y las guías
  de `docs/`) pasa de `git -C "<vault>" add/commit/pull/push` a `souclaude vault-sync` /
  `souclaude vault-sync --push -m ... --paths Project-<PREFIJO>`, que usa la ruta de
  `vault.local.json`, argumentos fijos, `push` sin refspec y nunca force. El modo solo
  también acota el `add` con `--paths`: sin confirmación de por medio, un `add -A` sobre
  todo el Vault compartido ya no lo revisa nadie antes del push. Cambios de diseño
  frente al primer intento, por el security review: (1) no se permiten reglas `git -C * <cmd>`
  genéricas: un `allow` así deja pasar `-c core.sshCommand=...`, `--output=...`,
  `--work-tree=...` o un push a cualquier remoto o refspec sin confirmación, y con la sintaxis
  `:*` ni siquiera casan (el `*` del medio es literal); (2) no se permite `npx souclaude`
  en las plantillas: fuera de este repo `npx` lo resuelve contra el registro público, donde
  ese nombre no es el del harness y estaría libre para registrarlo; (3) `vault-sync --push`
  rechaza (exit 2) una ruta de `--paths` que empiece con `-`, para que ninguna se lea como
  opción de `git add`. Los repos consumidores lo reciben con `upgrade` y necesitan
  el CLI global (`npm install -g github:soutecdev/souclaude-harness#v3`).
- **`upgrade` migra el `CLAUDE.md` del consumidor a `vault-sync`** (SHS-M37-T005). El
  `CLAUDE.md` es user-owned y casi siempre está editado, así que la línea nueva solo
  llegaba al `CLAUDE.md.new` y el agente seguía usando `git -C "<vault>" pull --rebase`
  (equipo) o `npx souclaude vault-sync --push ...` (solo), que piden confirmación. La
  migración `v3-claude-md-vault-sync` reemplaza **solo esas líneas literales** que emitieron
  las plantillas v3.9.0–v3.14.0; si el dev las reescribió a su manera, no se tocan. Para
  eso el motor suma el veredicto `migrate`: sobre un archivo editado (`local-edit`,
  `conflict` o `foreign`), una migración que cambia algo se escribe **en el lugar**, con
  backup y sin reclamar el hash en el lockfile (el archivo sigue siendo del dev y el
  próximo upgrade no lo pisa). `conflict` y `foreign` conservan su `.new` al lado. Antes, las
  migraciones solo llegaban a disco en los archivos `append-block` y `merge-json`.

## [3.14.0] — 2026-09-21

### Cambiado

- **Pausa temporal y revertible de GitHub Actions** (SHS-M36). Los 5 workflows de
  este repo y los 4 distribuidos en `templates/base/github/workflows/` pierden sus
  triggers automáticos y quedan solo con `workflow_dispatch`; el bloque `on:`
  original queda comentado en cada archivo. `github-protect.js` deja de exigir
  checks requeridos en `main` (`required_status_checks: null`) para que los PRs no
  queden bloqueados por checks que ya no corren; el resto de la protección no
  cambia. Los repos consumidores reciben la pausa con `npx souclaude upgrade`.
  Mientras dure, `check-pr-rules.mjs` se corre a mano y los tags de release vuelven
  a ser manuales. Procedimiento de revert en
  `docs/decisions/20260921-pausa-github-actions.md`.
- **Solo los workflows del harness** (SHS-M36). `CLAUDE.md`, `CLAUDE-solo.md` y las
  skills `soutec-github` / `soutec-github-solo` prohíben crear o modificar workflows
  de GitHub Actions por proyecto o por funcionalidad (tests, lint, build, deploy,
  checks extra): cualquier CI propia se pide al coordinador y se evalúa en el
  harness. Esta regla es permanente, no parte de la pausa.

## [3.13.0] — 2026-09-15

### Agregado

- **Single Coder Mode («modo solo»)** (SHS-M34). `init`/`upgrade` preguntan el modo de
  trabajo del repo — `equipo` (la metodología completa de siempre) o `solo` (single
  coder) — con flags `--solo`/`--equipo` para el modo no interactivo; la elección se
  persiste en `.claude/harness.json` (sticky, incluso sin cambios de archivos) y una
  instalación existente sin modo la elige en su primer `upgrade`, con `equipo` como
  default no interactivo (T002). La superficie solo instala `CLAUDE-solo.md` (Git
  fluido: ramas simples `tipo/slug`, sin validación de PR, merge directo del agente a
  `dev` y `main`) y `settings-solo.json` que conserva únicamente los deny de secretos
  (T003); la skill `soutec-github-solo` reemplaza a `soutec-github` como required del
  modo, y `vault-milestones`/`jira-sync`/`azdo-sync` quedan solo en el catálogo de
  equipo (T004). La trazabilidad del modo solo vive en `Project-<PREFIJO>/worklog.md`
  del Vault — una línea con fecha por bloque de trabajo, sembrada por `init/upgrade` y
  recordada por el hook de sesión `worklog-solo.mjs`, que muestra las últimas líneas
  (T005). CI mínimo: solo `reglas-secretos.yml` + `check-pr-rules.mjs`; la plantilla de
  PR, CODEOWNERS, los checks de rama/pr-metadata, tag-release y la branch protection de
  `main` son del modo equipo (T006). El manifest gana el campo `modos` por entry y por
  skill del catálogo (sin el campo = ambos modos), `verify` acepta dest duplicado entre
  modos disjuntos, y cambiar de modo deja los archivos del modo anterior en OBSOLETE
  (`--prune` ofrece borrarlos). ADR `docs/decisions/20260915-modo-solo.md`.

### Cambiado

- **`reglas-pr.yml` se separa en tres checks independientes** (SHS-M33): `reglas-rama-commits`
  (formato de rama y de commits, ahora CI opcional — no bloquea el merge), `reglas-secretos`
  y `reglas-pr-metadata` (base=`dev`, mergeable, versión/semver y secciones del PR
  completas), ambos CI required. `check-pr-rules.mjs` gana el flag `--grupo` para correr
  solo el subconjunto de reglas de cada workflow. `github-protect.js` configura la branch
  protection de `main` con los dos checks required (`reglas-secretos`, `reglas-pr-metadata`)
  en vez del check único `reglas-pr`.

### Corregido

- **`COMMIT_REGEX` acepta letras acentuadas y ñ al inicio de la descripción del commit**
  (SHS-M32). Un commit como `fix: ícono roto en el panel` ya no falla el check de
  rama/commits, y el tipo `Revert` con mayúscula inicial también valida.

## [3.12.0] — 2026-09-14

### Cambiado

- **Una rama Git por milestone, no por tarea** (SHS-M31-T001, T002, T003). La skill
  `soutec-github`, `CLAUDE.md` (local y distribuido), `AGENTS.md`, `progress/README.md`,
  la skill `vault-milestones` y la plantilla de PR prescriben `tipo/M<n>-slug`:
  la rama nace de `dev` al tomar el milestone y vive hasta cerrarlo; las tareas del
  kanban son commits en esa rama y pasan a Hecho al pushear, sin esperar el merge;
  desde la misma rama se admiten PRs parciales a `dev` (tras cada merge, `git merge
  origin/dev` y se sigue); `En review` queda opcional para tareas gateadas por un PR
  concreto. La rama **no lleva la clave del proyecto** (`M31-`, no `SHS-M31-`): el
  repo ya pertenece a un proyecto del Vault (SHS-M31-T005). `RAMA_REGEX` de
  `check-pr-rules.mjs` acepta `M<n>-` (las ramas legadas con clave y por tarea siguen
  validando) y `milestoneDeRama()` del monitor reconstruye `<PREFIJO>-M<n>` con el
  `project` de `vault.local.json` para `sessions.md`. ADR
  `docs/decisions/20260912-una-rama-por-milestone.md`.

### Corregido

- **Paridad de permisos git/gh entre la copia distribuida y la local** (SHS-M29-T001).
  `templates/base/claude/settings.json` declara las mismas reglas `allow`/`ask`/`deny`
  sobre `git push`/`git merge`/`gh pr merge`/`gh pr review`/`gh release` que
  `.claude/settings.json` (hallazgo cerrado en 3.11.0). El security review del PR
  detectó y cerró además un bypass de la protección de `main` por refspec
  (`git push origin HEAD:main`) en ambas copias.

## [3.11.0] — 2026-09-08

### Agregado

- **Skill `azdo-sync`** (SHS-M27-T001), análoga a `jira-sync` pero espejando el
  tablero del Vault en Azure DevOps Boards vía el MCP oficial de Azure DevOps:
  cada milestone es un Epic y cada tarea del kanban un work item hijo, con
  autenticación por PAT vía variable de entorno. Se distribuye como opción al
  instalar el harness (`.mcp.json`, `azdo.json`, manifest); mientras se evalúa
  como reemplazo de `jira-sync`, no se sincronizan ambas herramientas a la vez.

## [3.10.0] — 2026-09-08

### Agregado

- **`tag-release` deja de instalarse fijo en Node** (SHS-M28-T001). La skill
  `harness-upgrade` detecta el lenguaje/framework y la fuente de versión del
  proyecto consumidor al hacer init/upgrade, y genera/adapta ahí mismo el script y
  el workflow de tag-release para ese stack en vez de distribuir siempre la
  variante Node.

### Cambiado

- **La skill `vault-milestones` reconcilia los milestones cerrados antes de listar**
  y responde corto al pedir los pendientes (Backlog + En curso).
- **El bump de versión del release se documenta como directo en `dev`**, sin rama
  `chore` aparte solo para el bump.

## [3.9.2] — 2026-09-02

### Cambiado

- **El hito de release en `OBSERVATORIO.md` se escribe al abrir el PR de release**
  (SHS-M24). La skill `soutec-github` (copia local y distribuida) pasa a un esquema
  en dos toques: el hito se agrega al abrir el PR `dev` → `main` (fecha del día +
  versión propuesta en `package.json`) y se verifica/corrige al confirmarse el
  merge y el tag, eliminándolo si el PR se descarta. Escribirlo solo tras el merge
  dependía de que la sesión siguiera viva cuando el coordinador mergeara. El
  puente de `vault-milestones` (§5) se alinea al nuevo momento.

## [3.9.1] — 2026-08-31

### Cambiado

- **Hito de release obligatorio en la ficha `OBSERVATORIO.md` del Vault** (SHS-M24).
  La skill `soutec-github` ahora exige agregar el hito (`- YYYY-MM-DD · vX.Y.Z ·
  resumen`) en la sección "Hitos" tras cada merge de release `dev` → `main` con tag
  nuevo, y actualizar el resto de la ficha cuando se detecte un cambio importante
  del proyecto, en cualquier momento. La sección queda condicionada a Vault
  conectado, y `vault-milestones` gana un puente (§5) hacia la regla.

## [3.9.0] — 2026-08-31

### Agregado

- **Siembra de `OBSERVATORIO.md` desde la plantilla canónica del Vault** (SHS-M24).
  Al instalar el harness, la ficha del proyecto se siembra desde
  `00-System/templates/OBSERVATORIO.md` del Vault, rellenando
  `{Nombre del Proyecto}` con el nombre completo de `id-registry.md` y, si hay
  contexto del proyecto disponible durante la instalación, completando la ficha en
  ese mismo momento en lugar de dejarla vacía.

### Cambiado

- **Semilla `OBSERVATORIO.md` alineada al formato oficial nuevo** (SHS-M23).

## [3.8.1] — 2026-08-31

### Corregido

- **Security review del PR delegado a un subagente en `soutec-github`** (SHS-M22).
  La skill ya no corre el security review inline: lo delega a un subagente cuyo
  resultado vuelve como tool-result explícito, de modo que el agente principal no
  pierde el hilo y continúa con el push/PR si no hay hallazgos bloqueantes.

## [3.8.0] — 2026-08-27

### Agregado

- **Instalación global del CLI desde `init`/`upgrade`** (SHS-M21-T001). Al instalar
  o actualizar el harness, el CLI ofrece dejar `souclaude` instalado globalmente
  desde GitHub (`npm install -g <repo>#v3`), de modo que `souclaude monitor` corra
  en cualquier terminal y no solo vía `npx` dentro del repo. Es idempotente —si ya
  está instalado en la misma versión no reinstala— y tiene bandera para el modo no
  interactivo. Documentado en el README y en la guía de onboarding.

- **Config del Vault a nivel máquina como fallback** (SHS-M21-T002).
  `~/.claude/souclaude/vault.json` —lo escribe `init`/`upgrade` al conectar el
  Vault— actúa como respaldo de `.claude/vault.local.json`. Así el CLI global
  publica snapshot y consumo, y lee al equipo, desde cualquier terminal aunque no
  esté parado sobre un repo consumidor. La línea de `sessions.md` sigue
  escribiéndose solo cuando hay `project` declarado.

### Corregido

- **Resolución de `npm` sin depender del directorio actual** (CWE-427). Las llamadas
  a `npm` de la instalación global se ejecutan con `cwd` explícito en el home del
  usuario, para no resolver binarios ni `node_modules` desde un directorio de
  trabajo que podría no ser confiable.


## [3.7.0] — 2026-08-26

### Agregado

- **Branch protection de `main` configurada por el CLI** (SHS-M17). `souclaude
  init`/`upgrade` aplican, siempre y sin preguntar, la protección de `main` vía
  `gh api`: PR obligatorio (sin exigir aprobaciones — nadie aprueba lo suyo), el
  check `reglas-pr` en verde, sin force-push ni borrado de la rama, alcanzando
  también a administradores. Si `gh` no está instalado/autenticado o falta permiso
  de admin en el repo, se reporta con un aviso accionable y el resto de
  init/upgrade sigue igual. Complementa a `check-pr-rules.mjs`: ese workflow
  bloquea el *merge* del PR; esto bloquea el *push* directo en el propio GitHub.

- **Tag automático de release al mergear el PR a `main`** (SHS-M19). Workflow
  `tag-release.yml` distribuido por el harness: dispara en `pull_request`
  `closed`+`merged` con base `main`, lee la versión de `package.json` en el
  commit de merge y crea/pushea el tag inmutable `vX.Y.Z` y el tag móvil de la
  serie (`vX`). Idempotente: si el tag ya existe, no falla ni duplica. No crea el
  GitHub Release —sigue siendo del coordinador—. Se dogfoodea en este repo y se
  distribuye vía el manifest a los repos consumidores.

### Corregido

- **La descripción del commit puede arrancar en mayúscula** (SHS-M17).
  `check-pr-rules.mjs` exigía que la descripción del commit empezara en
  minúscula, sin que la skill `soutec-github` lo pidiera — rechazaba siglas
  legítimas como "PR" o "API" al inicio. Ahora acepta cualquier letra.

- **PR a `main` solo puede venir de `dev`** (SHS-M17). `check-pr-rules.mjs`
  aceptaba cualquier rama con formato válido (`feature/`, `fix/`, `hotfix/`, etc.)
  como base de un PR contra `main`. Ahora un PR con base `main` solo pasa el
  check si la rama de origen es exactamente `dev`, sin excepción para hotfixes
  (`CLAUDE.md`: "los hotfixes también" pasan por `dev`).

- **CI determinista en ubuntu + Node 22** (SHS-M14). `node --test` corre los
  archivos de test en paralelo por defecto (concurrencia = CPUs); en Linux eso
  dejaba una ventana de carrera en la que el propio test runner corrompía su
  canal IPC (serialización estructurada sobre el pipe de stdout del proceso
  hijo), fallando con "Unable to deserialize cloned data" — no era un bug del
  código de los tests. CI ahora corre `npm run test:ci`
  (`--test-concurrency=1`); `npm test` local sigue en paralelo (rápido, y el
  bug no reproduce ahí de todos modos).

- **Backfill de archivos base del Vault en `upgrade`** (SHS-M18-T001).
  `asegurarProyecto()` cortaba en cuanto `vault.local.json` ya tenía `project`
  declarado, así que `sembrarProyecto()` —único lugar que escribía las semillas—
  nunca se volvía a llamar para un proyecto ya conectado: un archivo base
  agregado después (`OBSERVATORIO.md`, `progress/history.md`) quedaba huérfano
  para siempre en instalaciones viejas. Se extrae el bucle a
  `escribirSemillasFaltantes()` y se agrega `completarProyectoDeclarado()`, que
  la corre sin pisar lo existente y pushea solo si faltó algo, en las dos ramas
  donde el proyecto ya se resuelve sin sembrar (`declarado` en `vault.local.json`
  y `porRegistro` vía `id-registry.md`). Idempotente: sin archivos faltantes, no
  toca el Vault.

## [3.6.0] — 2026-08-24

Reglas de PR distribuidas por el harness (SHS-M17) y alta de proyectos del Vault
desde el CLI (SHS-M18).

### Agregado

- **Reglas de PR distribuidas vía el manifest.** `check-pr-rules.mjs` y su workflow
  (`reglas-pr`) entran al manifest: `souclaude init`/`upgrade` los instala y
  actualiza en los repos consumidores. Valida en CI, contra cada PR, las reglas
  deterministas de la skill `soutec-github` (formato de rama, formato de commits,
  ausencia de secretos, `base=dev`, `mergeable`, versión semver propuesta,
  secciones de la plantilla completas).
- **El PR se abre solo a pedido explícito del usuario.** La skill `soutec-github`
  fija que terminar un cambio no implica abrir el PR: se crea únicamente cuando el
  usuario lo pide o dice que quiere mergear/integrar. Mientras tanto, commit y push
  a la rama, reportando que está listo para PR.
- **Ficha `OBSERVATORIO.md` como semilla de proyecto.** Se crea vacía en
  `Project-<PREFIJO>/` al conectar cualquier repo al Vault, junto al resto de
  archivos base. La skill `soutec-github` recuerda revisarla y actualizarla en cada
  release `dev` → `main` con cambios importantes (tagline, plataforma, resumen,
  hitos). Es independiente del README del repo técnico.
- **Opción "Crear proyecto nuevo" al conectar el repo al Vault.** En el prompt
  interactivo que pregunta a qué `Project-<PREFIJO>/` pertenece el repo (varias
  carpetas, ninguna declarada), se puede dar de alta un prefijo nuevo en el
  momento: pide prefijo, nombre y dueño, agrega la fila a
  `00-System/id-registry.md`, la pushea y siembra la carpeta en el mismo paso. Esto
  cambia la regla anterior (el prefijo se pedía antes, a un coordinador) — ahora el
  CLI también puede darlo de alta.

### Corregido

- **`rama-formato` no rechaza el PR de release `dev` → `main`.** La regla exigía
  `tipo/descripcion-corta` también sobre la rama de un PR de release, cuya rama
  origen es siempre literalmente `dev` — nunca iba a cumplir ese patrón. Ahora
  reconoce la combinación rama=`dev` + base=`main` como la misma excepción que ya
  usa `pr-apunta-a-dev`.

### Problemas conocidos

- **CI no determinista en ubuntu + Node 22** (SHS-M14): el runner de `node --test`
  se cae con "Unable to deserialize cloned data" en `test/monitor-cmd.test.js`. Es un
  fallo del runner en esa combinación de la matriz, no del código publicado: la
  suite completa pasa en el resto de la matriz. Sigue en Backlog.

## [3.5.0] — 2026-08-21

Primer release publicado de la serie v3. La conexión del repo con su proyecto del
Vault queda cerrada de punta a punta (SHS-M5) y el panel en vivo se simplifica
(SHS-M12).

### Agregado

- **Siembra de la carpeta del proyecto en el Vault.** Un repo cuyo prefijo ya figura
  en `00-System/id-registry.md` pero que todavía no tiene carpeta en el Vault ahora
  la recibe: `Project-<PREFIJO>/` con `milestones.md`, `kanban.md`, `sessions.md`,
  `plans/` y `progress/history.md`. Antes solo se emitía un warning y el repo quedaba
  sin tablero donde declarar sus milestones — justo lo que el protocolo exige antes
  de tocar código. **El registro es la única autoridad**: un repo que no figura ahí
  no se siembra, y el prefijo ni se inventa ni se agrega desde el CLI. Escribir en el
  Vault es escribir en el repo compartido de la organización, así que nunca pasa sin
  decisión explícita: con TTY se confirma, y en modo desatendido hace falta
  `--vault-seed`. La publicación va por `pushSeguro` (add acotado, commit,
  `pull --rebase`, push).
- **Resolución del proyecto por el registro de prefijos, sin preguntar.** El CLI
  contrasta la identidad del repo (`name` de `package.json`, remoto git, carpeta)
  contra `00-System/id-registry.md` y persiste la carpeta si eso apunta a una sola
  que exista. La comparación es **exacta, sin fuzzy**: parecerse al nombre registrado
  no alcanza. Cierra el caso desatendido (`--yes`, CI) que quedaba abierto.
- Flag `--vault-project <Project-XXX>` para declarar la carpeta del proyecto en modo
  no interactivo (`--project` ya estaba tomado por los filtros del monitor).

### Corregido

- **El instalador declara la carpeta `Project-<PREFIJO>` en vez de dejar que se
  adivine.** `carpetaProyecto()` caía a un respaldo que infiere el proyecto de
  cuántas carpetas `Project-*` hay en el Vault: acierta con una sola y devuelve
  `null` con dos o más. El Vault tiene tres desde el 2026-08-19, así que **toda
  instalación sin `project` escrito a mano dejó de publicar las líneas de
  `sessions.md` sin un error visible** — se perdía el registro de consumo por
  contribuyente y proyecto. `asegurarProyecto()` ahora resuelve y **persiste** la
  carpeta al conectar el Vault, con la misma prioridad que `resolveSkills`:
  `--vault-project` explícito > lo ya declarado > una sola carpeta > preguntar.
  Nunca bloquea: lo irresoluble queda en warning.
- Si el registro asocia el repo a un proyecto cuya carpeta todavía no está en el
  Vault, ya no cae en "hay una sola, debe ser esa" — eso declaraba el proyecto de
  otro repo.

### Cambiado

- **El panel en vivo pierde el bloque VENTANAS.** El consumo propio por ventana
  (5h / 7d / Fable) queda solo en `souclaude monitor --usage`; el panel en vivo se
  reserva para el estado del momento.

### Problemas conocidos

- **CI no determinista en ubuntu + Node 22** (SHS-M14): el runner de `node --test`
  se cae con "Unable to deserialize cloned data" en `test/monitor-cmd.test.js`. Es un
  fallo del runner en esa combinación de la matriz, no del código publicado: la suite
  completa (497 tests) pasa en el resto de la matriz. Se corrige en 3.5.1.

## [3.4.0] — 2026-08-19

La línea de consumo por sesión de `sessions.md` deja de depender de la disciplina
del agente: la publica el propio monitor (SHS-M1-T002).

### Agregado

- **Publicación automática de `sessions.md`** desde el panel en vivo
  (`npx souclaude monitor`): cada sesión **con consumo** del proyecto actual publica
  su línea en `Project-<PREFIJO>/sessions.md` del Vault y la va actualizando de
  forma recurrente mientras la sesión sigue viva — misma cadencia (~5 min),
  backoff y filtro de secretos que los snapshots de `00-System/monitor/`.
  Idempotente por sesión vía registro local
  (`~/.claude/souclaude/sesiones-publicadas.json`); la línea se actualiza en el
  lugar solo si sigue byte a byte como la escribió el monitor —
  una línea editada a mano nunca se pisa. Autorizado por el ADR
  `20260817-milestones-planes-y-sesiones-en-vault` (la telemetría cruda sigue
  prohibida). `--no-publish` apaga snapshots y sesiones a la vez.
- Campo opcional `"quien"` en `.claude/vault.local.json`: el `@quién` de la línea
  automática (respaldo: alias de la cuenta). El milestone se infiere del nombre de
  la rama (`feature/SHS-M1-T002-...` → `SHS-M1`); sin patrón reconocible, `n/d`.

### Cambiado

- `progress/README.md` (managed) documenta la línea automática como piso del
  protocolo manual, no reemplazo.

## [3.1.0] — 2026-08-17

El Vault pasa de tablero de tareas a estado vivo de tres niveles por proyecto:
milestones (con claim entre máquinas), planes por milestone y registro de sesiones
con consumo de tokens.

### Agregado

- **`Project-<PREFIJO>/milestones.md`**: tablero Kanban de milestones
  (`<PREFIJO>-M<n>`). La tarjeta En curso lleva dueño **y máquina**; es la unidad de
  anti-solapamiento — un agente que encuentra el milestone En curso con otro
  dueño/máquina para y pregunta, antes incluso de mirar el kanban de tareas.
- **`Project-<PREFIJO>/plans/`**: un archivo por plan (`<PREFIJO>-M<n>-P<n>-<slug>.md`),
  espejado al adoptarlo. Los planes descartados no se borran: la tarjeta del milestone
  apunta al vigente.
- **`Project-<PREFIJO>/sessions.md`**: append-only, una línea por sesión al cerrarla —
  fecha, rama/sesión, milestone, quién, máquina, tokens entrada/salida y resultado.
  Amplía la excepción de telemetría del ADR 20260810 (ADR
  `20260817-milestones-planes-y-sesiones-en-vault`); la telemetría cruda sigue
  prohibida.
- **Skill `vault-milestones`** (opcional): analiza el tablero de milestones del Vault
  (foto, consistencia, diagnóstico) y guía su iteración — alta de milestones nuevos
  con ID secuencial, división y re-secuencia, cierre y cambio de plan — respetando el
  anti-solapamiento y el push inmediato del protocolo.

### Cambiado

- `progress/README.md` (managed) reescribe el protocolo del Vault con los tres niveles
  y el claim en dos pasos (milestone → tarea); `templates/base/CLAUDE.md` resume el
  flujo nuevo en "Los dos repos".
- `docs/vault-guide.md` se reescribe para el harness 3.x: se elimina la deriva del
  flujo SDD/rocas (agentes y comandos `/rock-*` que ya no existen) y se documentan los
  dos canales de consumo (sesiones por proyecto + snapshots del monitor por cuenta).

## [3.0.0] — 2026-08-17

El harness se simplifica por completo: se eliminan los agentes y el flujo SDD/CCEM
para que el modelo trabaje sin ataduras, y quedan solo las skills personalizadas de
SOUTEC, ahora seleccionables desde el CLI.

### Cambiado (breaking)

- **Sin agentes ni flujo SDD**: se eliminan `.claude/agents/` (orchestrator,
  spec-author, implementer, reviewer, security-evidence-compiler), `AGENTS.md`,
  `docs/constitution.md`, `specs/` (README y templates full/lite) y todas las skills
  CCEM (`ccem-core`, `ccem-sdd`, `ccem-planner`, `ccem-research`, `ccem-stack`,
  `ccem-prompting`, `ccem-model-router`, `ccem-rocas`, `rock-*`, `export-ninety`,
  `spec-new`, `constitution-check`). En un upgrade quedan marcados obsoletos y
  `--prune` ofrece borrarlos — nunca se borran solos.
- **Catálogo de skills reducido**: `soutec-github` (obligatoria), `it-security-review`,
  `security-report-standard`, `soutec-md-a-pdf` (nueva en el harness, antes solo
  repo-local), `adr-new` y `harness-upgrade`.
- **Comando `mode` eliminado**: sin flujo de agentes no hay modos `auto`/`manual`.
- `it-security-review` ya no delega en agentes: la remediación y la compilación de
  evidencia las hace el propio modelo, con el PDF vía `soutec-md-a-pdf`.
- Ramas sin ID de hito: formato `tipo/<slug>`; el ID de tracker es opcional.
- **Flujo de release `dev` → `main`**: las ramas de trabajo nacen de `dev` y su PR
  apunta a `dev`; `main` solo recibe merges desde `dev` (el PR de release). Los
  **tags de versión los puede crear el agente** tras ese merge (`vX.Y.Z` + tag móvil
  por major); `git tag` sale de `permissions.ask` en el settings emitido.

### Agregado

- **Selección de skills en el CLI**: `init` pregunta con un checkbox qué skills
  instalar (todas marcadas por defecto; `soutec-github` entra siempre). Sin modo
  interactivo, `--skills a,b`. La selección se persiste en `.claude/harness.json`
  y los upgrades la respetan; deseleccionar marca la skill obsoleta (`--prune`).
- **Soporte de archivos binarios en el manifest** (`"binary": true`): los assets PNG
  de `soutec-md-a-pdf` se copian y comparan byte a byte, sin normalización LF. El
  backup también copia bytes tal cual.

## [2.4.0] — 2026-08-11

`souclaude vault-sync`: la sincronización con el Vault deja de ser prosa y pasa a ser un
comando; el monitor publica el consumo al Vault por defecto; el CI queda alineado con el
requisito real de Node.

### Agregado

- **Comando `vault-sync`**: pull `--rebase` seguro por defecto (con `rebase --abort`
  defensivo), `--push -m "<msg>" [--paths a,b]` para espejos y kanban (add → commit →
  pull → push, jamás `--force`), `--status`. Exit codes 0/1/2/3 — los agentes distinguen
  "Vault sin configurar" (3) de "falló el sync" (1) y lo reportan en vez de omitirlo en
  silencio. El push ocurre dentro del proceso Node, así que no choca con el
  `permissions.ask` de `git push`. Helper reutilizable en `src/core/vault-sync.js`; el
  publisher del monitor lo adopta y borra su copia del patrón.
- **El monitor publica por defecto**: con `.claude/vault.local.json` presente y panel en
  vivo, los snapshots agregados (<1 KB, ADR 20260810) se publican sin flag; `--no-publish`
  es el opt-out por corrida. La sección CUENTAS de todo el equipo se llena sola.
- Los `.md` de agentes y `progress/README.md` invocan `vault-sync` en lugar de la
  secuencia git a mano; `.claude/settings.json` permite el comando sin prompt.

### Corregido

- **CI en Node 22/24 (antes 20)**: `parseArgs({ allowNegative: true })` requiere
  Node >= 22.4 (igual que `engines`), así que en Node 20 todo `--no-<flag>` salía con
  exit 2 y los tests de `vault` y `mode` fallaban solo en GitHub. La matriz ahora prueba
  22 (piso de `engines`) y 24 (versión de trabajo); `push` a `dev` también dispara CI;
  `package-lock.json` regenerado (estaba fosilizado en 1.0.0); `.nvmrc` y `.npmrc`
  (`engine-strict`) nuevos.
- **Timeout del fetcher con timer propio ref'd**: `AbortSignal.timeout` usa un timer
  unref'd y bajo `node --test` en Node 22 el event loop moría antes del abort, dejando
  la promesa colgada y cancelando en cascada los 8 tests del fetcher.

---

`souclaude monitor`: panel de consumo de tokens de Claude Code en la terminal.

### Agregado

- **Comando `monitor`**: panel de límites de plan, agentes vivos, sesiones,
  proyectos y desglose por tipo de token y por modelo, leído directamente de
  `~/.claude/projects/**/*.jsonl`. Modos `--once`, `--compact`, `--agents`,
  `--json` y panel en vivo con TTY (alternate buffer, resize, teclas). Sale
  0/1/2 según el peor límite de plan — pensado para un hook. No suma ninguna
  dependencia nueva.
- **Refresco propio de los límites de plan**: `cachedUsageUtilization` de
  `~/.claude.json` solo se reescribe cuando el humano corre `/usage` — medido
  con un poller sobre `fetchedAtMs`: cero refrescos en 12 minutos de actividad
  continua, y `claude auth status` tampoco lo toca. El monitor ahora consulta
  el mismo endpoint que usa Claude Code, `GET
  https://api.anthropic.com/api/oauth/usage`, con el token OAuth que Claude
  Code ya guarda, TTL de 5 minutos y caché propio en
  `~/.claude/souclaude/usage-cache.json`. Entre las dos fuentes gana la de
  lectura más reciente, entera: los campos nunca se mezclan. El endpoint es
  interno y no documentado — puede romperse con cualquier actualización de
  Claude Code — así que ante 401, 404, cambio de forma o timeout el monitor
  cae al caché y el panel muestra la edad real del dato, nunca inventa un
  número.
- **Flag `--no-refresh`**: desactiva la consulta a la API para CI, para
  `--claude-home` apuntando a un fixture, o cuando el humano prefiere no
  tocar la red. Ningún test sale a internet.
- **Reglas `deny` nuevas en `.claude/settings.json`**: `~/.claude/.credentials.json`
  (guarda, además del token de Claude, los OAuth de los conectores MCP de
  terceros — es probablemente el archivo más sensible de la máquina),
  `~/.ssh/**` y `~/.aws/credentials`, más las que `CLAUDE.md` ya daba por
  existentes (`*.key`, `*.pfx`, `credentials.json`, `secrets.json`).
- **18 tests nuevos** sobre el manejo del token con credenciales falsas
  reconocibles (suite total: 284 pass).

### Decisiones

- **Deduplicación por `message.id`**: varias líneas `assistant` de un mismo
  transcript comparten `message.id` y repiten el objeto `usage` completo. Sin
  deduplicar, el consumo se infla 2-3x — el síntoma es un número mal, no una
  excepción, así que la regla vive en el acumulador de dominio
  (`domain/consumo.js`), no en un adapter donde se pueda saltear.
- **Tokens medidos, costo estimado**: los tokens salen del `usage` de cada
  respuesta (dato real); el costo en USD sale de una tabla de precios local,
  porque la máquina no guarda lo que costó cada llamada (dato estimado). El
  panel lo declara en su propio pie para que nunca se confundan.

## [2.3.0] — no publicado

El Vault deja de ser un paso manual: el instalador lo conecta (y lo clona si hace falta), y
los agentes saben que trabajan contra **dos repos**.

### Agregado

- **Paso de Vault en el instalador** (`init` y `upgrade`): pregunta si tienes el Vault en
  esta máquina; si no, ofrece clonar
  `https://github.com/ialvarezsoutec/soubunker-vault.git` (URL declarada en el manifest,
  clave `vault.repo`) y deja la ruta escrita. Nunca bloquea: si el clone falla o lo
  cancelas, avisa con el comando manual y la instalación sigue devolviendo 0.
- **`.claude/vault.local.json`** — nueva fuente canónica de la ruta local del Vault,
  gitignorada (es config de máquina) y **legible por los agentes**. Reemplaza a `VAULT_PATH`
  del `.env` para ese uso: `.claude/settings.json` deniega `Read(./.env)`, así que ningún
  agente podía leerla de ahí. `VAULT_PATH` en `.env.example` queda solo para el runtime de
  la app. La ruta **no** va al lockfile: `.claude/harness.json` se commitea y viajaría a
  otra máquina. Al lockfile va solo `VAULT_REPO`, que es igual para toda la organización.
- **Flags nuevos**: `--vault-path <ruta>` (conecta sin preguntar), `--vault-repo <url>`
  (repo alternativo) y `--no-vault` (omite el paso). Con `--yes` o en CI **nunca se clona**:
  git clone es red y disco, y en CI correría en cada corrida.
- **Doctrina de los dos repos** (`progress/README.md`, replicada en `CLAUDE.md`, `AGENTS.md`
  y los cuatro agentes): el Vault es un repo git con su propio remoto y regla **opuesta** a
  la del repo de proyecto — **push directo a su `main`, sin PR**, porque el tablero refleja
  el ahora. Convención de commits del Vault: `chore:` para movimientos de kanban, `docs:`
  para espejos. Nunca `--force`, en ninguno de los dos.
- **Anti-solapamiento entre máquinas**: antes de tomar un task, el agente hace
  `git -C "<vault>" pull --rebase` y lee el kanban. Si la tarjeta ya está en "En curso" o
  "En review" **con otro dueño**, **para y pregunta al humano** — no la toma ni salta a otra
  por su cuenta. Los conflictos en `kanban.md` se resuelven conservando ambas tarjetas; dos
  rebases fallidos seguidos se anotan como `vault_skip` y se reportan.

### Corregido

- **`--no-backup` nunca funcionó**: el help lo documentaba pero `parseArgs` lo rechazaba como
  opción desconocida. Ahora se parsea con `allowNegative: true`, que habilita también
  `--no-vault`. Sube el requisito de Node de `>=20` a `>=22.4`.

### Nota de actualización

`CLAUDE.md` es `user-owned`: el `upgrade` **no** lo sobrescribe, deja `CLAUDE.md.new` al lado
(garantía P8). **Hay que mergear ese `.new`**: sin la sección "Los dos repos", el agente lee
"nunca push directo a `main`" sin matices y se niega a escribir en el Vault.

## [2.2.0] — no publicado

Progreso por disco formalizado, IDs de task amarrados al hito y costo por tarea en la
telemetría del router.

### Agregado

- **Carpeta `progress/` formalizada y emitida por el harness**: `progress/README.md`
  (managed — documenta la convención) y `progress/history.md` (user-owned — historial
  compartido append-only, una línea por task/sesión cerrada, con regla de resolución de
  merge en el encabezado). Subcarpeta `progress/<ID-hito>-<slug>/` por spec en marcha con
  `summary.md` (spec-author), `impl_summary.md` (implementer) y `review.md` (reviewer) —
  reemplaza la convención plana `spec_/impl_/review_<ID>.md`.
- **IDs de task `<PREFIJO>-H<n>-T<nnn>`** (ej. `TNP-H1-T001`), emitidos por el spec-author
  en la fase Tasks con **bloques de 100 por spec** según el orden de reserva en
  `/rock-plan` (1.er spec desde T001, 2.º desde T101) — cero colisiones entre specs en
  ramas paralelas. Footer `Refs: <ID-task>` obligatorio en el commit-por-task. La cadena
  de `ccem-planner` se extiende: Roca → Hito → Spec → **Task** → commit.
- **Costo por tarea en la telemetría del router**: `progress/model-router.jsonl` suma
  `task`, `tokens_in`, `tokens_out`, `costo_usd` y `medicion` (`medido`|`estimado`, con
  regla de honestidad: un estimado es orden de magnitud, nunca cifra contable), más la
  tabla de precios referencial en `ccem-model-router` §7 (único lugar a actualizar).
  `/rock-close` suma el bloque "Resumen de costo" (% medido primero, total después).
- **Regla de arquitectura**: si un task cambia la arquitectura (puerto nuevo, contrato
  público, dependencia entre capas), el cierre exige doc en `docs/` + ADR; el implementer
  actualiza docs y declara el ADR pendiente (sigue siendo del spec-author), y el reviewer
  rechaza sin ambas cosas.
- **`docs/vault-guide.md`** (solo este repo, no distribuido): guía de creación del Vault
  central multi-proyecto — estructura, archivos semilla (`id-registry.md`), quién escribe
  qué, relación Vault↔repos↔Ninety, concurrencia multi-persona.
- **Espejo al Vault y estado vivo (kanban)**: los artefactos SDD y los resúmenes de
  progreso se copian al Vault (`Project-<PREFIJO>/specs/` y `progress/`), y cada task
  tiene tarjeta en `Project-<PREFIJO>/kanban.md` (formato plugin Kanban de Obsidian) que
  los agentes mueven **al empezar** a trabajar — el tablero refleja el ahora, no el push
  final; por eso el Vault vive en un repo aparte. Ruta vía `VAULT_PATH` en `.env`
  (emitida en `env.example`); sin ella el espejo se omite sin bloquear y queda anotado en
  `history.md`. Doctrina en `progress/README.md`; `ccem-planner` distingue ahora qué
  cruza a Ninety (solo hito) vs al Vault (espejos + kanban).

### Cambiado

- `AGENTS.md`, los 4 agentes SDD y el orchestrator usan las rutas nuevas de `progress/` y
  agregan su línea a `history.md` al cerrar cada artefacto.
- Templates `tasks-template.md` y `tasks-lite-template.md` con IDs completos y la regla de
  numeración por bloques.

## [2.1.0] — no publicado

Soutec Model Router: cada subagente corre con el mejor modelo posible según el triángulo
Calidad / Velocidad / Costo. El orchestrator es el router; la política es declarativa.

### Agregado

- **Skill `ccem-model-router`** (distribuida por el manifest, policy managed): única fuente
  de verdad de la política de ruteo — clasificación de tarea (mecánica/estándar/compleja),
  checklist de señales de dificultad, matriz agente × clase → (modelo, effort), escalamiento
  excepcional (criterios objetivos + máximo 1 escalada por hito + fallback a `inherit`) y
  telemetría en `progress/model-router.jsonl` con revisión trimestral en `/rock-close`.
  El mapeo rol → alias (Decisiones→`fable`, Ejecución→`opus`, Volumen→`sonnet`) vive en
  una sola tabla, el único lugar a actualizar cuando cambie la familia de modelos.

### Cambiado

- **`orchestrator`**: la sección "Selección de modelo" pasa de prosa orientativa a protocolo
  de router obligatorio (clasificar → resolver overrides `model`/`effort` en la llamada
  Agent → escalar solo con criterios y presupuesto → registrar cada lanzamiento en JSONL).
- **`spec-author` y `reviewer`** suman `effort: high`, **`implementer`** suma
  `effort: medium` en el frontmatter — red de seguridad para invocaciones sin orchestrator.
  Se mantiene la decisión de **no** emitir `model:` en frontmatter: forzar un modelo rompe
  a quien no lo tiene; el modelo se decide por invocación con fallback a `inherit`.
- **`ccem-core`** enlaza su sección "Selección de modelo" con la política operable;
  **`/rock-close`** suma el paso "Revisión de política de modelos" (umbral de escaladas
  >10 %, rework por celda).

## [2.0.0] — no publicado

Capa de rocas: el **hito** reemplaza a Planner como emisor de IDs. Implementa la Fase 0 de la
Metodología de Roca v2.1.0 en el repo de código.

### BREAKING CHANGE

- **El emisor de IDs pasa de la tarjeta de Planner al hito** (`<PREFIJO>-H<n>`, ej. `REA-H3`),
  definido en el Paso 2 de la roca (`/rock-plan`). El hilo de trazabilidad es ahora
  `Roca → Hito → specs/<ID-hito>-<slug>/ → rama → PR → tag`. Los repos consumidores reciben la
  reescritura en el próximo `upgrade`. ADR: `docs/decisions/20260722-capa-rocas-hito-emisor-de-ids.md`
  (supersede al de orquestación solo en cuanto al emisor).

### Agregado

- **Paquete de skills `ccem-rocas`** (4 comandos, distribuidos por el manifest): `/rock-plan`
  (Paso 2, con las 7 reglas de construcción de hitos y el checklist de validación E1/E4),
  `/rock-status` (snapshot semanal derivado de GitHub; falla ante campos derivados editados a
  mano, E2/E3), `/rock-close` (cierre contra criterios congelados, exige evidencia por criterio,
  E5) y `/export-ninety` (contrato por fases con Ninety; Fase 0 manual).

### Cambiado

- **`ccem-planner` reescrito**: el hito es el emisor, el estado del trabajo se **deriva** de
  GitHub (rama/PR) en vez de un tablero, y el WIP pasa de "2-3 tarjetas por dev" a "**2 ramas
  vivas por persona**" (`git branch -r`). Conserva su nombre para no romper manifest/lockfile.
- **`spec-new`** suma el contrato de entrada hito → spec (criterios heredados, no-alcance,
  entregable, rollback) y deja de hablar de Planner. Corrige una referencia P7 → P9.
- **`soutec-github`**, los agentes `orchestrator`/`spec-author`/`implementer` y ambos `CLAUDE.md`
  pasan de "tarjeta de Planner" al hito como origen del trabajo.

### No incluido (tracks aparte)

- El repo Vault (`00-System`, `id-registry.md`, `plantilla_apertura_roca.yaml`), los jobs
  semanales (E2/E3 como cron), el cierre de hito con evidencia automatizado (E5) y la API de
  Ninety (Fases 1-3). P7/P8 de la constitución se dejan como placeholder a propósito
  (metodología §9).

## [1.2.0] — no publicado

Flujo de security review para IT y verificación de integridad del harness.

### Agregado

- **Agente `security-evidence-compiler`** en `.claude/agents/`: compila el security
  review, las remediaciones SDD y la evidencia de pruebas en un informe Markdown y PDF
  para IT. Contrato de activación explícito: solo corre cuando la skill
  `it-security-review` entrega `FINAL_SECURITY_GATE=PASSED`. `AGENTS.md` documenta la
  categoría nueva de "agentes especialistas bajo demanda" — con nombre descriptivo y
  contrato concreto, no casillas vacías.
- **Skills `it-security-review`** (el workflow del review, con su template de informe) y
  **`security-report-standard`** (el estándar interno del informe técnico para IT).
  Ambas se distribuyen por el harness: están en `templates/base/` y en el manifest.
- **Skill `soutec-md-a-pdf`** commiteada en `.claude/skills/`: renderiza el PDF de
  evidencia con la identidad corporativa. El ADR
  `docs/decisions/20260722-render-pdf-evidencia-via-skill-soutec-md-a-pdf.md` ya la
  referenciaba, pero los archivos no estaban en el repo.
- **Comando `souclaude verify`**: verificación de integridad del harness instalado
  (`src/commands/verify.js` + `src/core/verify.js`), con tests propios y test de
  dogfooding.

### Corregido

- La suite de pruebas corre en Node ≥ 22.

## [1.1.0] — 2026-07-21

Orquestación multi-agente: cuatro roles que siguen el flujo SDD de CCEM con separación de
responsabilidades y checkpoints humanos.

### Agregado

- **Cuatro agentes** en `.claude/agents/`, distribuidos por el harness: `orchestrator`
  (coordina, no escribe código), `spec-author` (redacta spec/plan/tasks, una fase por
  invocación), `implementer` (task por task, cada cambio con su test) y `reviewer` (aprueba
  o rechaza de forma **independiente**, sin `Write`/`Edit`).
- **`AGENTS.md`** en la raíz: el mapa del flujo multi-agente, los cuatro roles, y las reglas
  del harness que respetan **por referencia** (no las redefinen).
- El patrón se subordina a la constitución: los checkpoints humanos y "ningún agente se
  auto-aprueba ni marca `done`" son **P6 hecho producto**. El hilo sigue siendo el ID de
  Planner; no se introduce `feature_list.json` ni un segundo sistema de estado.

### Decisiones

- **Opt-in, no líder global.** La orquestación se invoca a demanda; no se fuerza a cada
  sesión vía `CLAUDE.md` — forzarlo secuestraría el proyecto consumidor (P9/P10). ADR:
  `docs/decisions/20260721-orquestacion-multiagente.md`.
- **Identificadores en inglés, prosa en español.** `name:`/`subagent_type` toca el framework
  → inglés kebab-case; el cuerpo instructivo que lee el dev → español.
- Patrón **derivado** de `betta-tech/harness-sdd` (repo sin LICENSE): se adopta el patrón, no
  la prosa — todo redactado original. Evaluado con `ccem-research`.

## [1.0.0] — 2026-07-15

Primera versión. Reemplaza la copia manual de la carpeta `Kit/`.

### Agregado

- CLI `souclaude` con `init`, `upgrade`, `status` y `adopt`. Se distribuye por
  `npx github:ialvarezsoutec/souclaude-harness#v1` — sin registry ni token.
- **Motor de migración**: un solo code path para instalar en un repo vacío, adoptar un
  repo legacy y migrar de una versión del harness a otra. Lockfile en
  `.claude/harness.json` con el hash de cada archivo emitido.
- **Garantía de no-sobrescritura**: un archivo editado por el usuario nunca se pisa; la
  propuesta del harness queda al lado como `.new`.
- Skills project-local en `.claude/skills/`: `ccem-core`, `ccem-sdd`, `ccem-planner`,
  `ccem-research`, `ccem-stack`, `ccem-prompting`, `soutec-github`.
- Comandos `/spec-new`, `/adr-new`, `/constitution-check`, `/harness-upgrade`.
- Templates SDD Lite, que el `specs/README.md` del Kit prometía y nunca existieron.
- `.github/pull_request_template.md` y `.github/CODEOWNERS` — **obligatorios en Fase 1**
  según la Guía Operativa Git v2.0, y que el Kit no emitía.
- La constitución prellena **P1 (Contratos antes que tecnologías)** y **P2 (Hexagonal
  con enforcement automático)**, con la herramienta de enforcement **derivada del stack
  detectado** (import-linter en Python, dependency-cruiser en Node, ArchUnit en Java…).

### Decisiones que resuelven contradicciones del corpus

- **Numeración canónica P1-P10.** El corpus numeraba los mismos dos principios
  universales de tres formas: CCEM v3.0 los llama #5/#6, el Kit P7/P8, y el doc de
  Arquitectura P9/P10. **Gana P9 (Simplicity First) y P10 (Surgical Changes)**, la del
  doc de Arquitectura. Pendiente: corregir el Kit y CCEM v3.0 para que coincidan.
- **Idioma**: el dominio se nombra en español (entidades, value objects, policies,
  métodos de puerto) porque *el puerto habla en lenguaje de dominio, no de framework*.
  Adaptadores, infraestructura y todo lo que toca frameworks, en inglés. La regla previa
  del Kit ("todo en inglés") contradecía al doc de Arquitectura.
- **La carpeta de spec lleva el ID de Planner**: `specs/<PLN-023>-<slug>/`, con el mismo
  slug que la rama. El Kit usaba solo el slug, lo que rompe el hilo de trazabilidad
  Planner ↔ specs ↔ rama ↔ commits ↔ PR ↔ release.
- **Skills project-local, no globales.** CCEM v3.0 dice `~/.claude/skills/`. Se eligió
  local: cero instalación por dev, versionadas con el código, funcionan en CI, y —
  decisivo — una skill global **no se puede actualizar por proyecto**, lo que dejaría al
  motor de migración sin nada que migrar.

### Estilo

- **Conjugación en español: tuteo, no voseo.** Estándar de la organización — aplica a
  toda respuesta de Claude, no solo al contenido del harness. `CLAUDE.md` ahora lo
  declara explícitamente. Se convirtió todo el texto en voseo argentino que traía el
  proyecto (skills, comandos, README, MAINTAINERS, guía del desarrollador, comentarios de
  código) a tuteo — ~250 formas corregidas en 3 pasadas de verificación.

### Corregido (respecto del Kit v0)

- **`.claude/settings.json` tenía 4 de 5 claves inválidas.** `effort`,
  `auto_confirm_destructive`, `display_tools` y `token_budget_warning` no existen en el
  schema de Claude Code: se ignoraban en silencio. El archivo parecía configurado y no
  hacía nada. Hay una migración que las remueve.
  **Ojo**: estas claves las prescribe el propio doc de Arquitectura (§14). Ese documento
  también hay que corregirlo, o los repos nuevos las van a volver a copiar.
- **`model: "opusplan"` no es un valor válido.** El harness ya no fija `model` a nivel
  proyecto: forzarlo rompe a quien no tenga ese modelo.
- **`.claudeignore` nunca fue una feature de Claude Code.** El archivo se ignora en
  silencio. La exclusión real de secretos se configura en `permissions.deny` de
  `settings.json`, que el harness ahora emite. El `.claudeignore` de un repo viejo se
  marca obsoleto y se ofrece borrarlo con `--prune`.
- **`plan-template.md` emitía el antipattern #15** del doc de Arquitectura: constitution
  alignment con checkboxes sin referenciar ADRs ("alignment teatral"). Ahora exige el
  ADR concreto que respalda cada principio.
- **`tasks-template.md` imponía 15-30 min sin escape hatch**, cuando el doc de
  Arquitectura ya había documentado la excepción para adaptadores (2-3 h si son un
  componente único y verificable en aislamiento). La excepción ahora está en el template
  y hay que justificarla al usarla.
- **`apply()` revertía en silencio las ediciones del usuario.** Escribía toda acción con
  `writePath`, incluidas las `local-edit` — si editabas una skill, el siguiente `upgrade`
  te la pisaba sin avisar. Era la violación más grave posible de la garantía central.
  Encontrado por los tests, no por inspección manual.
- **Un repo recién creado con `README.md` de 0 bytes quedaba con un `.new` para siempre.**
  Un archivo vacío ahora se trata como ausente: no hay nada del usuario que perder.
- **`DATE` se recalculaba en cada corrida.** Un `CLAUDE.md`/`constitution.md` intactos
  aparecían como `conflict` -> `.new` espurio con solo cruzar la medianoche, porque el
  contenido deseado cambiaba de fecha aunque nada real hubiera cambiado. Ahora es sticky,
  igual que `OWNER`: se siembra una vez al instalar y no se toca más. Encontrado
  dogfooding el propio harness sobre este repo.

### Pendiente (falta la fuente)

- `ccem-research` (los 7 criterios) y `ccem-stack` están escritos como reconstrucción, no
  desde la fuente. Los documentos que los contienen —
  `CCEM-External-Sources-Evaluation.md` y `CCEM-Project-Startup-Guide.md` — no están en
  el repo. **Reescribirlos apenas aparezcan**; los repos los reciben con
  `souclaude upgrade`.
