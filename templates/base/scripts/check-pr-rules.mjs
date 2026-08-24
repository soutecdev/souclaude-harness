#!/usr/bin/env node
// Verifica las reglas deterministas de PR de la skill soutec-github
// (.claude/skills/soutec-github/SKILL.md). Cubre: #1, #2, #3, #5, #6, #8, #9
// del documento "Cubo A". #4 es la interseccion de #2+#3 (no aporta chequeo
// propio). #7 y #10 quedaron fuera por decision explicita (ver PR que agrego
// este script): #7 no esta documentada en el skill, #10 no aplica a este repo.
//
// Uso:
//   node scripts/check-pr-rules.mjs                 # reglas locales (rama/commits/secretos)
//   node scripts/check-pr-rules.mjs --pr <numero>    # suma las reglas que dependen del PR en GitHub
//
// Sale con codigo 1 si alguna regla determinista en True/False dio False.
// Las reglas en None (no medibles en este contexto) se reportan pero no rompen el build.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// El prefijo opcional en mayusculas es el ID de tarea del tracker que la skill
// exige anteponer al slug (feature/REA-123-captura-lead, feature/SHS-M4-T001-...).
const RAMA_REGEX = /^(feature|fix|hotfix|docs|chore|refactor|experiment)\/(?:[A-Z][A-Z0-9]{1,3}(?:-[A-Z0-9]+)+-)?[a-z0-9-]+$/
const RAMA_LISTA_NEGRA = ['cambios', 'prueba', 'final', 'final-final', 'arreglo']
const COMMIT_TIPOS = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'style', 'build', 'ci', 'perf', 'revert']
const COMMIT_REGEX = new RegExp(`^(${COMMIT_TIPOS.join('|')}): [a-z].*[^.]$`)
const COMMIT_MENSAJES_PROHIBIDOS = ['update', 'fix', 'cosas', 'ya', 'ahora si', 'ahora sí']
const SECRETO_ARCHIVOS = [/(^|\/)\.env(\..+)?$/, /\.pem$/, /\.key$/, /\.pfx$/, /(^|\/)credentials\.json$/, /(^|\/)secrets\.json$/]

function sh(args) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8' }).trim()
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

function commitsDeLaRama(baseRef) {
  const cabeza = cabezaDeLaRama()
  const log = sh(['git', 'log', `${baseRef}..${cabeza}`, '--no-merges', '--format=%H%x1f%s'])
  if (!log) return []
  return log.split('\n').map((linea) => {
    const [hash, subject] = linea.split('\x1f')
    return { hash, subject }
  })
}

function archivosAgregados(baseRef) {
  const cabeza = cabezaDeLaRama()
  const salida = sh(['git', 'diff', `${baseRef}..${cabeza}`, '--diff-filter=A', '--name-only'])
  return salida ? salida.split('\n') : []
}

function ultimoTag() {
  try {
    const tags = sh(['git', 'tag', '-l', 'v[0-9]*.[0-9]*.[0-9]*'])
      .split('\n')
      .filter(Boolean)
      .sort((a, b) => compararSemver(a, b))
    return tags.at(-1) ?? null
  } catch {
    return null
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

export function evaluaRama(nombre) {
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

function evaluaCommits(commits) {
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

function evaluaSecretos(archivos) {
  const encontrados = archivos.filter((ruta) => SECRETO_ARCHIVOS.some((patron) => patron.test(ruta)))
  if (encontrados.length > 0) {
    return { regla: 'sin-secretos', cumple: false, detalle: `archivos sospechosos agregados: ${encontrados.join(', ')}` }
  }
  return { regla: 'sin-secretos', cumple: true, detalle: 'sin archivos de credenciales agregados' }
}

function evaluaBaseDev(baseRefName) {
  if (baseRefName == null) {
    return { regla: 'pr-apunta-a-dev', cumple: null, detalle: 'no hay datos de PR (falta --pr o gh)' }
  }
  if (baseRefName === 'main') {
    return { regla: 'pr-apunta-a-dev', cumple: true, detalle: 'PR de release dev -> main' }
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

function obtenerPR(numero) {
  if (numero == null) return null
  const json = sh(['gh', 'pr', 'view', String(numero), '--json', 'baseRefName,body,mergeable'])
  return JSON.parse(json)
}

function resuelveRef(nombre) {
  try {
    sh(['git', 'rev-parse', '--verify', `origin/${nombre}`])
    return `origin/${nombre}`
  } catch {
    return nombre
  }
}

function main() {
  const { values } = parseArgs({ options: { pr: { type: 'string' } } })
  const baseLocal = resuelveRef(process.env.GITHUB_BASE_REF || 'dev')

  const pr = obtenerPR(values.pr)
  const baseRefName = pr?.baseRefName ?? (values.pr ? null : baseLocal)

  const resultados = []
  resultados.push(evaluaRama(ramaActual()))
  resultados.push(...evaluaCommits(commitsDeLaRama(baseLocal)))
  resultados.push(evaluaSecretos(archivosAgregados(baseLocal)))
  resultados.push(evaluaBaseDev(pr?.baseRefName ?? null))
  resultados.push(evaluaMergeable(pr))
  resultados.push(evaluaVersion(pr, baseRefName))
  resultados.push(evaluaSeccionesCompletas(pr))

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
