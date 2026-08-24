import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { evaluaRama, evaluaSeccionesCompletas, evaluaVersion } from '../scripts/check-pr-rules.mjs'

// La norma de la skill soutec-github admite DOS formas de rama, y las dos son
// contrato: tipo/descripcion-corta a secas, o tipo/ID-descripcion-corta donde
// el ID en mayusculas es tarea del Vault, milestone del Vault o tracker externo.

test('evaluaRama: acepta la forma simple tipo/descripcion-corta', () => {
  const validas = [
    'feature/captura-lead',
    'fix/error-integracion-odoo',
    'hotfix/correccion-produccion',
    'docs/onboarding-auth-gh',
    'chore/actualizar-dependencias',
    'refactor/mejorar-estructura-api',
    'experiment/prueba-modelo-rag',
  ]
  for (const rama of validas) {
    assert.equal(evaluaRama(rama).cumple, true, rama)
  }
})

test('evaluaRama: acepta el prefijo de ID en sus tres variantes', () => {
  const validas = [
    'feature/SHS-M7-T006-playbook-adopcion', // tarea del Vault
    'fix/SHS-M7-T007-check-pr-reglas',
    'fix/SHS-M10-chequeo-gh', // milestone del Vault, sin tarea desglosada
    'feature/CSC-M1-alta-de-milestones',
    'feature/REA-123-captura-lead', // tracker externo
  ]
  for (const rama of validas) {
    assert.equal(evaluaRama(rama).cumple, true, rama)
  }
})

test('evaluaRama: rechaza lo que ninguna de las dos formas permite', () => {
  const invalidas = [
    'feature/Mayusculas-en-el-slug', // el slug sigue siendo minusculas
    'feature/SHS-M7-T006', // ID sin slug descriptivo
    'cambios/algo', // tipo inexistente
    'feature/prueba', // slug prohibido
    'feature/final-final',
    'main',
    'feature/', // sin slug
  ]
  for (const rama of invalidas) {
    assert.equal(evaluaRama(rama).cumple, false, rama)
  }
})

// El release dev -> main es un PR sobre la rama "dev" en si: nunca va a
// cumplir tipo/descripcion-corta porque no es una rama de trabajo. La
// excepcion exige AMBAS senales (rama "dev" Y base "main"): "dev" contra
// cualquier otra base sigue siendo invalida, y no hay otro nombre de rama
// que la excepcion perdone.
test('evaluaRama: "dev" contra base "main" es la excepcion del release', () => {
  assert.equal(evaluaRama('dev', 'main').cumple, true)
})

test('evaluaRama: "dev" sin base de release sigue siendo invalida', () => {
  assert.equal(evaluaRama('dev').cumple, false)
  assert.equal(evaluaRama('dev', 'dev').cumple, false)
  assert.equal(evaluaRama('dev', null).cumple, false)
})

// El harness distribuye el check y su workflow a los repos consumidores via el
// manifest. La fuente sigue siendo scripts/ y .github/workflows/ de este repo:
// si alguien toca una copia y no la otra, los consumidores quedan con una
// version distinta de la que este repo aplica sobre si mismo (SHS-M17).
test('las copias distribuidas en templates/base son identicas a las fuentes', () => {
  const espejos = [
    ['scripts/check-pr-rules.mjs', 'templates/base/scripts/check-pr-rules.mjs'],
    ['.github/workflows/reglas-pr.yml', 'templates/base/github/workflows/reglas-pr.yml'],
  ]
  for (const [fuente, copia] of espejos) {
    assert.equal(readFileSync(copia, 'utf8'), readFileSync(fuente, 'utf8'), `${copia} difiere de ${fuente}`)
  }
})

test('evaluaSeccionesCompletas: la plantilla sin rellenar NO pasa', () => {
  const plantilla = readFileSync('.github/pull_request_template.md', 'utf8')
  const r = evaluaSeccionesCompletas({ body: plantilla })
  assert.equal(r.cumple, false)
  assert.match(r.detalle, /Descripción del cambio/)
})

test('evaluaSeccionesCompletas: secciones con contenido real pasan', () => {
  const body = [
    '## Descripción del cambio',
    'Se corrige la regex de ramas del check.',
    '',
    '## Evidencia',
    'npm test en verde, regex probada contra las ramas historicas.',
    '',
    '## Impacto / Riesgos',
    'Solo CI de este repo.',
  ].join('\n')
  assert.equal(evaluaSeccionesCompletas({ body }).cumple, true)
})

test('evaluaSeccionesCompletas: "N/A" o vacia sigue fallando', () => {
  const body = [
    '## Descripción del cambio',
    'N/A',
    '',
    '## Evidencia',
    '',
    '## Impacto / Riesgos',
    'Ninguno relevante.',
  ].join('\n')
  const r = evaluaSeccionesCompletas({ body })
  assert.equal(r.cumple, false)
})

test('evaluaVersion: exige exactamente una casilla marcada', () => {
  const conNo = '## Requiere versión / release\n- [x] No\n- [ ] Sí\nVersión sugerida: vX.Y.Z'
  const cruda = '## Requiere versión / release\n- [ ] No\n- [ ] Sí\nVersión sugerida: vX.Y.Z'
  assert.equal(evaluaVersion({ body: conNo }, 'dev').cumple, true)
  assert.equal(evaluaVersion({ body: cruda }, 'dev').cumple, false)
})
