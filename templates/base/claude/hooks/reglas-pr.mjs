// Hook de Claude Code del harness (managed): reglas de PR en la sesion (SHS-M39)
// y proteccion de `main` por repo (SHS-M42).
//
// Los checks de scripts/check-pr-rules.mjs corren en CI (workflows reglas-*) y,
// antes, aca: dentro de la sesion del agente, en el momento en que importan.
//
//   PreToolUse  · git push              -> (1) deniega el push que toca `main` de
//                                          cualquier repo que no sea el Vault ni
//                                          este en modo solo; (2) grupo secretos
//                                          sobre los commits que el push subiria;
//                                          si falla, deniega el push; (3) pregunta
//                                          al usuario (`ask`) si el destino o la
//                                          carpeta del push no se pueden leer
//                                          del comando (variables, xargs, alias)
//                                          o si el push es forzado (esto ultimo,
//                                          solo en modo equipo).
//   PostToolUse · gh pr create / edit   -> los tres grupos contra el PR, un
//                                          comentario con el resultado en el PR
//                                          (la evidencia para el revisor) y el
//                                          resultado de vuelta al agente: block
//                                          si falla secretos o pr-metadata.
//   Manual      · node .claude/hooks/reglas-pr.mjs --pr <url>
//                                       -> lo mismo que el PostToolUse, para
//                                          despues de un push correctivo (que no
//                                          vuelve a disparar el hook) o si el
//                                          hook no corrio.
//
// Es un hook de Claude Code, no un git hook. Corre en cada comando de shell, sin
// filtro `if` en settings.json (`git -C <ruta> push` no empieza por `git push` y
// se le escapaba), y se filtra solo: sin push ni PR en el comando termina sin
// hacer nada. Falla abierto ante problemas de infraestructura (sin gh, sin red,
// sin el script): no frena por no poder verificar, pero lo avisa. El check de
// secretos no aplica en repos sin scripts/check-pr-rules.mjs (el Vault, por
// ejemplo). En modo solo corre solo el check de secretos antes del push: cubre
// tambien los merges directos a dev/main, que en solo no pasan por ningun PR.
//
// Limite: el hook lee el TEXTO del comando, no lo ejecuta. Ve el push a traves
// de envoltorios (`command git push`), agrupaciones (`(git push)`),
// sustituciones (`$(git push)`, tambien entre comillas dobles), comandos
// anidados (`bash -c`, `eval`, el guion que un shell lee de su entrada),
// funciones definidas en el mismo comando (con los argumentos de cada llamada),
// lanzadores (`start`, `Start-Process`) y otros programas que lo corren
// (`caffeinate git push`, `find -exec git push`), y sigue los `cd` que de
// verdad cambian la carpeta de lo que viene despues (no el de un subshell, una
// tuberia o `nohup cd`) y los cambios de rama del mismo comando (`git checkout
// main && git push`). Si el push puede correr en una de dos carpetas, lo evalua
// en las dos; si no puede saber en cual corre o que sube, o no alcanza a leer
// el comando, pregunta: tambien si el programa sale de una variable (`$GIT
// push`) o recibe un push escrito que puede correr (`python -c`, `git rebase
// -x`). No ve lo que no esta en el texto: el push que hace un script
// (`./deploy.sh`, `make`), un alias o una funcion de la configuracion del
// usuario, un programa que arma el comando (`base64 -d | sh`), una llamada a la
// API (`gh api`), ni todas las formas de PowerShell. Es una red para el error
// honesto; la barrera de `main` es la proteccion de rama en GitHub, que
// `souclaude init` y `upgrade` configuran en modo equipo.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ENTORNO ={ ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }
const MARCA = '<!-- souclaude:reglas-pr -->'
const LIMITE_SALIDA = 60_000
const MAX_AVISOS = 20

// rama-commits es informativo desde SHS-M33: un nombre de rama o un commit con
// otro formato no traba nada. secretos y pr-metadata si bloquean.
const GRUPOS = [
  { grupo: 'rama-commits', bloqueante: false },
  { grupo: 'secretos', bloqueante: true },
  { grupo: 'pr-metadata', bloqueante: true },
]

// --- Lectura del comando ---------------------------------------------------

// Parte un comando de shell por sus operadores de control (&&, ||, |, ;, &,
// saltos de linea), por los parentesis de un subshell o de una sustitucion de
// comando -- `(git push)`, `$(git push)` -- y, en bash, por los backticks, sin
// cortar dentro de comillas: `git commit -m "x; git push"` es un solo segmento.
// Las redirecciones (2>&1, &>) no son operadores, y un comentario (`# ...`) no
// es parte de ningun segmento.
export function segmentos(comando, shell = 'bash') {
  return piezasDe(comando, shell)
    .map((pieza) => pieza.texto.trim())
    .filter(Boolean)
}

const ABRE = new Set(['(', '`('])
const CIERRA = new Set([')', '`)'])
// Hasta cuantas sustituciones, una dentro de otra, se leen dentro de comillas
// dobles o del cuerpo de un heredoc.
const SUSTITUCIONES_ANIDADAS = 24

// El heredoc que abre un `<<` (`j` es la posicion que le sigue): su
// delimitador, si lleva `-` (el cierre puede ir sangrado con tabuladores) y si
// es `literal` -- con el delimitador entre comillas (`<<'EOF'`) el cuerpo no se
// expande --, o null si lo que sigue no es un delimitador que se pueda leer
// igual que bash (`<<EOF$x`, `<<'EO'F`). Un retorno de carro pegado al
// delimitador (un comando con fines de linea de Windows) es parte de el, como
// para bash: la linea que cierra tambien lo trae.
function heredocEn(comando, j) {
  const tabs = comando[j] === '-'
  if (tabs) j++
  while (comando[j] === ' ' || comando[j] === '\t') j++
  const c = comando[j]
  const cr = (k) => (comando[k] === '\r' && comando[k + 1] === '\n' ? '\r' : '')
  const termina = (k) => k >= comando.length || /[\s;&|()<>]/.test(comando[k])
  if (c === "'" || c === '"') {
    const fin = comando.indexOf(c, j + 1)
    const delim = fin === -1 ? '' : comando.slice(j + 1, fin)
    return fin !== -1 && termina(fin + 1) && !/[\n\\$`]/.test(delim) ? { delim: delim + cr(fin + 1), tabs, literal: true } : null
  }
  const desde = c === '\\' ? j + 1 : j
  const delim = comando.slice(desde).match(/^[A-Za-z0-9_!@%+,.:=\/^][A-Za-z0-9_!@%+,.:=\/^-]*/)?.[0]
  return delim && termina(desde + delim.length) ? { delim: delim + cr(desde + delim.length), tabs, literal: c === '\\' } : null
}

// Las lineas del comando, por su texto: para encontrar el cierre de un heredoc
// sin volver a recorrer el comando cada vez (con miles de `<<X` sin cerrar, eso
// costaba el cuadrado del largo). `conTabs` son las que traian tabuladores al
// frente, guardadas sin ellos: valen como cierre de un `<<-`.
function indiceDeLineas(comando) {
  const tal = new Map()
  const conTabs = new Map()
  const sumar = (mapa, texto, donde) => (mapa.get(texto) ?? mapa.set(texto, []).get(texto)).push(donde)
  for (let a = 0; a <= comando.length; ) {
    const salto = comando.indexOf('\n', a)
    const b = salto === -1 ? comando.length : salto
    // Un delimitador es una palabra corta: una linea larga no lo cierra.
    if (b - a <= 256) {
      const texto = comando.slice(a, b)
      const sinTabs = texto.replace(/^\t+/, '')
      sumar(sinTabs === texto ? tal : conTabs, sinTabs, { desde: a, hasta: b })
    }
    a = b + 1
  }
  return { tal, conTabs }
}

// De una lista de lineas en orden, la primera que empieza en `desde` o despues.
function primeraDesde(lineas, desde) {
  if (!lineas) return null
  let [a, b] = [0, lineas.length]
  while (a < b) {
    const medio = (a + b) >> 1
    if (lineas[medio].desde < desde) a = medio + 1
    else b = medio
  }
  return lineas[a] ?? null
}

// El here-string de PowerShell que abre la comilla de `i` (`@'` o `@"` al final
// de una linea): la posicion del `@` que lo cierra, o -1 si no lo es.
function finDeHereString(comando, i) {
  if (comando[i - 1] !== '@') return -1
  const salto = comando.indexOf('\n', i)
  if (salto === -1 || comando.slice(i + 1, salto).trim() !== '') return -1
  const cierre = comando.indexOf(`\n${comando[i]}@`, salto)
  return cierre === -1 ? -1 : cierre + 2
}

// El comando, pieza por pieza y sin descartar las vacias: el texto tal cual
// (`desde` y `hasta` son su posicion en el comando) y `corte`, el operador que
// la termino. Un salto de linea cuenta como `;` (no el que sigue a una barra:
// eso es una continuacion de linea, y la palabra sigue). `(` y `)` abren y
// cierran una expresion, y en bash un par de backticks tambien (`\`(` y `\`)`).
// `shell` es 'bash' (y los que se le parecen), 'powershell' o 'cmd'; en cmd un
// `&` suelto no manda nada al fondo: separa comandos que corren uno tras otro,
// como `;`.
//
// Una sustitucion se ejecuta tambien dentro de comillas dobles, y su contenido
// se lee como comandos: `git commit -m "docs: usa \`git push origin main\`"`
// hace ese push, y en `"$(cat <<'EOF' ... EOF)"` las comillas del mensaje no son
// las del comando. La pieza que sigue al cierre de una de esas empieza dentro de
// las comillas (`enComillas`): es texto, no un comando.
//
// Lo que no es un comando se descarta:
// - Un comentario. Un `#` al comienzo de una palabra llega hasta el fin de la
//   linea (en bash y en PowerShell; en cmd no). Sin eso, el apostrofo de
//   `# don't ...` abria una comilla que se tragaba las lineas siguientes, y el
//   push que hubiera en ellas no se veia.
// - El cuerpo de un heredoc (`<<EOF ... EOF`) y un here-string de PowerShell
//   (`@' ... '@`): son texto. Leidos como comandos, el codigo en linea de un
//   documento (\`git push origin main\`) contaba como un push, y un `1)` suelto
//   cerraba el subshell que lo contenia. Del heredoc sin comillas se leen las
//   sustituciones, que bash ejecuta al expandirlo. Un `<<` no abre un heredoc
//   dentro de una expresion aritmetica ni de un subindice (`$((1 << n))`), y el
//   que queda sin cuerpo dentro de una sustitucion termina con ella.
//
// `cuerpos`: donde quedo el cuerpo de cada heredoc (`en` es la posicion de su
// `<<`). `sinLeerDesde`: desde donde hubo algo que no se pudo leer con certeza (un
// heredoc sin cierre o con un delimitador raro, sustituciones demasiado
// anidadas), o -1. Lo que sigue se leyo igual, como comandos, pero puede no ser
// lo que el shell ejecuta.
function leerPiezas(comando, shell = 'bash') {
  const escape = shell === 'powershell' ? '`' : '\\'
  // La posicion que sigue a `j`, salteando continuaciones de linea.
  const trasContinuaciones = (j) => {
    while (comando[j] === escape && comando[j + 1] === '\n') j += 2
    return j
  }
  const piezas = []
  let lineas = null
  // El cuerpo de cada heredoc (de `a` a `b`) y donde estaba su `<<`: es texto,
  // salvo que quien lo recibe sea un shell (`bash <<EOF`), y entonces es su guion.
  const cuerposLeidos = []
  let sinLeerDesde = -1
  const noSeLeyo = (desde) => {
    if (sinLeerDesde === -1 || desde < sinLeerDesde) sinLeerDesde = desde
  }
  // Leer una sustitucion que al final no cerraba cuesta su largo, y hay que
  // volver atras: el total queda acotado.
  let porReleer = comando.length * 4 + 10_000

  // En un heredoc sin comillas, una linea que continua la anterior (que termina
  // en una barra) no lo cierra.
  const continuada = (desde) => {
    let barras = 0
    for (let k = desde - 2; k >= 0 && comando[k] === '\\'; k--) barras++
    return barras % 2 === 1
  }
  const cierreDelHeredoc = (pos, { delim, tabs, literal }) => {
    for (;;) {
      const tal = primeraDesde(lineas.tal.get(delim), pos)
      const sangrada = tabs ? primeraDesde(lineas.conTabs.get(delim), pos) : null
      const cierra = tal && sangrada ? (tal.desde < sangrada.desde ? tal : sangrada) : (tal ?? sangrada)
      if (!cierra || literal || !continuada(cierra.desde)) return cierra
      pos = cierra.hasta + 1
    }
  }

  // Lee desde `inicio` hasta `limite`, o hasta el caracter que cierra la
  // sustitucion que se esta leyendo (`cierre`: ')' o '`'). Devuelve donde paro.
  const leer = (inicio, cierre, limite, nivel) => {
    let desde = inicio
    let comilla = null // "'", '"' o '$' (las comillas de `$'...'`)
    let enBackticks = false
    let enPalabra = false
    let escapado = -1
    let sigueEnComillas = false
    let heredocs = []
    // Por cada `(` abierto aca: 'a' (de una expresion aritmetica), 's' (de una
    // sustitucion: `$(`, `<(`) o 'g' (un subshell, un grupo).
    const abiertos = []
    let aritmeticas = 0
    let sustituciones = 0
    let subindices = 0
    // El ultimo corte: tras `&&`, `||` o `|` al final de una linea, el comando
    // sigue en la siguiente (tambien tras lineas en blanco o comentarios).
    let ultimoCorte = null
    const sigueDelOperador = (i) => shell !== 'cmd' && ['&&', '||', '|'].includes(ultimoCorte) && !comando.slice(desde, i).trim()
    const cortar = (hasta, corte, largo = 1) => {
      ultimoCorte = corte
      const pieza = { texto: comando.slice(desde, hasta), desde, hasta, corte }
      if (sigueEnComillas) pieza.enComillas = true
      sigueEnComillas = false
      piezas.push(pieza)
      desde = hasta + largo
      subindices = 0
    }
    // Una sustitucion dentro de comillas dobles o del cuerpo de un heredoc, que
    // empieza en `abre` (su `(` o su backtick): se lee aparte, con sus propias
    // comillas. Devuelve donde cierra, o -1 si no cierra antes de `tope` (era
    // texto) o no se la leyo.
    const sustitucion = (abre, tope) => {
      if (nivel >= SUSTITUCIONES_ANIDADAS || porReleer <= 0) {
        noSeLeyo(abre)
        return -1
      }
      const backtick = comando[abre] === '`'
      const [marca, antes, estaba] = [piezas.length, desde, sigueEnComillas]
      cortar(abre, backtick ? '`(' : '(')
      const fin = leer(abre + 1, backtick ? '`' : ')', tope, nivel + 1)
      if (fin >= tope) {
        porReleer -= tope - abre
        piezas.length = marca
        desde = antes
        sigueEnComillas = estaba
        return -1
      }
      desde = fin + 1
      return fin
    }
    // Las sustituciones del texto que va de `a` a `b` (el cuerpo de un heredoc
    // sin comillas, un here-string expandible): lo unico que ahi se ejecuta.
    const sustitucionesDe = (a, b) => {
      for (let j = a; j < b; j++) {
        const d = comando[j]
        if (d === escape) {
          j++
        } else if ((d === '`' && shell === 'bash') || (d === '$' && comando[j + 1] === '(')) {
          desde = d === '`' ? j : j + 1
          const fin = sustitucion(desde, b)
          if (fin !== -1) j = fin
        }
      }
    }

    let i = inicio
    for (; i < limite; i++) {
      const c = comando[i]
      if (comilla) {
        if (comilla === '$') {
          // `$'...'`: la barra escapa cualquier caracter, tambien la comilla.
          if (c === '\\' && i + 1 < limite) i++
          else if (c === "'") comilla = null
        } else if (c === escape && comilla === '"' && i + 1 < limite) {
          i++
        } else if (c === comilla) {
          comilla = null
        } else if (comilla === '"' && c === '`' && shell === 'bash' && (enBackticks || cierre === '`')) {
          // Un backtick cierra la sustitucion en la que esta, haya o no comillas abiertas.
          comilla = null
          if (cierre === '`') break
          cortar(i, '`)')
          enBackticks = false
          heredocs = heredocs.filter((heredoc) => !heredoc.enBackticks)
        } else if (comilla === '"' && shell !== 'cmd' && ((c === '$' && comando[i + 1] === '(') || (c === '`' && shell === 'bash'))) {
          const fin = sustitucion(c === '`' ? i : i + 1, limite)
          if (fin !== -1) {
            i = fin
            sigueEnComillas = true
          }
        }
        continue
      }
      // El backtick que cierra la sustitucion que se esta leyendo.
      if (cierre === '`' && c === '`') break
      const empiezaPalabra = !enPalabra
      enPalabra = true
      if (c === "'" || c === '"') {
        const fin = shell === 'powershell' ? finDeHereString(comando, i) : -1
        if (fin !== -1) {
          // Un here-string entre comillas dobles ejecuta sus `$( )`.
          if (c === '"') {
            const sigue = desde
            sustitucionesDe(i + 1, fin - 2)
            desde = sigue
          }
          i = fin
        } else {
          comilla = c === "'" && shell === 'bash' && comando[i - 1] === '$' && i - 1 >= inicio && escapado !== i - 1 ? '$' : c
        }
      } else if (c === escape && i + 1 < limite) {
        i++
        escapado = i
        // Una continuacion de linea no empieza ni termina una palabra.
        if (comando[i] === '\n' || (shell === 'powershell' && comando[i] === '\r' && comando[i + 1] === '\n')) {
          if (comando[i] === '\r') i++
          enPalabra = !empiezaPalabra
        }
      } else if (c === '&' && ((i > desde && /[<>]/.test(comando[i - 1])) || comando[i + 1] === '>')) {
        // 2>&1, &>: una redireccion, no un operador.
      } else if (shell === 'powershell' && c === '<' && comando[i + 1] === '#') {
        // `<# ... #>`, un comentario de bloque de PowerShell.
        const fin = comando.indexOf('#>', i + 2)
        const hasta = fin === -1 || fin + 2 > limite ? limite : fin + 2
        cortar(i, ';', hasta - i)
        i = desde - 1
        enPalabra = false
      } else if (c === '#' && empiezaPalabra && shell !== 'cmd') {
        let fin = comando.indexOf('\n', i)
        if (fin === -1 || fin > limite) fin = limite
        // Dentro de unos backticks, el que los cierra tambien termina el comentario.
        const backtick = shell === 'bash' && (cierre === '`' || enBackticks) ? comando.indexOf('`', i) : -1
        if (backtick !== -1 && backtick < fin) fin = backtick
        if (sigueDelOperador(i) && backtick === -1) {
          // Un comentario tras `&&` al final de la linea: la lista sigue abajo.
          desde = fin
        } else cortar(i, ';', fin - i)
        i = desde - 1
        enPalabra = false
      } else if (c === '<' && comando[i + 1] === '<' && shell === 'bash') {
        // `<<<` es un here-string: una palabra mas. `<<` abre un heredoc, y su
        // cuerpo empieza en la linea siguiente.
        if (comando[i + 2] === '<') {
          i += 2
        } else {
          if (!aritmeticas && !subindices) {
            const heredoc = heredocEn(comando, i + 2)
            if (heredoc) heredocs.push({ ...heredoc, sustituciones, enBackticks, en: i })
            else noSeLeyo(i)
          }
          i++
        }
      } else if (c === '`' && shell === 'bash') {
        cortar(i, enBackticks ? '`)' : '`(')
        // Lo que sigue al backtick que abre es el comienzo de un comando; lo que
        // sigue al que cierra (`x=\`cmd\`#y`) es parte de la misma palabra.
        enPalabra = enBackticks
        enBackticks = !enBackticks
        if (!enBackticks) heredocs = heredocs.filter((heredoc) => !heredoc.enBackticks)
      } else if (c === '(') {
        const previo = comando[i - 1]
        const tipo = comando[i + 1] === '(' || (previo === '(' && abiertos.at(-1) === 'a') ? 'a' : previo === '$' || previo === '<' || previo === '>' ? 's' : 'g'
        abiertos.push(tipo)
        if (tipo === 'a') aritmeticas++
        else if (tipo === 's') sustituciones++
        cortar(i, c)
        enPalabra = false
      } else if (c === ')') {
        // El parentesis que cierra la sustitucion que se esta leyendo.
        if (cierre === ')' && !abiertos.length) break
        const tipo = abiertos.pop()
        if (tipo === 'a') aritmeticas--
        if (tipo === 's') {
          // El heredoc que quedo sin cuerpo dentro de la sustitucion termina con
          // ella: `echo $(cat <<EOF)` no toma las lineas que siguen.
          sustituciones--
          heredocs = heredocs.filter((heredoc) => heredoc.sustituciones <= sustituciones)
        }
        cortar(i, c)
        // Tras cerrar un subshell, lo que sigue empieza otra palabra: `(true)#; cd
        // x` es un comentario. Tras cerrar una sustitucion, la palabra sigue.
        enPalabra = shell !== 'bash' || tipo !== 'g'
      } else if (c === '[' && i > inicio && /[A-Za-z0-9_$]/.test(comando[i - 1])) {
        subindices++
      } else if (c === ']' && subindices) {
        subindices--
      } else if ((c === '\n' || c === '\r') && !heredocs.length && sigueDelOperador(i)) {
        // `false &&` + salto + `cd x`: el `cd` es parte de la misma lista.
        enPalabra = false
      } else if (c === ';' || c === '\n' || c === '\r') {
        // `;;`, `;&`, `;;&` y `;|` terminan una rama de `case`: no mandan nada al fondo.
        let largo = 1
        if (c === ';' && shell === 'bash') {
          let j = trasContinuaciones(i + 1)
          if (comando[j] === ';') j = trasContinuaciones(j + 1)
          if (comando[j] === '&' || comando[j] === '|') largo = j - i + 1
        }
        cortar(i, ';', largo)
        i += largo - 1
        enPalabra = false
        if (c === '\n' && heredocs.length) {
          lineas ??= indiceDeLineas(comando)
          let pos = i + 1
          const cuerpos = []
          for (const heredoc of heredocs) {
            const cierra = cierreDelHeredoc(pos, heredoc)
            if (!cierra || cierra.hasta > limite) {
              pos = -1
              break
            }
            cuerpos.push({ a: pos, b: cierra.desde, literal: heredoc.literal, en: heredoc.en })
            pos = cierra.hasta + 1
          }
          heredocs = []
          if (pos === -1) {
            // Sin cierre: no se salta nada.
            noSeLeyo(i)
          } else {
            // El cuerpo es texto, salvo lo que bash ejecuta al expandirlo: las
            // sustituciones de un heredoc sin comillas.
            for (const { a, b, literal } of cuerpos) if (!literal) sustitucionesDe(a, b)
            cuerposLeidos.push(...cuerpos)
            desde = pos - 1
            i = pos - 2
          }
        }
      } else if (c === '&' || c === '|') {
        // `&&` y `||` son un solo operador; `|&` es una tuberia (con stderr). Una
        // continuacion de linea en el medio (`&\<salto>&`) no los separa.
        const j = trasContinuaciones(i + 1)
        const doble = comando[j] === c
        const largo = doble || (c === '|' && comando[j] === '&') ? j - i + 1 : 1
        const corte = doble ? c + c : c === '&' && shell === 'cmd' ? ';' : c
        cortar(i, corte, largo)
        i += largo - 1
        enPalabra = false
      } else if (/\s/.test(c)) {
        enPalabra = false
      }
    }
    const fin = Math.min(i, limite)
    cortar(fin, fin < limite ? (cierre === '`' ? '`)' : ')') : '')
    return fin
  }

  leer(0, null, comando.length, 0)
  return { piezas, sinLeerDesde, cuerpos: cuerposLeidos }
}

export function piezasDe(comando, shell = 'bash') {
  return leerPiezas(comando, shell).piezas
}

// Lo que vale un escape de `$'...'` que empieza en `j` (despues de la barra), y
// cuantos caracteres ocupa: `\x70` es `p`, `\160` tambien, `\n` un salto de
// linea. Uno que no se conoce queda tal cual, con su barra, como en bash.
const ESCAPES_SIMPLES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
const ESCAPE_CON_CODIGO = /x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c([\s\S])/y
function escapeAnsiC(s, j) {
  const c = s[j]
  if (Object.hasOwn(ESCAPES_SIMPLES, c)) return { texto: ESCAPES_SIMPLES[c], largo: 1 }
  ESCAPE_CON_CODIGO.lastIndex = j
  const m = ESCAPE_CON_CODIGO.exec(s)
  if (!m) return { texto: `\\${c}`, largo: 1 }
  const [todo, hex, u4, u8, octal, control] = m
  const enHex = hex ?? u4 ?? u8
  const codigo = enHex != null ? parseInt(enHex, 16) : octal != null ? parseInt(octal, 8) & 0xff : control.charCodeAt(0) & 0x1f
  return { texto: codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '', largo: todo.length }
}

// Palabras de un segmento, sin comillas. Descarta las redirecciones (2>&1,
// > archivo) y las asignaciones iniciales (VAR=valor git push). Una expresion
// entre parentesis o entre backticks (`$(cat rama.txt)`) queda entera dentro de
// su palabra: sus espacios no separan. Una barra seguida de un salto de linea
// (en PowerShell, un backtick) es una continuacion de linea: no deja nada, ni
// siquiera en medio de una palabra (`git pu\<salto>sh` es `git push`).
export function palabras(segmento, shell = 'bash') {
  const escape = shell === 'powershell' ? '`' : '\\'
  const crudas = []
  // Cada palabra tal como esta escrita, con sus comillas (sin las continuaciones
  // de linea, que no son parte de ella): dice si es una asignacion.
  const escritas = []
  const escrita = (a, b) => segmento.slice(a, b).replaceAll(`${escape}\r\n`, '').replaceAll(`${escape}\n`, '')
  let inicio = -1
  let actual = ''
  let hay = false
  let comilla = null // "'", '"' o '$' (las comillas de `$'...'`)
  let profundidad = 0
  let enBackticks = false
  let trasEscape = -1 // el largo de `actual` justo despues de un caracter escapado
  for (let i = 0; i < segmento.length; i++) {
    const c = segmento[i]
    if (comilla) {
      // En bash, dentro de comillas dobles la barra solo escapa " \ $ ` y el
      // salto de linea: "C:\Users\x" queda tal cual. En PowerShell, el
      // backtick escapa cualquier caracter. En `$'...'` la barra escapa
      // cualquiera, tambien la comilla.
      const escapado = segmento[i + 1] ?? ''
      if (comilla === '$') {
        if (c === '\\' && escapado !== '') {
          const { texto, largo } = escapeAnsiC(segmento, i + 1)
          actual += texto
          i += largo
        } else if (c === "'") comilla = null
        else actual += c
      } else if (c === comilla) comilla = null
      else if (c === escape && comilla === '"' && (shell === 'powershell' ? escapado !== '' : /["\\$`\n]/.test(escapado))) {
        if (segmento[++i] !== '\n') actual += segmento[i]
      } else actual += c
      continue
    }
    if (inicio === -1 && !(/\s/.test(c) && profundidad === 0 && !enBackticks)) inicio = i
    if (c === "'" || c === '"') {
      // `$'main'` es `main`: el `$` es parte de las comillas.
      if (c === "'" && shell === 'bash' && actual.endsWith('$') && trasEscape !== actual.length) {
        comilla = '$'
        actual = actual.slice(0, -1)
      } else {
        comilla = c
      }
      hay = true
    } else if (c === escape && i + 1 < segmento.length) {
      i++
      if (shell === 'powershell' && segmento[i] === '\r' && segmento[i + 1] === '\n') i++
      if (segmento[i] !== '\n') {
        actual += segmento[i]
        hay = true
        trasEscape = actual.length
      }
    } else if (/\s/.test(c) && profundidad === 0 && !enBackticks) {
      if (hay) {
        crudas.push(actual)
        escritas.push(escrita(inicio, i))
      }
      actual = ''
      hay = false
      inicio = -1
    } else {
      // Una redireccion pegada al final de una palabra (`main>/dev/null`,
      // `main&>log`) no es parte de ella: `git push origin main>/dev/null`
      // sube main. El numero de descriptor (`2>`) si va con la redireccion.
      const redirige = c === '>' || c === '<' || (c === '&' && segmento[i + 1] === '>')
      if (redirige && hay && profundidad === 0 && !enBackticks && !(shell === 'powershell' ? /^(\d+|&|\*)$/ : /^(\d+|&)$/).test(actual) && !/[<>&]$/.test(actual)) {
        crudas.push(actual)
        escritas.push(escrita(inicio, i))
        inicio = i
        actual = ''
      }
      if (c === '(') profundidad++
      else if (c === ')' && profundidad > 0) profundidad--
      else if (c === '`' && shell === 'bash') enBackticks = !enBackticks
      actual += c
      hay = true
    }
  }
  if (hay) {
    crudas.push(actual)
    escritas.push(escrita(inicio))
  }

  const sinRedireccion = []
  const escritasSinRedireccion = []
  for (let i = 0; i < crudas.length; i++) {
    const m = crudas[i].match(/^(\d*|&|\*)?(>>?|<)(&\d+|&-)?(.*)$/)
    if (m) {
      if (!m[3] && m[4] === '') i++ // operador solo: la palabra siguiente es el archivo
      continue
    }
    sinRedireccion.push(crudas[i])
    escritasSinRedireccion.push(escritas[i] ?? crudas[i])
  }
  // Las asignaciones del principio (`X=1 git push`, `X+=1 cd x`) no son el
  // comando. Lo son solo si el nombre y el `=` van sin comillas ni barras:
  // `"X"=1 cd x` y `X\=1 cd x` buscan un comando llamado `X=1`, y ese `cd` no
  // corre. Una asi, en el lugar del comando (tambien tras `then` o `!`), queda
  // tal como esta escrita, para que nada la tome por una asignacion.
  let desde = 0
  while (desde < sinRedireccion.length && ASIGNACION.test(escritasSinRedireccion[desde])) desde++
  for (let i = desde; i < sinRedireccion.length; i++) {
    const escrita = escritasSinRedireccion[i]
    if (shell === 'bash' && PALABRAS_DE_CONTROL.has(escrita)) continue
    if (ASIGNACION.test(escrita) || ASIGNACION_CON_INDICE.test(escrita)) continue
    if (shell === 'bash' && PARECE_ASIGNACION.test(sinRedireccion[i])) sinRedireccion[i] = escrita
    break
  }
  return sinRedireccion.slice(desde)
}

const ES_GIT = /(^|[\\/])git(\.exe)?$/i
const ES_GH = /(^|[\\/])gh(\.exe)?$/i
const ES_CD = /^(cd|chdir|set-location|sl)$/i
const ES_PUSHD = /^(pushd|push-location)$/i
const ES_POPD = /^(popd|pop-location)$/i
const ES_SHELL = /(^|[\\/])(ba|z|da|k|a)?sh(\.exe)?$/i
const ES_POWERSHELL = /(^|[\\/])(powershell|pwsh)(\.exe)?$/i
const ES_CMD = /(^|[\\/])cmd(\.exe)?$/i
const ES_EVAL = /^(eval|iex|invoke-expression)$/i
// Programas que LANZAN otro con una sintaxis que no es la de un shell: `start`
// (cmd y Git Bash) y, en PowerShell, `Start-Process`/`saps`, `Invoke-Command`/
// `icm` y `Start-Job`/`sajb`.
const ES_LANZADOR = /^(start|start-process|saps|invoke-command|icm|start-job|sajb)$/i
const OPCIONES_PUSH_CON_VALOR = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])
// Las opciones largas de `git push`, y sus negaciones: git acepta cualquier
// prefijo que no sea ambiguo (`--al` es `--all`; `--mi`, `--mirror`; `--del`,
// `--delete`). Y las cortas que se agrupan (`-uf`); `-o` lleva un valor, pegado
// (`-ox`) o en la palabra siguiente (`-uo x`).
const OPCIONES_LARGAS_DEL_PUSH = ['verbose', 'quiet', 'repo', 'all', 'branches', 'mirror', 'delete', 'tags', 'dry-run', 'porcelain', 'force', 'force-with-lease', 'force-if-includes', 'recurse-submodules', 'thin', 'receive-pack', 'exec', 'set-upstream', 'progress', 'prune', 'verify', 'follow-tags', 'signed', 'atomic', 'push-option', 'ipv4', 'ipv6'].flatMap((o) => [`--${o}`, `--no-${o}`])
const CORTAS_DEL_PUSH = new Set(['v', 'q', 'n', 'f', 'd', 'u', '4', '6'])

// Los argumentos de un `git push` como los entiende git: cada opcion larga
// abreviada con su nombre entero, y cada grupo de cortas por separado. Lo que
// git no entenderia (un prefijo ambiguo, una corta que no existe) queda como
// esta: con eso el push no corre.
export function argumentosDelPush(args) {
  const salida = []
  for (let j = 0; j < args.length; j++) {
    const a = args[j]
    if (a === '--') {
      salida.push(...args.slice(j))
      break
    }
    const larga = a.match(/^(--[^=]+)(=[\s\S]*)?$/)
    if (larga) {
      const [, nombre, valor = ''] = larga
      const posibles = OPCIONES_LARGAS_DEL_PUSH.includes(nombre) ? [nombre] : OPCIONES_LARGAS_DEL_PUSH.filter((o) => o.startsWith(nombre))
      salida.push(posibles.length === 1 ? posibles[0] + valor : a)
      continue
    }
    if (/^-[^-]/.test(a)) {
      const partes = []
      let entiende = true
      let valor = null
      for (let k = 1; k < a.length; k++) {
        if (a[k] === 'o') {
          valor = k + 1 < a.length ? a.slice(k + 1) : null
          partes.push('-o')
          break
        }
        if (!CORTAS_DEL_PUSH.has(a[k])) {
          entiende = false
          break
        }
        partes.push(`-${a[k]}`)
      }
      if (!entiende) {
        salida.push(a)
        continue
      }
      salida.push(...partes)
      if (partes.at(-1) === '-o') salida.push(valor ?? args[++j] ?? '')
      continue
    }
    salida.push(a)
  }
  return salida
}
// El refspec "matching": `:` a secas (o `+:`) sube todas las ramas que existen
// con el mismo nombre en los dos lados -- main incluida --, igual que --all.
const REFSPEC_MATCHING = /^\+?:$/

// Lo que puede ir DELANTE de un comando sin cambiar cual es. Los envoltorios son
// los que el propio Claude Code quita antes de comparar con las reglas de
// permisos (timeout, time, nice, nohup, stdbuf, command, builtin, noglob, xargs)
// mas env, exec y sudo/doas: como `command git push origin main` casa con la
// regla allow `Bash(git push:*)`, ese push pasaba sin pregunta Y sin que este
// hook lo viera. Las palabras de control son las de un if/while/grupo de shell.
// `coproc` lo corre al fondo; `nocorrect` y `repeat N` son de zsh (en bash no
// existen: ahi ese comando no corre).
const ENVOLTORIOS = new Set(['command', 'builtin', 'exec', 'time', 'nice', 'nohup', 'stdbuf', 'timeout', 'noglob', 'env', 'sudo', 'doas', 'xargs', 'coproc', 'nocorrect', 'repeat'])
// De esos, los que son del propio shell: lo que envuelven corre en el mismo
// proceso. Un `cd` detras de cualquier otro (`nohup cd x`, `env cd x`) corre en
// un proceso aparte y no mueve la carpeta de lo que sigue.
const ENVOLTORIOS_DEL_SHELL = new Set(['command', 'builtin', 'time', 'noglob', 'nocorrect', 'repeat'])
const PALABRAS_DE_CONTROL = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}'])
const PROFUNDIDAD_MAXIMA = 4
// `eval eval eval ...`: cada uno vuelve a leer el texto del anterior. Mas alla
// de este numero no se sigue, y se pregunta: leerlos todos agotaba la pila.
const EVALS_ENCADENADOS = 64

// El comando que un segmento ejecuta de verdad, sin lo que lo envuelve.
// `viaXargs`: sus argumentos llegan por stdin y no se pueden leer del texto.
// `envoltorios`: los que se le quitaron, en orden. `dudoso`: se le quito una
// asignacion o una palabra de control que seguia a un envoltorio que no las
// admite (`builtin X=1 cd x` busca un builtin llamado `X=1`): puede que ese
// comando no llegue a correr. `repite`: lo envuelve un `repeat`, y corre mas
// de una vez.
const ASIGNACION = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
// `a[0]=1 cd x`: en bash asigna; en zsh puede fallar (sus arreglos empiezan en
// 1), y entonces el comando no corre. Y lo que, quitadas las comillas, parece
// una asignacion (`"X"=1` no lo es).
const ASIGNACION_CON_INDICE = /^[A-Za-z_][A-Za-z0-9_]*\[[^\]]*\]\+?=/
const PARECE_ASIGNACION = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/
const ADMITEN_ASIGNACIONES = new Set(['env', 'sudo', 'doas', 'time'])

export function comandoEfectivo(palabrasDelSegmento) {
  let p = [...palabrasDelSegmento]
  let viaXargs = false
  let dudoso = false
  let negado = false
  let repite = false
  const envoltorios = []
  // `git push` entre backticks, o {git push} pegado a las llaves (PowerShell).
  // (No `{cd,} x`: eso es una expansion de llaves de bash, y el comando es `cd`.)
  const abre = /^\{[^{}]*,[^{}]*\}/.test(p[0] ?? '') ? null : p[0]?.match(/^[`{]+/)?.[0]
  if (abre) {
    // (Se quitan solo las palabras que quedaron vacias al sacarles eso: un
    // argumento vacio, `''`, sigue siendo una palabra.)
    const vacias = new Set()
    p[0] = p[0].slice(abre.length)
    if (p[0] === '') vacias.add(0)
    const ultima = p.length - 1
    const sinCierre = p[ultima].replace(/[`};]+$/, '')
    if (sinCierre !== p[ultima]) {
      p[ultima] = sinCierre
      if (sinCierre === '') vacias.add(ultima)
    }
    p = p.filter((_, i) => !vacias.has(i))
  }
  while (p.length) {
    // `then GIT_TRACE=1 git push`, `{ X=1 git push; }`: las asignaciones que
    // siguen a una palabra de control son las del comando. Tras un envoltorio
    // que no es `time`, una palabra de control es el nombre de un programa
    // (`builtin ! cd x` busca un builtin llamado `!`).
    if (PALABRAS_DE_CONTROL.has(p[0]) || ASIGNACION.test(p[0]) || ASIGNACION_CON_INDICE.test(p[0])) {
      if (envoltorios.some((envoltorio) => envoltorio !== 'time') || ASIGNACION_CON_INDICE.test(p[0])) dudoso = true
      if (p[0] === '!') negado = true
      p.shift()
      continue
    }
    const nombre = p[0].replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
    if (!ENVOLTORIOS.has(nombre)) break
    // `! time cd x`: tras un `!`, que `time` sea la palabra del shell o el
    // programa (que corre el `cd` en otro proceso) depende del shell. Y lo que
    // envuelven `nocorrect`, `noglob` y `repeat` corre solo en zsh.
    if ((nombre === 'time' && negado) || nombre === 'nocorrect' || nombre === 'repeat' || nombre === 'noglob') dudoso = true
    if (nombre === 'repeat') repite = true
    if (nombre === 'xargs') viaXargs = true
    // Escrito con su ruta (`/usr/bin/time`) es un programa aparte, no el del shell.
    envoltorios.push(/[\\/]/.test(p[0]) ? p[0] : nombre)
    p.shift()
    // `repeat 3 cmd`: la cuenta no es parte del comando.
    if (nombre === 'repeat') p.shift()
    // `command -v git` solo dice donde esta git: no ejecuta nada.
    if (nombre === 'command' && /^-[vV]$/.test(p[0] ?? '')) return { p: [], viaXargs, envoltorios }
    // Opciones del envoltorio, asignaciones de env y duraciones de timeout/nice.
    while (p.length && (p[0].startsWith('-') || ASIGNACION.test(p[0]) || /^\d+(\.\d+)?[smhd]?$/.test(p[0]))) {
      // `env -S 'git push origin main'` parte esa cadena en palabras: ese es el comando.
      const partida = nombre === 'env' ? p[0].match(/^(?:-S|--split-string)(=?)([\s\S]*)$/) : null
      if (partida) {
        const separada = partida[1] === '' && partida[2] === ''
        p = [...palabras(separada ? (p[1] ?? '') : partida[2]), ...p.slice(separada ? 2 : 1)]
        continue
      }
      if (ASIGNACION.test(p[0]) && !ADMITEN_ASIGNACIONES.has(nombre)) dudoso = true
      p.shift()
    }
  }
  return dudoso ? { p, viaXargs, envoltorios, dudoso, ...(repite && { repite }) } : { p, viaXargs, envoltorios }
}

// Un comando escrito dentro de otro: `bash -c "..."`, `eval "..."`,
// `powershell -Command "..."`, `cmd /c ...`. Devuelve el texto a analizar.
// `$(cat <<EOF ... EOF)` entrega el cuerpo de ese heredoc: en `eval "$(cat
// <<'EOF' ...)"` o `bash -c "$(cat <<EOF ...)"`, lo que se ejecuta es ese texto.
const SOLO_UN_CAT = /^\$\(\s*cat\s*<<-?\s*[\\'"]?([A-Za-z0-9_!@%+,.:=/^-]+)['"]?[ \t]*\r?\n([\s\S]*?)\r?\n\t*\1[ \t]*\r?\n?\s*\)$/
const loQueEntrega = (texto) => texto.match(SOLO_UN_CAT)?.[2] ?? texto

export function comandoAnidado(p, shell = 'bash') {
  const primero = p[0] ?? ''
  if (ES_EVAL.test(primero)) {
    // (`eval -- git push`: el `--` no es parte del comando.)
    const resto = p[1] === '--' ? p.slice(2) : p.slice(1)
    return resto.length ? { comando: loQueEntrega(resto.join(' ')), shell } : null
  }
  if (ES_SHELL.test(primero)) {
    const i = p.findIndex((w, k) => k > 0 && /^-[a-zA-Z]*c$/.test(w))
    return i !== -1 && p[i + 1] != null ? { comando: loQueEntrega(p[i + 1]), shell: 'bash' } : null
  }
  if (ES_POWERSHELL.test(primero)) {
    // `-EncodedCommand` (o `-e`, `-ec`, `-enc`...): el comando en base64, en UTF-16LE.
    const codificado = p.findIndex((w, k) => k > 0 && /^-(e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)$/i.test(w))
    if (codificado !== -1 && p[codificado + 1] != null) {
      const texto = Buffer.from(p[codificado + 1], 'base64').toString('utf16le')
      return texto.trim() ? { comando: texto, shell: 'powershell' } : null
    }
    const i = p.findIndex((w, k) => k > 0 && /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(w))
    return i !== -1 && p[i + 1] != null ? { comando: p.slice(i + 1).join(' '), shell: 'powershell' } : null
  }
  if (ES_CMD.test(primero)) {
    // `//c`: asi hay que escribirlo desde Git Bash, que si no convierte `/c` en una ruta.
    const i = p.findIndex((w, k) => k > 0 && /^\/\/?[ck]$/i.test(w))
    return i !== -1 && p[i + 1] != null ? { comando: p.slice(i + 1).join(' '), shell: 'cmd' } : null
  }
  return null
}

// Los argumentos del `git push` que lanza un `start` / `Start-Process` /
// `Invoke-Command`, o null si no lanza ninguno. Las listas de PowerShell
// (`"push","origin","main"`, `'push origin main'`) y los bloques (`{ git push }`)
// se abren en palabras sueltas. Es una lectura aproximada: quien la usa marca
// el push como incierto.
export function pushLanzado(resto) {
  const piezas = resto
    // La ruta de git puede traer espacios (`C:\Program Files\Git\cmd\git.exe`): no se parte.
    .flatMap((w) => (ES_GIT.test(w) ? [w] : w.split(/[\s,;]+/)))
    .map((w) => w.replace(/^['"({@]+|['")}]+$/g, ''))
    .filter(Boolean)
  if (!piezas.some((w) => ES_GIT.test(w))) return null
  const i = piezas.indexOf('push')
  return i === -1 ? null : piezas.slice(i + 1).filter((w) => !ES_GIT.test(w))
}

// En Git Bash sobre Windows el agente escribe rutas MSYS (`/c/Users/...`), que
// path.resolve leeria como relativas a la raiz de la unidad actual
// (`C:\c\Users\...`): la carpeta no existiria y el push quedaria sin revisar.
// Se traducen a su forma nativa (`C:/Users/...`) antes de resolverlas.
export function rutaNativa(ruta, plataforma = process.platform) {
  const m = plataforma === 'win32' ? ruta.match(/^\/([a-zA-Z])(\/.*)?$/) : null
  return m ? `${m[1].toUpperCase()}:${m[2] ?? '/'}` : ruta
}

// Lo que el shell resuelve recien al ejecutar dentro de una ruta: variables y
// sustituciones. Los comodines quedan fuera a proposito (`[` y `*` aparecen en
// nombres de carpeta reales); `~`, `$HOME`, `$PWD` y `$(pwd)` si se pueden
// resolver aca.
const DINAMICO_EN_RUTA = /[$`]|%[A-Za-z_][A-Za-z0-9_]*%/
const HOGAR = /^(\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=$|[\\/])/i
const AQUI = /^(\$PWD|\$\{PWD\}|\$\(\s*pwd\s*\)|`\s*pwd\s*`|%CD%)(?=$|[\\/])/i

function esCarpeta(ruta) {
  try {
    return fs.statSync(ruta).isDirectory()
  } catch {
    return false
  }
}

// Una carpeta que todavia no existe (`mkdir build; cd build`) es del repo en el
// que se la va a crear: su ancestro mas cercano que exista.
function laQueExiste(ruta) {
  while (!esCarpeta(ruta) && path.dirname(ruta) !== ruta) ruta = path.dirname(ruta)
  return ruta
}

// La carpeta es una de las que el mismo comando crea con `mkdir` (o queda
// camino a una: `mkdir -p a/b` crea tambien `a`).
const seCrea = (creadas, ruta) => creadas != null && [...creadas].some((creada) => creada === ruta || creada.startsWith(ruta + path.sep))
const MAX_CARPETAS_CREADAS = 256

// `$PWD` y `$(pwd)` son la carpeta en la que se este, sea cual sea: quedan como
// `.`, relativos a ella (con una duda de por medio, `cd "$(pwd)"` no la despeja).
function rutaExpandida(destino) {
  if (destino === '~' || /^~[\\/]/.test(destino)) return path.join(os.homedir(), destino.slice(1))
  // `~-`, `~+`, `~1`, `~usuario`: la carpeta anterior, la actual, una de la pila
  // o la de otro usuario. Se resuelven recien al ejecutar.
  if (/^~[^\\/]/.test(destino)) return `\${${destino}}`
  return rutaNativa(destino.replace(HOGAR, () => os.homedir()).replace(AQUI, () => '.'))
}

const dudaDeCarpeta = (motivo) => `no se sabe en que carpeta corre (${motivo})`

// `$CLAUDE_PROJECT_DIR` es la raiz del proyecto de la sesion. Claude Code se la
// pasa a sus hooks, pero no al shell de sus comandos: ahi `cd
// "$CLAUDE_PROJECT_DIR"` es `cd ""`, que no mueve nada. No se sabe cual de las
// dos vale, pero las dos carpetas se conocen: esta es la otra.
const PROYECTO = /^(\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR(:-\.?)?\}|\$env:CLAUDE_PROJECT_DIR|%CLAUDE_PROJECT_DIR%)(?=$|[\\/])/i
function enElProyecto(destino) {
  const variable = destino.match(PROYECTO)?.[0]
  return variable ? path.join(process.env.CLAUDE_PROJECT_DIR || RAIZ_DEL_HOOK, destino.slice(variable.length)) : null
}

// Topes para lo que ningun comando real alcanza. Sin ellos, un comando con miles
// de `cd a` o de `pushd a` alarga la ruta (o la pila) en cada paso, leerlo cuesta
// el cuadrado de su largo y el hook se queda sin su plazo: un hook que no llega
// a responder no frena nada.
const RUTA_MAXIMA = 4096
const PILA_MAXIMA = 256

// El estado de carpeta mientras se lee un comando: donde se esta (`carpeta`);
// el motivo, si eso no se sabe con certeza (`duda`), y entonces la otra carpeta
// en la que puede estar, si se conoce (`alternativa`); el lugar anterior, para
// `cd -`; y los que apilo `pushd`. Un lugar es { carpeta, duda, alternativa }.
// `cambios` cuenta las veces que cambio. Con `duda` y `alternativa`, la carpeta
// es una de las dos; con `duda` y sin `alternativa`, puede ser cualquiera.
// `imposible`: se llego hasta aca solo si no fallo un `cd` que falla seguro.
const lugarDe = (e) => ({ carpeta: e.carpeta, duda: e.duda, alternativa: e.alternativa })
const copiaDe = (e) => ({ ...e, pila: [...e.pila] })
// El mismo lugar (o ninguno, los dos): la misma carpeta, con la misma duda.
const mismoLugar = (a, b) => a === b || (a != null && b != null && a.carpeta === b.carpeta && a.duda === b.duda && (a.alternativa ?? null) === (b.alternativa ?? null))
const mismaPila = (a, b) => a.length === b.length && a.every((lugar, i) => mismoLugar(lugar, b[i]))
// El mismo estado entero: tambien adonde llevan `cd -` y `popd`.
const mismoEstado = (a, b) => mismoLugar(a, b) && mismoLugar(a.anterior, b.anterior) && mismaPila(a.pila, b.pila)
// Deja `e` como `otro` sin cambiar de objeto: un `eval` lo comparte con quien lo llama.
const volverA = (e, otro) => Object.assign(e, otro, { pila: [...otro.pila] })

// Un `cd` (o un `eval`) cambia la carpeta de lo que viene despues solo si corre
// en el mismo proceso: no detras de un envoltorio que no es del shell (`nohup cd
// x`), ni dentro de una tuberia (`cd x | tee log`), ni mandado al fondo (`cd x
// &`). 'depende': hay dos casos en los que bash y zsh hacen cosas distintas, y
// el hook no sabe cual de los dos corre el comando. El ultimo comando de una
// tuberia corre en el shell actual en zsh y en un subshell en bash; y `command
// cd x` corre el `cd` del shell en bash y el programa `cd` en zsh, que no
// mueve nada.
function correAca({ antes, despues, envoltorios, shell }) {
  if (!envoltorios.every((x) => ENVOLTORIOS_DEL_SHELL.has(x))) return 'no'
  if (despues === '&') return 'no'
  if (shell !== 'powershell' && despues === '|') return 'no'
  if (shell === 'cmd' && antes === '|') return 'no'
  return shell === 'bash' && (antes === '|' || envoltorios.includes('command')) ? 'depende' : 'si'
}

// Una redireccion a un archivo (no a /dev/null ni a otro descriptor): si falla
// -- el archivo no existe, la carpeta no existe --, el comando no corre.
function redireccionDudosa(texto) {
  for (const m of texto.matchAll(/(?:^|[^<>&])(?:\d*|&)(>>|>\||>|<)(?![<>&(])\s*([^\s;&|()<>]+)/g)) {
    if (m[2] !== '/dev/null' && !m[2].startsWith('&')) return true
  }
  return false
}

// Aplica un `cd`, `pushd` o `popd` al estado de carpeta `e`, y devuelve true si
// lo cambio. Cuando no se puede saber adonde lleva (`cd "$DESTINO"`), deja la
// carpeta como estaba y anota el motivo en `e.duda`: prePushMain pregunta en
// vez de adivinar. `cd -` y `popd` vuelven a lo que se sabia.
function cambiarDeCarpeta(e, p, contexto) {
  const nombre = p[0]
  // Una asignacion delante cambia lo que usa: `HOME=x cd`, `OLDPWD=x cd -`,
  // `CDPATH=x cd y`. No se sigue.
  if (contexto.shell === 'bash' && /(^|[\s;&|(])(HOME|OLDPWD|CDPATH|PWD|DIRSTACK)\+?=/.test(contexto.texto ?? '')) {
    if (correAca(contexto) === 'no') return false
    e.duda = dudaDeCarpeta(`\`${p.join(' ')}\` usa una variable que el mismo comando cambia`)
    e.alternativa = null
    e.cambios++
    return true
  }
  // Si falla su redireccion (`cd x >/no/existe`), ese `cd` no corre.
  if (contexto.shell === 'bash' && !contexto.quiza && redireccionDudosa(contexto.texto ?? '')) {
    contexto = { ...contexto, quiza: true, motivoQuiza: `\`${p.join(' ')}\` no corre si falla su redireccion` }
  }
  // Las opciones que entiende uno solo de los dos shells (`cd -q` y `pushd -q`,
  // de zsh; `cd -e`, de bash): ese `cd` puede correr o no. Las que no entiende
  // ninguno lo hacen fallar.
  if (contexto.shell === 'bash') {
    // (Van antes de la carpeta: en `cd x bash -c y`, `-c` no es una opcion.)
    const cuantas = p.slice(1).findIndex((x) => !/^-[A-Za-z@]+$/.test(x))
    const delante = cuantas === -1 ? p.slice(1) : p.slice(1, 1 + cuantas)
    const opciones = delante.filter((x) => x !== '-n')
    const validas = ES_CD.test(nombre) ? { ambos: /^-[LP]+$/, bash: /^-[LPe@]+$/, zsh: /^-[LPqs]+$/ } : ES_PUSHD.test(nombre) ? { ambos: /^$/, bash: /^$/, zsh: /^-[LPqs]+$/ } : null
    if (validas && opciones.length) {
      const en = { bash: opciones.every((x) => validas.bash.test(x)), zsh: opciones.every((x) => validas.zsh.test(x)) }
      if (!en.bash && !en.zsh) return false
      if (!opciones.every((x) => validas.ambos.test(x))) {
        const sinOpciones = [nombre, ...p.slice(1).filter((x, i) => i >= delante.length || x === '-n')]
        return cambiarDeCarpeta(e, sinOpciones, { ...contexto, quiza: true, motivoQuiza: `\`${p.join(' ')}\` usa una opcion que solo entiende ${en.bash ? 'bash' : 'zsh'}` })
      }
    }
  }
  if (contexto.shell === 'bash') {
    // `cd --foo x`: bash no conoce esa opcion, y zsh la toma por otra carpeta:
    // en los dos el `cd` falla.
    const primera = p.slice(1).findIndex((x) => !x.startsWith('-') || x === '-')
    if ((primera === -1 ? p.slice(1) : p.slice(1, 1 + primera)).some((x) => /^--./.test(x))) return false
  }
  // `Set-Location x -WhatIf`, o con un parametro que no tiene: no se mueve.
  if (contexto.shell === 'powershell' && ES_CD.test(nombre)) {
    const raro = p.slice(1).find((x) => /^-[A-Za-z]/.test(x) && !/^-(p|pa|pat|path|l|li|lit|lite|liter|litera|literal|literalp|literalpa|literalpat|literalpath|passthru|stackname|verbose|debug|erroraction|ea|warningaction|wa|informationaction|infa|errorvariable|ev|warningvariable|wv|informationvariable|iv|outvariable|ov|outbuffer|ob|pipelinevariable|pv)$/i.test(x))
    if (raro) {
      if (correAca(contexto) === 'no') return false
      e.duda = dudaDeCarpeta(`\`${p.join(' ')}\` lleva un parametro (\`${raro}\`) con el que puede no moverse`)
      e.alternativa = null
      e.cambios++
      return true
    }
  }
  const corre = correAca(contexto)
  if (corre === 'no') return false
  // Con una duda anterior, una duda mas deja mas de dos carpetas posibles.
  const yaDudaba = e.duda != null
  const dudar = (motivo) => {
    e.duda = dudaDeCarpeta(motivo)
    e.alternativa = null
    e.cambios++
    return true
  }
  // Tras un `cd` que pudo correr o no, `cd -` vuelve a donde se estaba (si
  // corrio) o a la carpeta anterior de antes (si no). Sin una anterior, o si es
  // la misma, es donde se estaba; si no, una de las dos.
  const [aca, anteriorDeAntes, pilaDeAntes] = [lugarDe(e), e.anterior, e.pila.length]
  const anteriorIncierta = () =>
    anteriorDeAntes == null || mismoLugar(anteriorDeAntes, aca) ? aca : { carpeta: aca.carpeta, duda: e.duda, alternativa: aca.duda || anteriorDeAntes.duda || aca.carpeta === anteriorDeAntes.carpeta ? null : anteriorDeAntes.carpeta }
  // Y si lo que pudo no correr es un `pushd` sobre una pila con algo, tampoco se sabe que saca `popd`.
  const pilaIncierta = () => {
    if (pilaDeAntes) e.pila = e.pila.map(() => ({ carpeta: aca.carpeta, duda: e.duda, alternativa: null }))
  }
  if (corre === 'depende' || contexto.quiza) {
    // Puede correr aca o no: por el shell, o porque llega solo si fallo lo
    // anterior (`a || cd x`). Las dos carpetas posibles se conocen: donde se
    // esta, y adonde lleva si corre.
    const siCorre = copiaDe(e)
    cambiarDeCarpeta(siCorre, p, { ...contexto, antes: ';', envoltorios: [], quiza: false, motivoQuiza: null, texto: '' })
    if (mismoEstado(siCorre, e)) return false
    const mismaPilaSiCorre = mismaPila(siCorre.pila, e.pila)
    dudar(
      corre === 'depende'
        ? `que \`${contexto.envoltorios.includes('command') ? 'command ' : ''}${nombre}\` cambie o no la carpeta depende del shell${contexto.antes === '|' ? ': cierra una tuberia' : ''}`
        : (contexto.motivoQuiza ?? `\`${p.join(' ')}\` corre solo si falla el comando anterior`),
    )
    // Tampoco se sabe del todo adonde llevan ahora `cd -` y `popd`.
    e.anterior = anteriorIncierta()
    if (!mismaPilaSiCorre) e.pila = Array.from({ length: Math.max(e.pila.length, siCorre.pila.length) }, () => (pilaDeAntes ? lugarDe(e) : aca))
    e.alternativa = yaDudaba || siCorre.duda ? null : siCorre.carpeta
    return true
  }
  const ir = (lugar) => {
    e.anterior = lugarDe(e)
    Object.assign(e, { alternativa: null }, lugar)
    e.cambios++
    return true
  }
  // Cada comando corre en un shell nuevo: sin un pushd previo en el mismo
  // comando, la pila esta vacia y `popd` falla sin mover nada. Con argumentos
  // (`popd +1`, `popd -n`) saca otra entrada, o ninguna carpeta cambia: no se sigue.
  if (ES_POPD.test(nombre)) {
    if (contexto.shell === 'bash' && p.length > 1) return dudar(`\`${p.join(' ')}\` saca de la pila otra entrada que la de arriba`)
    return e.pila.length ? ir(e.pila.pop()) : false
  }
  const args = p.slice(1).filter((x) => !(contexto.shell === 'cmd' && /^\/d$/i.test(x)))
  const apila = ES_PUSHD.test(nombre)
  if (apila && args.some((x) => /^[+-]\d+$/.test(x))) return dudar(`\`${p.join(' ')}\` rota una pila de carpetas que este comando no deja ver`)
  // `cd -1`, `cd +2`: en zsh, una carpeta de la pila; en bash, un error.
  if (!apila && contexto.shell === 'bash' && args.some((x) => /^[+-]\d+$/.test(x))) return dudar(`\`${p.join(' ')}\` usa la pila de carpetas de zsh`)
  // `pushd -n x` (bash) apila sin moverse; zsh no lo entiende. La carpeta no
  // cambia, y la pila queda en duda.
  if (apila && contexto.shell === 'bash' && args.includes('-n')) {
    const incierto = { carpeta: e.carpeta, duda: dudaDeCarpeta(`\`${p.join(' ')}\` cambia la pila de carpetas sin moverse`), alternativa: null }
    e.pila = [...e.pila.map(() => incierto), incierto]
    return true
  }
  // `cd a b`: bash da error (o ignora `b`, segun la version) y zsh reemplaza `a`
  // por `b` en la ruta actual.
  if (args.filter((x) => x === '-' || !x.startsWith('-')).length > 1) return dudar(`\`${p.join(' ')}\` tiene mas de un destino, y que hace con eso depende del shell`)
  const destino = args.find((x) => !x.startsWith('-'))
  // `pushd -` va a la carpeta anterior y apila la actual; lo que queda en la pila no se sigue.
  if (apila && args.includes('-')) return dudar(`\`${p.join(' ')}\` va a la carpeta anterior, y lo que deja en la pila depende del shell`)
  // `cd -P x/..`: con -P, `..` sale de la carpeta real, que con un enlace simbolico es otra.
  if (destino != null && contexto.shell === 'bash' && /(^|[\\/])\.\.([\\/]|$)/.test(destino) && args.some((x) => /^-[LPe@]*P/.test(x))) return dudar(`\`${p.join(' ')}\` resuelve \`..\` sobre la carpeta real: con un enlace simbolico, es otra`)
  if (destino == null) {
    if (apila) {
      // `pushd` a secas intercambia la carpeta actual con la ultima apilada. Con
      // la pila vacia, bash da error y zsh va a la carpeta personal.
      if (!e.pila.length) {
        if (contexto.shell !== 'bash') return false
        dudar('que hace `pushd` a secas con la pila vacia depende del shell')
        e.anterior = anteriorIncierta()
        e.pila = [aca]
        e.alternativa = yaDudaba ? null : os.homedir()
        return true
      }
      const tope = e.pila.pop()
      e.pila.push(lugarDe(e))
      return ir(tope)
    }
    if (args.includes('-')) return e.anterior ? ir(e.anterior) : dudar(`\`${nombre} -\` vuelve a una carpeta que este comando no nombra`)
    // `cd` a secas va a la carpeta personal en bash y en zsh (y en PowerShell
    // reciente); en cmd solo muestra la actual.
    if (contexto.shell === 'bash') return ir({ carpeta: os.homedir(), duda: null })
    if (contexto.shell === 'powershell') return dudar(`\`${nombre}\` a secas puede ir a la carpeta personal`)
    return false
  }
  const expandida = rutaExpandida(destino)
  const ruta = path.resolve(e.carpeta, expandida)
  const dinamica = DINAMICO_EN_RUTA.test(expandida) && !esCarpeta(ruta)
  if ((!dinamica && ruta.length > RUTA_MAXIMA) || (apila && e.pila.length >= PILA_MAXIMA)) {
    return dudar(`tras \`${nombre}\` la ruta o la pila de carpetas pasa de lo que este hook sigue`)
  }
  if (apila) e.pila.push(lugarDe(e))
  if (dinamica) {
    dudar(`el destino de \`${nombre} ${destino}\` se resuelve recien al ejecutar`)
    e.anterior = anteriorIncierta()
    if (apila) pilaIncierta()
    e.alternativa = yaDudaba ? null : enElProyecto(destino)
    return true
  }
  // La carpeta no existe ahora, y el comando no la crea con un `mkdir`. Este
  // `cd` puede fallar, y entonces lo que le sigue corre donde se estaba: `cd
  // ../vualt; git add -A; git commit; git push`, con la ruta mal escrita, hace
  // todo eso en el proyecto. Si no falla es porque algo que corre antes la crea
  // (un clon, un worktree, un script), y de eso no se sabe que repo deja ahi: la
  // otra carpeta posible no se conoce. En Windows, las rutas propias de Git
  // Bash (`/tmp`) no se pueden comprobar.
  const comprobable = !(process.platform === 'win32' && /^[\\/](?![\\/])/.test(expandida))
  const falta = comprobable && ((!esCarpeta(ruta) && !seCrea(contexto.creadas, ruta)) || cruzaUnaQueNoExiste(e.carpeta, expandida, contexto.creadas))
  const siFallaNoSigue = contexto.despues === '&&' || (contexto.despues === '||' && contexto.saleSiFalla)
  if (falta && !siFallaNoSigue) {
    dudar(`\`${nombre} ${destino}\` puede fallar: esa carpeta no existe ahora`)
    e.anterior = anteriorIncierta()
    if (apila) pilaIncierta()
    return true
  }
  // Tras un `&&` o un `|| exit 1`, si falla no corre lo que sigue. Si antes no
  // corrio nada que pudiera crearla, falla seguro (`imposible`: lo que sigue no
  // llega a correr). Si corrio algo, se sabe donde se esta pero no que repo hay
  // ahi: eso se resuelve al evaluar el push. (Con una duda anterior, de una ruta
  // relativa tampoco se sabe si existe.)
  if (falta && !contexto.corrieron && !(yaDudaba && !path.isAbsolute(expandida))) e.imposible = true
  // Una ruta absoluta deja en claro donde se esta; una relativa hereda la duda
  // y mueve igual la carpeta alternativa -- si desde ahi existe: si no, alla
  // ese `cd` falla y se queda donde estaba.
  if (path.isAbsolute(expandida)) return ir({ carpeta: ruta, duda: null })
  const otra = e.alternativa && path.resolve(e.alternativa, expandida)
  return ir({ carpeta: ruta, duda: e.duda, alternativa: otra && (esCarpeta(otra) ? otra : e.alternativa) })
}

// Lo que sigue a un `||` (un comando, o unas llaves enteras) termina con `exit`
// o `return`: si se llega ahi, lo de despues no corre.
// (El `exit` de un subshell o de una tuberia -- `|| (exit 1)`, `|| exit 1 | cat`
// -- sale solo de ese subshell; y `return` sale solo de una funcion o de un guion
// leido con `source`: `conRetorno`.)
function saleElQueSigue(piezas, desde, conRetorno = false) {
  let llaves = 0
  for (let k = desde; k < piezas.length; k++) {
    const crudas = piezas[k].crudas ?? []
    if (!crudas.length) {
      if (ABRE.has(piezas[k].corte)) return false
      continue
    }
    const sinLlaves = crudas.filter((palabra) => palabra !== '{' && palabra !== '}')
    llaves += crudas.filter((palabra) => palabra === '{').length - crudas.filter((palabra) => palabra === '}').length
    if ((sinLlaves[0] === 'exit' || (sinLlaves[0] === 'return' && conRetorno)) && piezas[k].corte !== '|') return true
    if (llaves <= 0) return false
  }
  return false
}

// Un `cd` literal a una carpeta que ahora no existe: puede fallar.
function puedeFallar(e, p, shell, creadas) {
  if (!ES_CD.test(p[0]) && !ES_PUSHD.test(p[0])) return false
  const destino = p.slice(1).find((x) => !x.startsWith('-') && !(shell === 'cmd' && /^\/d$/i.test(x)))
  if (destino == null) return false
  const expandida = rutaExpandida(destino)
  if (process.platform === 'win32' && /^[\\/](?![\\/])/.test(expandida)) return false
  const ruta = path.resolve(e.carpeta, expandida)
  return !DINAMICO_EN_RUTA.test(expandida) && ((!esCarpeta(ruta) && !seCrea(creadas, ruta)) || cruzaUnaQueNoExiste(e.carpeta, expandida, creadas))
}

// `cd x/no-existe/..`: bash y zsh comprueban que exista cada carpeta que esta
// antes de un `..`; si una no existe, el `cd` falla aunque la ruta final exista.
function cruzaUnaQueNoExiste(base, ruta, creadas = new Set()) {
  if (!/(^|[\\/])\.\.([\\/]|$)/.test(ruta)) return false
  let actual = path.isAbsolute(ruta) ? path.parse(path.resolve(ruta)).root : base
  for (const parte of ruta.split(/[\\/]+/)) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') {
      if (!esCarpeta(actual) && !seCrea(creadas, actual)) return true
      actual = path.dirname(actual)
    } else actual = path.join(actual, parte)
  }
  return false
}

// `$(git branch --show-current)` y sus equivalentes SI se pueden leer del
// texto: son la rama actual, lo mismo que HEAD. Es la forma habitual de pushear
// "esta rama" en un script, y tratarla como incierta seria preguntar de mas.
const NOMBRE_DE_LA_RAMA_ACTUAL = String.raw`git\s+(?:branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+--short\s+HEAD)`
const SUSTITUCION_DE_LA_RAMA_ACTUAL = new RegExp(String.raw`\$\(\s*${NOMBRE_DE_LA_RAMA_ACTUAL}\s*\)|` + '`\\s*' + NOMBRE_DE_LA_RAMA_ACTUAL + '\\s*`', 'g')
// Lo mismo con `$(git rev-parse --show-toplevel)`: es la raiz del repo en el
// que ya esta la carpeta actual. Para saber a que repo va el push, `cd` ahi es
// quedarse donde se esta (`.`).
const RAIZ_DEL_REPO_ACTUAL = String.raw`git\s+rev-parse\s+--show-toplevel`
const SUSTITUCION_DE_LA_RAIZ_DEL_REPO = new RegExp(String.raw`\$\(\s*${RAIZ_DEL_REPO_ACTUAL}\s*\)|` + '`\\s*' + RAIZ_DEL_REPO_ACTUAL + '\\s*`', 'g')

// Los comandos de los que este hook lee algo. Uno de estos cortado por una
// expresion (`git push $(echo origin) main`) se lee entero, con lo que sigue al
// cierre: `main` es parte del mismo comando.
const SE_LEE = [ES_CD, ES_PUSHD, ES_POPD, ES_GIT, ES_GH, ES_LANZADOR, ES_SHELL, ES_POWERSHELL, ES_CMD, ES_EVAL]
const seLee = (nombre) => SE_LEE.some((forma) => forma.test(nombre ?? ''))
// Lo que queda en lugar de una expresion que no se pudo leer entera (sin cierre,
// o en un comando tan anidado que releerlo no entra en el plazo del hook). Como
// argumento de un push cuenta como algo que se resuelve recien al ejecutar.
const EXPRESION_SIN_LEER = '$(...)'

// Las palabras con las que bash arma sus bloques. Lo de adentro de un bloque
// puede no correr (el `then` de un `if`, el cuerpo de un bucle).
const ABRE_BLOQUE = new Set(['if', 'while', 'until', 'for', 'select', 'case'])
const CIERRA_BLOQUE = new Set(['fi', 'done', 'esac'])
const SIGUE_BLOQUE = new Set(['then', 'do', 'else', 'elif', '!', '{', '}'])
// A estas las sigue un comando (`if case ...`, `while ! { ...`); a `for`,
// `select` y `case`, un nombre.
const SIGUE_UN_COMANDO = new Set(['if', 'while', 'until'])
const BUCLES = new Set(['for', 'while', 'until', 'select'])

// Las palabras de estructura con las que empieza una pieza (`then`, `fi`,
// `{`, `if case`...), hasta la primera que ya es un comando o un nombre, y
// cuantas palabras ocupan (`largo`). `time` puede ir delante de cualquier
// comando, tambien de un bloque (`time if ...`): no cuenta, pero no corta.
function cabezaDe(crudas) {
  const estructura = []
  let largo = 0
  for (; largo < crudas.length; largo++) {
    const palabra = crudas[largo]
    if (palabra === 'time' || (palabra === '-p' && crudas[largo - 1] === 'time')) continue
    if (ABRE_BLOQUE.has(palabra)) {
      estructura.push(palabra)
      if (!SIGUE_UN_COMANDO.has(palabra)) {
        largo++
        break
      }
    } else if (CIERRA_BLOQUE.has(palabra) || SIGUE_BLOQUE.has(palabra)) {
      estructura.push(palabra)
    } else {
      break
    }
  }
  return { estructura, largo }
}
const estructuraDe = (crudas) => cabezaDe(crudas).estructura

// Una pieza hecha solo de palabras de estructura (o vacia): lo que sigue a su
// expresion -- `if (test) then`, `{ (cmd) }` -- todavia puede ser estructura.
// Tras cualquier otra cosa (`echo $(date) case`), lo que sigue son argumentos.
const soloEstructura = (pieza) => !pieza.texto.trim() || (pieza.crudas.length > 0 && pieza.funcion == null && cabezaDe(pieza.crudas).largo === pieza.crudas.length)

// Las palabras reservadas de bash y zsh: no pueden ser el nombre de una funcion.
const PALABRAS_RESERVADAS = new Set(['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while', 'until', 'do', 'done', 'in', 'function', 'time', 'coproc', 'foreach', 'end', 'repeat', 'always', 'nocorrect', 'noglob'])

// `x=(a b)`, `arr+=(c)`, `local x=(...)`: el literal de un arreglo. Lo de
// adentro son datos, no comandos.
const ABRE_UN_ARREGLO = /(^|\s)[A-Za-z_][A-Za-z0-9_]*\+?=$/

// `bash guion.sh`, `sh -x deploy.sh`: el shell corre ese archivo, y su entrada es
// la del guion. Sin archivo (o con `-s`), lo que lee de la entrada es el guion.
function tieneGuion(p) {
  for (let i = 1; i < p.length; i++) {
    if (p[i] === '-s' || p[i] === '-') return false
    if (/^(-o|-O|\+o|\+O|--rcfile|--init-file)$/.test(p[i])) i++
    else if (!p[i].startsWith('-') && !p[i].startsWith('+')) return true
  }
  return false
}

// El cuerpo de una funcion con los argumentos de una llamada puestos, como lo
// leen bash y zsh: `"$@"` es cada argumento, citado; `"$*"`, todos en una sola
// palabra; `"$1"`..., el que toca, y `$#`, cuantos son. Sin comillas, bash parte
// cada argumento en palabras y zsh no: si eso cambia algo, salen las dos
// lecturas. Dentro de comillas dobles, el texto va tal cual, escapado para esas
// comillas. `completo` es false si el cuerpo usa sus argumentos de una forma que
// esto no sigue (`shift`, `set --`, `${@:2}`, una variable, un arreglo o un
// `for` hechos con ellos, un heredoc, un comodin sin comillas): entonces la
// llamada se lee como se leia, con lo que sigue al nombre como un comando.
const ARGUMENTO_ENTRE_COMILLAS = /"\$(?:\{([@*]|[1-9])\}|([@*]|[1-9]))"/y
const ARGUMENTO = /\$(?:\{([@*#]|[1-9])\}|([@*#]|[1-9]))/y
const ARGUMENTOS_QUE_NO_SE_SIGUEN = [
  /\$\{(?![@*#]\}|[1-9]\})[#!]?(?:[@*]|#\}|\d|argv\b)/, // `${@:2}`, `${10}`, `${#1}`, `${1:-x}`
  /\$\{?argv\b/, // el arreglo de los argumentos, en zsh
  /[\w\]]\+?=\(?\s*["']?\$\{?[@*1-9]/, // `x=$1`, `local a=("$@")`
  /\bfor\s+\w+\s*(?:;|\n|do\b)/, // `for a; do`: recorre "$@"
  /\bfor\s+\w+\s+in\b[^;\n]*\$\{?[@*1-9]/,
  /<</, // en un heredoc, `$1` va sin comillas
  /(^|[\s;&|({])([A-Za-z_][\w.:-]*\s*\(\s*\)\s*[{(]|function\s+[^\s(){};&|]+)/, // una funcion definida adentro: sus `$1` son los de ella
]
function conArgumentos(cuerpo, args) {
  const sinSimples = cuerpo.replace(/'[^']*'/g, "''")
  let completo = !USA_SUS_ARGUMENTOS.test(sinSimples) || (!ARGUMENTOS_QUE_NO_SE_SIGUEN.some((re) => re.test(sinSimples)) && !cambiaSusArgumentos(sinSimples))
  // Uno que es una palabra reservada (`if`, `then`...), puesto en el lugar de un
  // comando, no lo es: eso no se sigue.
  if (args.some((arg) => PALABRAS_RESERVADAS.has(arg) || PALABRAS_DE_CONTROL.has(arg))) completo = false
  const lecturas = new Set()
  for (const partir of [true, false]) {
    const { texto, comodin } = ponerArgumentos(cuerpo, args, partir)
    if (comodin) completo = false
    lecturas.add(texto)
  }
  return { lecturas: [...lecturas], completo }
}

// `shift`, `getopts` y `set` con argumentos cambian lo que valen `$1`, `$@`...
function cambiaSusArgumentos(texto) {
  for (const segmento of texto.split(/[;&|\n(){}]+/)) {
    const w = segmento.trim().split(/\s+/)
    let i = 0
    while (i < w.length && (PALABRAS_RESERVADAS.has(w[i]) || w[i] === '!' || w[i] === 'builtin' || w[i] === 'command')) i++
    if (w[i] === 'shift' || w[i] === 'getopts') return true
    if (w[i] !== 'set') continue
    for (let j = i + 1; j < w.length; j++) {
      if (/^[-+][A-Za-z]*o$/.test(w[j])) j++
      else if (!/^[-+][A-Za-z]+$/.test(w[j])) return true
    }
  }
  return false
}

// Una palabra entre comillas simples, para volver a leerla como texto de un
// comando. Un `~` al principio queda afuera: en la llamada (`g cd ~`) el shell
// ya lo expandio.
const citarParaShell = (palabra) => {
  const tilde = palabra.match(/^~[A-Za-z0-9._-]*(\/|$)/)?.[0] ?? ''
  const resto = palabra.slice(tilde.length)
  return tilde && !resto ? tilde : `${tilde}'${resto.replaceAll("'", "'\\''")}'`
}

function ponerArgumentos(cuerpo, args, partir) {
  const citar = citarParaShell
  let comodin = false
  // Sin comillas: bash parte en palabras (y expande comodines); zsh no.
  const sueltas = (texto) => {
    const partes = partir ? texto.split(/[ \t\n]+/).filter(Boolean) : texto === '' ? [] : [texto]
    if (partir && partes.some((parte) => /[*?[]/.test(parte))) comodin = true
    return partes.map(citar).join(' ')
  }
  const valor = (cual, como) => {
    if (cual === '#') return String(args.length)
    const todos = cual === '@' || cual === '*'
    const arg = todos ? null : (args[Number(cual) - 1] ?? '')
    if (como === 'palabra') return todos ? (cual === '@' ? args.map(citar).join(' ') : citar(args.join(' '))) : citar(arg)
    if (como === 'texto') return (todos ? args.join(' ') : arg).replace(/[\\"$`]/g, '\\$&')
    if (!todos) return sueltas(arg)
    return partir ? sueltas(args.join(' ')) : args.filter((a) => a !== '').map(citar).join(' ')
  }
  let salida = ''
  let enDobles = false
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i]
    if (!enDobles && c === "'") {
      const fin = cuerpo.indexOf("'", i + 1)
      const hasta = fin === -1 ? cuerpo.length : fin + 1
      salida += cuerpo.slice(i, hasta)
      i = hasta - 1
      continue
    }
    if (c === '\\') {
      salida += cuerpo.slice(i, i + 2)
      i++
      continue
    }
    if (!enDobles && c === '"') {
      ARGUMENTO_ENTRE_COMILLAS.lastIndex = i
      const m = ARGUMENTO_ENTRE_COMILLAS.exec(cuerpo)
      if (m) {
        salida += valor(m[1] ?? m[2], 'palabra')
        i += m[0].length - 1
        continue
      }
    }
    if (c === '"') enDobles = !enDobles
    if (c === '$') {
      ARGUMENTO.lastIndex = i
      const m = ARGUMENTO.exec(cuerpo)
      if (m) {
        salida += valor(m[1] ?? m[2], enDobles ? 'texto' : 'suelta')
        i += m[0].length - 1
        continue
      }
    }
    salida += c
  }
  return { texto: salida, comodin }
}

// Una funcion definida en el mismo comando que usa sus argumentos (`retry() {
// "$@" || "$@"; }`): lo que se le pasa puede ser un comando.
const USA_SUS_ARGUMENTOS = /\$(\{?[@*1-9])/

// Donde esta, en el texto de una pieza, la n-esima llave que es una palabra
// suelta: la que abre un grupo o el cuerpo de una funcion.
function llaveEn(textoDePieza, n) {
  let vistas = 0
  for (const m of textoDePieza.matchAll(/(^|\s)\{(?=\s|$)/g)) if (++vistas === n) return m.index + m[1].length
  return textoDePieza.indexOf('{')
}

// Cuantos bloques de script de PowerShell abre y cierra una pieza. `${var}` y
// `@{...}` no son bloques.
function llavesDe(crudas) {
  const texto = crudas.join(' ').replace(/[$@]\{[^{}]*\}/g, '')
  return { abre: texto.split('{').length - 1, cierra: texto.split('}').length - 1 }
}

// Cada comando que el texto ejecuta: `p` (sus palabras, sin lo que lo
// envuelve), la `carpeta` en la que corre y `duda`, el motivo cuando esa
// carpeta no se puede saber con certeza (con `alternativa`, la otra carpeta
// posible, si se conoce). Mira a traves de envoltorios (`command git push`),
// agrupaciones (`(git push)`, `if ...; then git push; fi`), comandos anidados
// (`bash -c`, `eval`) y funciones definidas en el mismo comando, y sigue los
// `cd`, `pushd` y `popd`.
//
// La carpeta la mueve solo el `cd` que llega a lo que viene despues:
// - En bash, el de un subshell o una sustitucion -- `(cd x)`, `$(cd x)` --
//   termina con ella: al cerrar el parentesis vuelve la carpeta de antes. En
//   PowerShell y en cmd un parentesis no abre otro proceso, y ese `cd` queda.
//   Lo mismo el de una lista mandada al fondo (`a && cd x &`).
// - El que puede no haber corrido -- el de un `if`, un bucle o un `case`, o el
//   que sigue a un `&&` o a un `||` -- vale para lo que lo acompania adentro;
//   al salir ya no se sabe donde se esta, y queda en duda.
// - El del cuerpo de una funcion no mueve nada al definirla: corre cuando se
//   la llama, y ahi se vuelve a leer el cuerpo.
//
// Deja `e` como "uno de estos estados" (los pasos de una lista, las salidas de
// una funcion): la carpeta del primero, en duda si algun otro difiere, y la
// otra carpeta posible si entre todos son exactamente dos y se conocen. Si lo
// que difiere es la pila de `pushd` o la carpeta anterior, lo que queda en duda
// es adonde llevan `popd` y `cd -`.
function unoDeVariosEn(e, estados, motivo) {
  const [a] = estados
  const cambios = estados.reduce((mayor, s) => Math.max(mayor, s.cambios), 0)
  const misma = { pila: estados.every((s) => mismaPila(a.pila, s.pila)), anterior: estados.every((s) => mismoLugar(a.anterior, s.anterior)) }
  volverA(e, a)
  e.cambios = cambios
  const incierto = () => ({ carpeta: e.carpeta, duda: dudaDeCarpeta(motivo), alternativa: null })
  if (!misma.pila) e.pila = Array.from({ length: estados.reduce((mayor, s) => Math.max(mayor, s.pila.length), 0) }, incierto)
  if (!misma.anterior) e.anterior = incierto()
  if (estados.every((s) => mismoLugar(a, s))) return
  const posibles = new Set()
  let cualquiera = false
  for (const s of estados) {
    posibles.add(s.carpeta)
    if (s.duda && s.alternativa) posibles.add(s.alternativa)
    else if (s.duda) cualquiera = true
  }
  posibles.delete(a.carpeta)
  e.duda = a.duda ?? estados.find((s) => s.duda)?.duda ?? dudaDeCarpeta(motivo)
  e.alternativa = !cualquiera && posibles.size === 1 ? [...posibles][0] : null
}

// `lectura` es lo que comparten las lecturas anidadas de un mismo comando: el
// presupuesto de piezas (`quedan`), si ya se aviso de algo que no se pudo leer,
// las funciones definidas (cada una con los cuerpos que puede tener), las
// carpetas que crea con `mkdir`, cuantos comandos corrieron ya, donde puede
// terminar cada funcion que se esta leyendo (`retornos`) y los alias.
const nuevaLectura = () => ({ quedan: null, avisado: false, funciones: new Map(), definidas: [], enCurso: new Set(), creadas: new Set(), corrieron: 0, retornos: [], alias: new Map() })

function* comandosDe(comando, cwd, shell = 'bash', nivel = 0, { estado = null, lectura = null, evals = 0 } = {}) {
  const texto = comando.replace(SUSTITUCION_DE_LA_RAMA_ACTUAL, 'HEAD').replace(SUSTITUCION_DE_LA_RAIZ_DEL_REPO, '.')
  const { piezas, sinLeerDesde, cuerpos } = leerPiezas(texto, shell)
  // Los cuerpos de heredoc cuyo `<<` esta entre `desde` y `hasta` (busqueda
  // binaria: puede haber miles).
  const enOrden = [...cuerpos].sort((x, y) => x.en - y.en)
  const cuerposEntre = (desde, hasta) => {
    let [a, b] = [0, enOrden.length]
    while (a < b) {
      const medio = (a + b) >> 1
      if (enOrden[medio].en < desde) a = medio + 1
      else b = medio
    }
    const salida = []
    for (let j = a; j < enOrden.length && enOrden[j].en < hasta; j++) salida.push(enOrden[j])
    return salida
  }
  // Un comando anidado se vuelve a leer en cada nivel (`eval (eval (...`): el
  // total de piezas leidas queda acotado, y lo que no se alcanza a leer se
  // pregunta. Un hook que se pasa de su plazo no frena nada.
  lectura ??= nuevaLectura()
  lectura.quedan ??= piezas.length * 4 + 5_000
  lectura.quedan -= piezas.length

  // Primera pasada: las palabras de cada pieza y, para cada pieza que abre una
  // expresion, la pieza en la que cierra.
  // - El `)` de un patron de `case` no cierra nada: tomado por el de un
  //   subshell, deshacia su `cd` antes de tiempo.
  // - `esDato`: la pieza esta dentro del literal de un arreglo. `esArgumento`:
  //   sigue al cierre de una expresion que era parte de los argumentos de un
  //   comando, o empieza dentro de unas comillas. En ninguna de las dos una
  //   palabra como `case` o `}` es estructura.
  // - `function f` no es parte del comando de la pieza: es el encabezado de una
  //   definicion (`trasFunction`: cuantas palabras de estructura lleva delante).
  // - `defineFuncion`: los parentesis vacios tras un nombre son los de una
  //   definicion (`git() { ... }`), no una expresion: lo que sigue es su cuerpo.
  const cierreDe = new Map()
  const abiertas = []
  const cases = []
  let sigueArgumento = false
  piezas.forEach((pieza, k) => {
    let crudas = pieza.texto.trim() ? palabras((pieza.enComillas ? '"' : '') + pieza.texto, shell) : []
    pieza.esDato = abiertas.at(-1)?.datos === true
    pieza.esArgumento = sigueArgumento || pieza.enComillas === true
    sigueArgumento = false
    if (shell !== 'cmd' && !pieza.esDato && !pieza.esArgumento) {
      const largo = shell === 'bash' ? cabezaDe(crudas).largo : 0
      if (crudas.length > largo + 1 && (crudas[largo] === 'function' || (crudas[largo] === 'filter' && shell === 'powershell'))) {
        pieza.funcion = crudas[largo + 1]
        pieza.trasFunction = largo
        crudas = [...crudas.slice(0, largo), ...crudas.slice(largo + 2)]
      }
    }
    pieza.crudas = crudas
    if (shell === 'bash' && !pieza.esDato && !pieza.esArgumento) {
      for (const palabra of estructuraDe(crudas)) {
        // `case x in esac` abre y cierra en la misma pieza.
        if (palabra === 'case' && !(crudas.at(-1) === 'esac' && crudas.at(-2) === 'in')) cases.push(abiertas.length)
        else if (palabra === 'esac') cases.pop()
      }
    }
    if (ABRE.has(pieza.corte)) {
      abiertas.push({ k, datos: shell === 'bash' && pieza.corte === '(' && ABRE_UN_ARREGLO.test(pieza.texto) })
    } else if (pieza.corte === ')' && cases.length && abiertas.length === cases.at(-1)) {
      pieza.corte = ';'
    } else if (CIERRA.has(pieza.corte) && abiertas.length) {
      const a = abiertas.pop().k
      const abre = piezas[a]
      cierreDe.set(a, k)
      if (abre.corte === '(' && k === a + 1 && !pieza.texto.trim() && !abre.esDato && !abre.esArgumento) {
        const efectivo = comandoEfectivo(abre.crudas)
        // `f g() { ... }` define las dos en zsh; en bash es un error y no corre
        // nada. Con una sola palabra, esa es el nombre, aunque sea la de un
        // envoltorio (`command() { ... }`).
        const nombres = abre.funcion != null ? [abre.funcion] : abre.crudas.length === 1 ? [...abre.crudas] : efectivo.p
        // (`for i (1 2) cmd`, de zsh, no define funciones llamadas `for` e `i`.)
        if (abre.funcion != null ? abre.crudas.length === abre.trasFunction : shell === 'bash' && nombres.length > 0 && nombres.every((nombre) => /^[A-Za-z_][\w.:-]*$/.test(nombre) && !PALABRAS_RESERVADAS.has(nombre))) {
          abre.defineFuncion = true
          abre.funciones = nombres
          // `time f() { ... }`: que quede definida depende del shell.
          abre.envuelta = (abre.crudas.length > 1 && efectivo.envoltorios.length > 0) || nombres.length > 1
        }
      }
      // (`case x in (a) cmd`: ese parentesis abre un patron, y lo que sigue es un comando.)
      const patronDeCase = estructuraDe(abre.crudas).includes('case') && abre.crudas.at(-1) === 'in'
      sigueArgumento = !abre.defineFuncion && !patronDeCase && (abre.corte === '`(' || abre.esArgumento || !soloEstructura(abre))
    }
  })
  // La pieza en la que termina el comando que una expresion corto: la que sigue
  // a su cierre, y al de las expresiones que vengan pegadas. null, sin cierre.
  const finDe = new Map()
  const finDelComando = (k) => {
    const camino = []
    let fin = k
    while (fin != null && ABRE.has(piezas[fin].corte) && !finDe.has(fin)) {
      camino.push(fin)
      const cierre = cierreDe.get(fin)
      fin = cierre == null ? null : cierre + 1
    }
    if (fin != null && finDe.has(fin)) fin = finDe.get(fin)
    for (const j of camino) finDe.set(j, fin)
    return fin
  }

  let e = estado ?? { carpeta: cwd, duda: null, alternativa: null, anterior: null, pila: [], cambios: 0, imposible: false }
  const ambitos = []
  // Lo que puede no haber corrido y sigue abierto, con el estado al entrar.
  let regiones = []
  // El estado al empezar cada lista (`a && b || c`) y cada tuberia, por nivel de
  // anidamiento. De una lista mandada al fondo (`a && cd x && b &`), bash corre
  // todo en un subshell y zsh solo la ultima tuberia: vuelve uno de los dos.
  let inicios = new Map()
  let tuberias = new Map()
  // Un comando cortado por una expresion corre despues de ella (`cd x "$(git
  // push)"` hace primero el push): queda pendiente hasta la pieza en que termina.
  const pendientes = new Map()
  // Tras `f()` o `function f`: la funcion cuyo cuerpo viene. `dudosa`: que quede
  // definida depende de una condicion o del shell (`x && f() {...}`, `x | f()
  // {...}`, `time f() {...}`).
  let esperaCuerpo = null
  let llaves = 0 // bloques de script de PowerShell abiertos
  const yaLeidas = new Set()
  // Releer entero un comando cortado cuesta su largo; el total queda acotado.
  let porReleer = texto.length * 4 + 10_000
  let siFallo = null
  let antes = ''
  // Lo que el comando anterior de una tuberia le pasa al que sigue, si se puede
  // leer del texto: `cat <<EOF |`, `echo "..." |`.
  let loQueViene = null

  // Lo que no se pudo leer queda, una vez por comando, como un push del que no
  // se sabe nada: eso se pregunta.
  const sinLeerEn = (lugar) => {
    if (lectura.avisado) return []
    lectura.avisado = true
    return [{ p: ['git', 'push', EXPRESION_SIN_LEER], viaXargs: false, ...lugarDe(lugar) }]
  }
  const dudar = (lugar, motivo) => {
    lugar.duda = dudaDeCarpeta(motivo)
    lugar.alternativa = null
    lugar.cambios++
  }
  // Cuantos bloques o grupos hay abiertos (sin contar las listas): cada region guarda cuantos tenia debajo.
  // Una definicion segura reemplaza a la de antes; una que puede no haber
  // corrido (dentro de un `if`, tras un `&&`, en una tuberia) se suma a las
  // posibles: al llamarla puede correr cualquiera, o el comando de siempre.
  const definir = (nombres, { cuerpo, cierta, mueve }) => {
    for (const nombre of nombres) {
      const antes = lectura.funciones.get(nombre)
      lectura.funciones.set(nombre, cierta ? { cuerpos: [cuerpo], cierta: true, mueve } : { cuerpos: [...new Set([...(antes?.cuerpos ?? []), cuerpo])], cierta: false, mueve: mueve || antes?.mueve === true })
    }
    lectura.definidas.push(...nombres)
  }
  // Lee `texto` en otro ambito de funciones: lo que define ahi no queda definido
  // aca (`bash -c`, un guion por la entrada), o no se sabe si quedo (`comparte`
  // distinto de 'no': un `eval` que puede no correr, el final de una tuberia).
  const enOtroAmbito = function* (lectura_, comparte, leer) {
    const funciones = lectura_.funciones
    lectura_.funciones = new Map(funciones)
    yield* leer()
    const adentro = lectura_.funciones
    lectura_.funciones = funciones
    if (comparte !== 'no') {
      for (const [nombre, funcion] of adentro) {
        const antes = funciones.get(nombre)
        if (antes !== funcion) funciones.set(nombre, { cuerpos: [...new Set([...(antes?.cuerpos ?? []), ...funcion.cuerpos])], cierta: false, mueve: funcion.mueve || antes?.mueve === true })
      }
    }
  }
  const nivelDeLista = () => (regiones.length ? regiones.at(-1).debajo + (regiones.at(-1).tipo !== 'lista') : 0)

  // Deja `e` como "el estado `a` o el estado `b`": la carpeta de `a`, en duda si
  // la de `b` es otra. Las dos se conocen (`conLaOtra`) solo si a `b` se llego
  // con un unico cambio. Si lo que difiere es la pila de `pushd` o la carpeta
  // anterior, lo que queda en duda es adonde llevan `popd` y `cd -`.
  const unoUOtro = (a, b, motivo, conLaOtra) => {
    volverA(e, a)
    // Lo que cambio adentro sigue contando: la region que contiene a esta lo usa
    // para saber si adentro hubo un cambio o varios.
    e.cambios = Math.max(a.cambios, b.cambios)
    const incierto = () => ({ carpeta: e.carpeta, duda: dudaDeCarpeta(motivo), alternativa: null })
    if (!mismaPila(a.pila, b.pila)) e.pila = Array.from({ length: Math.max(a.pila.length, b.pila.length) }, incierto)
    if (!mismoLugar(a.anterior, b.anterior)) e.anterior = incierto()
    if (mismoLugar(a, b)) return
    if (a.duda) {
      // Ya habia una duda: ahora las carpetas posibles son mas de dos.
      e.alternativa = null
      return
    }
    e.duda = b.duda ?? dudaDeCarpeta(motivo)
    if (b.carpeta === a.carpeta) e.alternativa = b.alternativa
    else e.alternativa = (b.duda ? b.alternativa === a.carpeta : conLaOtra) ? b.carpeta : null
  }
  // Lo mismo con varios estados posibles (los pasos de una lista).
  const unoDeVarios = (estados, motivo) => unoDeVariosEn(e, estados, motivo)
  // Al salir de algo que puede no haber corrido. Si adentro cambio la carpeta,
  // vuelve la de antes y queda en duda; la otra carpeta posible se conoce solo
  // si adentro hubo un unico cambio: con dos (`if a; then cd x; else cd y; fi`)
  // pudo quedar en cualquiera. Tampoco se conoce si en un bucle el mismo `cd`,
  // repetido, lleva mas lejos (`while ...; do cd sub; done`, con un sub/sub).
  const seRepite = (desde, hasta) => {
    const otraVuelta = path.resolve(hasta, path.relative(desde, hasta))
    return otraVuelta !== hasta && esCarpeta(otraVuelta)
  }
  const salirDe = (region) => {
    const antesDe = region.estado
    // El cuerpo de una funcion corre cuando se la llama; y tras un `cd` que
    // falla seguro (`cd no-existe && ...`), lo que seguia no corrio.
    const posible = (s) => !(s.imposible && !antesDe.imposible)
    // Una lista pudo terminar en cualquiera de sus pasos: en `cd x && make && cd
    // -`, si falla `make`, se queda en x.
    const salidas = (region.salidas ?? []).filter((s) => posible(s) && !mismoEstado(s, antesDe))
    if (mismoEstado(e, antesDe) && !salidas.length) return
    const fin = copiaDe(e)
    const motivo = 'un `cd` anterior corre solo si se cumple una condicion'
    if (region.tipo === 'funcion') volverA(e, antesDe)
    else if (salidas.length) unoDeVarios([antesDe, ...salidas, ...(posible(fin) ? [fin] : [])], motivo)
    else if (!posible(fin)) volverA(e, antesDe)
    else unoUOtro(antesDe, fin, motivo, fin.cambios - antesDe.cambios === 1 && !(region.bucle && seRepite(antesDe.carpeta, fin.carpeta)))
  }
  const cerrarHasta = (tipo) => {
    const i = regiones.findLastIndex((region) => region.tipo === tipo)
    if (i !== -1) for (const region of regiones.splice(i).reverse()) salirDe(region)
  }
  // Cierra un bloque de bash (`fi`, `done`, `esac`) o unas llaves. En una
  // tuberia o al fondo, lo compuesto corre en un subshell: al terminar vuelve la
  // carpeta de antes, sin dudas. Unas llaves a secas corren siempre y en este
  // shell, y su `cd` queda; lo demas puede no correr. El cuerpo de una funcion
  // se guarda para leerlo cuando se la llame; si se la definio dentro de un
  // bloque, de una tuberia o tras una condicion, puede no haber quedado definida.
  const cerrar = (tipos, pieza) => {
    const i = regiones.findLastIndex((region) => tipos.includes(region.tipo))
    if (i === -1) return
    const [region, ...adentro] = regiones.splice(i)
    for (const otra of adentro.reverse()) salirDe(otra)
    // Seguido de `|` o de `&`, lo compuesto corre en un subshell: lo que define
    // adentro (o la funcion misma) no queda definido afuera, en ningun shell.
    const enSubshell = pieza.corte === '|' || pieza.corte === '&'
    if (region.tipo === 'funcion') {
      // (`f() { ...; } >/no/existe`: esa redireccion es de cada llamada, y si falla la funcion no corre.)
      const cierta = !region.dudosa && regiones.every((otra) => otra.tipo === 'grupo' && !otra.trasTuberia) && !redireccionDudosa(pieza.texto.slice(pieza.texto.lastIndexOf('}') + 1))
      if (!enSubshell) definir(region.nombres, { cuerpo: texto.slice(region.abre, pieza.hasta), cierta, mueve: !mismoEstado(e, region.estado) })
      salirDe(region)
    } else if (enSubshell) {
      volverA(e, region.estado)
      lectura.funciones = region.funciones
      lectura.alias = region.alias
    } else if (region.tipo !== 'grupo' || region.trasTuberia) salirDe(region)
  }
  const entrar = (tipo, extra = {}) => regiones.push({ tipo, estado: copiaDe(e), debajo: nivelDeLista(), salidas: [], funciones: new Map(lectura.funciones), alias: new Map(lectura.alias), ...extra })
  // Lo que sigue a un `&&` o a un `||` corre solo si lo anterior salio de cierta manera.
  const entrarEnLista = (antes) => {
    if ((antes === '&&' || antes === '||') && regiones.at(-1)?.tipo !== 'lista') entrar('lista')
  }

  for (let k = 0; k < piezas.length; k++) {
    const pieza = piezas[k]
    if (pendientes.has(k)) yield* pendientes.get(k)()
    // Con el `;` termina la lista: lo que seguia a su `&&` ya no acompania al `cd`.
    if (antes === ';' || antes === '&' || antes === '') while (regiones.at(-1)?.tipo === 'lista') salirDe(regiones.pop())
    if (antes === ';' || antes === '&' || antes === '' || ABRE.has(antes)) inicios.set(nivelDeLista(), { ...copiaDe(e), definidas: lectura.definidas.length })
    if (antes !== '|' && !CIERRA.has(antes)) tuberias.set(nivelDeLista(), copiaDe(e))
    // La lista pudo terminar justo antes de esta pieza (si fallo lo anterior,
    // tras un `&&`; si no fallo, tras un `||`): el estado de ahora es una salida posible.
    if ((antes === '&&' || antes === '||') && regiones.at(-1)?.tipo === 'lista') regiones.at(-1).salidas.push(copiaDe(e))
    // Desde lo que no se pudo leer con certeza (un heredoc sin cierre), tampoco
    // se sabe en que carpeta corre lo que sigue.
    if (sinLeerDesde !== -1 && pieza.hasta > sinLeerDesde && !e.duda) dudar(e, 'una parte del comando no se pudo leer con certeza')

    // Lo que sigue al cierre de una expresion que es argumento de otro comando
    // (`echo $(date) cd x`) es parte de ese comando: no se lee como uno aparte.
    // (En PowerShell, lo que sigue a `foreach (...)` es la llave de su bloque.)
    if (!yaLeidas.has(k) && !pieza.esDato && !(pieza.esArgumento && shell === 'bash') && pieza.texto.trim()) {
      const crudas = pieza.crudas
      let cuerpoSuelto = false
      let llaveSuelta = false
      let negado = false

      // Lo que sigue a un `||` corre solo si fallo algo de antes: quiza sin el
      // `cd` que esta lista ya hizo (`a && cd x && b || c`: si fallo `a`).
      const lista = regiones.at(-1)?.tipo === 'lista' ? regiones.at(-1) : null
      if (antes === '||' && lista && !mismoEstado(e, lista.estado)) {
        unoUOtro(copiaDe(e), lista.estado, 'lo que sigue a un `||` corre solo si fallo algo de antes', e.cambios - lista.estado.cambios === 1)
      }

      if (shell === 'bash') {
        const estructura = pieza.esArgumento ? [] : estructuraDe(crudas)
        negado = estructura.filter((palabra) => palabra === '!').length % 2 === 1
        // `if cond { ... }`, `x always { ... }`, `for x (a b) cmd`: sintaxis de zsh
        // que este hook no sigue. Lo que venga despues queda en duda.
        if (!pieza.esArgumento && crudas.slice(Math.max(1, cabezaDe(crudas).largo)).includes('{')) dudar(e, 'una llave en medio del comando: sintaxis de zsh que este hook no sigue')
        if ((estructura.includes('for') || crudas[0] === 'foreach') && pieza.corte === '(' && piezas[k + 1]?.texto.trim()) dudar(e, 'un `for` de zsh, con la lista entre parentesis')
        const dudosa = antes === '|' || antes === '&&' || antes === '||' || pieza.envuelta === true
        // `function f { ...`: el `{` que sigue a `function f` abre su cuerpo.
        const llaveDeFuncion = pieza.funcion != null && !pieza.defineFuncion ? estructuraDe(crudas.slice(0, pieza.trasFunction)).length : -1
        if (esperaCuerpo != null && estructura[0] !== '{' && !(pieza.funcion != null && crudas.length === pieza.trasFunction)) {
          // El cuerpo no va entre llaves. Un comando solo (`f() cmd`, de zsh) se
          // lee como el cuerpo; un bloque (`f() if ...`), como lo que es, y de
          // esa funcion queda que no se pudo leer.
          if (estructura.length) definir(esperaCuerpo.nombres, { cuerpo: null, cierta: !esperaCuerpo.dudosa, mueve: true })
          else {
            entrar('funcion', { nombres: esperaCuerpo.nombres, abre: pieza.desde, dudosa: esperaCuerpo.dudosa })
            cuerpoSuelto = true
          }
          esperaCuerpo = null
        }
        estructura.forEach((palabra, j) => {
          if (ABRE_BLOQUE.has(palabra)) entrar('bloque', { bucle: BUCLES.has(palabra) })
          else if (CIERRA_BLOQUE.has(palabra)) cerrar(['bloque'], pieza)
          else if (palabra === '}') cerrar(['funcion', 'grupo'], pieza)
          else if (palabra === '{') {
            if (j === llaveDeFuncion) esperaCuerpo = { nombres: [pieza.funcion], dudosa }
            // Tras `x |`, que las llaves corran en este shell depende del shell.
            // (Su cuerpo empieza en esta llave, que no siempre es la primera de la pieza: `{ function g { ...`.)
            if (esperaCuerpo != null) entrar('funcion', { nombres: esperaCuerpo.nombres, abre: pieza.desde + llaveEn(pieza.texto, estructura.slice(0, j + 1).filter((x) => x === '{').length), dudosa: esperaCuerpo.dudosa })
            else entrar('grupo', { trasTuberia: antes === '|' })
            esperaCuerpo = null
          }
        })
        // `{ cd x }`, con la llave pegada al comando: zsh la toma por el cierre y
        // bash por un argumento mas. Lo que sigue queda en duda.
        llaveSuelta = !pieza.esArgumento && crudas.length > cabezaDe(crudas).largo && crudas.at(-1) === '}' && regiones.some((region) => region.tipo === 'funcion' || region.tipo === 'grupo')
        // El encabezado de una definicion: lo que sigue es su cuerpo.
        if (pieza.defineFuncion || (pieza.funcion != null && crudas.length === pieza.trasFunction)) esperaCuerpo = { nombres: pieza.funciones ?? [pieza.funcion], dudosa }
      } else if (shell === 'powershell') {
        const { abre, cierra } = llavesDe(crudas)
        if (llaves === 0 && abre > 0) entrar('llaves')
        llaves = Math.max(0, llaves + abre - cierra)
      }

      // Un envoltorio redefinido como funcion (`command() { ... }`) ya no es el
      // del shell: llamarlo es llamar a la funcion.
      let leido = shell === 'bash' && ENVOLTORIOS.has(crudas[0]) && lectura.funciones.has(crudas[0]) ? { p: [...crudas], viaXargs: false, envoltorios: [] } : comandoEfectivo(crudas)
      let despues = pieza.corte
      let termina = k
      if (ABRE.has(pieza.corte) && !pieza.defineFuncion) {
        // Lo corto una expresion: el comando sigue despues de su cierre, y del de
        // las que vengan. Se lee entero si asi resulta ser uno de los que se leen
        // (`PATH=$(pwd)/bin:$PATH git push origin main` lo es recien entero).
        const fin = finDelComando(k)
        const largo = fin == null ? Infinity : piezas[fin].hasta - pieza.desde
        let entero = null
        if (largo <= porReleer) {
          porReleer -= largo
          entero = comandoEfectivo(palabras((pieza.enComillas ? '"' : '') + texto.slice(pieza.desde, piezas[fin].hasta), shell))
        }
        if (entero && (seLee(entero.p[0]) || /^(\$\(|`)/.test(entero.p[0] ?? ''))) {
          leido = entero
          despues = piezas[fin].corte
          termina = fin
          for (let j = k; j !== fin; j = cierreDe.get(j) + 1) yaLeidas.add(cierreDe.get(j) + 1)
        } else if (seLee(leido.p[0])) {
          // Sin cierre, o sin presupuesto para releerlo: queda constancia de que
          // lo completa una expresion que no se leyo.
          leido = { ...leido, p: [...leido.p, EXPRESION_SIN_LEER] }
        }
      }

      // Si este comando alimenta una tuberia con un texto que se conoce, y si el
      // anterior lo alimentaba a el.
      const entrada = antes === '|' ? loQueViene : null
      // Lo que lee de su entrada, como lista de textos posibles: con varias
      // redirecciones de entrada (heredocs, here-strings, archivos), bash usa la
      // ultima y zsh las concatena en orden; sin ninguna, lo que le pasa la
      // tuberia. Un archivo no se puede leer: si interviene, esa posibilidad no
      // se cuenta.
      const suEntrada = () => {
        const tramo = texto.slice(pieza.desde, piezas[termina].hasta)
        const fuentes = cuerposEntre(pieza.desde, piezas[termina].hasta).map((cuerpo) => ({ en: cuerpo.en, texto: texto.slice(cuerpo.a, cuerpo.b) }))
        for (const m of tramo.matchAll(/<<<[ \t]*/g)) fuentes.push({ en: pieza.desde + m.index, texto: palabras(tramo.slice(m.index + m[0].length), shell)[0] ?? '' })
        for (const m of tramo.matchAll(/(^|[^<])<(?![<(&])/g)) fuentes.push({ en: pieza.desde + m.index + m[1].length, texto: null })
        if (!fuentes.length) return entrada ?? []
        fuentes.sort((x, y) => x.en - y.en)
        const posibles = [fuentes.at(-1).texto]
        if (fuentes.length > 1 && fuentes.every((fuente) => fuente.texto != null)) posibles.push(fuentes.map((fuente) => fuente.texto).join('\n'))
        const legibles = [...new Set(posibles.filter((posible) => posible != null))]
        // (Un archivo, o lo que imprime otro comando con `< <(...)`, no se puede leer.)
        legibles.ilegible = fuentes.some((fuente) => fuente.texto == null)
        return legibles
      }
      const emite = /^cat$/.test(leido.p[0] ?? '') && leido.p.length === 1 ? suEntrada() : /^(echo|printf)$/.test(leido.p[0] ?? '') ? [leido.p.slice(1).join(' ').replaceAll('\\n', '\n')] : []
      loQueViene = despues === '|' && emite.length ? emite : null

      // Lo que el comando hace. `antes` es el operador que lo precede.
      const correr = function* (antes) {
        // El encabezado de una definicion (`cd() {`) no es un comando que corra.
        if (pieza.defineFuncion) return
        let { p } = leido
        const { viaXargs } = leido
        // Con `!` delante, lo que sigue a `&&` corre si el comando fallo, y lo que
        // sigue a `||`, si no.
        const trasEl = negado ? ({ '&&': '||', '||': '&&' }[despues] ?? despues) : despues
        // `cd x || exit 1`, `cd x || { echo no; return 1; }`: si el cd falla, no sigue.
        const saleSiFalla = trasEl === '||' && saleElQueSigue(piezas, k + 1, lectura.retornos.length > 0)
        // `quiza`: llega aca solo si fallo lo anterior (`a || cd x`), y puede no correr.
        const contexto = { antes, despues: trasEl, envoltorios: leido.envoltorios, shell, saleSiFalla, creadas: lectura.creadas, corrieron: lectura.corrieron, quiza: antes === '||' || leido.dudoso === true, texto: texto.slice(pieza.desde, piezas[termina].hasta) }
        // Lo que sigue a `cd x ||` corre solo si ese cd fallo: en la carpeta de antes.
        const aqui = siFallo ?? e
        siFallo = null

        // Un comando escrito dentro de otro (`bash -c`, `eval`) o el cuerpo de una
        // funcion a la que se llama: se lee con las mismas reglas. `eval`, `iex` y
        // una funcion corren en este mismo shell y su `cd` queda -- si corren aca:
        // no en una tuberia ni al fondo, y no solo si fallo lo anterior. El de
        // `bash -c "cd x"` termina con ese proceso.
        // `marco`: es el cuerpo de una funcion o un guion leido con `source`, y un
        // `return` adentro termina ahi: cada `return` es una salida posible.
        const leerAdentro = function* (anidado, comparte, nombre, { marco = false } = {}) {
          // `eval eval eval git push`: cada `eval` vuelve a leer el texto del anterior,
          // pero no es un comando dentro de otro: no cuenta para la profundidad, y
          // tiene su propio tope.
          const encadenado = ES_EVAL.test(nombre) && ES_EVAL.test(p[1] ?? '')
          const adentroDe = encadenado ? nivel : nivel + 1
          const evalsAdentro = encadenado ? evals + 1 : 0
          const motivo = 'una funcion (o un guion leido con `source`) puede terminar antes, con `return`'
          if (nivel >= PROFUNDIDAD_MAXIMA || evalsAdentro >= EVALS_ENCADENADOS || lectura.quedan <= 0) {
            yield* sinLeerEn(aqui)
          } else if (comparte === 'si' && !contexto.quiza) {
            entrarEnLista(antes)
            const previo = trasEl === '||' ? copiaDe(aqui) : null
            if (marco) lectura.retornos.push([])
            yield* comandosDe(anidado.comando, aqui.carpeta, anidado.shell, adentroDe, { estado: aqui, lectura, evals: evalsAdentro })
            const salidas = marco ? lectura.retornos.pop() : []
            if (salidas.length) unoDeVariosEn(aqui, [copiaDe(aqui), ...salidas], motivo)
            if (previo && !mismoLugar(aqui, previo)) siFallo = previo
          } else {
            const adentro = copiaDe(aqui)
            // Un `return` de adentro no sale de lo que se esta leyendo aca.
            lectura.retornos.push([])
            yield* enOtroAmbito(lectura, comparte, () => comandosDe(anidado.comando, aqui.carpeta, anidado.shell, adentroDe, { estado: adentro, lectura, evals: evalsAdentro }))
            const salidas = lectura.retornos.pop()
            if (marco && salidas.length) unoDeVariosEn(adentro, [copiaDe(adentro), ...salidas], motivo)
            // Puede correr o no (`quiza`), o quedar o no segun el shell ('depende'):
            // la carpeta es la de antes o la de despues.
            if (comparte !== 'no' && !mismoEstado(adentro, aqui)) unoDeVariosEn(e, [copiaDe(e), adentro], comparte === 'depende' ? `\`${nombre}\` cierra una tuberia, y que su \`cd\` quede o no depende del shell` : `\`${nombre}\` puede no correr, y cambia de carpeta`)
          }
        }

        // Una funcion definida antes en el mismo comando: llamarla es correr su
        // cuerpo. (`builtin x` y `command x` saltean las funciones, y el encabezado
        // de otra definicion con el mismo nombre no es una llamada.)
        const funcion = shell === 'bash' && !pieza.esArgumento && !pieza.defineFuncion && !contexto.envoltorios.includes('builtin') && !contexto.envoltorios.includes('command') ? lectura.funciones.get(p[0]) : undefined
        if (funcion) {
          const llamada = p[0]
          const comparte = correAca(contexto)
          const conocidos = funcion.cuerpos.filter((cuerpo) => cuerpo != null)
          // Cada cuerpo, con los argumentos de esta llamada puestos. Si alguno los
          // usa de una forma que no se sigue, se leen como estan escritos.
          const puestos = conocidos.map((cuerpo) => conArgumentos(cuerpo, p.slice(1)))
          const completo = puestos.every((puesto) => puesto.completo)
          const lecturas = completo ? [...new Set(puestos.flatMap((puesto) => puesto.lecturas))] : conocidos
          // Con una sola definicion segura, llamarla es correr ese cuerpo, aca. Si
          // no (definida dentro de un `if`, tras un `&&` o redefinida asi, o si
          // bash y zsh leen distinto sus argumentos), puede correr cualquiera de
          // sus lecturas, o el comando de siempre: se leen todas, como algo que
          // puede no correr.
          const segura = funcion.cierta && conocidos.length === 1 && funcion.cuerpos.length === 1 && lecturas.length === 1
          if (!segura) contexto.quiza = true
          // `f >/no/existe/x`: si falla su redireccion, la funcion no corre.
          if (redireccionDudosa(contexto.texto ?? '')) contexto.quiza = true
          if (lectura.enCurso.has(llamada)) {
            // Se llama a si misma: lo que hace esa otra vuelta no se sigue.
            if (funcion.mueve && comparte !== 'no') dudar(aqui, `la funcion \`${llamada}\` se llama a si misma y cambia de carpeta`)
          } else {
            lectura.enCurso.add(llamada)
            for (const cuerpo of lecturas) yield* leerAdentro({ comando: cuerpo, shell }, comparte, llamada, { marco: true })
            lectura.enCurso.delete(llamada)
          }
          const desconocido = conocidos.length < funcion.cuerpos.length
          if (desconocido && funcion.mueve && comparte !== 'no') dudar(aqui, `la funcion \`${llamada}\` cambia de carpeta y no se pudo seguir`)
          // Una funcion llamada `git` suele envolver al programa: si su cuerpo no
          // se pudo leer entero con estos argumentos, el comando se lee tal cual.
          // De las demas, si usa sus argumentos, lo que sigue a su nombre puede
          // ser un comando: es un envoltorio mas.
          // Si no es seguro cual corre, y se llama como uno de los comandos que se
          // leen (`eval`, `cd`, `bash`...), puede ser ese mismo comando.
          // Si los usa de una forma que no se sigue, y lo que se le pasa habla de
          // un push (`g() { cd "$1"; shift; "$@"; }; g x git push origin main`), se pregunta.
          if (!completo && /push|send-pack/i.test(p.slice(1).join(' '))) yield* sinLeerEn(aqui)
          if (((ES_GIT.test(llamada) || ES_GH.test(llamada)) && !(segura && completo)) || (!segura && seLee(llamada))) p = [...p]
          else if (desconocido || (!completo && conocidos.some((cuerpo) => USA_SUS_ARGUMENTOS.test(cuerpo)))) {
            // (`g X=1 cd x` busca un comando llamado `X=1`: ese `cd` puede no correr.)
            if (ASIGNACION.test(p[1] ?? '') || PALABRAS_DE_CONTROL.has(p[1])) contexto.quiza = true
            const resto = comandoEfectivo(p.slice(1))
            p = resto.p
            contexto.envoltorios = [...contexto.envoltorios, ...resto.envoltorios]
          } else {
            // El cuerpo ya se leyo con estos argumentos puestos. Si los usa, lo que
            // sigue al nombre se lee ademas como un comando, por si el cuerpo lo
            // corre de una forma que este hook no lee (`op run -- "$@"`, `ssh
            // host "$@"`): solo para ver sus pushes, sobre una copia de la carpeta
            // que dejo el cuerpo, sin que sus `cd` cuenten.
            if (p.length > 1 && conocidos.some((cuerpo) => USA_SUS_ARGUMENTOS.test(cuerpo))) {
              if (nivel + 1 >= PROFUNDIDAD_MAXIMA || lectura.quedan <= 0) {
                if (/push|send-pack/i.test(p.slice(1).join(' '))) yield* sinLeerEn(aqui)
              } else {
                const copia = copiaDe(aqui)
                lectura.retornos.push([])
                yield* enOtroAmbito(lectura, 'no', () => comandosDe(p.slice(1).map(citarParaShell).join(' '), copia.carpeta, shell, nivel + 1, { estado: copia, lectura }))
                lectura.retornos.pop()
              }
            }
            p = []
          }
        }

        const nombre = p[0] ?? ''
        const anidado = comandoAnidado(p, shell)
        // Un alias definido antes en el mismo comando: zsh lo expande (en las
        // lineas que siguen), bash no. Se lee la expansion, como algo que puede no
        // correr, y despues el comando como esta.
        if (shell === 'bash' && lectura.alias.has(nombre) && !lectura.enCurso.has(`alias ${nombre}`)) {
          contexto.quiza = true
          lectura.enCurso.add(`alias ${nombre}`)
          yield* leerAdentro({ comando: [lectura.alias.get(nombre), ...p.slice(1)].join(' '), shell }, 'si', nombre)
          lectura.enCurso.delete(`alias ${nombre}`)
        }
        // Un shell sin `-c` ni archivo lee su guion de la entrada: un heredoc
        // (`bash <<EOF`), un here-string (`bash <<< '...'`) o lo que le pasa el
        // comando anterior (`cat <<EOF | sh`, `echo "..." | bash`). `source
        // /dev/stdin` lo lee en este mismo shell.
        // (La palabra de un here-string no es el archivo de un guion.)
        const hereString = shell === 'bash' ? palabras(pieza.texto.match(/<<<\s*([\s\S]*)$/)?.[1] ?? '', shell).slice(0, 1) : []
        const leeLaEntrada = shell === 'bash' && !anidado && ((ES_SHELL.test(nombre) && !tieneGuion(p.filter((palabra) => palabra !== hereString[0]))) || (/^(source|\.)$/.test(nombre) && p[1] === '/dev/stdin'))
        if (ES_CD.test(nombre) || ES_PUSHD.test(nombre) || ES_POPD.test(nombre)) {
          if (leido.repite) {
            // `repeat 3 cd ..` sube tres carpetas en zsh, y en bash no corre.
            dudar(e, `\`repeat\` repite ese \`${nombre}\`, y solo existe en zsh`)
            return
          }
          // `cd x && a; b`: si ese cd puede fallar (la carpeta no existe), `a` corre
          // solo si no fallo, y `b` corre igual: tambien es una lista condicional.
          if (trasEl === '&&' && puedeFallar(e, p, shell, lectura.creadas) && regiones.at(-1)?.tipo !== 'lista') entrar('lista')
          entrarEnLista(antes)
          const previo = trasEl === '||' ? copiaDe(e) : null
          if (cambiarDeCarpeta(e, p, contexto) && previo) siFallo = previo
        } else if (leeLaEntrada) {
          // Cada texto posible es un guion entero; si hay mas de uno, cualquiera puede ser el que corre.
          const guiones = suEntrada()
          // `source /dev/stdin < <(echo cd x)`: lo que lee no se ve, y corre aca.
          if (guiones.ilegible && /^(source|\.)$/.test(nombre) && correAca(contexto) !== 'no') {
            dudar(e, `lo que lee \`${nombre}\` sale de un archivo o de lo que imprime otro comando`)
            if (/push|send-pack/i.test(texto.slice(pieza.desde, piezas[ABRE.has(pieza.corte) ? (finDelComando(k) ?? termina) : termina].hasta))) yield* sinLeerEn(aqui)
          }
          if (guiones.length > 1) contexto.quiza = true
          for (const guion of guiones) yield* leerAdentro({ comando: guion, shell: 'bash' }, ES_SHELL.test(nombre) ? 'no' : correAca(contexto), nombre, { marco: !ES_SHELL.test(nombre) })
        } else if (nombre === 'trap' && shell === 'bash') {
          // `trap 'accion' SENAL`: la accion corre mas tarde, donde se este entonces.
          const operandos = p.slice(1).filter((x) => !/^-[lp-]*$/.test(x))
          if (operandos.length > 1 && operandos[0] !== '-' && operandos[0] !== '') {
            const adentro = copiaDe(aqui)
            dudar(adentro, 'la accion de un `trap` corre mas tarde, donde se este entonces')
            const antesDeLeerla = copiaDe(adentro)
            yield* enOtroAmbito(lectura, 'si', () => comandosDe(operandos[0], adentro.carpeta, shell, nivel + 1, { estado: adentro, lectura }))
            // Y si cambia de carpeta, puede hacerlo antes de lo que sigue: con
            // DEBUG, ERR o RETURN en cualquier momento, y en zsh la de EXIT puesta
            // dentro de una funcion corre al salir de ella.
            if (!mismoEstado(adentro, antesDeLeerla)) dudar(e, 'la accion de un `trap` cambia de carpeta, y puede correr antes de lo que sigue')
          }
        } else if (shell === 'bash' && /^(return|exit)$/.test(nombre)) {
          // Lo que sigue a un `return` (o a un `exit`) puede no correr: el estado de
          // ahora es una de las salidas posibles de la funcion o del guion.
          lectura.retornos.at(-1)?.push(copiaDe(aqui))
        } else if (shell === 'bash' && /^(break|continue)$/.test(nombre)) {
          // Y lo que sigue a un `break` o a un `continue`, en el bucle.
          const bucle = regiones.findLast((region) => region.bucle)
          if (bucle) bucle.salidas.push(copiaDe(aqui))
          else lectura.retornos.at(-1)?.push(copiaDe(aqui))
        } else if (shell === 'bash' && (nombre === 'unset' || nombre === 'unfunction')) {
          // `unset -f f` borra la funcion: llamarla ya no corre su cuerpo.
          // `unfunction f` la borra solo en zsh, y `unset f` a secas solo en bash
          // (si no hay una variable f): despues, puede seguir definida o no.
          const borra = nombre === 'unset' && p.includes('-f')
          for (const arg of p.slice(1)) {
            if (arg.startsWith('-') || !lectura.funciones.has(arg)) continue
            if (borra) lectura.funciones.delete(arg)
            else lectura.funciones.set(arg, { ...lectura.funciones.get(arg), cierta: false })
          }
        } else if (shell === 'bash' && nombre === 'alias') {
          for (const arg of p.slice(1)) {
            const definicion = arg.match(/^([^=\s]+)=([\s\S]*)$/)
            if (definicion && lectura.alias.size < MAX_CARPETAS_CREADAS) lectura.alias.set(definicion[1], definicion[2])
          }
        } else if (nombre === 'dirs' && p.includes('-c')) {
          // `dirs -c` vacia la pila: el `popd` que siga no vuelve a ningun lado.
          if (correAca(contexto) !== 'no') e.pila = []
        } else {
          // (Hasta el final del comando, con las expresiones que lo cortan: `source <(...)`.)
          const tramo = texto.slice(pieza.desde, piezas[ABRE.has(pieza.corte) ? (finDelComando(k) ?? termina) : termina].hasta)
          // Lo que corre sale de una variable o de lo que imprime otro comando
          // (`eval "$(...)"`, `$(echo cd) x`, `source <(...)`): puede ser un `cd` o
          // un push que el texto no muestra.
          // (Tambien `source =(...)`, de zsh, y un comando que sale de una expansion
          // y puede ser un `cd`: `${X:-cd} x`, `{cd,} x`.)
          const oculto = (anidado && ES_EVAL.test(nombre) && /[$`]/.test(anidado.comando)) || /^(\$\(|`)/.test(nombre) || (shell === 'bash' && /^(source|\.)$/.test(nombre) && /<\(|=\(|[$`]/.test(tramo)) || (shell === 'bash' && /[$`{]/.test(nombre) && /(^|[^A-Za-z])(cd|pushd|popd|chdir|source)([^A-Za-z]|$)/.test(nombre))
          if (oculto) {
            if (/\$\{?[A-Za-z_]|\b(cd|pushd|popd|source|eval)\b/.test(anidado?.comando ?? tramo) && correAca(contexto) !== 'no') dudar(e, `lo que corre \`${nombre}\` sale de una variable o de lo que imprime otro comando`)
            if (/push|send-pack/i.test(tramo)) yield* sinLeerEn(aqui)
          }
          if (anidado) yield* leerAdentro(anidado, ES_EVAL.test(nombre) ? correAca(contexto) : 'no', nombre)
          else if (p.length && !pieza.defineFuncion) {
            // `mkdir build`: esa carpeta va a existir cuando corra lo que sigue.
            if (/^(mkdir|md)$/i.test(nombre) && !aqui.duda && lectura.creadas.size < MAX_CARPETAS_CREADAS) {
              // Sin `-p`, mkdir no crea las carpetas de arriba; y falla si ya hay un
              // archivo con ese nombre.
              const conPadres = /^md$/i.test(nombre) || p.some((x) => /^-[a-zA-Z]*p/.test(x) || x === '--parents')
              for (let j = 1; j < p.length; j++) {
                if (/^(-m|--mode)$/.test(p[j])) j++
                if (j >= p.length || p[j].startsWith('-') || DINAMICO_EN_RUTA.test(p[j])) continue
                const ruta = path.resolve(aqui.carpeta, rutaExpandida(p[j]))
                if (fs.existsSync(ruta) && !esCarpeta(ruta)) continue
                if (!conPadres && !esCarpeta(path.dirname(ruta)) && !seCrea(lectura.creadas, path.dirname(ruta))) continue
                lectura.creadas.add(ruta)
              }
            }
            // `GIT_DIR=x git push`: el repo no lo dice la carpeta.
            const otroRepo = shell === 'bash' && ES_GIT.test(nombre) && /(^|[\s;&|(])GIT_(DIR|WORK_TREE)=/.test(tramo)
            yield { p, viaXargs, ...lugarDe(aqui), sinCrear: aqui.imposible || aqui.cambios === 0, ...(otroRepo && { otroRepo }) }
            lectura.corrieron++
          }
        }
      }
      if (termina === k) yield* correr(antes)
      else {
        const antesDelComando = antes
        pendientes.set(termina, () => correr(antesDelComando))
      }

      if (llaveSuelta) dudar(e, 'una llave que cierra pegada a un comando: bash y zsh la leen distinto')
      if (cuerpoSuelto) cerrar(['funcion'], pieza)
      if (shell === 'powershell' && llaves === 0) cerrarHasta('llaves')
    }
    // Una lista mandada al fondo: en bash corre entera en un subshell y su `cd`
    // no queda; en zsh, solo su ultima tuberia, y el `cd` de antes queda.
    if (pieza.corte === '&' && shell === 'bash') {
      while (regiones.at(-1)?.tipo === 'lista') regiones.pop()
      const [inicio, tuberia] = [inicios.get(nivelDeLista()), tuberias.get(nivelDeLista())]
      if (inicio && tuberia) {
        // Lo mismo las funciones que esa lista definio: en bash no quedan definidas.
        for (const nombre of lectura.definidas.slice(inicio.definidas)) if (lectura.funciones.has(nombre)) lectura.funciones.set(nombre, { ...lectura.funciones.get(nombre), cierta: false })
        const { definidas: _, ...estadoAlEmpezar } = inicio
        unoUOtro(estadoAlEmpezar, tuberia, 'que quede el `cd` de una lista mandada al fondo depende del shell', tuberia.cambios - inicio.cambios === 1)
      }
    }
    if (shell === 'bash') {
      if (ABRE.has(pieza.corte)) {
        if (esperaCuerpo != null && pieza.corte === '(' && !pieza.texto.trim()) {
          // `f() ( ... )`: el cuerpo es un subshell, y su `cd` termina con el.
          const cierre = cierreDe.get(k)
          const cierta = !esperaCuerpo.dudosa && regiones.every((otra) => otra.tipo === 'grupo' && !otra.trasTuberia)
          definir(esperaCuerpo.nombres, { cuerpo: cierre != null ? texto.slice(pieza.hasta, piezas[cierre].hasta + 1) : null, cierta, mueve: false })
          esperaCuerpo = null
        }
        // Lo que se define adentro (funciones incluidas) termina con el subshell.
        ambitos.push({ e, regiones, esperaCuerpo, inicios, tuberias, funciones: lectura.funciones, alias: lectura.alias })
        e = copiaDe(e)
        regiones = []
        inicios = new Map()
        tuberias = new Map()
        lectura.funciones = new Map(lectura.funciones)
        lectura.alias = new Map(lectura.alias)
      } else if (CIERRA.has(pieza.corte) && ambitos.length) {
        let funciones
        let alias
        ;({ e, regiones, esperaCuerpo, inicios, tuberias, funciones, alias } = ambitos.pop())
        lectura.funciones = funciones
        lectura.alias = alias
      }
    }
    antes = pieza.corte
  }

  // Fin del texto. Lo que quedo abierto y podia no correr termina aca: importa
  // cuando el estado es de quien llamo (un `eval`, una funcion).
  if (ambitos.length) {
    ;({ e, regiones } = ambitos[0])
    lectura.funciones = ambitos[0].funciones
    lectura.alias = ambitos[0].alias
  }
  while (regiones.length) salirDe(regiones.pop())
  // Algo no se pudo leer con certeza y el texto habla de un push: se pregunta.
  if (sinLeerDesde !== -1 && /push|send-pack/i.test(texto)) yield* sinLeerEn(e)
}

// Cada `git push` del comando, con la carpeta efectiva en la que corre (el cwd
// mas los cd y -C previos) y sus argumentos: sin `git`, sus opciones globales
// ni `push`. `incierto` lleva el motivo cuando el texto no alcanza para saber
// que se sube (xargs, un alias de git definido en la misma linea, un programa
// que lo lanza); `duda`, cuando no alcanza para saber en que carpeta corre.
function* pushes(comando, cwd, shell = 'bash') {
  const lectura = nuevaLectura()
  // Donde evaluar un push cuya carpeta todavia no existe. Si el mismo comando la
  // crea con `mkdir`, es del repo en el que la crea: su ancestro mas cercano. Si
  // antes corre otra cosa que pudo crearla (`git clone`, `git worktree add`, un
  // script), no se sabe que repo habra ahi: queda en duda. Y si antes no corre
  // nada, no puede existir: ahi el push no llega a correr (`sinCrear`: a esa
  // carpeta se llego sin que nada pudiera crearla, o es la de la sesion). Como
  // carpeta alternativa, una que no existe no cuenta.
  const donde = (ruta) => (esCarpeta(ruta) ? ruta : seCrea(lectura.creadas, ruta) ? laQueExiste(ruta) : null)
  // `GIT_DIR=...`, `export GIT_WORK_TREE=...`: el repo no lo dice la carpeta.
  const fijaElRepo = shell === 'bash' && /(^|[\s;&|(`])(export\s+|env\s+(-\S+\s+)*)?GIT_(DIR|WORK_TREE)=/.test(comando)
  // La configuracion de git que decide a donde va un push (el remoto, su URL, el
  // refspec por defecto, push.default, el upstream) cambiada en el mismo
  // comando: con `-c`, con `GIT_CONFIG_*`, o con un `git config`, `git remote
  // add` o `git branch -u` que corre antes. Lo que dice ahora el repo ya no vale.
  const configPorEntorno = /(^|[\s;&|(`])(export\s+|env\s+(-\S+\s+)*)?GIT_CONFIG(_[A-Z0-9_]+)?=/.test(comando)
  let configCambiada = false
  // Un alias de git definido en el mismo comando (`git config alias.p push`):
  // cualquier subcomando puede ser un push.
  // (Se mira una sola vez: repetirlo por cada comando leido costaba el largo del
  // texto entero cada vez.)
  const hablaDePush = /push|send-pack/i.test(comando)
  const aliasEnElComando = /\balias\./i.test(comando) && hablaDePush
  let configDelPush = false
  // La rama en la que queda el repo si el mismo comando cambia de rama antes del
  // push (`git checkout main && git push`): la actual se lee de git antes de que
  // el comando corra, y ya no es la que sube. `{ nombre, creada }`; nombre null
  // si no se sabe cual queda (`git checkout -`, `gh pr checkout`).
  let cambioDeRama
  // Lo que cambia la carpeta de una forma que este hook no sigue (un `trap`, una
  // funcion que el shell corre solo, una opcion de `cd`...): ningun push del
  // comando tiene una carpeta segura.
  const sinModelo = SIN_MODELO.find(([forma]) => forma.test(comando))?.[1] ?? null
  // PowerShell: un alias, una funcion que pasa `@args` o un bloque armado como
  // texto pueden correr un push que no se lee.
  if (shell === 'powershell' && hablaDePush && /\b(set-alias|new-alias|sal|nal)\b|@args\b|\[scriptblock\]|::create\s*\(|&\s*[($]/i.test(comando)) {
    yield { dir: cwd, args: [], incierto: 'un alias, una funcion o un bloque de PowerShell pueden correr un push que no se lee del texto', duda: null, alternativa: null }
  }
  for (const { p: leidas, viaXargs, carpeta, duda: dudaLeida, alternativa: otraPrevia, sinCrear, otroRepo: otroRepoPrevio } of comandosDe(comando, cwd, shell, 0, { lectura })) {
    let p = leidas
    let dudaPrevia = dudaLeida
    configDelPush = configPorEntorno || configCambiada
    const evaluable = (push) => {
      push = { ...push, args: argumentosDelPush(push.args ?? []), ...(configDelPush && { configDelPush }), ...(cambioDeRama && { ramaActual: cambioDeRama }) }
      let { duda, alternativa } = push
      alternativa = alternativa == null ? null : donde(alternativa)
      if (sinModelo) {
        duda ??= dudaDeCarpeta(sinModelo)
        alternativa = null
      }
      const dir = donde(push.dir)
      if (dir == null && (donde(carpeta) == null ? !sinCrear : lectura.corrieron > 0)) {
        duda ??= dudaDeCarpeta(`la carpeta ${push.dir} todavia no existe, y no se sabe que repo habra ahi cuando corra`)
        alternativa = null
      }
      return { ...push, dir: dir ?? push.dir, duda, alternativa }
    }
    if (ES_LANZADOR.test(p[0])) {
      // `start git push origin main`, `Start-Process git -ArgumentList push,origin,main`:
      // lo que se alcanza a leer decide si toca main; el resto se pregunta.
      const lanzado = pushLanzado(p.slice(1))
      if (lanzado) yield evaluable({ dir: carpeta, args: lanzado, incierto: `lo lanza \`${p[0]}\`, que no deja leer sus argumentos con certeza`, duda: dudaPrevia, alternativa: otraPrevia })
      continue
    }
    // zsh: `=git` es la ruta de `git`.
    if (shell === 'bash' && /^=[^=]/.test(p[0] ?? '') && ES_GIT.test(p[0].slice(1))) p = [p[0].slice(1), ...p.slice(1)]
    // Un push que no esta donde se lo busca: dentro de otro comando (se lee desde
    // ahi), detras de un programa que sale de una variable, o escrito en un
    // argumento que el programa puede correr (se pregunta).
    if (ES_GH.test(p[0] ?? '') && p[1] === 'pr' && p[2] === 'checkout') cambioDeRama = { nombre: null, creada: false }
    const adentro = pushDentroDe(p, hablaDePush, shell)
    if (adentro?.incierto) {
      yield evaluable({ dir: carpeta, args: [], incierto: adentro.incierto, duda: dudaPrevia, alternativa: otraPrevia })
      continue
    }
    if (adentro) {
      p = p.slice(adentro.desde)
      if (adentro.otraCarpeta) dudaPrevia ??= dudaDeCarpeta(adentro.otraCarpeta)
    }
    if (!ES_GIT.test(p[0])) continue

    let i = 1
    let dir = carpeta
    let duda = dudaPrevia
    let alternativa = otraPrevia
    let alias = false
    let otroRepo = fijaElRepo || otroRepoPrevio === true
    while (i < p.length && p[i].startsWith('-')) {
      if (p[i] === '-C') {
        const destino = p[i + 1] ?? '.'
        const expandida = rutaExpandida(destino)
        const ruta = path.resolve(dir, expandida)
        if (DINAMICO_EN_RUTA.test(expandida) && !esCarpeta(ruta)) {
          // Con una duda anterior ya no hay una sola carpeta alternativa que seguir.
          alternativa = duda ? null : enElProyecto(destino)
          duda ??= dudaDeCarpeta(`la ruta de \`git -C ${destino}\` se resuelve recien al ejecutar`)
        } else {
          // Una ruta absoluta no depende de donde se este.
          if (path.isAbsolute(expandida)) duda = null
          alternativa = duda && alternativa ? path.resolve(alternativa, expandida) : null
          dir = ruta
        }
        i += 2
      } else if (['-c', '--git-dir', '--work-tree', '--namespace', '--config-env'].includes(p[i])) {
        const clave = p[i] === '-c' || p[i] === '--config-env' ? (p[i + 1] ?? '') : ''
        if (/^alias\./i.test(clave)) alias = true
        if (CONFIG_DEL_PUSH.test(clave)) configDelPush = true
        if (p[i] === '--git-dir' || p[i] === '--work-tree') otroRepo = true
        i += 2
      } else {
        if (/^--(git-dir|work-tree)=/.test(p[i])) otroRepo = true
        const clave = p[i].match(/^--config-env=([\s\S]*)$/)?.[1] ?? ''
        if (/^alias\./i.test(clave)) alias = true
        if (CONFIG_DEL_PUSH.test(clave)) configDelPush = true
        i += 1
      }
    }
    // Con `--git-dir`, `--work-tree` o `GIT_DIR`, el repo no lo dice la carpeta.
    if (otroRepo) {
      duda ??= dudaDeCarpeta('el repo lo fija `--git-dir`, `--work-tree` o `GIT_DIR`, no la carpeta')
      alternativa = null
    }
    // PowerShell: `git @('push','origin','main')` pasa los argumentos en un arreglo.
    const arreglo = shell === 'powershell' && /^@?\(/.test(p[i] ?? '') ? p[i].replace(/^@?\(\s*|\s*\)$/g, '').split(',').map((x) => x.trim().replace(/^(['"])(.*)\1$/, '$2')) : null
    if (arreglo && arreglo[0] === 'push' && arreglo.every((x) => x && !/[$()@]/.test(x))) {
      yield evaluable({ dir, args: [...arreglo.slice(1), ...p.slice(i + 1)], incierto: viaXargs ? 'sus argumentos llegan por xargs' : null, duda, alternativa })
      continue
    }
    if (p[i] !== 'push') {
      // Lo que cambia, para los pushes que siguen, a donde van.
      if (cambiaLaConfigDelPush(p[i], p.slice(i + 1))) configCambiada = true
      const deja = ramaQueDeja(p[i], p.slice(i + 1))
      if (deja) cambioDeRama = deja
      // `git send-pack <remoto> <ref>...` es la forma interna de `git push`: se lee
      // igual, y se pregunta si no toca main.
      if (p[i] === 'send-pack') yield evaluable({ dir, args: p.slice(i + 1), incierto: 'usa `git send-pack`, la forma interna de `git push`', duda, alternativa })
      // `git -c alias.p=push p origin main`, `git config alias.p push && git p
      // origin main`: el subcomando real no se ve.
      else if (alias || aliasEnElComando) yield evaluable({ dir, args: [], incierto: 'usa un alias de git definido en el mismo comando', duda, alternativa })
      // `git $SUB origin main`, `git {push,} ...`: el subcomando sale de una
      // expansion, y puede ser `push` si el comando habla de uno (sin eso, `for c
      // in status log; do git $c; done` no tiene por que preguntar).
      else if (p[i] != null && (/[$`{}*?[\\]/.test(p[i]) || EXPRESION.test(p[i]) || p[i] === EXPRESION_SIN_LEER || (shell === 'powershell' && /^@/.test(p[i]))) && hablaDePush) yield evaluable({ dir, args: p.slice(i + 1), incierto: `el subcomando de git (\`${p[i]}\`) se resuelve recien al ejecutar`, duda, alternativa })
      continue
    }
    yield evaluable({ dir, args: p.slice(i + 1), incierto: viaXargs ? 'sus argumentos llegan por xargs' : null, duda, alternativa })
  }
}

// Lo que cambia la carpeta, o el `cd` mismo, de una forma que este hook no sigue.
const SIN_MODELO = [
  [/\btrap\b[^;\n]*\b(cd|pushd|popd|source|eval)\b/, 'un `trap` cuya accion cambia de carpeta puede correr en cualquier momento'],
  [/\b(chpwd|precmd|preexec|zshexit|periodic|zshaddhistory|TRAP[A-Z]+|command_not_found_handler?)\b/, 'una funcion que el shell corre solo (`chpwd`, `TRAPEXIT`, `command_not_found_handler`...)'],
  [/\b(auto_?pushd|pushd_?(ignore_?dups|minus|silent|to_?home)|cdable_?vars|auto_?cd|chase_?(links|dots)|posix_?cd)\b|\bset\s+-[a-zA-Z]*P\b|\bset\s+-o\s+physical\b/i, 'una opcion del shell que cambia como se mueven `cd` y `pushd`'],
  [/(^|[;&|({\n])\s*(builtin\s+)?(disable|enable\s+-n|unhash)\s/, 'deshabilita comandos o funciones del shell'],
  [/\b(functions|builtins|aliases|galiases|dirstack|DIRSTACK|cdpath|CDPATH)(\[[^\]]*\])?\+?=|\bOLDPWD\b/, 'cambia la pila de carpetas, la carpeta anterior, `cdpath` o una tabla del shell'],
  [/(^|[;&|({\n])\s*(function\s*)?\(\s*\)\s*\{|(^|[;&|({\n])\s*function\s*\{|\bfunction\s+[^\s(){};&|]+\s+[^\s(){};&|]+\s*(\(\s*\)\s*)?\{/, 'una funcion anonima de zsh, o una definicion de varias funciones a la vez'],
  [/\b(ZDOTDIR|BASH_ENV|ENV)=|\.(zshenv|zshrc|zprofile|zlogin|bashrc|bash_profile|bash_login|profile)\b/, 'un archivo de inicio que otro shell lee antes del comando'],
  [/\bchmod\s+(-\S+\s+)*([0-7]?[0246][0-7]{2}\b|\S*-\S*x)|\bmkdir\b[^;&|\n]*\s(-m|--mode)\b|\bln\s+(-\S+\s+)*-[a-zA-Z]*s/, 'cambia permisos de carpetas o crea enlaces simbolicos'],
]

// Comandos que nombran un `git push` sin correrlo: lo imprimen, lo buscan o lo
// guardan como texto. Y los subcomandos de git que no corren otros comandos
// (`git commit -m "... git push ..."` es texto).
const SOLO_LO_NOMBRAN = /^(echo|printf|print|cat|less|more|head|tail|wc|grep|egrep|fgrep|rg|ag|ack|gh|man|help|type|which|whence|true|false|:|test|\[|\[\[)$/
const SUBCOMANDOS_DE_TEXTO = new Set(['commit', 'tag', 'log', 'show', 'notes', 'grep', 'stash', 'diff', 'blame', 'status', 'add', 'rm', 'mv', 'restore', 'reset', 'fetch', 'pull', 'merge', 'cherry-pick', 'revert', 'describe', 'shortlog', 'reflog', 'ls-files', 'ls-remote', 'rev-parse', 'rev-list', 'clone', 'init', 'remote', 'branch', 'checkout', 'switch', 'help', 'version', 'config'])
// Algo que corre codigo aunque el comando solo imprima: `*(e:'...')` y `${(e)x}`, de zsh.
const CORRE_CODIGO = /\((e|\+)[:'"]|\$\{\([A-Za-z@:#%=~^]*e[A-Za-z@:#%=~^]*\)/
// Una palabra que trae escrito un `git ... push` (dos busquedas sueltas: una
// sola expresion con `git.*push` costaba el cuadrado del largo de la palabra).
const traeUnPush = (w) => /\b(push|send-pack)\b/.test(w) && /\bgit\b/.test(w)

// Donde empieza el subcomando del `git` que esta en `desde`, tras sus opciones
// (`-C x`, `-c k=v`...).
function indiceDelSubcomando(p, desde = 0) {
  let i = desde + 1
  while (i < p.length && p[i].startsWith('-')) i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix'].includes(p[i]) ? 2 : 1
  return i
}
const esUnPush = (p, desde = 0) => ES_GIT.test(p[desde] ?? '') && ['push', 'send-pack'].includes(p[indiceDelSubcomando(p, desde)])

// Un push que no esta donde se lo busca. `{ desde }`: `git ... push` aparece mas
// adelante, como palabras sueltas (`caffeinate -i git push`, `find . -exec git
// push ... \;`, `exec -a x git push`), y se lee desde ahi. `{ incierto }`: el
// programa sale de una variable, o un argumento trae un push escrito que el
// programa puede correr (`perl -e`, `git rebase -x`).
function pushDentroDe(p, hablaDePush, shell = 'bash') {
  if (!p.length || esUnPush(p)) return null
  const nombre = p[0]
  const desde = ES_GIT.test(nombre) ? indiceDelSubcomando(p) : 0
  const soloTexto = ES_GIT.test(nombre) ? SUBCOMANDOS_DE_TEXTO.has(p[desde]) : SOLO_LO_NOMBRAN.test(nombre)
  if (soloTexto && !p.some((w) => CORRE_CODIGO.test(w))) return null
  for (let k = desde + 1; k < p.length; k++) {
    if (esUnPush(p, k)) {
      const otraCarpeta = p.slice(0, k).some((w) => w === '-execdir' || w === 'foreach') ? `\`${nombre}\` lo corre en otra carpeta` : null
      return { desde: k, otraCarpeta }
    }
  }
  if (!hablaDePush) return null
  // (En PowerShell una variable sola no corre nada, salvo con `&`: alli cuenta si
  // lo que sigue nombra el push, como en `& $g push origin main`.)
  const loNombra = shell !== 'powershell' || p.slice(1).some((w) => /\bpush\b|send-pack/i.test(w))
  // (`$@` o `$1` como programa son los argumentos de una funcion, que se leen al
  // llamarla; y un comodin suelto suele ser el patron de un `case`.)
  const variable = /[$`]/.test(nombre) && !/^\$\{?[@*#0-9]/.test(nombre)
  if (loNombra && (variable || EXPRESION.test(nombre) || /^\{.*,.*\}$/.test(nombre))) return { incierto: `el programa que corre (\`${nombre}\`) se resuelve recien al ejecutar, y el comando habla de un push` }
  if (p.slice(desde + 1).some((w) => traeUnPush(w) || CORRE_CODIGO.test(w))) {
    return { incierto: `\`${desde ? `git ${p[desde]}` : nombre}\` recibe un texto con un push adentro, y puede correrlo` }
  }
  return null
}

// `B=$(git branch --show-current) && git push origin "$B"`: una variable que se
// asigna una sola vez con la rama actual, y que nada mas toca, es HEAD.
function variablesDeLaRamaActual(comando) {
  const nombres = new Set()
  const asignacion = new RegExp(String.raw`(?:^|[\s;&|(])([A-Za-z_]\w*)=(["']?)(?:\$\(\s*${NOMBRE_DE_LA_RAMA_ACTUAL}\s*\)|` + '`\\s*' + NOMBRE_DE_LA_RAMA_ACTUAL + '\\s*`' + String.raw`)\2(?=$|[\s;&|)])`, 'g')
  for (const m of comando.matchAll(asignacion)) nombres.add(m[1])
  for (const nombre of nombres) {
    let escrituras = 0
    for (const m of comando.matchAll(new RegExp(String.raw`(\$\{|\$)?\b${nombre}\b(\})?`, 'g'))) {
      if (!m[1]) escrituras++
      else if (m[1] === '${' && !m[2]) escrituras = Infinity
    }
    if (escrituras !== 1) nombres.delete(nombre)
  }
  return nombres
}

// La rama en la que deja el repo un `git checkout`, `git switch` o `git branch
// -m`: `{ nombre, creada }`, con nombre null si no se sabe (`-`, un commit
// suelto, una expresion); o null si no cambia de rama (`git checkout -- x`).
function ramaQueDeja(subcomando, args) {
  const literal = (x) => (x == null || x === '-' || x.startsWith('-') || DINAMICO.test(x) || EXPRESION.test(x) ? null : x)
  if (subcomando === 'switch' || subcomando === 'checkout') {
    if (args.includes('--') || args.some((a) => /^(-p|--patch|--pathspec-from-file(=|$))/.test(a))) return null
    if (args.includes('-')) return { nombre: null, creada: false }
    const crea = args.findIndex((a) => /^(-[bBcC]|--create|--force-create|--orphan)$/.test(a))
    if (crea !== -1) return { nombre: literal(args[crea + 1]), creada: true }
    if (args.some((a) => a === '--detach' || (subcomando === 'switch' && a === '-d'))) return { nombre: null, creada: false }
    const posicionales = args.filter((a) => !a.startsWith('-'))
    if (posicionales.length !== 1 || (subcomando === 'checkout' && posicionales[0] === '.')) return null
    return { nombre: literal(posicionales[0]), creada: false }
  }
  if (subcomando === 'branch' && args.some((a) => /^(-[mM]|--move)$/.test(a))) {
    const posicionales = args.filter((a) => !a.startsWith('-'))
    return posicionales.length === 1 ? { nombre: literal(posicionales[0]), creada: true } : posicionales.length === 2 ? { nombre: null, creada: false } : null
  }
  if (subcomando === 'bisect' && args[0] === 'start') return { nombre: null, creada: false }
  return null
}

// Las claves de configuracion que deciden a donde va un push: el remoto y su
// URL, las reescrituras de URL, el refspec por defecto, push.default, el
// upstream de cada rama, y otro archivo de configuracion incluido.
const CONFIG_DEL_PUSH = /^(remote|url|branch|push|include|includeif)\./i

// Un `git config`, `git remote` o `git branch` que cambia esa configuracion.
function cambiaLaConfigDelPush(subcomando, args) {
  if (subcomando === 'remote') return ['add', 'set-url', 'rename', 'set-branches', 'set-head'].includes(args.find((a) => !a.startsWith('-')))
  if (subcomando === 'branch' || subcomando === 'checkout' || subcomando === 'switch') return args.some((a) => /^(-u|-t|--set-upstream-to(=|$)|--track(=|$)|--unset-upstream$)/.test(a))
  if (subcomando !== 'config') return false
  if (args.some((a) => /^(-e|--edit|--add|--replace-all|--unset|--unset-all|--rename-section|--remove-section)$/.test(a)) || ['set', 'unset', 'edit', 'rename-section', 'remove-section'].includes(args[0])) {
    return !args.some((a) => /^[A-Za-z][\w.-]*\.[\w.-]/.test(a)) || args.some((a) => CONFIG_DEL_PUSH.test(a))
  }
  const posicionales = []
  for (let j = 0; j < args.length; j++) {
    if (/^(-f|--file|--blob|--type|--default|--comment)$/.test(args[j])) j++
    else if (!args[j].startsWith('-')) posicionales.push(args[j])
  }
  return posicionales.length >= 2 && CONFIG_DEL_PUSH.test(posicionales[0])
}

// Variables, sustituciones de comando y comodines: lo que el shell resuelve
// recien al ejecutar, y que este hook no puede leer del texto del comando.
const DINAMICO = /[$`*?[]|%[A-Za-z_][A-Za-z0-9_]*%/
// `(Get-Content rama.txt)`, `@(...)`: una expresion de PowerShell como argumento.
const EXPRESION = /^@?\(/

// El flag o refspec que vuelve forzado a un push, o null. Cubre lo que las reglas
// `ask` de settings.json no ven por ser de prefijo: el flag al final
// (`git push origin x --force`), agrupado (`-uf`) o como `+refspec`.
export function pushForzado(args) {
  for (let j = 0; j < args.length; j++) {
    const a = args[j]
    if (OPCIONES_PUSH_CON_VALOR.has(a)) {
      j++
    } else if (/^--force(-with-lease|-if-includes)?(=|$)/.test(a)) {
      return a
    } else if (/^-[a-zA-Z0-9]*f[a-zA-Z0-9]*$/.test(a)) {
      return a
    } else if (a.startsWith('+')) {
      return a
    }
  }
  return null
}

// Las revs cuyos commits sin pushear hay que revisar antes de un `git push`
// con esos argumentos: la rama o el tag del refspec, HEAD por defecto, y
// --branches / --tags para --all, --mirror y --tags (un tag sobre un commit sin
// pushear tambien lo sube). Vacio si no sube commits (borra una rama remota).
function cabezasDe(args) {
  const posicionales = []
  const extra = []
  for (let j = 0; j < args.length; j++) {
    const arg = args[j]
    if (arg === '--delete' || arg === '-d') return []
    if (arg === '--tags' || arg === '--follow-tags') extra.push('--tags')
    if (arg === '--all' || arg === '--branches') extra.push('--branches')
    if (arg === '--mirror') extra.push('--branches', '--tags')
    if (OPCIONES_PUSH_CON_VALOR.has(arg)) {
      j++
    } else if (!arg.startsWith('-')) {
      posicionales.push(arg)
    }
  }
  const refspecs = posicionales.slice(1)
  const cabezas = []
  for (const refspec of refspecs) {
    if (REFSPEC_MATCHING.test(refspec)) {
      extra.push('--branches')
      continue
    }
    if (refspec.startsWith(':')) continue // borrar la rama remota
    const origen = refspec.replace(/^\+/, '').split(':')[0]
    // Un origen que se resuelve recien al ejecutar (`$RAMA`, `$(...)`) no se
    // puede revisar: se revisa HEAD, lo mas probable. Ese push ya se pregunta.
    cabezas.push(origen === '' || origen === '@' || DINAMICO.test(origen) || EXPRESION.test(origen) ? 'HEAD' : origen)
  }
  // Sin refspec, push de la rama actual; --tags solo, en cambio, no la sube.
  if (refspecs.length === 0 && !extra.includes('--branches') && !(extra.includes('--tags') && !args.includes('--follow-tags'))) {
    cabezas.push('HEAD')
  }
  return [...new Set([...cabezas, ...extra])]
}

// Cada `git push` del comando que sube commits, con la carpeta en la que corre
// y sus `cabezas`. Son todos, no solo el primero: `(cd <vault> && git push); git
// push` sube tambien la rama del proyecto, y esa es la que lleva el check.
function* pushesConCommits(comando, cwd, shell = 'bash') {
  for (const { dir, args, duda, alternativa, ramaActual } of pushes(comando, cwd, shell)) {
    // (Tras `git checkout x`, HEAD es x.)
    const cabezas = cabezasDe(args).map((cabeza) => (cabeza === 'HEAD' && ramaActual?.nombre ? ramaActual.nombre : cabeza))
    if (!cabezas.length) continue
    yield { dir, cabezas }
    // Si puede correr en otra carpeta que se conoce, tambien ahi.
    if (duda && alternativa) yield { dir: alternativa, cabezas }
  }
}

// El primero de ellos, o null si el comando no sube commits.
export function pushDelComando(comando, cwd, shell = 'bash') {
  for (const push of pushesConCommits(comando, cwd, shell)) return push
  return null
}

// Comodines de destinosDelPush que resuelve git en la carpeta del push.
const RAMA_ACTUAL = '@rama-actual'
const UPSTREAM = '@upstream'
const TODAS = '*'

// (`heads/main` tambien es main: git lo encuentra en el remoto como refs/heads/main.)
const ramaCorta = (ref) => ref.replace(/^(refs\/)?heads\//, '')

// Ramas remotas que cada `git push` del comando escribiria o borraria, para la
// proteccion de main: el lado destino de cada refspec (`dev:main`,
// `HEAD:refs/heads/main`, `:main` y `--delete main` tocan main; `origin main`
// sube main a main), TODAS para --all/--branches/--mirror y, con `HEAD` o sin
// refspec, la rama actual (sin refspec, tambien su upstream: con
// push.default=upstream iria a ella). Un push solo de tags no toca ramas. Viaja
// tambien el remoto nombrado (`remoto`; null = el de la rama, normalmente
// origin), que sirve para reconocer el Vault por su URL.
export function destinosDelPush(comando, cwd, shell = 'bash') {
  const salida = []
  const vistos = new Set()
  const ramaActual = shell === 'bash' ? variablesDeLaRamaActual(comando) : new Set()
  for (const { dir, args: todos, incierto: inciertoDelComando = null, duda = null, alternativa = null, configDelPush = false, ramaActual: otraRama = null } of pushes(comando, cwd, shell)) {
    // En PowerShell, la llave o el parentesis que cierran el bloque no son un
    // refspec. Y una variable que es la rama actual es HEAD.
    const args = (shell === 'powershell' ? todos.filter((a, j) => !(j === todos.length - 1 && /^[)}]+$/.test(a))) : todos).map((a) => {
      const variable = a.match(/^\$\{?([A-Za-z_]\w*)\}?$/)?.[1]
      return variable && ramaActual.has(variable) ? 'HEAD' : a
    })
    const posicionales = []
    const destinos = []
    let soloTags = false
    for (let j = 0; j < args.length; j++) {
      const arg = args[j]
      if (arg === '--all' || arg === '--branches' || arg === '--mirror') destinos.push(TODAS)
      if (arg === '--tags') soloTags = true
      if (OPCIONES_PUSH_CON_VALOR.has(arg)) {
        j++
      } else if (!arg.startsWith('-')) {
        posicionales.push(arg)
      }
    }
    const refspecs = posicionales.slice(1)
    // Ramas remotas que este push BORRA: `--delete rama` / `-d rama` y `:rama`.
    const borraTodo = args.some((a) => a === '--delete' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(a))
    const borra = []
    for (const refspec of refspecs) {
      if (REFSPEC_MATCHING.test(refspec)) {
        destinos.push(TODAS)
        continue
      }
      const [origen, destino] = refspec.replace(/^\+/, '').split(':')
      const ref = destino ?? origen
      destinos.push(ref === 'HEAD' || ref === '@' ? RAMA_ACTUAL : ramaCorta(ref))
      if (borraTodo || refspec.startsWith(':')) borra.push(ramaCorta(ref))
    }
    // Lo que el shell resuelve recien al ejecutar (`$RAMA`, `$(...)`, un comodin
    // en el refspec, una expresion entre parentesis de PowerShell) no se puede
    // leer del texto: viaja como `incierto`, con el motivo, para que prePushMain
    // pregunte en vez de dejarlo pasar en silencio. Lo mismo si lo que no se
    // puede leer es la carpeta (`dudaDeCarpeta`).
    const dinamico = posicionales.find((w) => DINAMICO.test(w))
    const deLosArgumentos = posicionales.some((w) => EXPRESION.test(w))
      ? 'parte de sus argumentos sale de una expresion entre parentesis'
      : dinamico
        ? `"${dinamico}" se resuelve recien al ejecutar`
        : null
    const remotoIncierto = configDelPush || (refspecs.length > 0 && (DINAMICO.test(posicionales[0]) || EXPRESION.test(posicionales[0])))
    // Sin refspec, la rama que sube la decide la configuracion: si el mismo comando la cambia, no se sabe cual es.
    const deLaConfig = configDelPush && refspecs.length === 0 && !destinos.length ? 'la configuracion de git que decide a donde sube (remoto, refspec, push.default, upstream) cambia en este mismo comando' : null
    // Si el comando cambia de rama antes del push y no se sabe a cual, la rama actual no se sabe.
    const deLaRama = otraRama && !otraRama.nombre && (refspecs.length === 0 || refspecs.some((r) => /^\+?(HEAD|@)(:|$)/.test(r))) ? 'este comando cambia de rama antes del push, y no se sabe a cual' : null
    const incierto = inciertoDelComando ?? deLosArgumentos ?? deLaConfig ?? deLaRama ?? duda
    const forzado = pushForzado(args)
    // Sin refspec sube la rama actual, tambien cuando lo unico que no se puede
    // leer es el remoto (`git push $REMOTO`) o la carpeta. No cuando los
    // argumentos llegan por otro lado (xargs, un alias, un lanzador).
    if (refspecs.length === 0 && destinos.length === 0 && !soloTags && !inciertoDelComando) destinos.push(RAMA_ACTUAL, UPSTREAM)
    if (destinos.length || incierto || forzado) {
      const push = { dir, remoto: posicionales[0] ?? null, destinos: [...new Set(destinos)], incierto, forzado, borra: [...new Set(borra)], dudaDeCarpeta: duda, carpetaAlternativa: alternativa, ...(remotoIncierto && { remotoIncierto }), ...(otraRama?.nombre && { ramaActual: otraRama }) }
      // El cuerpo de una funcion se lee al definirla y otra vez al llamarla: el
      // mismo push, en la misma carpeta, cuenta una vez.
      const clave = JSON.stringify(push)
      if (!vistos.has(clave)) salida.push(push)
      vistos.add(clave)
    }
  }
  return salida
}

const FLAGS_DE_METADATA = /^(--body|-b|--body-file|-F|--base|-B)(=|$)/

// `gh pr create` o un `gh pr edit` que toca body o base (lo que valida
// pr-metadata). `objetivo` es el numero/URL/rama que se le paso a edit.
export function cambioDePR(comando, cwd, shell = 'bash') {
  for (const { p, carpeta } of comandosDe(comando, cwd, shell)) {
    if (!ES_GH.test(p[0]) || p[1] !== 'pr') continue
    const args = p.slice(3)
    if (p[2] === 'create') {
      if (args.some((a) => a === '--web' || a === '-w' || a === '--dry-run')) continue
      return { accion: 'create', dir: carpeta, objetivo: null }
    }
    if (p[2] === 'edit' && args.some((a) => FLAGS_DE_METADATA.test(a))) {
      const objetivo = args[0] && !args[0].startsWith('-') ? args[0] : null
      return { accion: 'edit', dir: carpeta, objetivo }
    }
  }
  return null
}

// La ultima URL de PR en la salida de la tool. La forma de tool_response no
// esta documentada, asi que se busca en todo su JSON; host, owner y repo van
// acotados para que dos URLs seguidas no se lean como una sola.
export function urlDelPR(texto) {
  const todas = String(texto ?? '').match(/https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+/g)
  return todas ? todas.at(-1) : null
}

// --- Checks ------------------------------------------------------------------

function correrReal(cmd, args, { cwd, timeout = 30_000, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: ENTORNO, encoding: 'utf8', timeout, input, windowsHide: true })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error }
}

function primeraLinea(r) {
  if (r.error?.code === 'ENOENT') return `no se encontro "${r.error.path ?? 'el comando'}" en el PATH`
  if (r.error?.code === 'ETIMEDOUT') return 'se agoto el tiempo de espera'
  return (r.stderr || r.stdout || r.error?.message || `exit ${r.status}`).trim().split('\n')[0]
}

function raizDelRepo(dir, correr) {
  const r = correr('git', ['rev-parse', '--show-toplevel'], { cwd: dir, timeout: 10_000 })
  return r.status === 0 ? r.stdout.trim() : null
}

function rutaDelScript(raiz) {
  return path.join(raiz, 'scripts', 'check-pr-rules.mjs')
}

// El script que se EJECUTA es siempre el del proyecto al que pertenece este
// hook (.claude/hooks/ -> la raiz), nunca el del repo destino del comando: un
// PreToolUse corre antes del prompt de permisos, y `cd <repo ajeno> && git push`
// no puede servir para ejecutar un check-pr-rules.mjs de terceros. El del repo
// destino solo se mira (existencia) para decidir si le corresponde el check.
const RAIZ_DEL_HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT_CONFIABLE = rutaDelScript(RAIZ_DEL_HOOK)

function enModoSolo(raiz) {
  try {
    return JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'harness.json'), 'utf8')).modo === 'solo'
  } catch {
    return false
  }
}

// El repo donde corre el comando, si le corresponde el check: con el script
// del harness. El Vault y cualquier otro repo quedan fuera. Los checks del PR
// son solo de modo equipo (en solo no hay plantilla ni validacion de PR); el
// de secretos antes del push corre en los dos modos: en solo es la unica regla
// dura, y los merges directos a dev/main se pushean sin pasar por ningun PR.
function repoConReglas(dir, correr, { tambienEnSolo = false } = {}) {
  const raiz = dir ? raizDelRepo(dir, correr) : null
  if (!raiz || !fs.existsSync(rutaDelScript(raiz)) || !fs.existsSync(SCRIPT_CONFIABLE)) return null
  if (!tambienEnSolo && enModoSolo(raiz)) return null
  return raiz
}

// --- Proteccion de main por repo (SHS-M42) -----------------------------------
//
// `main` del proyecto solo recibe merges desde `dev` por PR: ningun push la
// toca. La regla vive aca y no en permissions.deny de settings.json porque una
// regla por texto no sabe en que repo corre el comando: `git push origin main`
// es una violacion en el proyecto y es el protocolo en el Vault (push directo a
// main, sin PR); y `git -C <ruta> push origin main` ni siquiera empieza por
// `git push`. El hook resuelve la carpeta real del push (cwd, cd, -C) y exime al
// Vault —por su ruta configurada (.claude/vault.local.json, VAULT_PATH o la
// config de maquina, en el mismo orden que el CLI), por su remoto o por su
// carpeta 00-System, para que un clon del Vault se reconozca en los dos modos
// aunque esta maquina no lo tenga configurado— y al modo solo, donde el agente
// mergea y pushea main a proposito.

const RAMA_PROTEGIDA = 'main'

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'))
  } catch {
    return null
  }
}

// Config del Vault en esta maquina: las rutas y las URLs de remoto (`repo`)
// declaradas en .claude/vault.local.json del proyecto, VAULT_PATH y la config de
// maquina, en el mismo orden que readVaultConfig del CLI.
export function configDelVault({ raizProyecto = RAIZ_DEL_HOOK, env = process.env } = {}) {
  const rutas = []
  const repos = []
  const sumar = (config) => {
    if (typeof config?.path === 'string' && config.path) rutas.push(config.path)
    if (typeof config?.repo === 'string' && config.repo) repos.push(config.repo)
  }
  sumar(leerJson(path.join(raizProyecto, '.claude', 'vault.local.json')))
  if (env.VAULT_PATH) rutas.push(env.VAULT_PATH)
  const home = env.SOUCLAUDE_CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
  sumar(leerJson(path.join(home, 'souclaude', 'vault.json')))
  return { rutas, repos }
}

export function rutasDelVault(opciones) {
  return configDelVault(opciones).rutas
}

// Dos rutas apuntan a la misma carpeta: por realpath (resuelve enlaces, nombres
// 8.3 y la forma de las barras) y sin distinguir mayusculas en Windows.
export function mismaCarpeta(a, b, plataforma = process.platform) {
  const canon = (ruta) => {
    let r
    try {
      r = fs.realpathSync.native(ruta)
    } catch {
      r = path.resolve(ruta)
    }
    r = r.replace(/[\\/]+$/, '')
    return plataforma === 'win32' ? r.replace(/\\/g, '/').toLowerCase() : r
  }
  return canon(a) === canon(b)
}

function salidaDe(r) {
  return r.status === 0 ? r.stdout.trim() : ''
}

// Ramas remotas concretas que tocaria el push: resuelve los comodines de
// destinosDelPush con git en la carpeta del push. Si git no responde (la
// carpeta no existe, no es un repo), se queda con lo explicito: ese push
// fallaria igual.
function ramasDestino(push, correr) {
  const ramas = new Set()
  const git = (args) => salidaDe(correr('git', args, { cwd: push.dir, timeout: 10_000 }))
  let actual = null
  const deGit = () => (actual ??= git(['rev-parse', '--abbrev-ref', 'HEAD']))
  // Si el comando cambia antes a otra rama, la actual es esa. Si esa no existe
  // ahora y el comando no la crea, `git checkout x` pudo ser de un archivo (y la
  // rama no cambia) o crearla desde el remoto: valen las dos.
  const ramasActuales = () => {
    const otra = push.ramaActual?.nombre
    if (!otra) return [deGit()]
    if (push.ramaActual.creada) return [otra]
    const existe = correr('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${otra}`], { cwd: push.dir, timeout: 10_000 }).status
    return existe === 0 ? [otra] : [otra, deGit()]
  }
  const ramaActual = () => ramasActuales()[0]
  for (const destino of push.destinos) {
    if (destino === TODAS) {
      // --all/--mirror suben main si existe en local; si git no responde, se asume que si.
      const r = correr('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${RAMA_PROTEGIDA}`], { cwd: push.dir, timeout: 10_000 })
      if (r.status === 0 || r.status == null) ramas.add(RAMA_PROTEGIDA)
    } else if (destino === RAMA_ACTUAL) {
      for (const rama of ramasActuales()) if (rama && rama !== 'HEAD') ramas.add(rama)
    } else if (destino === UPSTREAM) {
      for (const rama of ramasActuales()) {
        const merge = rama && rama !== 'HEAD' ? git(['config', '--get', `branch.${rama}.merge`]) : ''
        if (merge) ramas.add(ramaCorta(merge))
      }
    } else {
      ramas.add(destino)
    }
  }
  return ramas
}

// El repo del Vault de la organizacion (templates/harness.manifest.json ->
// vault.repo): cualquier clon del Vault se reconoce por el nombre de su remoto,
// tenga o no vault.local.json esta maquina.
const REPO_DEL_VAULT = /\/soubunker-vault$/

// `https://github.com/org/repo.git`, `git@github.com:org/repo.git` y
// `ssh://git@github.com/org/repo` -> `github.com/org/repo`; `C:\clones\repo` ->
// `c:/clones/repo`. Lo que vuelve comparables dos formas de nombrar un repo.
export function repoCanonico(url) {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]+@/, '')
    .replace(/^([^/:]+):(?![\\/])/, '$1/')
    .replace(/\.git$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

// URL del remoto al que va el push: el nombrado en el comando (o una URL o ruta
// escrita directo) o, sin nombrar, origin.
// La URL a la que va el push: la del remoto (la de push, si tiene una propia), o
// el remoto mismo si es una URL o la ruta de un repo que existe. Un nombre con
// `/` que no es un remoto ni una carpeta no es nada: no se lo toma por una URL.
function urlDelRemoto(push, correr) {
  const remoto = push.remoto ?? 'origin'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remoto) || (remoto.includes(':') && !/^[A-Za-z]:[\\/]/.test(remoto))) return remoto
  const url = salidaDe(correr('git', ['remote', 'get-url', remoto], { cwd: push.dir, timeout: 10_000 }))
  if (url) {
    // Si tiene una URL propia para el push (`remote.<x>.pushurl`), el push va ahi.
    const dePush = salidaDe(correr('git', ['remote', 'get-url', '--push', remoto], { cwd: push.dir, timeout: 10_000 }))
    return dePush && repoCanonico(dePush) !== repoCanonico(url) ? dePush : url
  }
  const ruta = /[/\\]/.test(remoto) ? path.resolve(push.dir, rutaExpandida(remoto)) : null
  return ruta && esCarpeta(ruta) ? ruta : null
}

// El push va al Vault si su carpeta (o la raiz de su repo) es una ruta
// configurada del Vault, si el repo tiene 00-System/ (la senal con la que el CLI
// reconoce un Vault) o si su remoto es el repo del Vault: el de la organizacion
// o uno declarado en la config. Asi un clon del Vault se reconoce aunque esta
// maquina no tenga vault.local.json, en modo equipo y en modo solo.
function esElVault({ push, raiz, correr, vault }) {
  const carpetas = raiz ? [push.dir, raiz] : [push.dir]
  if (carpetas.some((c) => vault.rutas.some((v) => mismaCarpeta(c, v)))) return true
  if (raiz && fs.existsSync(path.join(raiz, '00-System'))) return true
  const url = urlDelRemoto(push, correr)
  if (!url) return false
  const canon = repoCanonico(url)
  return REPO_DEL_VAULT.test(canon) || vault.repos.some((r) => repoCanonico(r) === canon)
}

// Decision `ask` del PreToolUse: el hook no puede afirmar que el comando viola
// una regla, pero tampoco que no. Decide el usuario, con el motivo a la vista.
function preguntar(lineas) {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: lineas.join('\n') },
  }
}

// Un push que puede correr en una de dos carpetas que se conocen (`npm ci && cd
// scripts && npm test; cd ..; git push`: de fallar `npm ci`, el `cd ..` sale del
// proyecto) no deja nada por adivinar: se lo evalua en las dos, sin la duda, y
// vale lo mas estricto. `unaDe` las nombra, con el motivo, para el mensaje.
export function candidatos(push) {
  if (!push.dudaDeCarpeta || !push.carpetaAlternativa) return [push]
  const otra = push.carpetaAlternativa
  const cierto = { ...push, dudaDeCarpeta: null, carpetaAlternativa: null, incierto: push.incierto === push.dudaDeCarpeta ? null : push.incierto }
  if (mismaCarpeta(push.dir, otra)) return [cierto]
  const unaDe = { carpetas: [push.dir, otra], motivo: push.dudaDeCarpeta }
  return [
    { ...cierto, unaDe },
    { ...cierto, dir: otra, unaDe },
  ]
}

const deDosCarpetas = (push) =>
  push.unaDe
    ? [`Del comando ${push.unaDe.motivo}: es ${push.unaDe.carpetas[0]} o ${push.unaDe.carpetas[1]}, y se evaluo en las dos. Para que corra en una sola, entra a su carpeta con una ruta literal (\`cd <ruta> && git push ...\`).`]
    : []

export function prePushMain({ push, correr, vault, enSolo = enModoSolo }) {
  const raiz = raizDelRepo(push.dir, correr)
  if (raiz && enSolo(raiz)) return null
  const tocaMain = ramasDestino(push, correr).has(RAMA_PROTEGIDA)
  if (!tocaMain && !push.incierto) return null
  // El Vault exime solo si la carpeta se pudo leer del comando. Si no (`cd "$X"
  // && git push ...`), que la carpeta evaluada sea el Vault no alcanza: un `main`
  // escrito en el comando se deniega igual, y lo demas se pregunta. Lo mismo si
  // el remoto no se puede leer o su configuracion cambia en el mismo comando
  // (`git -c remote.origin.pushurl=... push origin main`): no se sabe a que repo va.
  const enElVault = !push.remotoIncierto && esElVault({ push, raiz, correr, vault })
  if (enElVault && !push.dudaDeCarpeta) return null
  if (!tocaMain || (enElVault && !push.destinos.includes(RAMA_PROTEGIDA))) {
    return preguntar([
      push.dudaDeCarpeta && push.incierto === push.dudaDeCarpeta
        ? `reglas-pr (SHS-M42): de este push ${push.dudaDeCarpeta}. Se evaluo en ${raiz ?? push.dir}, pero puede correr en otro repo.`
        : `reglas-pr (SHS-M42): no se puede saber a que rama sube este push en ${raiz ?? push.dir}: ${push.incierto}.`,
      `\`${RAMA_PROTEGIDA}\` del proyecto solo recibe merges desde \`dev\` por PR. Confirma con el usuario que este push no la toca,`,
      push.dudaDeCarpeta
        ? 'o vuelve a escribirlo con la carpeta, el remoto y la rama literales (`cd <ruta> && git push origin <rama>`) para que no haga falta preguntar.'
        : 'o vuelve a escribirlo con el remoto y la rama literales (`git push origin <rama>`) para que no haga falta preguntar.',
      ...deDosCarpetas(push),
    ])
  }
  const sobreElVault = vault.rutas.length
    ? `El Vault de esta maquina esta en ${vault.rutas[0]} y este push no apunta ahi. En el Vault el push directo a main es el protocolo y este hook lo deja pasar.`
    : 'No hay Vault configurado en esta maquina (.claude/vault.local.json, VAULT_PATH o ~/.claude/souclaude/vault.json); un clon del Vault se reconoce igual por su remoto (soubunker-vault) o por su carpeta 00-System. Si este push era al Vault y no se reconocio, configuralo: `souclaude upgrade --vault-path <ruta>`.'
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `reglas-pr (SHS-M42): push a \`${RAMA_PROTEGIDA}\` denegado en ${raiz ?? push.dir}.`,
        '`main` del proyecto solo recibe merges desde `dev` por PR: trabaja en la rama del milestone (`tipo/M<n>-slug`, desde `dev`) y pushea esa rama.',
        ...(push.dudaDeCarpeta ? [`Del comando ${push.dudaDeCarpeta}; se evaluo en ${push.dir}. Si el push era para otro repo, entra a su carpeta con una ruta literal (\`cd <ruta> && git push ...\`).`] : []),
        ...deDosCarpetas(push),
        ...(enElVault ? [] : [sobreElVault]),
        'Para escribir en el Vault usa `souclaude vault-sync --push -m "<mensaje>" --paths Project-<PREFIJO>`, que corre sin confirmacion. No intentes rodear este hook.',
      ].join('\n'),
    },
  }
}

// Un push forzado reescribe historia que otros ya tienen. En modo equipo el
// protocolo lo prohibe (solo --force-with-lease, y solo sobre una rama propia):
// se pregunta siempre, en el proyecto y en el Vault. En modo solo no hay gates.
export function prePushForzado({ push, correr, enSolo = enModoSolo }) {
  if (!push.forzado) return null
  const raiz = raizDelRepo(push.dir, correr)
  if (raiz && enSolo(raiz)) return null
  return preguntar([
    `reglas-pr: push forzado (\`${push.forzado}\`) en ${raiz ?? push.dir}.`,
    'El protocolo es "nunca `git push --force`": solo `--force-with-lease`, solo sobre una rama propia y nunca sobre `dev` ni `main`.',
    'Confirma con el usuario antes de seguir; si era para sincronizar la rama, usa `git fetch origin && git merge origin/dev`.',
  ])
}

// `dev` es la rama de integracion: todas las ramas de trabajo nacen de ella y
// todos los PR apuntan a ella. Borrarla en el remoto (`git push origin --delete
// dev`, `git push origin :dev`) casa con la regla allow de `git push` y no la
// frenaba nada. No es un deny -- puede ser a proposito --, pero se pregunta.
// (`main` no llega aca: borrarla ya es "tocar main" y se deniega arriba.)
const RAMA_DE_INTEGRACION = 'dev'

export function prePushBorrado({ push, correr, vault, enSolo = enModoSolo }) {
  if (!push.borra?.includes(RAMA_DE_INTEGRACION)) return null
  const raiz = raizDelRepo(push.dir, correr)
  if (raiz && enSolo(raiz)) return null
  if (!push.dudaDeCarpeta && !push.remotoIncierto && esElVault({ push, raiz, correr, vault })) return null
  return preguntar([
    `reglas-pr: este push BORRA la rama \`${RAMA_DE_INTEGRACION}\` del remoto en ${raiz ?? push.dir}.`,
    `\`${RAMA_DE_INTEGRACION}\` es la rama de integracion: de ella nacen las ramas de trabajo y a ella apuntan los PR.`,
    'Confirma con el usuario antes de seguir; para borrar una rama de trabajo ya mergeada, nombra esa rama.',
  ])
}

// Cuantas cabezas distintas de un mismo comando llevan check de secretos (cada
// una corre el script) y cuantos pushes se evaluan contra las reglas de rama
// (cada uno consulta a git): el hook tiene un plazo, y pasado ese plazo no frena
// nada. Lo que queda sin revisar por un tope, o porque git no respondio a
// tiempo, se pregunta: nunca pasa en silencio.
const MAX_PUSHES_REVISADOS = 12
const MAX_PUSHES_EVALUADOS = 25
// El hook esta registrado con 60 s (settings.json): la revision entera tiene que
// terminar antes, con margen para responder.
const PLAZO_DE_LA_REVISION = 45_000
// El largo maximo de un comando que se lee (leer uno de 64 KB toma menos de un segundo).
const LARGO_MAXIMO = 64 * 1024

export function prePush({ push, raiz, correr }) {
  for (const cabeza of push.cabezas) {
    const args = [SCRIPT_CONFIABLE, '--grupo', 'secretos', '--sin-pushear']
    // Una rama o un tag que el mismo comando crea antes del push (`git switch -c
    // x && git push -u origin x`) todavia no existe: se revisa HEAD, de donde
    // sale. Si git no responde, se pasa igual y el script lo dice.
    const existe = cabeza.startsWith('--') || correr('git', ['rev-parse', '--verify', '--quiet', `${cabeza}^{commit}`], { cwd: raiz, timeout: 10_000 }).status !== 1
    // Con "=": una ref que empiece con "-" no puede leerse como otra opcion.
    if (cabeza !== 'HEAD' && existe) args.push(`--cabeza=${cabeza}`)
    const r = correr(process.execPath, args, { cwd: raiz, timeout: 30_000 })
    const fail = (r.stdout ?? '').split('\n').find((l) => l.startsWith('[FAIL] sin-secretos'))
    if (r.status === 1 && fail) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: [
            'reglas-pr (SHS-M39): el push subiria archivos de credenciales.',
            fail,
            'No pushees. Si estan solo en commits que todavia no se pushearon, sacalos de ahi:',
            '`git reset --soft <upstream de la rama, u origin/dev si nunca se pusheo>`, `git rm --cached <archivo>`,',
            'sumalo a .gitignore y vuelve a commitear. Si alguno ya se habia pusheado antes, la credencial quedo',
            'expuesta: avisa al usuario para que la rote. Si es un falso positivo (un fixture sin credenciales),',
            'avisa al usuario: ese push lo hace el. No intentes rodear este hook.',
          ].join('\n'),
        },
      }
    }
    if (r.status !== 0) {
      return { systemMessage: `reglas-pr: no se pudo validar secretos antes del push (${primeraLinea(r)}); el push sigue sin validar.` }
    }
  }
  return null
}

// --- Frescura de docs/metodologia (SHS-M16) ----------------------------------
//
// La carpeta publicable de la metodologia lleva secciones generadas desde
// package.json y el manifest; un push con esas secciones desactualizadas
// publicaria documentacion vieja. Solo aplica al repo del generador: el script
// no se distribuye a consumidores ni va en el paquete publicado, asi que en
// cualquier otro repo este paso es un no-op. Igual que SCRIPT_CONFIABLE, se
// ejecuta siempre el script del proyecto del hook, nunca el del repo destino.
const SCRIPT_DOCS = path.join(RAIZ_DEL_HOOK, 'scripts', 'gen-docs-metodologia.mjs')

export function preDocsMetodologia(correr, { script = SCRIPT_DOCS, raizPush = RAIZ_DEL_HOOK, raizHook = RAIZ_DEL_HOOK } = {}) {
  if (!raizPush || !mismaCarpeta(raizPush, raizHook)) return null
  if (!fs.existsSync(script)) return null
  const r = correr(process.execPath, [script, '--check'], { cwd: raizHook, timeout: 30_000 })
  if (r.status === 1) {
    const fails = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('[FAIL]'))
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: [
          'reglas-pr (SHS-M16): docs/metodologia esta desactualizada respecto del instalador y este push publicaria documentacion vieja.',
          ...(fails.length ? fails : ['[FAIL] docs-metodologia: drift en las secciones generadas']),
          'Corre `node scripts/gen-docs-metodologia.mjs`, revisa la prosa si el cambio lo amerita, commitea y vuelve a pushear. No intentes rodear este hook.',
        ].join('\n'),
      },
    }
  }
  if (r.status !== 0) {
    return { systemMessage: `reglas-pr: no se pudo verificar la frescura de docs/metodologia (${primeraLinea(r)}); el push sigue sin validar.` }
  }
  return null
}

function estadoDe(r) {
  // Un [AVISO] no cambia el resultado del grupo, pero se nota en la tabla.
  if (r.status === 0) return /^\[AVISO\]/m.test(r.salida ?? '') ? 'OK, con avisos' : 'OK'
  if (r.status === 1) return 'FAIL'
  return 'ERROR (no se pudo verificar)'
}

export function comentario({ sha, resultados }) {
  let salida = resultados.map((r) => `== ${r.grupo}\n${r.salida}`).join('\n\n')
  if (salida.length > LIMITE_SALIDA) salida = `${salida.slice(0, LIMITE_SALIDA)}\n... (recortado)`
  return [
    MARCA,
    '### Reglas de PR — corridas en la sesión del agente',
    '',
    `Checks corridos por el hook \`reglas-pr\` de Claude Code (SHS-M39) sobre \`${sha ? sha.slice(0, 7) : '?'}\`, en la sesión del agente. Los workflows \`reglas-*\` de GitHub Actions validan el mismo PR en CI.`,
    '',
    '| Grupo | Resultado |',
    '|---|---|',
    ...resultados.map((r) => `| ${r.grupo}${r.bloqueante ? '' : ' (informativo)'} | ${estadoDe(r)} |`),
    '',
    '<details><summary>Salida de <code>scripts/check-pr-rules.mjs</code></summary>',
    '',
    '````text',
    salida,
    '````',
    '',
    '</details>',
  ].join('\n')
}

// Lo que vuelve al agente: corto, solo lo que no dio OK, y que hacer.
export function textoParaElAgente({ url, sha, resultados, errorComentario }) {
  const lineas = [`reglas-pr (SHS-M39) · PR ${url}${sha ? ` · cabeza ${sha.slice(0, 7)}` : ''}`]
  for (const r of resultados) lineas.push(`- ${r.grupo}${r.bloqueante ? '' : ' (informativo)'}: ${estadoDe(r)}`)
  const avisos = resultados.flatMap((r) =>
    r.salida
      .split('\n')
      .filter((l) => /^\[(FAIL|skip|ERROR|AVISO)/.test(l))
      .map((l) => `  ${r.grupo} ${l}`),
  )
  if (avisos.length) {
    lineas.push('Detalle:', ...avisos.slice(0, MAX_AVISOS))
    if (avisos.length > MAX_AVISOS) lineas.push(`  ... y ${avisos.length - MAX_AVISOS} mas en el comentario del PR`)
  }
  lineas.push(
    errorComentario
      ? `No se pudo publicar el comentario en el PR (${errorComentario}): avisale al usuario.`
      : 'Resultado publicado como comentario en el PR.',
  )

  const fallaBloqueante = resultados.some((r) => r.bloqueante && r.status === 1)
  const sinVerificar = resultados.some((r) => r.status !== 0 && r.status !== 1)
  if (fallaBloqueante) {
    lineas.push(
      'Hay FAIL en un grupo bloqueante: corrigelo ahora, el PR no esta listo hasta que no quede ninguno.',
      `- Body: \`gh pr edit ${url} --body-file <archivo>\` (vuelve a disparar este check).`,
      `- Base: \`gh pr edit ${url} --base dev\`.`,
      `- Conflictos: \`git fetch origin && git merge origin/dev\`, push, y despues \`node .claude/hooks/reglas-pr.mjs --pr ${url}\`.`,
      '- Secreto: sacalo en un commit nuevo (`git rm --cached`) y avisa al usuario: ya se pusheo, hay que rotarlo.',
      'Si el FAIL no se arregla desde el body o la base, o sigue tras dos rondas, para y reportalo al usuario.',
    )
  }
  if (sinVerificar) {
    lineas.push(
      `Algun grupo no se pudo verificar (ERROR): cuando se resuelva, corre \`node .claude/hooks/reglas-pr.mjs --pr ${url}\`; si no se resuelve, avisale al usuario que el PR quedo sin validar.`,
    )
  }
  if (avisos.some((l) => l.includes('[AVISO]'))) {
    lineas.push('Los [AVISO] no bloquean, pero revisalos: si es una credencial real, sacala en un commit nuevo y avisa al usuario para rotarla.')
  }
  if (!fallaBloqueante && !sinVerificar) lineas.push('Los grupos bloqueantes pasaron. rama-commits es informativo: no reescribas commits ya pusheados.')
  return { estado: fallaBloqueante ? 'fail' : sinVerificar ? 'error' : 'ok', texto: lineas.join('\n') }
}

export function postPR({ objetivo, raiz, correr }) {
  const vista = correr('gh', ['pr', 'view', ...(objetivo ? [objetivo] : []), '--json', 'url,headRefOid'], { cwd: raiz, timeout: 20_000 })
  let pr = null
  try {
    if (vista.status === 0) pr = JSON.parse(vista.stdout)
  } catch {
    pr = null
  }
  if (!pr?.url) {
    const detalle = vista.status === 0 ? 'respuesta inesperada de gh' : primeraLinea(vista)
    return {
      estado: 'error',
      url: objetivo,
      texto: `reglas-pr (SHS-M39): no se pudo leer el PR con gh (${detalle}), asi que no se verifico. Cuando se resuelva, corre \`node .claude/hooks/reglas-pr.mjs --pr <url del PR>\`; si no, avisale al usuario que el PR quedo sin validar.`,
    }
  }

  // Para que la cabeza del PR (headRefOid) exista en local. Si falla (sin red),
  // el script reporta skip en lo que la necesita.
  correr('git', ['fetch', 'origin', '--quiet'], { cwd: raiz, timeout: 30_000 })

  const resultados = GRUPOS.map(({ grupo, bloqueante }) => {
    const r = correr(process.execPath, [SCRIPT_CONFIABLE, '--grupo', grupo, '--pr', pr.url], { cwd: raiz, timeout: 45_000 })
    const salida = (r.stdout ?? '').trim() || `[ERROR] ${primeraLinea(r)}`
    return { grupo, bloqueante, status: r.status === 0 || r.status === 1 ? r.status : 2, salida }
  })

  const publicado = correr('gh', ['pr', 'comment', pr.url, '--body-file', '-'], {
    cwd: raiz,
    timeout: 20_000,
    input: comentario({ sha: pr.headRefOid, resultados }),
  })
  const { estado, texto } = textoParaElAgente({
    url: pr.url,
    sha: pr.headRefOid,
    resultados,
    errorComentario: publicado.status === 0 ? null : primeraLinea(publicado),
  })
  return { estado, url: pr.url, texto }
}

// El modo manual corre sin prompt (regla allow): solo comenta en PRs del repo
// propio, no en cualquier PR donde el token de gh pueda escribir.
function repoDelOrigen(raiz, correr) {
  const r = correr('git', ['remote', 'get-url', 'origin'], { cwd: raiz, timeout: 10_000 })
  const m = r.status === 0 && r.stdout.trim().match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)
  return m ? m[1].toLowerCase() : null
}

export function prDeEsteRepo(objetivo, repoOrigen) {
  const m = String(objetivo ?? '').match(/^https:\/\/[\w.-]+\/([\w.-]+\/[\w.-]+)\/pull\/\d+\/?$/)
  if (!m) return !/^https?:/.test(String(objetivo ?? '')) // numero o rama: gh lo resuelve en este repo
  return repoOrigen != null && m[1].toLowerCase() === repoOrigen
}

export function salidaPostToolUse({ estado, texto, url }) {
  const hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: texto }
  if (estado !== 'fail') return { hookSpecificOutput }
  // block + reason no esta confirmado en la doc de PostToolUse; el detalle
  // completo va igual en additionalContext, que si lo esta.
  return {
    decision: 'block',
    reason: `reglas-pr: FAIL bloqueante en el PR ${url}. El detalle y como corregirlo van en el contexto adicional.`,
    hookSpecificOutput,
  }
}

// Punto de entrada del hook: decide que hacer con la entrada de Claude Code.
export function procesar(entrada, correr = correrReal) {
  const comando = entrada?.tool_input?.command
  if (typeof comando !== 'string') return null
  const cwd = entrada.cwd || process.cwd()
  const shell = /powershell/i.test(entrada.tool_name ?? '') ? 'powershell' : 'bash'

  if (entrada.hook_event_name === 'PreToolUse') {
    // Un comando mas largo que esto no se lee: hacerlo podria pasarse del plazo
    // del hook, y un hook que no responde a tiempo no frena nada. Si habla de un
    // push o de un PR, se pregunta.
    if (comando.length > LARGO_MAXIMO) {
      return /push|send-pack|\bgh\b/i.test(comando)
        ? preguntar([`reglas-pr: este comando tiene ${comando.length} caracteres, mas de los ${LARGO_MAXIMO} que este hook revisa, y habla de un push o de un PR. Confirma con el usuario antes de seguir, o separalo en comandos mas chicos.`])
        : null
    }
    // Primero main: es la regla dura y no necesita el script. Despues secretos.
    const esDeny = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny'
    const vault = configDelVault()
    // Toda la revision comparte un plazo: lo que git no llega a responder queda
    // anotado, y al final se pregunta.
    const vence = Date.now() + PLAZO_DE_LA_REVISION
    let sinTiempo = false
    const conPlazo = (cmd, args, opciones = {}) => {
      const resta = vence - Date.now()
      const r = resta > 0 ? correr(cmd, args, { ...opciones, timeout: Math.min(opciones.timeout ?? 30_000, resta) }) : { status: null, stdout: '', stderr: '', error: Object.assign(new Error('sin tiempo'), { code: 'ETIMEDOUT' }) }
      if (r.error?.code === 'ETIMEDOUT') sinTiempo = true
      return r
    }
    // Cada push distinto se evalua una vez (evaluarlo consulta a git), en cada
    // carpeta en la que puede correr. Primero los que nombran `main` o suben
    // todas las ramas: si hay que cortar por el tope, que no queden afuera.
    const porEvaluar = new Map()
    for (const leido of destinosDelPush(comando, cwd, shell)) for (const push of candidatos(leido)) porEvaluar.set(JSON.stringify(push), push)
    const urgente = (push) => push.destinos.includes(RAMA_PROTEGIDA) || push.destinos.includes(TODAS)
    const enOrden = [...porEvaluar.values()].sort((a, b) => urgente(b) - urgente(a))
    // Un deny corta; una pregunta (`ask`) queda pendiente por si mas abajo hay
    // un deny, que siempre gana.
    let pregunta = null
    for (const push of enOrden.slice(0, MAX_PUSHES_EVALUADOS)) {
      const decision = prePushMain({ push, correr: conPlazo, vault }) ?? prePushForzado({ push, correr: conPlazo }) ?? prePushBorrado({ push, correr: conPlazo, vault })
      if (esDeny(decision)) return decision
      pregunta ??= decision
    }
    if (enOrden.length > MAX_PUSHES_EVALUADOS) {
      pregunta ??= preguntar([`reglas-pr (SHS-M42): este comando hace mas de ${MAX_PUSHES_EVALUADOS} pushes distintos y no se revisaron todos. Confirma con el usuario, o separalo en comandos mas chicos.`])
    }
    // Secretos, en cada repo con reglas al que el comando pushea y por cada
    // cabeza distinta; con eso en orden, la frescura de docs/metodologia (solo
    // en el repo del generador, SHS-M16). Un aviso de "no se pudo validar" viaja
    // junto con la pregunta, si la hay.
    let validacion = null
    const raices = new Map()
    const revisados = new Set()
    const conDocs = new Set()
    let sinRevisar = false
    for (const push of pushesConCommits(comando, cwd, shell)) {
      if (!raices.has(push.dir)) raices.set(push.dir, repoConReglas(push.dir, conPlazo, { tambienEnSolo: true }))
      const raiz = raices.get(push.dir)
      if (!raiz) continue
      for (const cabeza of push.cabezas) {
        const clave = `${raiz}\n${cabeza}`
        if (revisados.has(clave)) continue
        if (revisados.size === MAX_PUSHES_REVISADOS) {
          sinRevisar = true
          break
        }
        revisados.add(clave)
        const resultado = prePush({ push: { ...push, cabezas: [cabeza] }, raiz, correr: conPlazo })
        if (esDeny(resultado)) return resultado
        validacion ??= resultado
      }
      if (sinRevisar) break
      if (!conDocs.has(raiz)) {
        conDocs.add(raiz)
        const resultado = preDocsMetodologia(conPlazo, { raizPush: raiz })
        if (esDeny(resultado)) return resultado
        validacion ??= resultado
      }
    }
    if (sinRevisar) {
      pregunta ??= preguntar([`reglas-pr (SHS-M39): este comando sube mas de ${MAX_PUSHES_REVISADOS} ramas o tags distintos y no en todos se validaron secretos. Confirma con el usuario, o separalo en comandos mas chicos.`])
    }
    if (sinTiempo) {
      pregunta ??= preguntar(['reglas-pr: git no respondio a tiempo y este push no se pudo revisar entero (rama de destino, secretos). Confirma con el usuario antes de seguir, o vuelve a intentarlo.'])
    }
    if (!pregunta) return validacion
    return validacion?.systemMessage ? { ...pregunta, systemMessage: validacion.systemMessage } : pregunta
  }
  if (entrada.hook_event_name === 'PostToolUse') {
    const cambio = cambioDePR(comando, cwd, shell)
    const raiz = cambio && repoConReglas(cambio.dir, correr)
    if (!raiz) return null
    const url = urlDelPR(JSON.stringify(entrada.tool_response ?? entrada.tool_result ?? ''))
    return salidaPostToolUse(postPR({ objetivo: url ?? cambio.objetivo, raiz, correr }))
  }
  return null
}

// Lee entero lo que llega por stdin. `fs.readFileSync(0)` puede cortar con
// EAGAIN si la tuberia todavia no trae todo (en macOS, con mas de 64 KB): el hook
// no veia nada y dejaba pasar el comando sin revisarlo.
function leerStdin() {
  const pedazos = []
  const buf = Buffer.alloc(1 << 16)
  const espera = new Int32Array(new SharedArrayBuffer(4))
  const vence = Date.now() + 20_000
  for (;;) {
    let n
    try {
      n = fs.readSync(0, buf, 0, buf.length, null)
    } catch (e) {
      if (e.code === 'EAGAIN' && Date.now() < vence) {
        Atomics.wait(espera, 0, 0, 5)
        continue
      }
      if (e.code === 'EOF') break
      throw e
    }
    if (n === 0) break
    pedazos.push(Buffer.from(buf.subarray(0, n)))
  }
  return Buffer.concat(pedazos).toString('utf8')
}

function leerEntrada() {
  try {
    return JSON.parse(leerStdin() || '{}')
  } catch {
    return {}
  }
}

function main() {
  const indicePr = process.argv.indexOf('--pr')
  if (indicePr !== -1) {
    // Modo manual: node .claude/hooks/reglas-pr.mjs --pr <url>
    const raiz = repoConReglas(process.cwd(), correrReal)
    if (!raiz) {
      console.log('reglas-pr: este repo no tiene scripts/check-pr-rules.mjs del harness (o esta en modo solo).')
      process.exit(2)
    }
    const objetivo = process.argv[indicePr + 1] ?? null
    if (!prDeEsteRepo(objetivo, repoDelOrigen(raiz, correrReal))) {
      console.log(`reglas-pr: ${objetivo} no es un PR de este repo (origin); no se corre ni se comenta.`)
      process.exit(2)
    }
    const { estado, texto } = postPR({ objetivo, raiz, correr: correrReal })
    console.log(texto)
    process.exit(estado === 'ok' ? 0 : estado === 'fail' ? 1 : 2)
  }
  if (process.stdin.isTTY) {
    console.log('Uso: lo invoca Claude Code (JSON por stdin), o a mano: node .claude/hooks/reglas-pr.mjs --pr <url>')
    process.exit(0)
  }
  let salida = null
  let entrada = {}
  try {
    entrada = leerEntrada()
    salida = procesar(entrada)
  } catch (e) {
    const motivo = String(e?.message ?? e).split('\n')[0]
    const comando = typeof entrada?.tool_input?.command === 'string' ? entrada.tool_input.command : ''
    // Si el comando habla de un push, un error al leerlo no lo deja pasar sin
    // revisar: se pregunta. Un hook que falla en silencio no frena nada.
    salida =
      entrada?.hook_event_name === 'PreToolUse' && /push|send-pack/i.test(comando)
        ? preguntar([`reglas-pr: error interno del hook al leer este comando (${motivo}); el push no se pudo revisar. Confirma con el usuario antes de seguir, o separa el comando en partes mas simples.`])
        : { systemMessage: `reglas-pr: error interno del hook (${motivo}); no se verifico nada.` }
  }
  // La respuesta sale entera antes de terminar: con `process.exit` justo despues
  // de escribir, una de mas de 64 KB llegaba cortada (y no era JSON). Y el motivo
  // se acota: rutas de miles de caracteres no le sirven a nadie.
  const motivo = salida?.hookSpecificOutput?.permissionDecisionReason
  if (typeof motivo === 'string' && motivo.length > 8000) salida.hookSpecificOutput.permissionDecisionReason = `${motivo.slice(0, 8000)}\n[... motivo recortado]`
  if (salida) process.stdout.write(JSON.stringify(salida), () => process.exit(0))
  else process.exit(0)
}

// Este archivo es el script que se esta ejecutando (y no un import desde los
// tests)? Se comparan rutas REALES: Node resuelve los enlaces simbolicos del
// script de entrada, asi que import.meta.url y process.argv[1] difieren cuando
// el proyecto se abre por una ruta con un enlace (un symlink o junction en el
// camino, /tmp y /var en macOS). Comparados tal cual, el hook terminaba sin
// hacer nada y con exit 0: la proteccion de main y el check de secretos
// quedaban apagados en silencio.
export function esPuntoDeEntrada(urlDelModulo, argv1 = process.argv[1], plataforma = process.platform) {
  if (!argv1) return false
  const real = (ruta) => {
    try {
      return fs.realpathSync.native(ruta)
    } catch {
      return path.resolve(ruta)
    }
  }
  const [modulo, entrada] = [real(fileURLToPath(urlDelModulo)), real(argv1)]
  return plataforma === 'win32' ? modulo.toLowerCase() === entrada.toLowerCase() : modulo === entrada
}

if (esPuntoDeEntrada(import.meta.url)) {
  main()
}
