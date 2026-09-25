import { test } from 'node:test'
import assert from 'node:assert/strict'
import { specGlobal, versionGlobalInstalada, instalarCliGlobal } from '../src/core/cli-global.js'

const MANIFEST = { harnessVersion: '3.7.0' }

// run inyectable: registra los comandos npm y devuelve lo programado. Nada
// toca el npm real de la maquina.
function fakeRun({ instalada = null, fallaInstall = false, quedaEn = MANIFEST.harnessVersion } = {}) {
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
        version = quedaEn
        return ''
      }
      throw new Error(`comando inesperado: ${cmd}`)
    },
  }
}

test('specGlobal: apunta al tag movil de la serie mayor del manifest', () => {
  assert.equal(specGlobal(MANIFEST), 'github:soutecdev/souclaude-harness#v3')
  assert.equal(specGlobal({ harnessVersion: '4.1.2' }), 'github:soutecdev/souclaude-harness#v4')
})

test('versionGlobalInstalada: parsea npm ls y devuelve null si no esta', () => {
  const conPaquete = fakeRun({ instalada: '3.5.0' })
  assert.equal(versionGlobalInstalada({ run: conPaquete.run }), '3.5.0')
  const sinPaquete = fakeRun()
  assert.equal(versionGlobalInstalada({ run: sinPaquete.run }), null)
})

test('instalarCliGlobal: idempotente si el global ya esta en la version del manifest', async () => {
  const f = fakeRun({ instalada: '3.7.0' })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: false, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'al-dia' })
  assert.ok(!f.llamadas.some((c) => c.startsWith('npm install')))
})

test('instalarCliGlobal: en CI sin --cli-global no toca npm', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: true, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'sin-flag' })
  assert.equal(f.llamadas.length, 0)
})

test('instalarCliGlobal: sin flag y fuera de CI instala solo si falta (el agente corre init/upgrade sin TTY)', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: false, run: f.run })
  assert.equal(r.aplicado, true)
  assert.ok(f.llamadas.includes('npm install -g github:soutecdev/souclaude-harness#v3'))
})

test('instalarCliGlobal: --cli-global instala tambien en CI', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': true }, ci: true, run: f.run })
  assert.equal(r.aplicado, true)
  assert.ok(f.llamadas.includes('npm install -g github:soutecdev/souclaude-harness#v3'))
})

test('instalarCliGlobal: actualiza solo un global desactualizado', async () => {
  const f = fakeRun({ instalada: '3.5.0' })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: false, run: f.run })
  assert.equal(r.aplicado, true)
  assert.ok(f.llamadas.some((c) => c.startsWith('npm install -g')))
})

test('instalarCliGlobal: si npm falla, reporta y no rompe (aplicado false)', async () => {
  const f = fakeRun({ fallaInstall: true })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: false, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'error' })
})

test('instalarCliGlobal: --no-cli-global no toca npm', async () => {
  const f = fakeRun()
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: { 'cli-global': false }, ci: false, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'desactivado' })
  assert.equal(f.llamadas.length, 0)
})

test('instalarCliGlobal: si npm sale bien pero la version no quedo, no lo da por instalado', async () => {
  const f = fakeRun({ instalada: '3.5.0', quedaEn: '3.5.0' })
  const r = await instalarCliGlobal({ manifest: MANIFEST, flags: {}, ci: false, run: f.run })
  assert.deepEqual(r, { aplicado: false, motivo: 'no-verificado' })
})
