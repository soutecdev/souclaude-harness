import path from 'node:path'
import { readIfExists, writeFileLF } from './fsx.js'
import { sinBom } from './jsonmerge.js'

export const LOCKFILE = '.claude/harness.json'

// Se commitea. Es la fuente de verdad del equipo sobre que version del harness
// tiene el repo y que archivos siguen intactos vs cuales toco el usuario.
//
// Ausente -> null (repo sin harness). Presente pero ilegible como JSON -> error:
// antes tambien devolvia null, y un lockfile con marcadores de conflicto de git
// (dos ramas que corrieron upgrade) o truncado hacia que el CLI tratara al repo
// como "sin harness": autodetectaba `adopt`, clasificaba todo lo editado como
// ajeno (.new) y reescribia el lockfile sin los hashes previos, sin avisar.
export function readLockfile(cwd) {
  const raw = readIfExists(path.join(cwd, '.claude', 'harness.json'))
  if (raw == null || sinBom(raw).trim() === '') return null
  let parsed
  try {
    parsed = JSON.parse(sinBom(raw))
  } catch (err) {
    throw lockfileInvalido(err.message)
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) throw lockfileInvalido('no es un objeto')
  for (const clave of ['files', 'blocks', 'vars']) {
    parsed[clave] ??= {}
    if (typeof parsed[clave] !== 'object' || Array.isArray(parsed[clave])) throw lockfileInvalido(`"${clave}" no es un objeto`)
  }
  return parsed
}

function lockfileInvalido(detalle) {
  return new Error(
    `.claude/harness.json existe pero no es un lockfile valido (${detalle}). ` +
      'Si quedo con marcadores de conflicto de un merge (<<<<<<< / >>>>>>>), conserva una de las dos versiones completas; ' +
      'si esta dañado, recuperalo con `git checkout -- .claude/harness.json`. No se escribio nada.'
  )
}

export function writeLockfile(cwd, lock) {
  writeFileLF(path.join(cwd, '.claude', 'harness.json'), JSON.stringify(lock, null, 2))
}

export function emptyLockfile() {
  return { harnessVersion: '0.0.0', files: {}, blocks: {}, vars: {} }
}

// Comparacion semver simple. Las versiones del harness son siempre X.Y.Z.
export function lt(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x < y) return true
    if (x > y) return false
  }
  return false
}
