import { test } from 'node:test'
import assert from 'node:assert/strict'

import { leerChangelog, novedadesEntre } from '../src/core/novedades.js'

// SHS-M43-T004: lo que el upgrade muestra al terminar sale del CHANGELOG
// empaquetado. El extractor toma las secciones (desde, hasta] en el orden del
// archivo (la mas nueva primero) e ignora los encabezados que no son version.
const CHANGELOG = [
  '# Changelog',
  '',
  '## [Sin publicar]',
  '',
  '- pendiente que no debe salir',
  '',
  '## [3.17.0] — 2026-10-08',
  '',
  '### Agregado',
  '',
  '- aviso de version nueva',
  '',
  '## [3.16.2] — 2026-09-29',
  '',
  '- fix de vault-sync --push',
  '',
  '## [3.16.0] — 2026-09-28',
  '',
  '- checks de PR en la sesion',
  '',
].join('\n')

test('novedadesEntre: toma (desde, hasta], la mas nueva primero y sin bordes vacios', () => {
  const secciones = novedadesEntre(CHANGELOG, '3.16.0', '3.17.0')
  assert.deepEqual(
    secciones.map((s) => s.version),
    ['3.17.0', '3.16.2']
  )
  assert.equal(secciones[0].lineas[0], '### Agregado')
  assert.equal(secciones[0].lineas.at(-1), '- aviso de version nueva')
  assert.deepEqual(secciones[1].lineas, ['- fix de vault-sync --push'])
})

test('novedadesEntre: al dia o retroceso devuelve vacio, y [Sin publicar] nunca sale', () => {
  assert.deepEqual(novedadesEntre(CHANGELOG, '3.17.0', '3.17.0'), [])
  assert.deepEqual(novedadesEntre(CHANGELOG, '3.17.0', '3.16.0'), [])
  const todas = novedadesEntre(CHANGELOG, '0.0.0', '9.9.9')
  assert.ok(todas.every((s) => !s.lineas.some((l) => l.includes('pendiente que no debe salir'))))
})

test('novedadesEntre: sin changelog (paquete viejo) devuelve vacio', () => {
  assert.deepEqual(novedadesEntre(null, '3.16.0', '3.17.0'), [])
})

test('leerChangelog: el CHANGELOG real viaja con el paquete y es legible', () => {
  const texto = leerChangelog()
  assert.ok(texto?.startsWith('# Changelog'))
  assert.match(texto, /^## \[3\.17\.0\]/m)
})
