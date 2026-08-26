import { test } from 'node:test'
import assert from 'node:assert/strict'
import { specGlobal, versionGlobalInstalada, instalarCliGlobal } from '../src/core/cli-global.js'

const MANIFEST = { harnessVersion: '3.7.0' }

// run inyectable: registra los comandos npm y devuelve lo programado. Nada
// toca el npm real de la maquina.
function fakeRun({ instalada = null, fallaInstall = false } = {}) {
  const llamadas = []
  let version = instalada
  return {
    llamadas,
    run(cmd) {
      llamadas.push(cmd)
      if (cmd.startsWith('npm ls -g')) {
        if (version == null) throw new Error('npm ls: empty')
        return JSON.stringify({ dependencies: { 'souclaude-harness': { version } } })
      }
      if (cmd.startsWith('npm install -g')) {
        if (fallaInstall) throw new Error('EACCES: permission denied')
        version = MANIFEST.harnessVersion
        return ''
      }
      throw new Error(`comando inesperado: ${cmd}`)
    },
  }
}

test('specGlobal: apunta al tag movil de la serie mayor del manifest', () => {
  assert.equal(specGlobal(MANIFEST), 'github:ialvarezsoutec/souclaude-harness#v3')
  assert.equal(specGlobal({ harnessVersion: '4.1.2' }), 'github:ialvarezsoutec/souclaude-harness#v4')
})

test('versionGlobalInstalada: parsea npm ls y devuelve null si no esta', () => {
  const conPaquete = fakeRun({ instalada: '3.5.0' })
  assert.equal(versionGlobalInstalada({ run: conPaquete.run }), '3.5.0')
  const sinPaquete = fakeRun()
  assert.equal(versionGlobalInstalada({ run: sinPaquete.run }), null)
})

test('instalarCliGlobal: idempotente si el global ya esta en la version del manifest', async () => {
  const f = fakeRun({ instalada: '3.7.0' })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': true }, yes: true, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'al-dia' })
  assert.ok(!f.llamadas.some((c) => c.startsWith('npm install')))
})

test('instalarCliGlobal: en modo no interactivo sin --cli-global no toca npm', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, yes: true, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'sin-flag' })
  assert.equal(f.llamadas.length, 0)
})

test('instalarCliGlobal: --cli-global instala sin preguntar (tambien con --yes)', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': true }, yes: true, run: f.run })
  assert.equal(r.aplicado, true)
  assert.ok(f.llamadas.includes('npm install -g github:ialvarezsoutec/souclaude-harness#v3'))
})

test('instalarCliGlobal: actualiza un global desactualizado con --cli-global', async () => {
  const f = fakeRun({ instalada: '3.5.0' })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': true }, yes: false, run: f.run })
  assert.equal(r.aplicado, true)
  assert.ok(f.llamadas.some((c) => c.startsWith('npm install -g')))
})

test('instalarCliGlobal: si npm falla, reporta y no rompe (aplicado false)', async () => {
  const f = fakeRun({ fallaInstall: true })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': true }, yes: true, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'error' })
})
