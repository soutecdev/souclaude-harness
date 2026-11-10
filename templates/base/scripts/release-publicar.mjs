#!/usr/bin/env node
// GitHub Release del release dev -> main (SHS-M44). Una sola descripcion corta
// alimenta el release de GitHub y el hito de la ficha OBSERVATORIO.md del Vault,
// asi que no pueden desalinearse. Lo corre el workflow tag-release.yml (cuando
// GitHub Actions este activo) o el agente / subagente de cierre de release
// despues del merge a main:
//
//   node scripts/release-publicar.mjs --version 3.18.0 \
//     --titulo "Release automatico" --descripcion "Una frase de menos de 30 palabras." \
//     [--milestones SHS-M44,SHS-M43] [--fecha AAAA-MM-DD] [--dry-run]
//
// Requiere que el tag vX.Y.Z ya exista (lo crea scripts/tag-release.mjs) y la CLI
// `gh` autenticada. Es idempotente: si el release ya existe, lo actualiza en vez
// de duplicarlo. Con --dry-run solo valida e imprime el release y el hito.
//
// Plantilla:
//   nombre: `vX.Y.Z · <titulo de hasta 6 palabras>`
//   cuerpo: `## Qué trae` + una frase de menos de 30 palabras + linea de milestones/changelog
//   hito:   `- AAAA-MM-DD · vX.Y.Z - <titulo> · <descripcion>` (descripcion <= 300 caracteres)

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const MAX_PALABRAS_TITULO = 6
export const MAX_PALABRAS_DESCRIPCION = 29 // "menos de 30 palabras"
export const MAX_CARACTERES_HITO = 300

export function contarPalabras(texto) {
  return String(texto ?? '').trim().split(/\s+/).filter(Boolean).length
}

// Devuelve la lista de problemas (vacia = valido).
export function validarTitulo(titulo) {
  const t = String(titulo ?? '').trim()
  const problemas = []
  if (!t) problemas.push('el título está vacío')
  if (/[\r\n]/.test(t)) problemas.push('el título debe ser de una sola línea')
  if (contarPalabras(t) > MAX_PALABRAS_TITULO) {
    problemas.push(`el título tiene ${contarPalabras(t)} palabras (máximo ${MAX_PALABRAS_TITULO})`)
  }
  if (t.includes(' · ') || t.includes('|')) problemas.push('el título no puede contener " · " ni "|"')
  return problemas
}

export function validarDescripcion(descripcion) {
  const d = String(descripcion ?? '').trim()
  const problemas = []
  if (!d) problemas.push('la descripción está vacía')
  if (/[\r\n]/.test(d)) problemas.push('la descripción debe ser de una sola línea')
  if (contarPalabras(d) > MAX_PALABRAS_DESCRIPCION) {
    problemas.push(`la descripción tiene ${contarPalabras(d)} palabras (debe tener menos de 30)`)
  }
  if (d.length > MAX_CARACTERES_HITO) {
    problemas.push(`la descripción tiene ${d.length} caracteres (máximo ${MAX_CARACTERES_HITO} en el hito)`)
  }
  return problemas
}

export function validarVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(String(version ?? '')) ? [] : [`versión SemVer inválida: "${version}"`]
}

export function validarFecha(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? '')) ? [] : [`fecha inválida (AAAA-MM-DD): "${fecha}"`]
}

export function nombreRelease(version, titulo) {
  return `v${version} · ${String(titulo).trim()}`
}

export function cuerpoRelease({ descripcion, milestones = [], changelogUrl = '' }) {
  const lineas = ['## Qué trae', '', String(descripcion).trim()]
  const extra = []
  if (milestones.length) extra.push(`Milestones: ${milestones.join(', ')}`)
  if (changelogUrl) extra.push(`Changelog: ${changelogUrl}`)
  if (extra.length) lineas.push('', extra.join(' · '))
  return lineas.join('\n')
}

export function hitoDeRelease({ fecha, version, titulo, descripcion }) {
  return `- ${fecha} · v${version} - ${String(titulo).trim()} · ${String(descripcion).trim()}`
}

// Valida todo el conjunto antes de tocar GitHub.
export function validarRelease({ version, titulo, descripcion, fecha }) {
  return [
    ...validarVersion(version),
    ...validarTitulo(titulo),
    ...validarDescripcion(descripcion),
    ...(fecha ? validarFecha(fecha) : []),
  ]
}

function sh(args) {
  return execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function intentar(args) {
  try {
    return sh(args)
  } catch {
    return null
  }
}

// https://github.com/<owner>/<repo>/blob/main/CHANGELOG.md a partir del remoto origin.
export function urlChangelog(remoto) {
  const m = String(remoto ?? '').match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/main/CHANGELOG.md` : ''
}

function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      titulo: { type: 'string' },
      descripcion: { type: 'string' },
      milestones: { type: 'string' },
      fecha: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const version = values.version
  const tag = `v${version}`
  const problemas = validarRelease({ ...values, version })
  if (problemas.length) {
    for (const p of problemas) console.error(`[ERROR] ${p}`)
    process.exit(1)
  }

  const milestones = (values.milestones ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const nombre = nombreRelease(version, values.titulo)
  const cuerpo = cuerpoRelease({
    descripcion: values.descripcion,
    milestones,
    changelogUrl: urlChangelog(intentar(['git', 'remote', 'get-url', 'origin'])),
  })
  // La fecha del hito es la del commit del tag (fecha real del release).
  const fecha = values.fecha ?? intentar(['git', 'log', '-1', '--format=%cs', `${tag}^{commit}`]) ?? ''
  const hito = fecha ? hitoDeRelease({ fecha, version, titulo: values.titulo, descripcion: values.descripcion }) : ''

  if (values['dry-run']) {
    console.log(`[dry-run] release: ${nombre}\n${cuerpo}\n`)
    console.log(hito ? `[dry-run] hito:\n${hito}` : '[dry-run] hito: (sin fecha: el tag aún no existe, usa --fecha)')
    return
  }

  sh(['git', 'fetch', 'origin', '--tags', '--force'])
  if (!intentar(['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) {
    throw new Error(`el tag ${tag} no existe: corre antes scripts/tag-release.mjs`)
  }

  if (intentar(['gh', 'release', 'view', tag])) {
    sh(['gh', 'release', 'edit', tag, '--title', nombre, '--notes', cuerpo])
    console.log(`[OK] release ${tag} actualizado.`)
  } else {
    sh(['gh', 'release', 'create', tag, '--verify-tag', '--title', nombre, '--notes', cuerpo])
    console.log(`[OK] release ${tag} creado.`)
  }
  if (hito) console.log(`hito: ${hito}`)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (e) {
    const detalle = (e?.stderr ?? '').toString().trim() || e?.message || String(e)
    console.error(`[ERROR] ${detalle.split('\n')[0]}`)
    process.exit(1)
  }
}
