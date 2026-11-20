import fs from 'node:fs'
import path from 'node:path'

// Los placeholders "cloud-only" de OneDrive pueden tirar al leer, y el repo del
// usuario puede estar sincronizado. Nunca dejamos que eso explote el CLI.
export function readIfExists(abs) {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

// Lectura para el MOTOR DE PLAN: distingue "no existe" de "existe y no se pudo
// leer". readIfExists trata cualquier fallo como ausencia, y eso esta bien para
// config opcional; para clasificar un archivo del usuario, no. Un archivo que
// existe pero no se deja leer (abierto por otro programa, retenido por el
// antivirus, placeholder de OneDrive sin conexion, permisos) se clasificaba como
// `create` y el motor escribia encima: sin .new y sin backup, justo lo que la
// garantia del harness promete que nunca pasa. Aca solo ENOENT/ENOTDIR son
// "ausente"; cualquier otro error corta el plan ANTES de escribir un byte.
export function leerParaElPlan(abs, dest, { binario = false } = {}) {
  try {
    return binario ? fs.readFileSync(abs) : fs.readFileSync(abs, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null
    throw new Error(
      `No se pudo leer ${dest} (${err?.code ?? err?.message ?? 'error desconocido'}): existe, pero no se deja leer ` +
        '(¿abierto en otro programa, retenido por el antivirus, pendiente de descarga en OneDrive, o es una carpeta?). ' +
        'No se escribio nada. Cierralo o espera a que sincronice y vuelve a correr el comando.'
    )
  }
}

// Un `dest` del manifest o una clave del lockfile es siempre una ruta POSIX
// relativa DENTRO del repo. El lockfile se commitea y llega por PR como cualquier
// otro archivo: una clave "../algo" hacia que --prune borrara, y el motor
// escribiera, fuera del repo. Nada con forma de ruta absoluta, de unidad de
// Windows o con segmentos `..` / `.` / vacios pasa de aca.
export function esDestSeguro(dest) {
  if (typeof dest !== 'string' || dest === '' || dest.includes('\0')) return false
  if (/^[\\/]/.test(dest) || /^[A-Za-z]:/.test(dest)) return false
  return !dest.split(/[\\/]/).some((seg) => seg === '' || seg === '.' || seg === '..')
}

export function exists(abs) {
  try {
    fs.accessSync(abs)
    return true
  } catch {
    return false
  }
}

// Escritura plana, siempre LF. NO usamos write-temp-then-rename: ese patron
// "atomico" es justo el que falla con EPERM bajo sync de OneDrive y antivirus.
export function writeFileLF(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const normalized = content.replace(/\r\n/g, '\n')
  fs.writeFileSync(abs, normalized.endsWith('\n') ? normalized : normalized + '\n', 'utf8')
}

// Variante binaria de readIfExists: devuelve un Buffer o null. Para los assets
// de skills (PNGs), donde una lectura utf8 corromperia los bytes.
export function readBytesIfExists(abs) {
  try {
    return fs.readFileSync(abs)
  } catch {
    return null
  }
}

// Escritura binaria: sin normalizacion LF ni newline final. Bytes tal cual.
export function writeFileBytes(abs, buf) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buf)
}

export function ensureDir(abs) {
  fs.mkdirSync(abs, { recursive: true })
}

export function listEntries(abs) {
  try {
    return fs.readdirSync(abs)
  } catch {
    return []
  }
}

// Siempre POSIX en el lockfile y en el manifest: un lockfile escrito en Windows
// tiene que ser legible por el mismo CLI corriendo en Linux (CI).
export function toPosix(p) {
  return p.split(path.sep).join('/')
}

export function fromPosix(cwd, p) {
  return path.join(cwd, ...p.split('/'))
}
