// Hook de Claude Code del harness (managed): reglas de PR en la sesion (SHS-M39).
//
// Con GitHub Actions en pausa (SHS-M36), los checks de
// scripts/check-pr-rules.mjs ya no corren en CI: los corre este hook dentro de
// la sesion del agente, en el momento en que importan.
//
//   PreToolUse  · git push              -> grupo secretos sobre los commits que
//                                          el push subiria; si falla, deniega el
//                                          push.
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
// Es un hook de Claude Code, no un git hook. Falla abierto ante problemas de
// infraestructura (sin gh, sin red, sin el script): no frena por no poder
// verificar, pero lo avisa. No hace nada en modo solo ni en repos sin
// scripts/check-pr-rules.mjs (el Vault, por ejemplo).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ENTORNO = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }
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
// saltos de linea) sin cortar dentro de comillas: `git commit -m "x; git push"`
// es un solo segmento. Las redirecciones (2>&1, &>) no son operadores.
export function segmentos(comando, shell = 'bash') {
  const escape = shell === 'powershell' ? '`' : '\\'
  const salida = []
  let actual = ''
  let comilla = null
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]
    if (comilla) {
      actual += c
      if (c === escape && comilla === '"' && i + 1 < comando.length) actual += comando[++i]
      else if (c === comilla) comilla = null
      continue
    }
    if (c === "'" || c === '"') {
      comilla = c
      actual += c
    } else if (c === escape && i + 1 < comando.length) {
      actual += c + comando[++i]
    } else if (c === '&' && (/[<>]$/.test(actual) || comando[i + 1] === '>')) {
      actual += c
    } else if (c === ';' || c === '\n' || c === '\r' || c === '&' || c === '|') {
      if ((c === '&' || c === '|') && comando[i + 1] === c) i++
      salida.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  salida.push(actual)
  return salida.map((s) => s.trim()).filter(Boolean)
}

// Palabras de un segmento, sin comillas. Descarta las redirecciones (2>&1,
// > archivo) y las asignaciones iniciales (VAR=valor git push).
export function palabras(segmento, shell = 'bash') {
  const escape = shell === 'powershell' ? '`' : '\\'
  const crudas = []
  let actual = ''
  let hay = false
  let comilla = null
  for (let i = 0; i < segmento.length; i++) {
    const c = segmento[i]
    if (comilla) {
      // En bash, dentro de comillas dobles la barra solo escapa " \ $ ` y el
      // salto de linea: "C:\Users\x" queda tal cual. En PowerShell, el
      // backtick escapa cualquier caracter.
      const escapado = segmento[i + 1] ?? ''
      if (c === comilla) comilla = null
      else if (c === escape && comilla === '"' && (shell === 'powershell' ? escapado !== '' : /["\\$`\n]/.test(escapado))) actual += segmento[++i]
      else actual += c
      continue
    }
    if (c === "'" || c === '"') {
      comilla = c
      hay = true
    } else if (c === escape && i + 1 < segmento.length) {
      actual += segmento[++i]
      hay = true
    } else if (/\s/.test(c)) {
      if (hay) crudas.push(actual)
      actual = ''
      hay = false
    } else {
      actual += c
      hay = true
    }
  }
  if (hay) crudas.push(actual)

  const sinRedireccion = []
  for (let i = 0; i < crudas.length; i++) {
    const m = crudas[i].match(/^(\d*|&)?(>>?|<)(&\d+|&-)?(.*)$/)
    if (m) {
      if (!m[3] && m[4] === '') i++ // operador solo: la palabra siguiente es el archivo
      continue
    }
    sinRedireccion.push(crudas[i])
  }
  let desde = 0
  while (desde < sinRedireccion.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(sinRedireccion[desde])) desde++
  return sinRedireccion.slice(desde)
}

const ES_GIT = /(^|[\\/])git(\.exe)?$/i
const ES_GH = /(^|[\\/])gh(\.exe)?$/i
const ES_CD = /^(cd|pushd|chdir|set-location|sl)$/i
const TAG = /^(refs\/tags\/.+|v\d+(\.\d+)*)$/
const OPCIONES_PUSH_CON_VALOR = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec'])

function carpetaTrasCd(actual, destino) {
  if (!destino || destino === '-') return actual
  const expandido = destino === '~' || destino.startsWith('~/') ? path.join(os.homedir(), destino.slice(1)) : destino
  return path.resolve(actual, expandido)
}

// Lo que un `git push` subiria, o null si el comando no pushea ramas: pushes
// de tags, borrados de ramas remotas y comandos sin push no llevan check.
// `cabezas` son las refs cuyos commits sin pushear hay que revisar.
export function pushDelComando(comando, cwd, shell = 'bash') {
  let carpeta = cwd
  for (const segmento of segmentos(comando, shell)) {
    const p = palabras(segmento, shell)
    if (ES_CD.test(p[0] ?? '')) {
      carpeta = carpetaTrasCd(carpeta, p.slice(1).find((x) => !x.startsWith('-')))
      continue
    }
    if (!ES_GIT.test(p[0] ?? '')) continue

    let i = 1
    let dir = carpeta
    while (i < p.length && p[i].startsWith('-')) {
      if (p[i] === '-C') {
        dir = path.resolve(dir, p[i + 1] ?? '.')
        i += 2
      } else if (['-c', '--git-dir', '--work-tree', '--namespace'].includes(p[i])) {
        i += 2
      } else {
        i += 1
      }
    }
    if (p[i] !== 'push') continue

    const posicionales = []
    let soloTags = false
    for (let j = i + 1; j < p.length; j++) {
      const arg = p[j]
      if (arg === '--delete' || arg === '-d') return null
      if (arg === '--tags') soloTags = true
      if (OPCIONES_PUSH_CON_VALOR.has(arg)) {
        j++
      } else if (!arg.startsWith('-')) {
        posicionales.push(arg)
      }
    }
    const refspecs = posicionales.slice(1)
    if (refspecs.length === 0) return soloTags ? null : { dir, cabezas: ['HEAD'] }

    const cabezas = []
    for (const refspec of refspecs) {
      if (refspec.startsWith(':')) continue // borrar la rama remota
      const origen = refspec.replace(/^\+/, '').split(':')[0]
      if (TAG.test(origen)) continue
      cabezas.push(origen === '' || origen === '@' ? 'HEAD' : origen)
    }
    return cabezas.length ? { dir, cabezas: [...new Set(cabezas)] } : null
  }
  return null
}

const FLAGS_DE_METADATA = /^(--body|-b|--body-file|-F|--base|-B)(=|$)/

// `gh pr create` o un `gh pr edit` que toca body o base (lo que valida
// pr-metadata). `objetivo` es el numero/URL/rama que se le paso a edit.
export function cambioDePR(comando, cwd, shell = 'bash') {
  let carpeta = cwd
  for (const segmento of segmentos(comando, shell)) {
    const p = palabras(segmento, shell)
    if (ES_CD.test(p[0] ?? '')) {
      carpeta = carpetaTrasCd(carpeta, p.slice(1).find((x) => !x.startsWith('-')))
      continue
    }
    if (!ES_GH.test(p[0] ?? '') || p[1] !== 'pr') continue
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

function enModoSolo(raiz) {
  try {
    return JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'harness.json'), 'utf8')).modo === 'solo'
  } catch {
    return false
  }
}

// El repo donde corre el comando, si le corresponde el check: con el script
// del harness y en modo equipo. El Vault y cualquier otro repo quedan fuera.
function repoConReglas(dir, correr) {
  const raiz = dir ? raizDelRepo(dir, correr) : null
  if (!raiz || enModoSolo(raiz) || !fs.existsSync(rutaDelScript(raiz))) return null
  return raiz
}

export function prePush({ push, raiz, correr }) {
  for (const cabeza of push.cabezas) {
    const args = [rutaDelScript(raiz), '--grupo', 'secretos', '--sin-pushear']
    if (cabeza !== 'HEAD') args.push('--cabeza', cabeza)
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

function estadoDe(r) {
  if (r.status === 0) return 'OK'
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
    `GitHub Actions está en pausa (SHS-M36): estos checks los corre el hook \`reglas-pr\` de Claude Code (SHS-M39) sobre \`${sha ? sha.slice(0, 7) : '?'}\`.`,
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
      .filter((l) => /^\[(FAIL|skip|ERROR)/.test(l))
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
    const r = correr(process.execPath, [rutaDelScript(raiz), '--grupo', grupo, '--pr', pr.url], { cwd: raiz, timeout: 45_000 })
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
    const push = pushDelComando(comando, cwd, shell)
    const raiz = push && repoConReglas(push.dir, correr)
    return raiz ? prePush({ push, raiz, correr }) : null
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

function leerEntrada() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
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
    const { estado, texto } = postPR({ objetivo: process.argv[indicePr + 1] ?? null, raiz, correr: correrReal })
    console.log(texto)
    process.exit(estado === 'ok' ? 0 : estado === 'fail' ? 1 : 2)
  }
  if (process.stdin.isTTY) {
    console.log('Uso: lo invoca Claude Code (JSON por stdin), o a mano: node .claude/hooks/reglas-pr.mjs --pr <url>')
    process.exit(0)
  }
  let salida = null
  try {
    salida = procesar(leerEntrada())
  } catch (e) {
    salida = { systemMessage: `reglas-pr: error interno del hook (${String(e?.message ?? e).split('\n')[0]}); no se verifico nada.` }
  }
  if (salida) process.stdout.write(JSON.stringify(salida))
  process.exit(0)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
