#!/usr/bin/env node
// Regenera las secciones autogeneradas de docs/metodologia/ — la carpeta
// publicable de la metodologia (SHS-M16-P2) — desde las fuentes de verdad del
// generador: package.json (version, engines, repository) y
// templates/harness.manifest.json (catalogo de skills).
//
// La prosa es de las personas; este script solo reemplaza lo que vive entre
// <!-- souclaude:gen <id> --> y <!-- /souclaude:gen <id> -->. Correrlo dos veces
// produce bytes identicos (sin fechas ni azar), y escribe plano: OneDrive y
// antivirus rompen el patron write-temp-then-rename con EPERM.
//
// Uso:
//   node scripts/gen-docs-metodologia.mjs           # reescribe las secciones
//   node scripts/gen-docs-metodologia.mjs --check   # no escribe; exit 1 si hay drift
//
// Exit 0: en sync (o regenerado). Exit 1: --check encontro drift. Exit 2: error.
// Lo exigen: souclaude verify, test/gen-docs-metodologia.test.js y el hook
// reglas-pr antes de cada push. Solo existe en el repo del generador: no se
// distribuye a consumidores ni se publica en el paquete (files de package.json).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const ARCHIVOS = [
  'docs/metodologia/README.md',
  'docs/metodologia/01-guia-metodologia.md',
  'docs/metodologia/02-infografia-metodologia.html',
  'docs/metodologia/03-prompt-instalacion.md',
]

export function leerFuentes(raiz = RAIZ) {
  const pkg = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(path.join(raiz, 'templates', 'harness.manifest.json'), 'utf8'))
  const slug = String(pkg.repository?.url ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace('https://github.com/', '')
  return {
    version: pkg.version,
    nodeMin: String(pkg.engines?.node ?? '').replace(/^[^\d]*/, ''),
    slug,
    tagMayor: `v${pkg.version.split('.')[0]}`,
    skills: manifest.skills ?? [],
  }
}

function filaSkill(s) {
  const sep = ' — '
  const desc = s.label.includes(sep) ? s.label.slice(s.label.indexOf(sep) + sep.length) : s.label
  const limpia = desc.replace(/\s*\(obligatoria\)\s*$/, '')
  const modos = !s.modos ? 'equipo y solo' : s.modos.join(' y ')
  return `| \`${s.id}\` | ${modos}${s.required ? ' · obligatoria' : ''} | ${limpia} |`
}

export function renderBloques(f) {
  return {
    version: `Documenta el **harness souclaude v${f.version}**. El sello lo regenera \`node scripts/gen-docs-metodologia.mjs\` y siempre coincide con la versión de \`package.json\`.`,
    requisitos: [
      `- **Node.js ≥ ${f.nodeMin}** y **git** — corren el CLI del harness y el flujo de ramas.`,
      '- **GitHub CLI (`gh`) autenticado** (`gh auth status`) — con él el agente opera GitHub por ti, sobre todo abrir los Pull Requests.',
      '- **Acceso de escritura al repo del Vault** de SOUTEC.',
    ].join('\n'),
    instalacion: [
      '```bash',
      `npx github:${f.slug}#${f.tagMayor}`,
      '```',
      '',
      'Opcional, una vez por máquina, el CLI global (habilita `souclaude status`, `souclaude monitor` y `souclaude vault-sync` desde cualquier repo):',
      '',
      '```bash',
      `npm install -g github:${f.slug}#${f.tagMayor}`,
      '```',
    ].join('\n'),
    skills: ['| Skill | Modo | Qué hace |', '|---|---|---|', ...f.skills.map(filaSkill)].join('\n'),
    'version-pie': `harness souclaude v${f.version}`,
  }
}

const MARCADOR = /<!-- souclaude:gen ([a-z-]+) -->[\s\S]*?<!-- \/souclaude:gen \1 -->/g

export function regenerar(contenido, bloques) {
  // El EOL se hereda del archivo: con autocrlf de git el working tree puede
  // estar en CRLF y el candado no debe acusar drift falso por eso.
  const eol = contenido.includes('\r\n') ? '\r\n' : '\n'
  const desconocidos = []
  const nuevo = contenido.replace(MARCADOR, (todo, id) => {
    if (!(id in bloques)) {
      desconocidos.push(id)
      return todo
    }
    const cuerpo = bloques[id].replaceAll('\n', eol)
    return `<!-- souclaude:gen ${id} -->${eol}${cuerpo}${eol}<!-- /souclaude:gen ${id} -->`
  })
  return { nuevo, desconocidos }
}

export function correr({ check = false, raiz = RAIZ } = {}) {
  const bloques = renderBloques(leerFuentes(raiz))
  const presentes = ARCHIVOS.filter((rel) => existsSync(path.join(raiz, rel)))
  if (!presentes.length) {
    return { codigo: 2, lineas: ['[ERROR] docs-metodologia: no existe docs/metodologia/ en este repo.'] }
  }
  const lineas = []
  let drift = false
  for (const rel of presentes) {
    const abs = path.join(raiz, rel)
    const original = readFileSync(abs, 'utf8')
    const { nuevo, desconocidos } = regenerar(original, bloques)
    if (desconocidos.length) {
      return { codigo: 2, lineas: [`[ERROR] docs-metodologia: marcador(es) sin bloque definido en ${rel}: ${desconocidos.join(', ')}`] }
    }
    if (nuevo === original) {
      lineas.push(`[OK  ] docs-metodologia: ${rel} al día`)
      continue
    }
    if (check) {
      drift = true
      lineas.push(`[FAIL] docs-metodologia: ${rel} desactualizado respecto de las fuentes — corre node scripts/gen-docs-metodologia.mjs y commitea el resultado`)
    } else {
      writeFileSync(abs, nuevo)
      lineas.push(`[GEN ] docs-metodologia: ${rel} regenerado`)
    }
  }
  return { codigo: drift ? 1 : 0, lineas }
}

function main() {
  const check = process.argv.includes('--check')
  let r
  try {
    r = correr({ check })
  } catch (e) {
    console.error(`[ERROR] docs-metodologia: ${e?.message ?? e}`)
    process.exit(2)
  }
  for (const l of r.lineas) console.log(l)
  process.exit(r.codigo)
}

// Solo como ejecutable: al importarse desde los tests no corre nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
