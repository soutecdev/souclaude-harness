#!/usr/bin/env node
// Tag automático de release, según la sección "Versionamiento" de la skill
// soutec-github: tras el merge dev -> main, el agente crea el tag inmutable
// vX.Y.Z y mueve el tag móvil vX. Este script hace lo mismo en CI, disparado
// por el workflow tag-release.yml en pull_request cerrado y mergeado con
// base main.
//
// No crea el GitHub Release: eso sigue siendo del coordinador (ver skill).
// Es idempotente: si vX.Y.Z ya existe (alguien lo taggeó a mano), no falla
// ni duplica -- solo reporta y sale 0.
//
// Uso: node scripts/tag-release.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function versionDePackageJson(contenidoJson) {
  const pkg = JSON.parse(contenidoJson)
  const version = pkg.version
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package.json no tiene una versión SemVer válida: "${version}"`)
  }
  return version
}

export function tagInmutable(version) {
  return `v${version}`
}

export function tagMovil(version) {
  return `v${version.split('.')[0]}`
}

function sh(args) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8' }).trim()
}

function tagExiste(tag) {
  try {
    sh(['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

function main() {
  const version = versionDePackageJson(readFileSync('package.json', 'utf8'))
  const inmutable = tagInmutable(version)
  const movil = tagMovil(version)

  sh(['git', 'fetch', 'origin', '--tags'])

  if (tagExiste(inmutable)) {
    console.log(`[skip] ${inmutable} ya existe -- release ya taggeado, no se toca.`)
  } else {
    sh(['git', 'tag', '-a', inmutable, '-m', `Release ${inmutable}`])
    sh(['git', 'push', 'origin', inmutable])
    console.log(`[OK] ${inmutable} creado y pusheado.`)
  }

  // El tag móvil (vX) es un puntero que se reasigna en cada release de esa
  // major -- a diferencia del tag inmutable, sí se mueve: -f es intencional
  // y coincide con lo que la skill soutec-github documenta para el agente.
  sh(['git', 'tag', '-f', '-a', movil, '-m', `Release ${inmutable}`])
  sh(['git', 'push', 'origin', movil, '--force'])
  console.log(`[OK] ${movil} apunta ahora a ${inmutable}.`)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
