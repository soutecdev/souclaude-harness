import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pullRebaseSeguro, pushSeguro } from '../src/core/vault-sync.js'
import { vaultSync } from '../src/commands/vault-sync.js'
import { main } from '../src/cli.js'
import { mkRepo, write } from './helpers.js'

// Git fake inyectable, mismo criterio que test/monitor-vault-publisher.test.js:
// registra cada invocacion y responde segun un guion por subcomando. El guard de
// --force es deliberadamente central (anti-hack): si CUALQUIER camino de codigo
// llega a git con --force, el test que lo ejercite revienta aca, no en un assert
// que alguien pueda olvidar escribir.
function gitFake(guion = {}) {
  const llamadas = []
  const fn = async (args) => {
    assert.ok(!args.includes('--force'), `git recibio --force: ${args.join(' ')}`)
    assert.ok(!args.includes('-f'), `git recibio -f: ${args.join(' ')}`)
    llamadas.push(args)
    const sub = args.find((a) => !a.startsWith('-') && a !== 'C:/vault' && a !== 'git')
    const respuesta = guion[sub]
    if (respuesta instanceof Error) throw respuesta
    if (typeof respuesta === 'function') return respuesta(args)
    return respuesta ?? ''
  }
  fn.llamadas = llamadas
  fn.subcomandos = () => llamadas.map((args) => args.find((a) => !a.startsWith('-') && a !== 'C:/vault'))
  return fn
}

const VAULT = 'C:/vault'

// --- pullRebaseSeguro ------------------------------------------------------

test('pullRebaseSeguro feliz: un solo pull --rebase y ok', async () => {
  const git = gitFake()
  const r = await pullRebaseSeguro({ vaultPath: VAULT, git })

  assert.deepEqual(r, { ok: true, motivo: null })
  assert.deepEqual(git.llamadas, [['-C', VAULT, 'pull', '--rebase']])
})

test('pullRebaseSeguro con pull fallido: rebase --abort defensivo, pull_fallo y nada mas', async () => {
  const git = gitFake({ pull: new Error('sin red') })
  const r = await pullRebaseSeguro({ vaultPath: VAULT, git })

  assert.deepEqual(r, { ok: false, motivo: 'pull_fallo' })
  assert.deepEqual(git.subcomandos(), ['pull', 'rebase'])
  assert.deepEqual(git.llamadas[1], ['-C', VAULT, 'rebase', '--abort'])
})

test('pullRebaseSeguro: si el abort tambien falla (no habia rebase), sigue devolviendo pull_fallo', async () => {
  const git = gitFake({ pull: new Error('sin red'), rebase: new Error('no rebase in progress') })
  const r = await pullRebaseSeguro({ vaultPath: VAULT, git })

  assert.deepEqual(r, { ok: false, motivo: 'pull_fallo' })
})

// --- pushSeguro ------------------------------------------------------------

test('pushSeguro feliz: orden exacto add -> commit -> pull -> push', async () => {
  const git = gitFake()
  const r = await pushSeguro({ vaultPath: VAULT, mensaje: 'docs: espejo X', paths: ['Project-SHS'], git })

  assert.deepEqual(r, { ok: true, motivo: null })
  assert.deepEqual(git.subcomandos(), ['add', 'commit', 'pull', 'push'])
  assert.deepEqual(git.llamadas[0], ['-C', VAULT, 'add', 'Project-SHS'])
  assert.deepEqual(git.llamadas[1], ['-C', VAULT, 'commit', '-m', 'docs: espejo X'])
})

test('pushSeguro sin paths: add -A sobre el Vault completo', async () => {
  const git = gitFake()
  await pushSeguro({ vaultPath: VAULT, mensaje: 'chore: kanban', git })

  assert.deepEqual(git.llamadas[0], ['-C', VAULT, 'add', '-A'])
})

test('pushSeguro con nothing to commit: ok + sin_cambios, y no hay pull ni push', async () => {
  const git = gitFake({ commit: new Error('nothing to commit'), status: '' })
  const r = await pushSeguro({ vaultPath: VAULT, mensaje: 'docs: espejo X', git })

  assert.deepEqual(r, { ok: true, motivo: 'sin_cambios' })
  assert.deepEqual(git.subcomandos(), ['add', 'commit', 'status'])
})

test('pushSeguro con commit fallido de verdad (status sucio): push_fallo', async () => {
  const git = gitFake({ commit: new Error('hook rechazo el commit'), status: ' M Project-SHS/kanban.md\n' })
  const r = await pushSeguro({ vaultPath: VAULT, mensaje: 'docs: espejo X', git })

  assert.deepEqual(r, { ok: false, motivo: 'push_fallo' })
})

test('pushSeguro con pull fallido tras el commit: pull_fallo y no se intenta push', async () => {
  const git = gitFake({ pull: new Error('conflicto') })
  const r = await pushSeguro({ vaultPath: VAULT, mensaje: 'docs: espejo X', git })

  assert.deepEqual(r, { ok: false, motivo: 'pull_fallo' })
  assert.ok(!git.subcomandos().includes('push'), 'no debe pushear si el pull fallo')
})

test('pushSeguro con push fallido: push_fallo (el commit local queda para el proximo intento)', async () => {
  const git = gitFake({ push: new Error('sin permisos') })
  const r = await pushSeguro({ vaultPath: VAULT, mensaje: 'docs: espejo X', git })

  assert.deepEqual(r, { ok: false, motivo: 'push_fallo' })
  assert.deepEqual(git.subcomandos(), ['add', 'commit', 'pull', 'push'])
})

// --- comando vault-sync ----------------------------------------------------

function repoConVault() {
  const dir = mkRepo()
  write(dir, '.claude/vault.local.json', JSON.stringify({ path: VAULT, repo: null }))
  return dir
}

test('vault-sync sin Vault configurado: exit 3 y ni una llamada a git', async () => {
  const git = gitFake()
  const dir = mkRepo()
  const code = await vaultSync({}, dir, { git })

  assert.equal(code, 3)
  assert.deepEqual(git.llamadas, [])
})

test('vault-sync default: pull --rebase y exit 0', async () => {
  const git = gitFake()
  const code = await vaultSync({}, repoConVault(), { git })

  assert.equal(code, 0)
  assert.deepEqual(git.llamadas, [['-C', VAULT, 'pull', '--rebase']])
})

test('vault-sync con pull fallido: exit 1', async () => {
  const git = gitFake({ pull: new Error('sin red') })
  const code = await vaultSync({}, repoConVault(), { git })

  assert.equal(code, 1)
})

test('vault-sync --push sin -m: exit 2 (error de uso) sin tocar git', async () => {
  const git = gitFake()
  const code = await vaultSync({ push: true }, repoConVault(), { git })

  assert.equal(code, 2)
  assert.deepEqual(git.llamadas, [])
})

test('vault-sync --push -m: espejo completo y exit 0; --paths restringe el add', async () => {
  const git = gitFake()
  const code = await vaultSync({ push: true, message: 'docs: espejo X', paths: 'Project-SHS, otro/dir' }, repoConVault(), { git })

  assert.equal(code, 0)
  assert.deepEqual(git.subcomandos(), ['add', 'commit', 'pull', 'push'])
  assert.deepEqual(git.llamadas[0], ['-C', VAULT, 'add', 'Project-SHS', 'otro/dir'])
})

test('vault-sync --push con una ruta con forma de opcion de git: exit 2 sin tocar git', async () => {
  const git = gitFake()
  const code = await vaultSync(
    { push: true, message: 'chore: kanban', paths: 'Project-SHS,--pathspec-from-file=/etc/hosts' },
    repoConVault(),
    { git }
  )

  assert.equal(code, 2)
  assert.deepEqual(git.llamadas, [])
})

test('vault-sync --status: exit 0 y consulta el working tree del Vault', async () => {
  const git = gitFake({ status: ' M Project-SHS/kanban.md\n' })
  const code = await vaultSync({ status: true }, repoConVault(), { git })

  assert.equal(code, 0)
  assert.deepEqual(git.llamadas, [['-C', VAULT, 'status', '--porcelain']])
})

test('cli: main reconoce vault-sync como comando (exit 3 en un repo sin Vault)', async () => {
  const code = await main(['vault-sync'], mkRepo())
  assert.equal(code, 3)
})
