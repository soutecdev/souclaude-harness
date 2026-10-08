import fs from 'node:fs'
import { lt } from './lockfile.js'

// SHS-M43-T004: el CHANGELOG viaja dentro del paquete (package.json "files"),
// asi el upgrade puede mostrar "que trae" la version recien instalada sin red
// ni repo clonado. Si el paquete no lo trae (instalacion vieja), null y el
// upgrade simplemente no muestra novedades.
const CHANGELOG_URL = new URL('../../CHANGELOG.md', import.meta.url)

export function leerChangelog() {
  try {
    return fs.readFileSync(CHANGELOG_URL, 'utf8')
  } catch {
    return null
  }
}

// Secciones "## [X.Y.Z]" del changelog con desde < version <= hasta, en el
// orden del archivo (la mas nueva primero): lo que esta corrida de upgrade le
// trae a un consumidor que estaba en `desde`. Los encabezados que no son una
// version (ej. "[Sin publicar]") cortan la seccion anterior y no se incluyen.
export function novedadesEntre(texto, desde, hasta) {
  if (!texto) return []
  const secciones = []
  let actual = null
  for (const linea of texto.split('\n')) {
    if (linea.startsWith('## ')) {
      actual = null
      const m = linea.match(/^## \[(\d+\.\d+\.\d+)\]/)
      if (m && lt(desde, m[1]) && !lt(hasta, m[1])) {
        actual = { version: m[1], lineas: [] }
        secciones.push(actual)
      }
      continue
    }
    if (actual) actual.lineas.push(linea)
  }
  for (const s of secciones) {
    while (s.lineas.length && s.lineas[0].trim() === '') s.lineas.shift()
    while (s.lineas.length && s.lineas.at(-1).trim() === '') s.lineas.pop()
  }
  return secciones
}
