import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preDocsMetodologia } from '../templates/base/claude/hooks/reglas-pr.mjs'

// SHS-M16-P2: antes de cada push en el repo del generador, el hook reglas-pr
// exige docs/metodologia al dia con las fuentes del instalador. En un repo
// consumidor el script no existe y el paso es un no-op.
const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = path.join(RAIZ, 'scripts', 'gen-docs-metodologia.mjs')

function deCorrer(resultado) {
  const llamadas = []
  const correr = (cmd, args, opciones = {}) => {
    llamadas.push({ cmd, args, opciones })
    return { stdout: '', stderr: '', ...resultado }
  }
  return { correr, llamadas }
}

test('preDocsMetodologia: sin el script (repo consumidor) es no-op', () => {
  const { correr, llamadas } = deCorrer({ status: 1 })
  const salida = preDocsMetodologia(correr, { script: path.join(RAIZ, 'no-existe.mjs'), raizPush: RAIZ, raizHook: RAIZ })
  assert.equal(salida, null)
  assert.equal(llamadas.length, 0, 'no debe ejecutar nada')
})

test('preDocsMetodologia: un push hacia otro repo no corre el check', () => {
  const { correr, llamadas } = deCorrer({ status: 1 })
  const salida = preDocsMetodologia(correr, { script: SCRIPT, raizPush: path.join(RAIZ, 'templates'), raizHook: RAIZ })
  assert.equal(salida, null)
  assert.equal(llamadas.length, 0)
})

test('preDocsMetodologia: drift deniega el push con una razon accionable', () => {
  const { correr, llamadas } = deCorrer({
    status: 1,
    stdout: '[FAIL] docs-metodologia: docs/metodologia/01-guia-metodologia.md desactualizado respecto de las fuentes — corre node scripts/gen-docs-metodologia.mjs y commitea el resultado\n',
  })
  const salida = preDocsMetodologia(correr, { script: SCRIPT, raizPush: RAIZ, raizHook: RAIZ })
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /docs\/metodologia/)
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /gen-docs-metodologia\.mjs/)
  assert.match(salida.hookSpecificOutput.permissionDecisionReason, /01-guia-metodologia\.md/)
  const args = llamadas[0].args
  assert.equal(args[0], SCRIPT)
  assert.equal(args[1], '--check')
})

test('preDocsMetodologia: con la carpeta al dia no emite nada', () => {
  const { correr } = deCorrer({ status: 0, stdout: '[OK  ] docs-metodologia: al dia\n' })
  assert.equal(preDocsMetodologia(correr, { script: SCRIPT, raizPush: RAIZ, raizHook: RAIZ }), null)
})

test('preDocsMetodologia: error de entorno deja pasar pero avisa', () => {
  const { correr } = deCorrer({ status: 2, stderr: '[ERROR] no se pudo leer el manifest' })
  const salida = preDocsMetodologia(correr, { script: SCRIPT, raizPush: RAIZ, raizHook: RAIZ })
  assert.equal(salida.hookSpecificOutput, undefined, 'no deniega')
  assert.match(salida.systemMessage, /frescura de docs\/metodologia/)
})
