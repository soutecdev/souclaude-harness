import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  contarPalabras,
  validarTitulo,
  validarDescripcion,
  validarVersion,
  validarFecha,
  validarRelease,
  nombreRelease,
  cuerpoRelease,
  hitoDeRelease,
  urlChangelog,
} from '../scripts/release-publicar.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/release-publicar.mjs', import.meta.url))

test('contarPalabras: separa por espacios y ignora vacíos', () => {
  assert.equal(contarPalabras('  uno  dos\ttres\n'), 3)
  assert.equal(contarPalabras(''), 0)
  assert.equal(contarPalabras(undefined), 0)
})

test('validarTitulo: hasta 6 palabras, una línea, sin separadores del hito', () => {
  assert.deepEqual(validarTitulo('Aviso de versión y metodología'), [])
  assert.match(validarTitulo('uno dos tres cuatro cinco seis siete')[0], /7 palabras/)
  assert.match(validarTitulo('')[0], /vacío/)
  assert.match(validarTitulo('a · b')[0], /no puede contener/)
  assert.match(validarTitulo('a | b')[0], /no puede contener/)
  assert.match(validarTitulo('a\nb')[0], /una sola línea/)
})

test('validarDescripcion: menos de 30 palabras y hasta 300 caracteres', () => {
  const veintinueve = Array(29).fill('palabra').join(' ')
  const treinta = Array(30).fill('palabra').join(' ')
  assert.deepEqual(validarDescripcion(veintinueve), [])
  assert.match(validarDescripcion(treinta)[0], /30 palabras/)
  assert.match(validarDescripcion('x'.repeat(301))[0], /301 caracteres/)
  assert.match(validarDescripcion('')[0], /vacía/)
  assert.match(validarDescripcion('uno\ndos')[0], /una sola línea/)
})

test('validarVersion y validarFecha', () => {
  assert.deepEqual(validarVersion('3.18.0'), [])
  assert.equal(validarVersion('v3.18').length, 1)
  assert.deepEqual(validarFecha('2026-11-10'), [])
  assert.equal(validarFecha('10/11/2026').length, 1)
})

test('validarRelease: junta los problemas de todos los campos', () => {
  const ok = { version: '3.18.0', titulo: 'Release automático', descripcion: 'Una frase corta.', fecha: '2026-11-10' }
  assert.deepEqual(validarRelease(ok), [])
  const mal = validarRelease({ version: 'x', titulo: '', descripcion: '' })
  assert.equal(mal.length, 3)
})

test('nombreRelease: vX.Y.Z · título', () => {
  assert.equal(nombreRelease('3.18.0', ' Release automático '), 'v3.18.0 · Release automático')
})

test('cuerpoRelease: encabezado "Qué trae", frase y línea de milestones/changelog', () => {
  const cuerpo = cuerpoRelease({ descripcion: 'Una frase.', milestones: ['SHS-M44', 'SHS-M43'], changelogUrl: 'https://x/CHANGELOG.md' })
  assert.equal(cuerpo, '## Qué trae\n\nUna frase.\n\nMilestones: SHS-M44, SHS-M43 · Changelog: https://x/CHANGELOG.md')
  assert.equal(cuerpoRelease({ descripcion: 'Solo frase.' }), '## Qué trae\n\nSolo frase.')
})

test('hitoDeRelease: formato oficial con versión, título y descripción', () => {
  assert.equal(
    hitoDeRelease({ fecha: '2026-11-10', version: '3.18.0', titulo: 'Release automático', descripcion: 'Una frase.' }),
    '- 2026-11-10 · v3.18.0 - Release automático · Una frase.',
  )
})

test('urlChangelog: arma la URL desde remotos https y ssh de GitHub; vacía si no es GitHub', () => {
  assert.equal(urlChangelog('https://github.com/soutecdev/souclaude-harness.git'), 'https://github.com/soutecdev/souclaude-harness/blob/main/CHANGELOG.md')
  assert.equal(urlChangelog('git@github.com:soutecdev/souclaude-harness.git'), 'https://github.com/soutecdev/souclaude-harness/blob/main/CHANGELOG.md')
  assert.equal(urlChangelog('https://gitlab.com/a/b.git'), '')
  assert.equal(urlChangelog(null), '')
})

test('CLI --dry-run: imprime release y hito sin tocar GitHub', () => {
  const salida = execFileSync(
    process.execPath,
    [SCRIPT, '--version', '3.18.0', '--titulo', 'Release automático', '--descripcion', 'Una frase.', '--fecha', '2026-11-10', '--milestones', 'SHS-M44', '--dry-run'],
    { encoding: 'utf8' },
  )
  assert.match(salida, /\[dry-run\] release: v3\.18\.0 · Release automático/)
  assert.match(salida, /Milestones: SHS-M44/)
  assert.match(salida, /- 2026-11-10 · v3\.18\.0 - Release automático · Una frase\./)
})

test('CLI: una descripción de 30 palabras falla antes de tocar GitHub', () => {
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--version', '3.18.0', '--titulo', 'Titulo', '--descripcion', Array(30).fill('p').join(' '), '--dry-run'],
    { encoding: 'utf8' },
  )
  assert.equal(r.status, 1)
  assert.match(r.stderr, /30 palabras/)
})
