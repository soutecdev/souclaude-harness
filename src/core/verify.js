import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATES_DIR } from './manifest.js'
import { toPosix, esDestSeguro } from './fsx.js'
import { SIGNATURES } from './detect.js'
import { MODOS } from './plan.js'

export const ERROR = 'error'
export const WARNING = 'warning'

// Rutas del propio generador (el CLI, no lo que instala). No van en el manifest
// porque el manifest describe el harness que se distribuye a un proyecto
// consumidor, no la anatomia del generador. Se listan aca, no en un archivo
// aparte, porque son solo 3 y no cambian con cada skill/agente nuevo.
const GENERATOR_CRITICAL_FILES = ['package.json', 'bin/cli.mjs', 'templates/harness.manifest.json']

// Camina un subdirectorio de templates/ y devuelve rutas POSIX relativas a
// templates/ (ej. "base/claude/skills/ccem-planner/SKILL.md"). `root` es
// inyectable para poder testear con un directorio temporal fabricado a mano.
export function walkTemplateFiles(subdir = 'base', root = TEMPLATES_DIR) {
  const out = []
  const abs = path.join(root, subdir)
  const walk = (cur, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(cur, e.name), rel)
      else out.push(toPosix(`${subdir}/${rel}`))
    }
  }
  walk(abs, '')
  return out
}

// Archivos fisicos en templates/base/** sin ningun entry en manifest.files[]
// que los referencie por `src`. Es basura acumulandose: nadie los borra, pero
// tampoco se instalan en ningun proyecto consumidor.
export function findOrphanTemplateFiles(manifest, root = TEMPLATES_DIR) {
  const declared = new Set(manifest.files.filter((f) => f.policy !== 'append-block').map((f) => f.src))
  return walkTemplateFiles('base', root)
    .filter((rel) => !declared.has(rel))
    .map((rel) => ({
      type: WARNING,
      code: 'orphan-template-file',
      message: `templates/${rel} existe pero ningun entry de manifest.files[] lo referencia.`,
    }))
}

// entry.src que no existe fisicamente. append-block usa un directorio de
// fragmentos (fragments/gitignore/*.txt), no un archivo unico -- se ignora,
// igual que ya hace el test "manifest: todos los templates declarados existen".
export function findMissingSrcFiles(manifest, root = TEMPLATES_DIR) {
  const errors = []
  for (const entry of manifest.files) {
    if (entry.policy === 'append-block') continue
    const abs = path.join(root, ...entry.src.split('/'))
    if (!fs.existsSync(abs)) {
      errors.push({
        type: ERROR,
        code: 'missing-src',
        message: `manifest.files[] entry "${entry.id}" referencia "${entry.src}", que no existe en templates/.`,
      })
    }
  }
  return errors
}

// Los fragmentos de .gitignore por stack (templates/fragments/gitignore/*.txt) no
// pasan por manifest.files[]: el entry "gitignore" es append-block y su `src` es el
// directorio entero, no un archivo, asi que findMissingSrcFiles/findOrphanTemplateFiles
// los ignoran a proposito. Sin este chequeo, un fragmento renombrado, mal tipeado o
// para un stack que detect.js no reconoce nunca se detectaria: nadie lo referencia,
// nadie se entera. `base.txt` es la excepcion: se concatena siempre, no es por-stack.
export function findOrphanFragments(root = TEMPLATES_DIR) {
  const dir = path.join(root, 'fragments', 'gitignore')
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }

  const known = new Set(['base.txt', ...SIGNATURES.map((s) => `${s.stack}.txt`)])
  return entries
    .filter((name) => name.endsWith('.txt') && !known.has(name))
    .map((name) => ({
      type: WARNING,
      code: 'orphan-gitignore-fragment',
      message: `templates/fragments/gitignore/${name} no corresponde a base.txt ni a ningun stack de detect.js: nunca se incluye en el .gitignore emitido.`,
    }))
}

export function findDuplicateIds(manifest) {
  const seen = new Map()
  const errors = []
  for (const entry of manifest.files) {
    const count = (seen.get(entry.id) ?? 0) + 1
    seen.set(entry.id, count)
    if (count === 2) {
      errors.push({ type: ERROR, code: 'duplicate-id', message: `manifest.files[] tiene mas de un entry con id "${entry.id}".` })
    }
  }
  return errors
}

// Dos entries con el mismo dest son un error salvo que nunca puedan emitirse en
// la misma corrida. Se evalua POR MODO (SHS-M34): en cada modo, los entries
// activos sobre un dest (los que no declaran "modos" cuentan en todos) solo
// pueden convivir si todos son merge-json — computePlan los funde en una sola
// accion (ver src/core/plan.js), asi que no se pisan. Un dest compartido por
// entries de modos disjuntos (CLAUDE.md de equipo vs de solo) es valido: cada
// corrida emite a lo sumo uno.
export function findDuplicateDests(manifest) {
  const byDest = new Map()
  for (const entry of manifest.files) {
    const group = byDest.get(entry.dest) ?? []
    group.push(entry)
    byDest.set(entry.dest, group)
  }
  const errors = []
  for (const [dest, group] of byDest) {
    if (group.length < 2) continue
    const chocanEnAlgunModo = MODOS.some((modo) => {
      const activos = group.filter((e) => !e.modos || e.modos.includes(modo))
      return activos.length > 1 && !activos.every((e) => e.policy === 'merge-json')
    })
    if (chocanEnAlgunModo) {
      errors.push({ type: ERROR, code: 'duplicate-dest', message: `manifest.files[] tiene mas de un entry con dest "${dest}" emitible en el mismo modo.` })
    }
  }
  return errors
}

// "Critico" para el lado consumidor = entry con critical:true cuyo src falta.
// Para el lado generador = las 3 rutas fijas de arriba, que no viven en el
// manifest porque describen al propio CLI.
export function findMissingCriticalFiles(manifest, root = TEMPLATES_DIR) {
  const errors = []
  for (const entry of manifest.files.filter((f) => f.critical)) {
    const abs = path.join(root, ...entry.src.split('/'))
    if (!fs.existsSync(abs)) {
      errors.push({ type: ERROR, code: 'missing-critical', message: `Archivo critico "${entry.id}" (${entry.src}) no existe.` })
    }
  }

  const repoRoot = path.join(root, '..')
  for (const rel of GENERATOR_CRITICAL_FILES) {
    if (!fs.existsSync(path.join(repoRoot, ...rel.split('/')))) {
      errors.push({ type: ERROR, code: 'missing-critical-generator', message: `Archivo critico del generador "${rel}" no existe.` })
    }
  }
  return errors
}

export const POLITICAS = ['managed', 'user-owned', 'append-block', 'merge-json']

// El contrato del manifest, entry por entry. No hay JSON Schema ni tipos: sin
// esto, una policy mal tipeada caia al `default` de desiredContent (se trataba
// como managed), un "modos" con un valor inexistente dejaba el archivo fuera de
// TODOS los modos sin avisar, y un asset binario sin `binary: true` se leia como
// utf8 y se instalaba corrupto. Se valida aca, que es lo que corre el CI.
export function findInvalidEntries(manifest, root = TEMPLATES_DIR) {
  const errors = []
  const mal = (code, message) => errors.push({ type: ERROR, code, message })
  const stacks = new Set(SIGNATURES.map((s) => s.stack))
  const skills = manifest.skills ?? []
  const idsDeSkills = new Set(skills.map((s) => s.id))
  const modosValidos = (modos) => modos === undefined || (Array.isArray(modos) && modos.length > 0 && modos.every((m) => MODOS.includes(m)))

  if (idsDeSkills.size !== skills.length) mal('duplicate-skill', 'manifest.skills[] tiene ids repetidos.')
  for (const s of skills) {
    if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) mal('invalid-skill', `manifest.skills[]: id invalido (${JSON.stringify(s.id)}).`)
    if (!modosValidos(s.modos)) mal('invalid-modos', `skill "${s.id}": "modos" debe ser una lista no vacia de ${MODOS.join(' | ')}.`)
  }

  for (const entry of manifest.files ?? []) {
    const quien = `entry "${entry.id}"`
    if (typeof entry.id !== 'string' || entry.id === '') mal('invalid-id', `manifest.files[]: entry sin id (dest ${JSON.stringify(entry.dest)}).`)
    if (typeof entry.src !== 'string' || !esDestSeguro(entry.src)) mal('invalid-src', `${quien}: "src" debe ser una ruta relativa dentro de templates/ (${JSON.stringify(entry.src)}).`)
    if (!esDestSeguro(entry.dest)) mal('invalid-dest', `${quien}: "dest" debe ser una ruta relativa dentro del repo destino (${JSON.stringify(entry.dest)}).`)
    if (!POLITICAS.includes(entry.policy)) mal('invalid-policy', `${quien}: policy ${JSON.stringify(entry.policy)} no es una de ${POLITICAS.join(' | ')}.`)
    if (!modosValidos(entry.modos)) mal('invalid-modos', `${quien}: "modos" debe ser una lista no vacia de ${MODOS.join(' | ')}.`)
    if (entry.when !== undefined && entry.when !== 'empty-repo' && !(typeof entry.when === 'string' && entry.when.startsWith('stack:') && stacks.has(entry.when.slice('stack:'.length)))) {
      mal('invalid-when', `${quien}: "when" ${JSON.stringify(entry.when)} no es "empty-repo" ni "stack:<${[...stacks].join('|')}>".`)
    }
    if (entry.skill !== undefined && !idsDeSkills.has(entry.skill)) mal('unknown-skill', `${quien}: la skill "${entry.skill}" no esta en manifest.skills[].`)
    if (entry.binary && (entry.render || entry.policy !== 'managed')) mal('invalid-binary', `${quien}: un binario solo puede ser managed y sin render.`)

    if (entry.policy === 'append-block' || typeof entry.src !== 'string' || !esDestSeguro(entry.src)) continue
    let bytes
    try {
      bytes = fs.readFileSync(path.join(root, ...entry.src.split('/')))
    } catch {
      continue // el src ausente lo reporta findMissingSrcFiles
    }
    const texto = bytes.toString('utf8')
    if (!entry.binary && (bytes.includes(0) || !Buffer.from(texto, 'utf8').equals(bytes))) {
      mal('binary-sin-declarar', `${quien}: ${entry.src} no es texto utf8 y no lleva "binary": true; se instalaria corrupto.`)
    }
    if (entry.policy === 'merge-json') {
      try {
        JSON.parse(texto)
      } catch (err) {
        mal('invalid-json-seed', `${quien}: ${entry.src} no es JSON valido (${err.message}).`)
      }
    }
  }

  for (const d of manifest.dirs ?? []) if (!esDestSeguro(d.dest)) mal('invalid-dest', `manifest.dirs[]: dest invalido (${JSON.stringify(d.dest)}).`)
  for (const o of manifest.obsolete ?? []) if (!esDestSeguro(o.dest)) mal('invalid-dest', `manifest.obsolete[]: dest invalido (${JSON.stringify(o.dest)}).`)
  if (typeof manifest.harnessVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.harnessVersion)) {
    mal('invalid-version', `manifest.harnessVersion debe ser X.Y.Z (${JSON.stringify(manifest.harnessVersion)}).`)
  }
  return errors
}

export function verifyManifest(manifest, root = TEMPLATES_DIR) {
  const errors = [
    ...findInvalidEntries(manifest, root),
    ...findMissingSrcFiles(manifest, root),
    ...findDuplicateIds(manifest),
    ...findDuplicateDests(manifest),
    ...findMissingCriticalFiles(manifest, root),
  ]
  const warnings = [...findOrphanTemplateFiles(manifest, root), ...findOrphanFragments(root)]
  return { errors, warnings }
}
