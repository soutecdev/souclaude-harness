import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { segmentos, piezasDe, palabras, comandoEfectivo, comandoAnidado, destinosDelPush, argumentosDelPush } from '../templates/base/claude/hooks/reglas-pr.mjs'

// Sigue a hook-reglas-pr-evasion.test.js: mismas herramientas, en un archivo
// aparte para que corra en paralelo con el.
const HOOK = fileURLToPath(new URL('../templates/base/claude/hooks/reglas-pr.mjs', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../templates/base/scripts/check-pr-rules.mjs', import.meta.url))
// Una carpeta real, con subcarpetas: el hook comprueba que el destino de un `cd`
// exista (a una carpeta que no existe, el `cd` falla).
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude contraste '))
for (const sub of ['otro/sub', 'sub', 'a/b', 'otra']) fs.mkdirSync(path.join(CWD, sub), { recursive: true })

// --- Lo que encontro la tercera lectura, y el contraste con bash y zsh ----------
//
// Una segunda verificacion independiente y, despues, miles de comandos armados
// al azar y ejecutados en bash y en zsh de verdad (con un `git` de mentira que
// anota en que carpeta corre) encontraron lo que fijan estos tests. Lo mas
// grave ya estaba en el hook original: un push escrito tras una continuacion de
// linea (`&& \` y salto) no se veia.

test('palabras: una continuacion de linea no deja nada, y `$\'...\'` son comillas', () => {
  assert.deepEqual(palabras('git \\\n push \\\n origin main'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(palabras('git pu\\\nsh origin ma\\\nin'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(palabras(' \\\n  git push origin main'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(palabras('git commit -m "uno \\\n dos"'), ['git', 'commit', '-m', 'uno  dos'])
  assert.deepEqual(palabras('git push `\n origin `\r\n main', 'powershell'), ['git', 'push', 'origin', 'main'])
  // En `$'...'` la barra escapa la comilla, y el `$` es parte de las comillas.
  assert.deepEqual(palabras("git push origin $'main'"), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(palabras("echo $'it\\'s' x"), ['echo', "it's", 'x'])
  assert.deepEqual(palabras("echo \\$'a' b"), ['echo', '$a', 'b'], 'con el `$` escapado son comillas simples comunes')
  // Una barra doble no continua nada: la segunda es un caracter.
  assert.deepEqual(palabras('echo a\\\\'), ['echo', 'a\\'])
})

test('comandoEfectivo: las asignaciones que siguen a una palabra de control son del comando', () => {
  const efectivo = (...p) => comandoEfectivo(p).p
  assert.deepEqual(efectivo('then', 'GIT_TRACE=1', 'git', 'push'), ['git', 'push'])
  assert.deepEqual(efectivo('do', 'A=1', 'B=2', 'git', 'push'), ['git', 'push'])
  assert.deepEqual(efectivo('{', 'X=1', 'git', 'push', '}'), ['git', 'push'])
  assert.deepEqual(efectivo('!', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!', '!', 'git', 'push'), ['git', 'push'], 'sin tope de palabras de control')
  // Tras `env` o `time` la asignacion es valida; tras otro envoltorio es el nombre
  // de un programa que no existe, y el comando que sigue puede no correr.
  assert.equal(comandoEfectivo(['env', 'X=1', 'cd', 'x']).dudoso, undefined)
  assert.equal(comandoEfectivo(['time', 'X=1', 'cd', 'x']).dudoso, undefined)
  assert.equal(comandoEfectivo(['builtin', 'X=1', 'cd', 'x']).dudoso, true)
  assert.deepEqual(comandoEfectivo(['builtin', 'X=1', 'cd', 'x']).p, ['cd', 'x'])
  // `! time cd x`: tras un `!`, que `time` sea el del shell depende del shell.
  assert.equal(comandoEfectivo(['!', 'time', 'cd', 'x']).dudoso, true)
  assert.equal(comandoEfectivo(['time', '!', 'cd', 'x']).dudoso, undefined)
  // Cada `eval` vuelve a leer el texto del anterior (y vuelve a quitarle las comillas).
  assert.deepEqual(comandoAnidado(['eval', 'eval', 'cd "a b"']), { comando: 'eval cd "a b"', shell: 'bash' })
  assert.deepEqual(comandoAnidado(['eval', 'cd', 'a b']), { comando: 'cd a b', shell: 'bash' })
})

test('piezasDe: lo que va entre comillas dobles se ejecuta si es una sustitucion', () => {
  assert.deepEqual(segmentos('echo "$(git push origin main)"'), ['echo "$', 'git push origin main', '"'])
  assert.deepEqual(segmentos('git commit -m "docs: usa `git push origin main`"').slice(1, 2), ['git push origin main'])
  assert.deepEqual(segmentos('echo "${x:-$(git push origin main)}"').slice(1, 2), ['git push origin main'])
  assert.deepEqual(segmentos('Write-Host "$(git push origin main)"', 'powershell').slice(1, 2), ['git push origin main'])
  // Escapada o entre comillas simples no se ejecuta.
  assert.deepEqual(segmentos('echo "\\$(git push origin main)"'), ['echo "\\$(git push origin main)"'])
  assert.deepEqual(segmentos("echo '$(git push origin main)'"), ["echo '$(git push origin main)'"])
  // Las comillas de adentro de la sustitucion no son las del comando: el mensaje
  // de un commit con una comilla impar no esconde lo que sigue.
  const commit = 'git commit -m "$(cat <<\'EOF\'\nfix: di "hola\n\nEOF\n)" && git push origin main'
  assert.equal(segmentos(commit).at(-1), 'git push origin main')
  // La pieza que sigue a la sustitucion empieza dentro de las comillas: es texto.
  const piezas = piezasDe('echo "$(pwd) git push origin main"')
  assert.equal(piezas.at(-1).texto, ' git push origin main"')
  assert.equal(piezas.at(-1).enComillas, true)
  // Las posiciones siguen siendo las del comando.
  for (const pieza of piezasDe(commit)) assert.equal(commit.slice(pieza.desde, pieza.hasta), pieza.texto)
  // `$'...'`: la comilla escapada no cierra, y lo que sigue se lee.
  assert.deepEqual(segmentos("echo $'a\\'b'; git push origin main"), ["echo $'a\\'b'", 'git push origin main'])
  // Una continuacion de linea no parte el comando, ni convierte en palabra nueva un `#`.
  assert.deepEqual(segmentos('echo hola && \\\ngit push origin main'), ['echo hola', '\\\ngit push origin main'])
  assert.deepEqual(segmentos("echo a \\\n# don't\ngit push origin main"), ['echo a \\', 'git push origin main'])
})

test('piezasDe: un `<<` no siempre abre un heredoc, y un heredoc no siempre tiene cuerpo', () => {
  const tiene = (comando, texto) => segmentos(comando).includes(texto)
  // Dentro de una expresion aritmetica o de un subindice es un desplazamiento.
  assert.ok(tiene('echo $((1<<EOF))\ngit push origin main\nEOF', 'git push origin main'))
  assert.ok(tiene('flags=$((1<<n))\necho $flags\ngit push origin main\nn', 'git push origin main'))
  assert.ok(tiene('a[1<<n ]=5\ngit push origin main\nn', 'git push origin main'))
  assert.ok(tiene('x=$[1<<n]\ngit push origin main\nn', 'git push origin main'))
  // El que queda sin cuerpo dentro de una sustitucion termina con ella...
  assert.ok(tiene('echo $(cat <<EOF)\ngit push origin main\nEOF', 'git push origin main'))
  assert.ok(tiene('echo `cat <<EOF`\ngit push origin main\nEOF', 'git push origin main'))
  assert.ok(tiene('cat <(cat <<EOF)\ngit push origin main\nEOF', 'git push origin main'))
  assert.ok(tiene('echo "$(cat <<EOF)"\ngit push origin main\nEOF', 'git push origin main'))
  // ...pero el de un subshell toma su cuerpo de las lineas que siguen.
  assert.deepEqual(segmentos('( cat <<EOF )\ngit push origin main\nEOF\ngit status'), ['cat <<EOF', 'git status'])
  // En un heredoc sin comillas, la linea que continua a la anterior no lo cierra.
  assert.deepEqual(segmentos('cat <<EOF\nuno \\\nEOF\ngit push origin main\nEOF\ngit status'), ['cat <<EOF', 'git status'])
  assert.deepEqual(segmentos("cat <<'EOF'\nuno \\\nEOF\ngit status"), ["cat <<'EOF'", 'git status'])
  // El delimitador admite los caracteres que bash toma tal cual.
  assert.deepEqual(segmentos('cat <<EOF!\ntexto\nEOF!\ngit status'), ['cat <<EOF!', 'git status'])
  assert.deepEqual(segmentos('cat <<1\ntexto\n1\ngit status'), ['cat <<1', 'git status'])
  // Un fin de linea de Windows pegado al delimitador es parte de el, como para bash.
  assert.deepEqual(segmentos("cat <<'EOF'\r\nx\r\nEOF\r\ngit status"), ["cat <<'EOF'", 'git status'])
  assert.ok(tiene('cat <<EOF\nx\nEOF\r\ngit push origin main\n', 'git push origin main'), 'sin el mismo fin de linea no cierra: no se salta nada')
})

test('destinosDelPush: una continuacion de linea, `function f`, `$\'...\'` o unas comillas dobles no esconden el push', () => {
  const destinos = (comando, shell) => destinosDelPush(comando, CWD, shell).flatMap((p) => p.destinos)
  for (const comando of [
    'git add -A && \\\n  git commit -m "x" && \\\n  git push origin main',
    'echo hola && \\\ngit push origin main',
    'git \\\n push origin main',
    'git pu\\\nsh origin main',
    'git push origin ma\\\nin',
    'git commit -m "uno \\\n dos" && \\\n git push origin main',
    'function f { git push origin main; }; f',
    'function f() { git push origin main; }; f',
    'for i in 1; do function g { git push origin main; }; g; done',
    "git commit -m $'fix: don\\'t crash' && git push origin main",
    "echo $'a\\'b'; git push origin main",
    "git push origin $'main'",
    'echo "$(git push origin main)"',
    'git commit -m "docs: usa `git push origin main`"',
    'git commit -m "$(cat <<EOF\nfix: usa `git push origin main` en la guia\nEOF\n)"',
    'if true; then GIT_TRACE=1 git push origin main; fi',
    '{ FOO=1 git push origin main; }',
    'eval eval eval eval eval git push origin main',
    'x=($(git push origin main))',
    'retry() { for i in 1 2 3; do "$@" && return; done; }; retry git push origin main',
  ]) {
    assert.ok(destinos(comando).includes('main'), comando)
  }
  assert.ok(destinos('git push `\n  origin `\n  main', 'powershell').includes('main'))
  assert.ok(destinos('function Subir { git push origin main }; Subir', 'powershell').includes('main'))
  // Y lo que no es un push sigue sin serlo.
  for (const comando of [
    'echo "$(pwd) git push origin main"',
    'echo "$(date) y luego $(pwd) git push origin main"',
    'git commit -m "fix: $(date) git push origin main"',
    'echo "\\$(git push origin main)"',
    "echo '$(git push origin main)'",
    'x=(git push origin main)',
    'arr+=(git push origin main)',
    'declare -a arr=(git push origin main)',
    'log() { printf "%s\\n" "$*"; }; log "ejecuta git push origin main"',
  ]) {
    assert.deepEqual(destinos(comando), [], comando)
  }
})

test('carpeta del push: `case`, arreglos y sustituciones no cierran antes de tiempo el subshell que los contiene', () => {
  const dirs = (comando) => destinosDelPush(comando, CWD).map((p) => p.dir)
  const otro = path.resolve(CWD, 'otro')
  // Cada uno de estos dejaba al push de afuera corriendo "en" la carpeta del subshell.
  for (const comando of [
    '(cd otro; case x in esac); git push origin x',
    '(cd otro; echo $(date) case closed); git push origin x',
    '( arr=(case otro); cd otro ); git push origin x',
    '(cd otro; x=$(date) case y); git push origin x',
    '(cd otro; echo "$(date) case") ; git push origin x',
  ]) {
    assert.deepEqual(dirs(comando), [CWD], comando)
  }
  // Y este cerraba el subshell en el `)` del patron: el push de adentro corre en otro/sub.
  assert.deepEqual(dirs('cd otro && (cd sub && if case x in x) true;; esac; then git push origin x; fi)'), [path.join(otro, 'sub')])
  // `time` delante de un bloque no lo esconde.
  assert.deepEqual(dirs('time if true; then cd otro; fi | cat; git push origin x'), [CWD])
})

test('carpeta del push: en una lista, el `cd` que puede no haber corrido queda en duda tambien adentro', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  // La lista termina en el `;` aunque lo que siga sea un parentesis, y tambien al final de un `eval`.
  for (const comando of ['false && cd otro; (git push origin x)', 'false && cd otro\n(git push origin x)', "eval 'false && cd otro'; git push origin x", 'eval "false && cd otro"\ngit push origin x']) {
    const p = push(comando)
    assert.equal(p.dir, CWD, comando)
    assert.match(p.dudaDeCarpeta, /solo si se cumple una condicion/, comando)
    assert.equal(p.carpetaAlternativa, otro, comando)
  }
  // Lo que sigue a un `||` corre si fallo algo de antes: quiza sin el `cd` de la lista.
  const tras = push('ls && cd otro && ls || git push origin x')
  assert.equal(tras.dir, otro)
  assert.match(tras.dudaDeCarpeta, /corre solo si fallo algo de antes/)
  assert.equal(tras.carpetaAlternativa, CWD)
  // Con `!` delante se invierte: lo que sigue al `||` corre si el `cd` no fallo.
  assert.equal(push('! cd otro || git push origin x').dir, otro)
  assert.equal(push('! cd otro || git push origin x').dudaDeCarpeta, null)
  assert.equal(push('! cd otro && git push origin x').dir, CWD)
  // Una lista mandada al fondo: bash la corre entera en un subshell; zsh, solo su ultima tuberia.
  const alFondo = push('cd otro && sleep 1 & git push origin x')
  assert.equal(alFondo.dir, CWD)
  assert.match(alFondo.dudaDeCarpeta, /depende del shell/)
  assert.equal(alFondo.carpetaAlternativa, otro)
  assert.equal(push('sleep 1 & git push origin x').dudaDeCarpeta, null)
  assert.equal(push('cd otro & git push origin x').dudaDeCarpeta, null)
  // `cd a b` hace cosas distintas segun el shell.
  assert.match(push('cd otro sub; git push origin x').dudaDeCarpeta, /mas de un destino/)
  // El comando cortado por una expresion corre despues de ella: ese push es anterior al `cd`.
  assert.equal(destinosDelPush('cd otro "$(git push origin x)"', CWD)[0].dir, CWD)
  assert.equal(destinosDelPush('cd otro "$(git push origin x)"', CWD)[0].dudaDeCarpeta, null)
})

test('carpeta del push: al salir de un bloque tambien quedan en duda la pila de `pushd` y la carpeta anterior', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const [otro, otra] = [path.resolve(CWD, 'otro'), path.resolve(CWD, 'otra')]
  // La carpeta es la misma haya corrido o no el bloque, pero `popd` y `cd -` no llevan al mismo lugar.
  for (const comando of [`pushd "${otra}"; if false; then popd; cd "${otro}"; pushd "${otra}"; fi; popd; git push origin x`, `cd "${otra}"; if false; then cd "${otro}"; cd "${otra}"; fi; cd -; git push origin x`]) {
    assert.match(push(comando).dudaDeCarpeta, /solo si se cumple una condicion/, comando)
  }
  // Tras un `cd` que pudo no correr, `cd -` vuelve a donde se estaba o a la anterior de antes.
  const p = push('cd otro; cd no-existe; cd -; git push origin x')
  assert.equal(p.dir, otro)
  assert.equal(p.carpetaAlternativa, CWD)
  // Sin una carpeta anterior, vuelve a donde se estaba.
  assert.equal(push('cd "$TMP" && ls; cd -; git push origin x').dudaDeCarpeta, null)
})

test('carpeta del push: definir una funcion no mueve nada; llamarla es correr su cuerpo', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const [otro, sub] = [path.resolve(CWD, 'otro'), path.resolve(CWD, 'sub')]
  for (const [comando, dir] of [
    ['f() { cd otro; }; git push origin x', CWD],
    ['f() { cd otro; }; f; git push origin x', otro],
    ['function f { cd otro; }; f; git push origin x', otro],
    ['function f() { cd otro; }; f; git push origin x', otro],
    ['f() { cd otro; }; f && git push origin x', otro],
    ['f() { cd otro; }; g() { f; }; g; git push origin x', otro],
    ['f() { cd otro; }; f | cat; git push origin x', CWD],
    ['x() ( cd otro ); x; git push origin x', CWD],
    ['f() { cd otro; }; cd sub; git push origin x', sub],
    // Una funcion llamada como un comando del shell lo reemplaza.
    ['cd() { builtin cd otro; }; cd /; git push origin x', otro],
    // La que pasa sus argumentos es un envoltorio mas.
    ['g() { "$@"; }; g cd otro; git push origin x', otro],
    // Volver a definirla no es llamarla.
    ['f() { cd otro; }; f() { true; }; git push origin x', CWD],
    // La que se define en un subshell o en otro proceso no existe afuera.
    ['(f() { cd otro; }); f; git push origin x', CWD],
    ['bash -c \'f() { cd otro; }\'; f; git push origin x', CWD],
    ["sh <<'EOF'\nf() { cd otro; }\nEOF\nf; git push origin x", CWD],
    ['echo "$(f() { cd otro; })"; f; git push origin x', CWD],
  ]) {
    assert.equal(push(comando).dir, dir, comando)
    assert.equal(push(comando).dudaDeCarpeta, null, comando)
  }
  // Si no se sabe si quedo definida (o como), llamarla deja la carpeta en duda.
  for (const comando of [
    'false && f() { cd otro; }; f; git push origin x',
    'true || function f { cd otro; }; f; git push origin x',
    'true | f() { cd otro; }; f; git push origin x',
    'time f() { cd otro; }; f; git push origin x',
    'if true; then f() { cd otro; }; fi; f; git push origin x',
    'f() if true; then cd otro; fi; f; git push origin x',
    'f g() { cd otro; }; f; git push origin x',
    'g() { "$@"; }; false && g() { "$@"; }; true || g() { true; }; g cd otro; git push origin x',
  ]) {
    assert.notEqual(push(comando).dudaDeCarpeta, null, comando)
  }
  // Una funcion que se llama a si misma no cuelga la lectura.
  assert.deepEqual(destinosDelPush('f() { f; git push origin main; }; f', CWD).map((p) => p.destinos), [['main']])
  // `{ cd x }`, con la llave pegada: zsh la toma por el cierre y bash por un argumento.
  assert.match(push('f() { cd otro }; git push origin x').dudaDeCarpeta, /bash y zsh la leen distinto/)
})

test('carpeta del push: una lista pudo terminar en cualquiera de sus pasos', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  // Si `make` falla, el `cd -` no corre y el push corre en otro.
  for (const comando of ['true && cd otro && make && cd -; git push origin x', 'ls && cd otro && { make; } && cd ..; git push origin x']) {
    const p = push(comando)
    assert.equal(p.dir, CWD, comando)
    assert.match(p.dudaDeCarpeta, /solo si se cumple una condicion/, comando)
    assert.equal(p.carpetaAlternativa, otro, comando)
  }
  // Con tres carpetas posibles, la otra no se conoce: un `cd` que pudo no correr
  // en una rama y uno seguro en la otra.
  const tres = push('if true; then [ -d no-existe ] || cd otro; elif true; then cd sub; fi; git push origin x')
  assert.notEqual(tres.dudaDeCarpeta, null)
  assert.equal(tres.carpetaAlternativa, null)
})

test('destinosDelPush: una funcion de cuerpo desconocido con el nombre de un comando que se lee puede ser ese comando', () => {
  const destinos = (comando) => destinosDelPush(comando, CWD).flatMap((p) => p.destinos)
  // En zsh, `eval h() { ... }` define `eval` y `h`; en bash es un error. Afuera
  // del subshell, `eval` vuelve a ser el de siempre.
  assert.ok(destinos('( eval eval \'h() { cd otro; }\' ); eval "git push origin main"').includes('main'))
  // Y si quiza quedo definida, puede ser el `eval` de siempre.
  assert.ok(destinos('false && eval() { cd otro; }; eval "git push origin main"').includes('main'))
})

test('carpeta del push: la que todavia no existe es del repo que la crea, si eso se sabe', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  // Entrar y volver no deja dudas: se sabe donde se esta.
  assert.equal(push('npm run build && cd dist && ls && cd .. && git push origin x').dir, CWD)
  assert.equal(push('npm run build && cd dist && ls && cd .. && git push origin x').dudaDeCarpeta, null)
  // Quedarse adentro, si: no se sabe que repo hay ahi.
  assert.match(push('npm run build && cd dist && git push origin x').dudaDeCarpeta, /no se sabe que repo habra ahi/)
  // Lo que no se pudo leer con certeza deja en duda todo lo que sigue.
  const roto = destinosDelPush('cat <<FIN\nuno\nFIN no\ncd otro\ngit push origin main', CWD)
  assert.ok(roto.every((p) => p.dudaDeCarpeta), 'un heredoc sin cierre')
  assert.ok(roto.some((p) => p.destinos.includes('main')))
})

test('hook real: un push que puede correr en una de dos carpetas se evalua en las dos', () => {
  const vault = vaultDePrueba()
  const enMain = proyecto({ rama: 'main' })
  // Con la sesion en el Vault y un `cd` al proyecto que puede no correr: en el proyecto ese push sube main.
  for (const comando of [`if true; then cd "${enMain}"; fi; git push`, `true && cd "${enMain}"; git push`, `true && cd "${enMain}"; git push origin HEAD`, `ls || cd "${enMain}"; git push`]) {
    const d = decision(enMain, comando, { cwd: vault })
    assert.equal(d?.tipo, 'deny', comando)
    assert.match(d.motivo, /se evaluo en las dos/, comando)
  }
  // El check de secretos tambien corre en la otra carpeta.
  const conSecreto = proyecto({ conReglas: true })
  fs.writeFileSync(path.join(conSecreto, '.env'), 'CLAVE=valor\n')
  git(conSecreto, 'add', '-f', '.env')
  git(conSecreto, 'commit', '-q', '-m', 'chore: config')
  const secretos = decision(conSecreto, `if true; then cd "${conSecreto}"; fi; git push`, { cwd: vault })
  assert.equal(secretos?.tipo, 'deny')
  assert.match(secretos.motivo, /SHS-M39/)
  // Si en las dos esta permitido, no hay nada que preguntar.
  const dir = proyecto()
  fs.mkdirSync(path.join(dir, 'scripts'))
  for (const comando of ['npm ci && cd scripts && npm test; cd ..; git push', 'ls && cd scripts && ls; cd ..; git push origin fix/M1-algo', 'mkdir -p build && cd build && cmake .. && make; cd ..; git push origin fix/M1-algo', 'cd scripts && npm test & wait; git push']) {
    assert.equal(decision(dir, comando), null, comando)
  }
  // `main` escrito en el comando se deniega si una de las dos es el proyecto.
  assert.equal(decision(dir, `[ -d "${vault}" ] && cd "${vault}"; git push origin main`)?.tipo, 'deny')
  assert.equal(decision(dir, `[ -d "${vault}" ] && cd "${vault}" && git push origin main`), null, 'con la carpeta sin dudas, es el Vault')
})

test('hook real: lo que la tercera lectura encontro que seguia pasando, ya no pasa', () => {
  const vault = vaultDePrueba()
  const dir = proyecto()
  for (const comando of [
    // Una continuacion de linea, que es como se escribe un comando largo.
    'git add -A && \\\n  git commit -m "x" && \\\n  git push origin main',
    'echo hola && \\\ngit push origin main',
    // Un heredoc que no era tal, o que no tenia cuerpo.
    'echo $((1<<EOF))\ngit push origin main\nEOF',
    'echo $(cat <<EOF)\ngit push origin main\nEOF',
    // `case`, arreglos y listas que dejaban al push "en" el Vault.
    `(cd "${vault}"; case x in esac); git push origin main`,
    `(cd "${vault}"; echo $(date) case closed); git push origin main`,
    `( arr=(case otro); cd "${vault}" ); git push origin main`,
    `false && cd "${vault}"; (git push origin main)`,
    `eval 'false && cd "${vault}"'; git push origin main`,
    `true || cd "${vault}"; git push origin main`,
    `ls || cd "${vault}" && git push origin main`,
    `! cd "${vault}" && git push origin main`,
    `cd "${vault}" && true &\ngit push origin main`,
    // El estado que solo cambiaba adentro de un bloque.
    `cd /; if false; then cd "${vault}"; cd /; fi; cd -; git push origin main`,
    // Funciones.
    'function f { git push origin main; }; f',
    `f() { cd "${dir}"; }; cd "${vault}"; f; git push origin main`,
    `false && f() { cd "${vault}"; }; f; git push origin main`,
    `f() { cd "${vault}"; }; f() { true; }; git push origin main`,
    // Comillas.
    'echo "$(git push origin main)"',
    'git commit -m "docs: usa `git push origin main`"',
    "git commit -m $'fix: don\\'t crash' && git push origin main",
    'git commit -m "$(cat <<\'EOF\'\nfix: di "hola\n\nEOF\n)" && git push origin main',
    // Asignaciones tras una palabra de control, y muchos `eval`.
    'if true; then GIT_TRACE=1 git push origin main; fi',
    'eval eval eval eval eval git push origin main',
    // Un clon recien hecho: no se sabe que repo es, y `main` esta escrito.
    'git clone https://github.com/soutecdev/otro.git ../otro && cd ../otro && git push origin main',
  ]) {
    assert.equal(decision(dir, comando)?.tipo, 'deny', comando)
  }
  // En la carpeta de un clon o de un worktree recien creados no se puede revisar nada: se pregunta.
  for (const comando of ['git worktree add ../wt -b fix/M2-otra && cd ../wt && git push -u origin fix/M2-otra', 'git clone https://github.com/soutecdev/otro.git ../otro && git -C ../otro push']) {
    const d = decision(dir, comando)
    assert.equal(d?.tipo, 'ask', comando)
    assert.match(d.motivo, /no se sabe que repo habra ahi/, comando)
  }
  // Y lo que es del Vault sigue pasando.
  for (const comando of [
    `cd "${vault}" && \\\n git push origin main`,
    `! cd "${vault}" || git push origin main`,
    `sync() { cd "${vault}" && git push origin main; }; sync`,
    `g() { "$@"; }; g cd "${vault}"; git push origin main`,
    `echo "$(cd "${vault}"; git push origin main)"`,
    `git commit -m "$(cat <<'EOF'\nfix: algo (con "comillas" y un don't)\nEOF\n)" && git push origin fix/M1-algo`,
    'git commit -m "docs: como usar git push origin main (no lo hagas)" && git push origin fix/M1-algo',
    "git commit -m 'docs: usa `git push origin main` solo en el Vault' && git push origin fix/M1-algo",
    'x=(git push origin main); git push origin fix/M1-algo',
    'cd ../no-existe && git push',
  ]) {
    assert.equal(decision(dir, comando), null, comando)
  }
})

test('hook real: lo que queda sin revisar por un tope se pregunta, nunca pasa en silencio', () => {
  const dir = proyecto({ conReglas: true })
  // Mas pushes distintos que los que se evaluan: `main`, el ultimo, se deniega igual.
  const muchos = Array.from({ length: 30 }, (_, i) => `git push origin b${i}`).join('; ')
  assert.equal(decision(dir, `${muchos}; git push origin main`)?.tipo, 'deny')
  assert.equal(decision(dir, muchos)?.tipo, 'ask')
  // El check de secretos corre por cada cabeza distinta, no solo por las primeras.
  fs.writeFileSync(path.join(dir, '.env'), 'CLAVE=valor\n')
  git(dir, 'add', '-f', '.env')
  git(dir, 'commit', '-q', '-m', 'chore: config')
  const d = decision(dir, 'git push origin main:x1; git push origin main~0:x2; git push origin main^0:x3; git push origin refs/heads/main:x4; git push')
  assert.equal(d?.tipo, 'deny')
  assert.match(d.motivo, /SHS-M39/)
})

test('destinosDelPush: el guion que un shell recibe por su entrada se lee; el heredoc de otro programa, no', () => {
  const destinos = (comando) => destinosDelPush(comando, CWD).flatMap((p) => p.destinos)
  for (const comando of [
    "bash <<'EOF'\ngit push origin main\nEOF",
    'sh -s <<EOF\ngit push origin main\nEOF',
    "zsh <<'EOF'\ngit push origin main\nEOF",
    "sudo bash <<'EOF'\ngit push origin main\nEOF",
    "bash <<< 'git push origin main'",
    "cat <<'EOF' | bash\ngit push origin main\nEOF",
    "echo 'git push origin main' | bash",
    "printf 'git push origin main\\n' | sh",
    "source /dev/stdin <<'EOF'\ngit push origin main\nEOF",
    'eval "$(cat <<\'EOF\'\ngit push origin main\nEOF\n)"',
    'bash -c "$(cat <<\'EOF\'\ngit push origin main\nEOF\n)"',
    // Lo que corre mas tarde o al fondo, y los envoltorios de zsh.
    "trap 'git push origin main' EXIT",
    'coproc git push origin main',
    'repeat 2 git push origin main',
    'nocorrect git push origin main',
  ]) {
    assert.ok(destinos(comando).includes('main'), comando)
  }
  // Con un archivo de guion la entrada es de ese guion; lo que corre en otra
  // maquina no es este repo; y el heredoc de `cat` o de `python` es texto.
  for (const comando of [
    "bash deploy.sh <<'EOF'\ngit push origin main\nEOF",
    "ssh servidor bash <<'EOF'\ngit push origin main\nEOF",
    "python3 - <<'PY'\nprint('git push origin main')\nPY",
    "cat <<'EOF' > guia.md\ngit push origin main\nEOF",
    'cat guia.md | bash',
    'trap - EXIT',
    "trap 'rm -f tmp.txt' EXIT",
  ]) {
    assert.deepEqual(destinos(comando), [], comando)
  }
})

test('carpeta del push: el `cd` de un guion por la entrada queda en ese shell; el de `source` y el de un `trap`, no', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  assert.equal(push("bash <<'EOF'\ncd otro\nEOF\ngit push origin x").dir, CWD)
  assert.equal(push("bash <<'EOF'\ncd otro\nEOF\ngit push origin x").dudaDeCarpeta, null)
  assert.equal(push("bash <<'EOF'\ncd otro\ngit push origin x\nEOF").dir, otro)
  assert.equal(push("source /dev/stdin <<'EOF'\ncd otro\nEOF\ngit push origin x").dir, otro)
  // La accion de un `trap` corre mas tarde: si cambia de carpeta, puede ser antes
  // de lo que sigue (con DEBUG, en cualquier momento; en zsh, la de EXIT puesta
  // dentro de una funcion corre al salir de ella).
  for (const comando of ["trap 'cd otro' DEBUG; git push origin x", "trap 'cd otro' EXIT; git push origin x", 'g() { "$@"; }; g trap \'cd otro\' EXIT; git push origin x']) {
    assert.match(push(comando).dudaDeCarpeta, /trap/, comando)
  }
  assert.equal(push("trap 'rm -f x' EXIT; git push origin x").dudaDeCarpeta, null)
  assert.match(push("trap 'git push origin x' EXIT").dudaDeCarpeta, /corre mas tarde/)
  // `repeat` y `nocorrect` son de zsh: en bash ese `cd` no corre.
  assert.match(push('repeat 2 cd otro; git push origin x').dudaDeCarpeta, /solo existe en zsh/)
  const quiza = push('nocorrect cd otro; git push origin x')
  assert.equal(quiza.dir, CWD)
  assert.equal(quiza.carpetaAlternativa, otro)
})

test('hook real: un guion pasado a `bash` por heredoc se revisa como cualquier comando', () => {
  const vault = vaultDePrueba()
  const dir = proyecto()
  // El hook original lo frenaba porque leia todo heredoc como comandos; al dejar
  // de hacerlo (un heredoc es texto), este caso habia quedado sin revisar.
  for (const comando of ["bash <<'EOF'\ngit push origin main\nEOF", "cat <<'EOF' | bash\ngit add -A\ngit push origin main\nEOF", "bash <<< 'git push origin main'", "trap 'git push origin main' EXIT; npm test"]) {
    assert.equal(decision(dir, comando)?.tipo, 'deny', comando)
  }
  for (const comando of [`bash <<'EOF'\ncd "${vault}" && git push origin main\nEOF`, "bash <<'EOF'\nnpm test\ngit push origin fix/M1-algo\nEOF", "cat > guia.md <<'EOF'\nNunca: git push origin main\nEOF"]) {
    assert.equal(decision(dir, comando), null, comando)
  }
})

// --- Lo que encontro la cuarta lectura ---------------------------------------
//
// Una cuarta verificacion independiente se corto dos veces por errores de red,
// pero dejo sus casos escritos. Pasados por el contraste con bash y zsh, 103
// ejecuciones de 113 comandos corrian donde el hook no lo preveia. Lo mas grave:
// un `return` dentro de una funcion, una funcion definida dentro de un `if` y
// llamada despues, y unos 900 `eval` encadenados que agotaban la pila del lector
// (el hook fallaba y dejaba pasar el comando).

test('carpeta del push: un `return`, un `exit`, un `break` o un `continue` dejan salir antes', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const [otro, sub] = [path.resolve(CWD, 'otro'), path.resolve(CWD, 'sub')]
  for (const comando of [
    `f() { cd "${otro}"; return; cd "${sub}"; }; f; git push origin x`,
    `f() { if true; then cd "${otro}"; return; fi; cd "${sub}"; }; f; git push origin x`,
    `source /dev/stdin <<'EOF'\ncd "${otro}"\nreturn\ncd "${sub}"\nEOF\ngit push origin x`,
  ]) {
    const p = push(comando)
    assert.match(p.dudaDeCarpeta, /return/, comando)
    assert.deepEqual(new Set([p.dir, p.carpetaAlternativa]), new Set([otro, sub]), comando)
  }
  // En un bucle, ademas, puede no haber dado ninguna vuelta: tres carpetas posibles.
  assert.notEqual(push(`for i in 1 2; do cd "${otro}"; break; cd "${sub}"; done; git push origin x`).dudaDeCarpeta, null)
  // `cd x || return` sale solo dentro de una funcion; afuera, en bash, sigue.
  assert.match(push('cd no-existe || return; git push origin x').dudaDeCarpeta, /esa carpeta no existe/)
  // Y el `exit` de un subshell o de una tuberia sale solo de ahi.
  for (const comando of ['cd no-existe || (exit 1); git push origin x', 'cd no-existe || exit 1 | cat; git push origin x']) {
    assert.equal(push(comando).dir, CWD, comando)
    assert.match(push(comando).dudaDeCarpeta, /esa carpeta no existe/, comando)
  }
})

test('carpeta del push: una funcion definida con una condicion se lee al llamarla, donde se la llama', () => {
  const dirs = (comando) => destinosDelPush(comando, CWD).map((p) => p.dir)
  const otro = path.resolve(CWD, 'otro')
  // El push esta en el cuerpo: corre donde se llama a la funcion, no donde se la definio.
  for (const comando of ['cd sub; true && g() { git push origin x; }; cd ../otro; g', 'cd sub; if true; then g() { git push origin x; }; fi; cd ../otro; g', 'cd sub; { g() { git push origin x; }; }; cd ../otro; g', 'f() { g() { git push origin x; }; }; cd sub; f; cd ../otro; g']) {
    assert.ok(dirs(comando).includes(otro), comando)
  }
  // Redefinida dentro de un `if` que no corre: la de antes sigue siendo la que corre.
  assert.ok(dirs('f() { git push origin x; }; if false; then f() { :; }; fi; cd otro; f').includes(otro))
  // Una funcion llamada como un envoltorio (`command`) no desarma la lectura de lo que sigue.
  const p = destinosDelPush('w() { case a in a) command() { "$@"; } ;; b) cd otro ;; esac; }; w; git push origin x', CWD).at(-1)
  assert.ok(p.dir === CWD || p.carpetaAlternativa === CWD, 'el push no se da por hecho en otro')
  // `unset -f` la borra en los dos shells; `unfunction`, solo en zsh.
  assert.equal(destinosDelPush('f() { cd otro; }; unset -f f; f; git push origin x', CWD).at(-1).dir, CWD)
  const quiza = destinosDelPush('f() { cd otro; }; unfunction f; f; git push origin x', CWD).at(-1)
  assert.equal(quiza.dir, CWD)
  assert.equal(quiza.carpetaAlternativa, otro)
  // La que se define dentro de un subshell no existe afuera, aunque se llame como un comando que se lee.
  assert.ok(destinosDelPush('( eval eval \'h() { cd otro; }\' ); eval "git push origin main"', CWD).some((p) => p.destinos.includes('main')))
})

test('carpeta del push: `pushd -n`, `popd +N`, `dirs -c`, `cd -N`, `cd` a secas y opciones de un solo shell', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const [otro, sub] = [path.resolve(CWD, 'otro'), path.resolve(CWD, 'otro', 'sub')]
  assert.equal(push('pushd -n otro; git push origin x').dir, CWD)
  assert.match(push('pushd otro; popd +1; git push origin x').dudaDeCarpeta, /saca de la pila/)
  assert.equal(push('pushd otro; pushd sub; dirs -c; popd; git push origin x').dir, sub, '`dirs -c` vacia la pila: el `popd` no vuelve')
  assert.match(push('cd -1; git push origin x').dudaDeCarpeta, /pila de carpetas de zsh/)
  assert.equal(push('cd; git push origin x').dir, os.homedir())
  for (const comando of ['HOME=/tmp cd; git push origin x', 'OLDPWD=/tmp cd -; git push origin x', 'CDPATH=/tmp cd otro; git push origin x']) {
    assert.match(push(comando).dudaDeCarpeta, /variable que el mismo comando cambia/, comando)
  }
  // `cd -q` y `noglob cd` solo corren en zsh; `cd -x` no corre en ninguno.
  for (const comando of ['cd -q otro; git push origin x', 'noglob cd otro; git push origin x']) {
    assert.equal(push(comando).dir, CWD, comando)
    assert.equal(push(comando).carpetaAlternativa, otro, comando)
  }
  assert.equal(push('cd -x otro; git push origin x').dir, CWD)
  assert.equal(push('cd -x otro; git push origin x').dudaDeCarpeta, null)
  // Una redireccion que puede fallar deja el `cd` en duda.
  assert.equal(push('cd otro >/no/existe/x; git push origin x').carpetaAlternativa, otro)
  assert.equal(push('cd otro >/dev/null 2>&1; git push origin x').dir, otro)
})

test('destinosDelPush: el push escondido en un escape, una expansion, un arreglo o `env -S` se ve', () => {
  const pushes = (comando, shell) => destinosDelPush(comando, CWD, shell)
  for (const comando of ["git $'\\x70ush' origin main", "git $'\\160ush' origin main", "env -S 'git push origin main'", 'env --split-string="git push origin main"']) {
    assert.ok(pushes(comando).some((p) => p.destinos.includes('main')), comando)
  }
  // El subcomando sale de una expansion: puede ser `push`.
  for (const comando of ['git {push,} origin main', 's=push; git $s origin main', 'git $"push" origin main']) {
    assert.ok(pushes(comando).some((p) => p.incierto), comando)
  }
  assert.ok(pushes("& git @('push','origin','main')", 'powershell').some((p) => p.destinos.includes('main')))
  // Lo que `eval` lee de lo que imprime otro comando no se ve: se pregunta.
  assert.ok(pushes('eval "$(echo git push origin main)"').some((p) => p.incierto))
  assert.match(pushes('eval "$(echo cd otro)"; git push origin x').at(-1).dudaDeCarpeta, /sale de una variable o de lo que imprime otro comando/)
  assert.match(pushes("source <(echo 'cd otro'); git push origin x").at(-1).dudaDeCarpeta, /sale de una variable o de lo que imprime otro comando/)
  // `GIT_DIR` y `--git-dir` fijan el repo: la carpeta no lo dice.
  for (const comando of ['GIT_DIR=x git push origin x', 'git --git-dir=x push origin x', 'export GIT_WORK_TREE=x; git push origin x']) {
    assert.match(pushes(comando).at(-1).dudaDeCarpeta, /--git-dir/, comando)
  }
})

test('carpeta del push: varias entradas para un shell, sintaxis de zsh y continuaciones de linea entre operadores', () => {
  const pushes = (comando) => destinosDelPush(comando, CWD)
  const otro = path.resolve(CWD, 'otro')
  // bash usa la ultima redireccion de entrada; zsh las concatena: el push puede correr en las dos carpetas.
  for (const comando of ["bash <<A <<B\ncd otro\nA\ngit push origin x\nB\n", "cat <<A <<B | sh\ncd otro\nA\ngit push origin x\nB\n"]) {
    assert.deepEqual(new Set(pushes(comando).flatMap((p) => [p.dir, p.carpetaAlternativa]).filter(Boolean)), new Set([CWD, otro]), comando)
  }
  for (const comando of ['{ cd otro; } always { cd sub; }; git push origin x', 'cd otro; for i (1 2) cd -; git push origin x', 'if true { cd otro }; git push origin x']) {
    assert.notEqual(pushes(comando).at(-1).dudaDeCarpeta, null, comando)
  }
  // `&\<salto>&` es `&&`, y `;&` termina una rama de `case`: ninguno manda nada al fondo.
  assert.equal(pushes('cd otro &\\\n& git push origin x').at(-1).dir, otro)
  assert.equal(pushes('case a in a) cd otro ;& b) true ;; esac; git push origin x').at(-1).carpetaAlternativa, otro)
  // Lo que sigue al cierre de una expresion que es argumento de otro comando no es un comando aparte.
  assert.equal(pushes('echo $(date) cd otro; git push origin x').at(-1).dir, CWD)
  assert.equal(pushes('echo $(date) cd otro; git push origin x').at(-1).dudaDeCarpeta, null)
  assert.ok(pushes('case x in (x) git push origin main ;; esac').some((p) => p.destinos.includes('main')), 'salvo el patron de un `case`')
})

test('carpeta del push: una funcion recibe sus argumentos como los entienden bash y zsh', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  // `"$@"` pasa cada argumento, y el `cd` corre una sola vez.
  assert.equal(push('g() { "$@"; }; g cd otro; git push origin x').dir, otro)
  assert.equal(push('g() { cd "$1"; }; g otro; git push origin x').dir, otro)
  // `"$*"` los junta en una palabra: un comando llamado `cd otro` no existe.
  assert.equal(push('g() { "$*"; }; g cd otro; git push origin x').dir, CWD)
  // Un argumento vacio sigue siendo una palabra: el comando `''` no existe.
  assert.equal(push('g() { "$@"; }; g "" cd otro; git push origin x').dir, CWD)
  // Sin comillas, bash parte el argumento y zsh no: puede ser cualquiera de las dos.
  const partido = push('g() { $1; }; g "cd otro"; git push origin x')
  assert.deepEqual(new Set([partido.dir, partido.carpetaAlternativa]), new Set([CWD, otro]))
  // Una funcion definida adentro usa los suyos, y un `~` ya llega expandido.
  assert.equal(push('f() { g() { "$@"; }; g cd otro; }; f; git push origin x').dir, otro)
  assert.equal(push('f() { g() { "$@"; }; g cd ~; }; f; git push origin x').dir, os.homedir())
  // `function g {` dentro de un grupo guarda su propio cuerpo, no el del grupo.
  assert.equal(push('f() { function g { cd otro; }; g; }; f; git push origin x').dir, otro)
  assert.equal(push('{ function g { cd otro; }; }; g; git push origin x').dir, otro)
})

test('carpeta del push: lo que se define en una tuberia o al fondo no queda definido afuera', () => {
  for (const comando of ['{ h() { cd otro; }; } | cat; h; git push origin x', 'h() { cd otro; } | cat; h; git push origin x', 'if true; then h() { cd otro; }; fi | cat; h; git push origin x']) {
    const p = destinosDelPush(comando, CWD).at(-1)
    assert.equal(p.dir, CWD, comando)
    assert.equal(p.dudaDeCarpeta, null, comando)
  }
  // Al final de una tuberia, zsh la deja definida y bash no.
  const p = destinosDelPush('cat /dev/null | { h() { cd otro; }; }; h; git push origin x', CWD).at(-1)
  assert.deepEqual(new Set([p.dir, p.carpetaAlternativa]), new Set([CWD, path.resolve(CWD, 'otro')]))
})

test('carpeta del push: una asignacion entre comillas no es una asignacion, y las opciones de `cd` van antes', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  for (const comando of ['"X"=1 cd otro; git push origin x', 'X\\=1 cd otro; git push origin x', "! 'X=1' cd otro; git push origin x"]) {
    assert.equal(push(comando).dir, CWD, comando)
    assert.equal(push(comando).carpetaAlternativa, null, comando)
  }
  for (const comando of ['X+=1 cd otro; git push origin x', '\\\nX=1 cd otro; git push origin x', "X='1' cd otro; git push origin x"]) {
    assert.equal(push(comando).dir, otro, comando)
  }
  // `a[0]=1` asigna en bash; en zsh puede fallar, y entonces el `cd` no corre.
  assert.equal(push('a[0]=1 cd otro; git push origin x').carpetaAlternativa, otro)
  // En `cd otro bash -c x`, `-c` no es una opcion de `cd`: son palabras de mas.
  assert.match(push('cd otro bash -c x; git push origin x').dudaDeCarpeta, /mas de un destino/)
})

test('hook real: las funciones que pasan sus argumentos a otro programa, y un git con subcomando variable', () => {
  const dir = proyecto()
  // El cuerpo se lee con los argumentos puestos, y lo que sigue al nombre de la
  // funcion tambien se lee como un comando: el push a main se ve.
  for (const comando of ['w() { op run -- "$@"; }; w git push origin main', 'w() { ssh host "$@"; }; w git push origin main', 'g() { $SHELL -c "$*"; }; g git push origin main', 'w() { npx -y "$@"; }; w git push origin main']) {
    assert.equal(decision(dir, comando)?.tipo, 'deny', comando)
  }
  // Sin un push en el texto, un subcomando de git que sale de una variable no pregunta.
  for (const comando of ['g() { git "$@"; }; g status', 'for c in status log; do git $c; done']) {
    assert.equal(decision(dir, comando), null, comando)
  }
})

test('hook real: lo que la cuarta lectura encontro que seguia pasando, ya no pasa', () => {
  const vault = vaultDePrueba()
  const dir = proyecto()
  for (const comando of [
    `f() { cd "${dir}"; return; cd "${vault}"; }; cd "${vault}"; f; git push origin main`,
    `cd "${vault}"; true && g() { git push origin main; }; cd "${dir}"; g`,
    `echo $(date) cd "${vault}"; git push origin main`,
    `bash <<A <<B\ncd "${vault}"\nA\ngit push origin main\nB\n`,
    `pushd -n "${vault}"; git push origin main`,
    "git $'\\x70ush' origin main",
    `f() { cd "${vault}"; }; unset -f f; f; git push origin main`,
  ]) {
    assert.equal(decision(dir, comando)?.tipo, 'deny', comando)
  }
  // Unos mil `eval` encadenados ya no agotan la pila: se pregunta.
  assert.equal(decision(dir, `${'eval '.repeat(1000)}git push origin main`)?.tipo, 'ask')
  // Y lo que es del Vault sigue pasando.
  for (const comando of [`sync() { cd "${vault}" || return 1; git push origin main; }; sync`, `cd "${vault}" && git push origin main`]) {
    assert.equal(decision(dir, comando), null, comando)
  }
})

// --- Lo que encontro la quinta lectura ---------------------------------------
//
// Una quinta verificacion independiente hallo formas de git que el hook no leia
// como las lee git (`heads/main`, `--al`, `-uo x`, la configuracion cambiada en
// el mismo comando), pushes escondidos detras de otro programa y lecturas de
// carpeta que bash y zsh hacen distinto. Y una que estaba desde el principio:
// cambiar de rama en el mismo comando (`git checkout main && git push`) dejaba
// pasar el push a main, porque la rama actual se lee antes de que el comando corra.

test('argumentosDelPush: las opciones de `git push`, como las entiende git', () => {
  assert.deepEqual(argumentosDelPush(['-uo', 'x', 'origin', 'main']), ['-u', '-o', 'x', 'origin', 'main'])
  assert.deepEqual(argumentosDelPush(['-ou', 'origin', 'main']), ['-o', 'u', 'origin', 'main'])
  assert.deepEqual(argumentosDelPush(['--al', 'origin']), ['--all', 'origin'])
  assert.deepEqual(argumentosDelPush(['--mi', 'origin']), ['--mirror', 'origin'])
  assert.deepEqual(argumentosDelPush(['--del', 'origin', 'main']), ['--delete', 'origin', 'main'])
  // Lo ambiguo o lo que no existe queda como esta: con eso git no corre el push.
  assert.deepEqual(argumentosDelPush(['--forc', 'origin', 'x']), ['--forc', 'origin', 'x'])
  assert.deepEqual(argumentosDelPush(['-xz', 'origin']), ['-xz', 'origin'])
})

test('destinosDelPush: `heads/main` es main, y la configuracion cambiada en el mismo comando no se da por buena', () => {
  const push = (comando) => destinosDelPush(comando, CWD)[0]
  for (const comando of ['git push origin HEAD:heads/main', 'git push origin heads/main', 'git push origin :heads/main', 'git push -uo https://github.com/soutecdev/soubunker-vault.git origin main']) {
    assert.ok(push(comando).destinos.includes('main'), comando)
    assert.equal(push(comando).remoto, 'origin', comando)
  }
  assert.ok(push('git push --al origin').destinos.includes('*'))
  for (const comando of ['git -c remote.origin.push=HEAD:main push origin', 'git config remote.origin.push HEAD:main && git push', 'git -c push.default=matching push origin']) {
    assert.match(push(comando).incierto, /configuracion/, comando)
  }
  // Con el refspec escrito solo queda en duda a que repo va: eso no se pregunta,
  // pero ya no puede eximir a un push a main por ser el Vault.
  const fork = push('git remote add fork https://github.com/x/y.git && git push fork feat/M1-x')
  assert.equal(fork.incierto, null)
  assert.equal(fork.remotoIncierto, true)
  assert.match(push('git config alias.p push && git p origin main').incierto, /alias/)
})

test('destinosDelPush: el push escondido detras de otro programa se ve, y lo que no se puede leer se pregunta', () => {
  const pushes = (comando, shell) => destinosDelPush(comando, CWD, shell)
  for (const comando of ['exec -a x git push origin main', 'env -u HOME git push origin main', 'caffeinate -i git push origin main', 'find . -maxdepth 0 -exec git push origin main \\;', 'eval -- git push origin main', '=git push origin main']) {
    assert.ok(pushes(comando).some((p) => p.destinos.includes('main')), comando)
  }
  for (const comando of ['G=git; $G push origin main', "x='git push origin main'; $x", 'perl -e \'system("git push origin main")\'', "git rebase --root -x 'git push origin HEAD:main'"]) {
    assert.ok(pushes(comando).some((p) => p.incierto), comando)
  }
  // Lo que solo nombra el push no pregunta.
  for (const comando of ['echo git push origin main', 'git commit -m "docs: como hacer git push"', 'grep -rn "git push" docs']) {
    assert.deepEqual(pushes(comando), [], comando)
  }
  // PowerShell: `-EncodedCommand` se decodifica; un alias o una llamada con `&` se preguntan.
  const codificado = Buffer.from('git push origin main', 'utf16le').toString('base64')
  assert.ok(pushes(`pwsh -EncodedCommand ${codificado}`).some((p) => p.destinos.includes('main')))
  for (const comando of ['Set-Alias g git; g push origin main', '& (Get-Command git) push origin main', "$g = 'git'; & $g push origin main"]) {
    assert.ok(pushes(comando, 'powershell').some((p) => p.incierto), comando)
  }
  assert.ok(!pushes('if ($true) { git push origin fix/M1-algo }', 'powershell').some((p) => p.incierto), 'una condicion de PowerShell no es un programa')
})

test('carpeta del push: un `&&` al final de la linea sigue en la siguiente, y otras formas de la quinta lectura', () => {
  const push = (comando) => destinosDelPush(comando, CWD).at(-1)
  const otro = path.resolve(CWD, 'otro')
  // La lista sigue tras el salto: el `cd` corre solo si lo de antes salio bien.
  assert.equal(push('npm test &&\n  cd otro &&\n  git push origin x').dir, otro)
  for (const comando of ['false &&\ncd otro\ngit push origin x', 'false && # comentario\n\ncd otro\ngit push origin x']) {
    assert.deepEqual(new Set([push(comando).dir, push(comando).carpetaAlternativa]), new Set([CWD, otro]), comando)
  }
  // `#` tras cerrar un subshell es un comentario.
  assert.equal(push('(true)#; cd otro\ngit push origin x').dir, CWD)
  // `cd --foo x` falla en los dos shells; `cd x/no-existe/..` tambien.
  assert.equal(push('cd --foo otro; git push origin x').dir, CWD)
  assert.match(push('cd otro/no-existe/..; git push origin x').dudaDeCarpeta, /no existe/)
  // `~-`, `~1` y un `cd -P` con `..` no se resuelven del texto.
  for (const comando of ['cd ~-; git push origin x', 'cd otro; cd ~1; git push origin x', 'cd otro && cd -P ..; git push origin x']) {
    assert.notEqual(push(comando).dudaDeCarpeta, null, comando)
  }
  // Lo que este hook no sigue deja en duda la carpeta de todos los pushes.
  for (const comando of ["trap 'cd otro' DEBUG; git push origin x", 'chpwd() { :; }; cd otro; git push origin x', 'setopt autopushd; cd otro; popd; git push origin x', 'disable cd; cd otro; git push origin x', 'read -r OLDPWD <<< otro; cd -; git push origin x', "ZDOTDIR=x zsh -c 'git push origin x'", 'cd otro; {cd,} ..; git push origin x']) {
    assert.notEqual(push(comando).dudaDeCarpeta, null, comando)
  }
})

test('hook real: cambiar de rama en el mismo comando, y la rama que el comando crea antes del push', () => {
  const dir = proyecto()
  for (const comando of ['git checkout main && git push', 'git switch main && git merge fix/M1-algo && git push', 'git checkout main && git push origin HEAD', 'git branch -M main && git push -u origin main']) {
    assert.equal(decision(dir, comando)?.tipo, 'deny', comando)
  }
  for (const comando of ['git checkout -b feat/M9-x && git push -u origin HEAD', 'git checkout main && git pull && git checkout fix/M1-algo && git merge main && git push', 'git checkout main -- README.md && git push']) {
    assert.equal(decision(dir, comando), null, comando)
  }
  assert.equal(decision(dir, 'git checkout - && git push')?.tipo, 'ask')
  // Una rama o un tag que el comando crea antes del push se revisa igual por
  // secretos (antes pasaba con un aviso de que no se pudo validar).
  const conSecreto = proyecto({ conReglas: true })
  fs.writeFileSync(path.join(conSecreto, '.env'), 'CLAVE=valor\n')
  git(conSecreto, 'add', '-f', '.env')
  git(conSecreto, 'commit', '-q', '-m', 'chore: config')
  for (const comando of ['git switch -c feat/M4-login && git push -u origin feat/M4-login', 'git tag -a v1.2.0 -m x && git push origin v1.2.0']) {
    const d = decision(conSecreto, comando)
    assert.equal(d?.tipo, 'deny', comando)
    assert.match(d.motivo, /SHS-M39/, comando)
  }
})

test('hook real: un comando enorme que habla de un push se pregunta sin leerlo, y la respuesta llega entera', () => {
  const dir = proyecto()
  assert.equal(decision(dir, `${'echo x; '.repeat(9000)}git push origin main`)?.tipo, 'ask')
  assert.equal(decision(dir, `${'echo x; '.repeat(9000)}ls`), null)
  // Un motivo largo (una ruta de miles de caracteres) sale recortado y como JSON valido.
  const largo = decision(dir, `cd ${'a/'.repeat(3000)}..; git push origin main`)
  assert.ok(largo === null || largo.motivo.length < 9000)
})

// --- El hook real, como lo corre Claude Code ------------------------------------

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=test@test', '-c', 'user.name=test', '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// `conReglas`: con scripts/check-pr-rules.mjs, para que corra tambien el check de secretos.
function proyecto({ modo = null, rama = 'fix/M1-algo', conReglas = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude evasion '))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: raiz')
  if (rama !== 'main') git(dir, 'switch', '-q', '-c', rama)
  git(dir, 'remote', 'add', 'origin', 'https://github.com/soutecdev/app-de-ejemplo.git')
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true })
  fs.copyFileSync(HOOK, path.join(dir, '.claude', 'hooks', 'reglas-pr.mjs'))
  if (conReglas) {
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-pr-rules.mjs'))
  }
  if (modo) fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ modo }))
  return dir
}

// Decision del hook: 'deny' | 'ask' | null (sin salida: el comando sigue su curso normal).
function decision(dir, comando, { cwd = dir, toolName = 'Bash', env = {} } = {}) {
  const salida = execFileSync(process.execPath, [path.join(dir, '.claude', 'hooks', 'reglas-pr.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, cwd, tool_input: { command: comando } }),
    encoding: 'utf8',
    env: { ...process.env, VAULT_PATH: '', SOUCLAUDE_CLAUDE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home ')), ...env },
  })
  if (salida === '') return null
  const json = JSON.parse(salida)
  return { tipo: json.hookSpecificOutput.permissionDecision, motivo: json.hookSpecificOutput.permissionDecisionReason }
}

function vaultDePrueba() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  git(vault, 'init', '-q', '-b', 'main')
  git(vault, 'commit', '-q', '--allow-empty', '-m', 'chore: tablero')
  git(vault, 'remote', 'add', 'origin', 'https://github.com/soutecdev/soubunker-vault.git')
  return vault
}
