import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import './helpers.js' // aisla SOUCLAUDE_CLAUDE_HOME del home real por defecto
import { ultimaVersionConocida, avisoCliDesactualizado } from '../src/core/version-remota.js'

// La cache version-check.json la escriben los hooks de SessionStart (SHS-M43);
// aca solo se lee. Cada caso apunta SOUCLAUDE_CLAUDE_HOME a un home temporal
// propio — las funciones resuelven el env en cada llamada.
function homeCon(cache) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude home vr '))
  if (cache != null) {
    fs.mkdirSync(path.join(home, 'souclaude'), { recursive: true })
    fs.writeFileSync(path.join(home, 'souclaude', 'version-check.json'), cache)
  }
  return home
}

test('lee la ultima version conocida de la major desde la cache de los hooks', () => {
  process.env.SOUCLAUDE_CLAUDE_HOME = homeCon(JSON.stringify({ ultimaPorMajor: { 3: '3.18.0', 1: '1.4.0' } }))
  assert.equal(ultimaVersionConocida('3'), '3.18.0')
  assert.equal(ultimaVersionConocida(3), '3.18.0')
  assert.equal(ultimaVersionConocida('1'), '1.4.0')
  assert.equal(ultimaVersionConocida('4'), null)
})

test('sin cache, con cache rota o con basura: null, sin consultar la red', () => {
  process.env.SOUCLAUDE_CLAUDE_HOME = homeCon(null)
  assert.equal(ultimaVersionConocida('3'), null)

  process.env.SOUCLAUDE_CLAUDE_HOME = homeCon('{no es json')
  assert.equal(ultimaVersionConocida('3'), null)

  process.env.SOUCLAUDE_CLAUDE_HOME = homeCon(JSON.stringify({ ultimaPorMajor: { 3: 'v3-no-semver' } }))
  assert.equal(ultimaVersionConocida('3'), null)
})

test('avisoCliDesactualizado solo avisa cuando el CLI esta detras del ultimo release', () => {
  process.env.SOUCLAUDE_CLAUDE_HOME = homeCon(JSON.stringify({ ultimaPorMajor: { 3: '3.18.0' } }))

  const aviso = avisoCliDesactualizado('3.17.0')
  assert.match(aviso, /v3\.17\.0.*ultimo release publicado es v3\.18\.0/)
  assert.match(aviso, /#v3\.18\.0/)

  assert.equal(avisoCliDesactualizado('3.18.0'), null)
  // El generador en desarrollo va DELANTE del ultimo release: silencio.
  assert.equal(avisoCliDesactualizado('3.19.0'), null)
})
