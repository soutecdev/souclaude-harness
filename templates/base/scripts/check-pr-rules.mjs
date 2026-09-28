#!/usr/bin/env node
// Verifica las reglas deterministas de PR de la skill soutec-github
// (.claude/skills/soutec-github/SKILL.md). Cubre: #1, #2, #3, #5, #6, #8, #9
// del documento "Cubo A". #4 es la interseccion de #2+#3 (no aporta chequeo
// propio). #7 y #10 quedaron fuera por decision explicita (ver PR que agrego
// este script): #7 no esta documentada en el skill, #10 no aplica a este repo.
//
// Las 7 reglas se agrupan en tres --grupo (SHS-M33): un fallo de formato de
// commit no debe verse igual de grave que un secreto filtrado. Mientras GitHub
// Actions esta en pausa (SHS-M36) no las corre CI: las corre el hook de Claude
// Code reglas-pr (.claude/hooks/reglas-pr.mjs, SHS-M39) en la sesion del
// agente. "Bloqueante" = el hook deniega el push o le devuelve el FAIL al
// agente (y, con Actions activo, github-protect.js lo exige como check
// requerido); "informativo" = se reporta, pero no frena nada.
//
//   rama-commits  -> #1 rama-formato, #2 commits-formato          (informativo)
//   secretos      -> #3 sin-secretos                              (bloqueante)
//   pr-metadata   -> #5 base=dev, #6 mergeable, #8 version,
//                    #9 secciones-PR                              (bloqueante)
//
// Uso:
//   node scripts/check-pr-rules.mjs --grupo rama-commits [--pr <n|url>]
//   node scripts/check-pr-rules.mjs --grupo secretos [--pr <n|url>]
//   node scripts/check-pr-rules.mjs --grupo secretos --sin-pushear [--cabeza <ref>]
//   node scripts/check-pr-rules.mjs --grupo pr-metadata --pr <n|url>
//
// Con --pr, base, rama y cabeza salen del PR (gh pr view): el check mira lo que
// ve GitHub, no el checkout local; corre antes `git fetch origin` para que la
// cabeza del PR exista en local. --sin-pushear revisa cada commit que un push
// subiria (los que no estan en ningun origin/*), no solo el arbol final.
//
// Exit 0: sin FAIL. Exit 1: alguna regla dio FAIL. Exit 2: no se pudo verificar
// (gh o git fallaron, o el uso es incorrecto) y se imprime una linea [ERROR].
// Las reglas en skip (no medibles en este contexto) se reportan pero no fallan.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// El prefijo opcional en mayusculas es el ID rastreable que la skill exige
// anteponer al slug: milestone del Vault sin clave de proyecto (feature/M4-playbook,
// una rama por milestone — la clave la aporta vault.local.json) o tarea de un
// tracker externo (feature/REA-123-captura-lead). Las ramas viejas con clave
// (feature/SHS-M4-...) y por tarea (feature/SHS-M4-T001-...) siguen validando.
// El slug admite puntos ademas de [a-z0-9-]: un bump de version como
// chore/bump-3.6.0 es un slug legitimo (precedente ya mergeado:
// feature/SHS-M15-T001-bump-3.5.0) y la skill soutec-github no los prohibe.
const RAMA_REGEX = /^(feature|fix|hotfix|docs|chore|refactor|experiment)\/(?:(?:M\d+|[A-Z][A-Z0-9]{1,3}(?:-[A-Z0-9]+)+)-)?[a-z0-9.-]+$/
const RAMA_LISTA_NEGRA = ['cambios', 'prueba', 'final', 'final-final', 'arreglo']
const COMMIT_TIPOS = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'style', 'build', 'ci', 'perf', 'revert']
// La descripcion puede arrancar en mayuscula: una sigla legitima (PR, API, CI,
// ID) no tiene por que forzarse a minuscula (precedente: commit 9dbe36f,
// "fix: PR a main solo puede venir de dev..." rechazado sin motivo real -- la
// skill soutec-github nunca exigio minuscula, solo "descripcion breve").
// El primer caracter admite tildes y enie (fix: ícono, feat: ñoquis...): el
// español los usa en palabras corrientes, no son un caso raro a excluir.
// "revert" admite mayuscula inicial (Revert: ...): es el unico tipo cuyo
// commit suele generarse a mano imitando el "Revert" de git, no tipeado
// como los demas tipos en minuscula.
const TIPOS_REGEX = COMMIT_TIPOS.map((t) => (t === 'revert' ? '[Rr]evert' : t)).join('|')
const COMMIT_REGEX = new RegExp(`^(${TIPOS_REGEX}): [a-zA-ZÁÉÍÓÚÜÑáéíóúüñ].*[^.]$`)
const COMMIT_MENSAJES_PROHIBIDOS = ['update', 'fix', 'cosas', 'ya', 'ahora si', 'ahora sí']
// .env.example (y sus variantes sample/template/dist) es la plantilla sin
// valores que la propia skill pide commitear y que el harness siembra: no es un
// secreto. Cualquier otro .env.* si lo es (.env.local, .env.staging...).
const SECRETO_ARCHIVOS = [
  /(^|\/)\.env(?!\.(?:example|sample|template|dist)$)(\..+)?$/,
  /\.pem$/,
  /\.key$/,
  /\.pfx$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)secrets\.json$/,
]

// Sin prompts de credenciales: un check que se cuelga esperando un usuario
// que no existe (hook, CI) es peor que uno que falla.
const ENTORNO = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }

function sh(args, { red = false } = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    env: ENTORNO,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: red ? 60_000 : undefined,
  }).trim()
}

// core.quotePath=false + -z: con el default, git escribe una ruta con tildes o
// enie ("configuración/.env") entre comillas y con escapes octales, y ningun
// patron anclado con $ la reconoce.
function rutas(args) {
  const salida = execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    env: ENTORNO,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return rutasDeSalidaZ(salida)
}

export function rutasDeSalidaZ(salida) {
  return salida
    .split('\0')
    .map((s) => s.replace(/^\n+/, ''))
    .filter(Boolean)
}

export function describeError(e) {
  if (e?.code === 'ENOENT') return `no se encontro "${e.path ?? 'el comando'}" en el PATH`
  if (e?.code === 'ETIMEDOUT' || e?.signal === 'SIGTERM') return 'se agoto el tiempo de espera'
  const stderr = (e?.stderr ?? '').toString().trim()
  return (stderr || String(e?.message ?? e)).split('\n')[0]
}

function ramaActual() {
  // En un checkout de pull_request, Actions hace HEAD detached sobre un merge
  // commit sintetico (refs/pull/<n>/merge): "git rev-parse --abbrev-ref HEAD"
  // devuelve literalmente "HEAD". GITHUB_HEAD_REF trae el nombre real de la rama.
  return process.env.GITHUB_HEAD_REF || sh(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
}

function cabezaDeLaRama() {
  // Mismo motivo que ramaActual(): en el checkout de PR, Actions resuelve
  // refs/pull/<n>/merge, un merge commit sintetico donde el padre 1 es la
  // base y el padre 2 es la cabeza real de la rama.
  if (process.env.GITHUB_HEAD_REF) {
    try {
      return sh(['git', 'rev-parse', 'HEAD^2'])
    } catch {
      return 'HEAD'
    }
  }
  return 'HEAD'
}

// Con --pr la cabeza es el commit que GitHub tiene como cabeza del PR, no el
// checkout local (que puede ser otra rama o tener commits sin pushear). Si ese
// commit no esta en local, las reglas que lo necesitan salen en skip: evaluar
// HEAD en su lugar daria un resultado sobre algo que no es el PR.
function cabezaDelPR(pr) {
  if (!pr?.headRefOid) return null
  try {
    sh(['git', 'cat-file', '-e', `${pr.headRefOid}^{commit}`])
    return pr.headRefOid
  } catch {
    return null
  }
}

function commitsDeLaRama(baseRef, cabeza) {
  const log = sh(['git', 'log', `${baseRef}..${cabeza}`, '--no-merges', '--format=%H%x1f%s'])
  if (!log) return []
  return log.split('\n').map((linea) => {
    const [hash, subject] = linea.split('\x1f')
    return { hash, subject }
  })
}

// Diff de arboles: lo que el PR agregaria a la base al mergearse.
function archivosAgregados(baseRef, cabeza) {
  return rutas(['diff', `${baseRef}..${cabeza}`, '--diff-filter=A', '--name-only', '-z'])
}

// Commit por commit, todo lo que un push subiria: un archivo agregado en un
// commit y borrado en el siguiente no aparece en el diff de arboles, pero el
// push sube igual el commit que lo contiene.
function archivosSinPushear(cabeza) {
  return rutas(['log', cabeza, '--not', '--remotes=origin', '--diff-filter=A', '--name-only', '-z', '--format='])
}

function tagsRemotos() {
  return sh(['git', 'ls-remote', '--tags', '--refs', 'origin'], { red: true })
    .split('\n')
    .map((linea) => linea.split('\t')[1]?.replace(/^refs\/tags\//, ''))
    .filter(Boolean)
}

function tagsLocales() {
  return sh(['git', 'tag', '-l', 'v*']).split('\n').filter(Boolean)
}

export function ultimoTagDe(nombres) {
  const semver = nombres.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort(compararSemver)
  return semver.at(-1) ?? null
}

// Los tags del remoto, no los locales: en la maquina de un dev pueden estar
// viejos, y un fetch para refrescarlos tocaria refs (y falla con el tag movil
// vX desactualizado). ls-remote es de solo lectura. Sin red, los locales.
function ultimoTag() {
  try {
    return ultimoTagDe(tagsRemotos())
  } catch {
    try {
      return ultimoTagDe(tagsLocales())
    } catch {
      return null
    }
  }
}

function compararSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// El release dev -> main es un PR sobre la propia rama "dev": nunca va a
// cumplir tipo/descripcion-corta porque no es una rama de trabajo (skill
// soutec-github §Pull Request). baseRefName === 'main' es la misma senal que
// ya usa evaluaBaseDev para reconocer el release. Ninguna rama de trabajo,
// ni siquiera hotfix/*, mergea directo a main (CLAUDE.md, regla dura).
export function evaluaRama(nombre, baseRefName) {
  if (nombre === 'dev' && baseRefName === 'main') {
    return { regla: 'rama-formato', cumple: true, detalle: 'PR de release dev -> main' }
  }
  if (baseRefName === 'main') {
    return { regla: 'rama-formato', cumple: false, detalle: `PR a main solo puede venir de "dev", no de "${nombre}"` }
  }
  if (!RAMA_REGEX.test(nombre)) {
    return { regla: 'rama-formato', cumple: false, detalle: `"${nombre}" no cumple tipo/descripcion-corta` }
  }
  // Coincidencia exacta: la lista caza nombres vagos ("prueba" a secas), no
  // descripciones legitimas que empiecen igual (experiment/prueba-modelo-rag
  // es un ejemplo valido de la propia skill).
  const slug = nombre.split('/').slice(1).join('/')
  const enListaNegra = RAMA_LISTA_NEGRA.includes(slug)
  if (enListaNegra) {
    return { regla: 'rama-formato', cumple: false, detalle: `"${nombre}" usa un slug prohibido` }
  }
  return { regla: 'rama-formato', cumple: true, detalle: nombre }
}

export function evaluaCommits(commits) {
  if (commits.length === 0) {
    return [{ regla: 'commits-formato', cumple: null, detalle: 'sin commits nuevos contra la base' }]
  }
  return commits.map(({ hash, subject }) => {
    const corto = hash.slice(0, 7)
    if (!COMMIT_REGEX.test(subject)) {
      return { regla: 'commits-formato', cumple: false, detalle: `${corto} "${subject}" no matchea tipo: descripcion` }
    }
    const mensaje = subject.split(': ').slice(1).join(': ').trim().toLowerCase()
    if (COMMIT_MENSAJES_PROHIBIDOS.includes(mensaje)) {
      return { regla: 'commits-formato', cumple: false, detalle: `${corto} "${subject}" es un mensaje prohibido` }
    }
    return { regla: 'commits-formato', cumple: true, detalle: `${corto} "${subject}"` }
  })
}

export function esArchivoDeSecreto(ruta) {
  return SECRETO_ARCHIVOS.some((patron) => patron.test(ruta))
}

export function evaluaSecretos(archivos, donde = 'agregados') {
  const encontrados = archivos.filter(esArchivoDeSecreto)
  if (encontrados.length > 0) {
    return { regla: 'sin-secretos', cumple: false, detalle: `archivos sospechosos ${donde}: ${encontrados.join(', ')}` }
  }
  return { regla: 'sin-secretos', cumple: true, detalle: `sin archivos de credenciales ${donde}` }
}

function evaluaBaseDev(baseRefName, nombreRama) {
  if (baseRefName == null) {
    return { regla: 'pr-apunta-a-dev', cumple: null, detalle: 'no hay datos de PR (falta --pr o gh)' }
  }
  if (baseRefName === 'main') {
    if (nombreRama === 'dev') {
      return { regla: 'pr-apunta-a-dev', cumple: true, detalle: 'PR de release dev -> main' }
    }
    return { regla: 'pr-apunta-a-dev', cumple: false, detalle: `base es "main" pero la rama es "${nombreRama}", debe ser "dev"` }
  }
  if (baseRefName !== 'dev') {
    return { regla: 'pr-apunta-a-dev', cumple: false, detalle: `base es "${baseRefName}", debe ser "dev"` }
  }
  return { regla: 'pr-apunta-a-dev', cumple: true, detalle: 'base = dev' }
}

function evaluaMergeable(pr) {
  if (pr == null) {
    return { regla: 'rama-al-dia-sin-conflictos', cumple: null, detalle: 'no hay datos de PR' }
  }
  if (pr.mergeable === 'UNKNOWN') {
    return { regla: 'rama-al-dia-sin-conflictos', cumple: null, detalle: 'GitHub todavia no calculo mergeable' }
  }
  return {
    regla: 'rama-al-dia-sin-conflictos',
    cumple: pr.mergeable === 'MERGEABLE',
    detalle: `mergeable=${pr.mergeable}`,
  }
}

// Justo despues de gh pr create, GitHub todavia no calculo si el PR mergea
// limpio (UNKNOWN) y la regla saldria en skip casi siempre. Se relee solo ese
// campo unas veces antes de rendirse; si la relectura falla, queda el skip.
export function esperaMergeable(pr, releer, dormir, { intentos = 4, esperaMs = 3000 } = {}) {
  let actual = pr
  for (let i = 0; i < intentos && actual?.mergeable === 'UNKNOWN'; i++) {
    dormir(esperaMs)
    try {
      actual = { ...actual, mergeable: releer() }
    } catch {
      break
    }
  }
  return actual
}

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function extraeSeccion(cuerpo, titulo) {
  // El lookahead (?=\n## |$) se combina con el flag 'm' del anchor ^, y ahi
  // $ significa fin-de-linea (no fin-de-string): corta la seccion en su
  // primera linea. (?![\s\S]) fuerza fin-de-string real.
  const regex = new RegExp(`^## ${titulo}\\s*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'm')
  const m = cuerpo.match(regex)
  return m ? m[1].trim() : null
}

export function evaluaVersion(pr, baseRefName) {
  if (pr == null) {
    return { regla: 'version-semver', cumple: null, detalle: 'no hay datos de PR' }
  }
  const seccion = extraeSeccion(pr.body ?? '', 'Requiere versión / release')
  if (seccion == null) {
    return { regla: 'version-semver', cumple: false, detalle: 'falta la seccion "Requiere versión / release"' }
  }
  const marcadosSi = /- \[x\] S[ií]/i.test(seccion)
  const marcadosNo = /- \[x\] No/i.test(seccion)
  if (marcadosSi === marcadosNo) {
    return { regla: 'version-semver', cumple: false, detalle: 'debe marcarse exactamente una de No/Si' }
  }
  if (!marcadosSi) {
    return { regla: 'version-semver', cumple: true, detalle: 'No requiere version' }
  }
  const m = seccion.match(/Versi[oó]n sugerida:\s*(v\d+\.\d+\.\d+)/i)
  if (!m) {
    return { regla: 'version-semver', cumple: false, detalle: 'marco "Si" pero no propuso vX.Y.Z' }
  }
  const propuesta = m[1]
  if (baseRefName !== 'main') {
    return { regla: 'version-semver', cumple: true, detalle: `${propuesta} (formato valido; comparacion con tags solo aplica en PR dev->main)` }
  }
  const ultimo = ultimoTag()
  if (ultimo && compararSemver(propuesta, ultimo) <= 0) {
    return { regla: 'version-semver', cumple: false, detalle: `${propuesta} no es mayor al ultimo tag ${ultimo}` }
  }
  return { regla: 'version-semver', cumple: true, detalle: `${propuesta} > ${ultimo ?? '(sin tags previos)'}` }
}

function plantillaPR() {
  try {
    return readFileSync('.github/pull_request_template.md', 'utf8')
  } catch {
    return ''
  }
}

export function evaluaSeccionesCompletas(pr) {
  if (pr == null) {
    return { regla: 'sin-secciones-vacias', cumple: null, detalle: 'no hay datos de PR' }
  }
  const cuerpo = pr.body ?? ''
  const plantilla = plantillaPR()
  const secciones = ['Descripción del cambio', 'Evidencia', 'Impacto / Riesgos']
  const vacias = secciones.filter((titulo) => {
    const contenido = extraeSeccion(cuerpo, titulo)
    if (contenido == null) return true
    if (contenido === '' || /^n\/a\.?$/i.test(contenido)) return true
    // Plantilla intacta: el texto guia de la seccion quedo tal cual, sin rellenar.
    const guia = extraeSeccion(plantilla, titulo)
    return guia != null && guia !== '' && contenido === guia
  })
  if (vacias.length > 0) {
    return { regla: 'sin-secciones-vacias', cumple: false, detalle: `vacias, "N/A" o con el texto de la plantilla: ${vacias.join(', ')}` }
  }
  return { regla: 'sin-secciones-vacias', cumple: true, detalle: 'secciones clave con contenido' }
}

// --pr acepta el numero o la URL del PR. La URL evita que gh tenga que elegir
// remoto (con varios remotos, pregunta o falla).
function obtenerPR(pr) {
  const campos = 'baseRefName,headRefName,headRefOid,body,mergeable,state'
  return JSON.parse(sh(['gh', 'pr', 'view', String(pr), '--json', campos], { red: true }))
}

function releerMergeable(pr) {
  return sh(['gh', 'pr', 'view', String(pr), '--json', 'mergeable', '--jq', '.mergeable'], { red: true })
}

// Con PR, base y rama salen del PR; sin PR, del entorno de Actions o del
// checkout local. Un GITHUB_BASE_REF vacio (Actions lo define vacio fuera de
// pull_request) cae a "dev".
export function contextoDelCheck({ pr = null, envBase = '', ramaLocal = null } = {}) {
  return {
    base: pr?.baseRefName || envBase || 'dev',
    rama: pr?.headRefName || ramaLocal,
  }
}

function resuelveRef(nombre) {
  try {
    sh(['git', 'rev-parse', '--verify', `origin/${nombre}`])
    return `origin/${nombre}`
  } catch {
    return nombre
  }
}

function sinCabeza(regla) {
  return { regla, cumple: null, detalle: 'la cabeza del PR no esta en local (corre git fetch origin)' }
}

const GRUPOS = ['rama-commits', 'secretos', 'pr-metadata']

function evaluar(values) {
  let pr = values.pr ? obtenerPR(values.pr) : null
  const { base, rama } = contextoDelCheck({
    pr,
    envBase: process.env.GITHUB_BASE_REF,
    ramaLocal: pr?.headRefName ? null : ramaActual(),
  })
  const baseLocal = resuelveRef(base)
  const cabeza = pr ? cabezaDelPR(pr) : values.cabeza || cabezaDeLaRama()

  const resultados = []
  if (values.grupo === 'rama-commits') {
    resultados.push(evaluaRama(rama, pr?.baseRefName ?? null))
    resultados.push(...(cabeza ? evaluaCommits(commitsDeLaRama(baseLocal, cabeza)) : [sinCabeza('commits-formato')]))
  }
  if (values.grupo === 'secretos') {
    if (values['sin-pushear']) {
      resultados.push(evaluaSecretos(archivosSinPushear(values.cabeza || 'HEAD'), 'en commits sin pushear'))
    } else {
      resultados.push(cabeza ? evaluaSecretos(archivosAgregados(baseLocal, cabeza)) : sinCabeza('sin-secretos'))
    }
  }
  if (values.grupo === 'pr-metadata') {
    // Un PR mergeado o cerrado reporta UNKNOWN para siempre: reintentar ahi es
    // pura espera.
    if (pr?.state === 'OPEN') pr = esperaMergeable(pr, () => releerMergeable(values.pr), dormir)
    resultados.push(evaluaBaseDev(pr?.baseRefName ?? null, rama))
    resultados.push(evaluaMergeable(pr))
    resultados.push(evaluaVersion(pr, pr?.baseRefName ?? null))
    resultados.push(evaluaSeccionesCompletas(pr))
  }
  return resultados
}

function main() {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        pr: { type: 'string' },
        grupo: { type: 'string' },
        cabeza: { type: 'string' },
        'sin-pushear': { type: 'boolean' },
      },
    }))
  } catch (e) {
    console.log(`[ERROR] uso: ${describeError(e)}`)
    process.exit(2)
  }
  if (!GRUPOS.includes(values.grupo)) {
    console.log(`[ERROR] uso: --grupo debe ser uno de: ${GRUPOS.join(', ')}`)
    process.exit(2)
  }

  let resultados
  try {
    resultados = evaluar(values)
  } catch (e) {
    console.log(`[ERROR] ${values.grupo}: no se pudo verificar: ${describeError(e)}`)
    process.exit(2)
  }

  let huboFalse = false
  for (const r of resultados) {
    const marca = r.cumple === true ? 'OK  ' : r.cumple === false ? 'FAIL' : 'skip'
    console.log(`[${marca}] ${r.regla}: ${r.detalle}`)
    if (r.cumple === false) huboFalse = true
  }

  process.exit(huboFalse ? 1 : 0)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
