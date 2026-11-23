import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { main } from '../src/cli.js'
import { mkRepo, read, has } from './helpers.js'
import { clasificar } from '../src/core/diagnostico.js'
import {
  aliasDesdeNombre,
  asegurarQuien,
  leerRegistroDePrefijos,
  machineConfigPath,
  nombrePorDefecto,
  quienPorDefecto,
  readVaultConfig,
  rutasDelVault,
  writeMachineVaultConfig,
  writeVaultConfig,
  VAULT_CONFIG,
} from '../src/core/vault.js'

// SHS-M54: en la instalacion la persona solo decide el prefijo. La ruta del
// Vault, el nombre del proyecto, el dueño y el alias se deducen, y el prefijo
// se valida contra el Vault recien sincronizado: sin publicar no hay alta.

beforeEach(() => {
  fs.rmSync(machineConfigPath(), { force: true })
})

const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const REGISTRO = '00-System/id-registry.md'

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' })
}

function identidad(dir) {
  git(dir, 'config', 'user.email', 'test@souclaude.local')
  git(dir, 'config', 'user.name', 'test')
}

// Un Vault como el de verdad: un remoto (bare) y el clon de esta maquina.
function vaultConRemoto(filas = [['SHS', 'souclaude-harness']]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude alta '))
  const semilla = path.join(base, 'semilla')
  fs.mkdirSync(path.join(semilla, '00-System'), { recursive: true })
  fs.writeFileSync(
    path.join(semilla, ...REGISTRO.split('/')),
    [
      '| Prefijo | Proyecto | Dueno | Fecha de alta | Estado |',
      '|---------|----------|-------|---------------|--------|',
      ...filas.map(([prefijo, proyecto]) => `| ${prefijo} | ${proyecto} | @x | 2026-08-20 | activo |`),
      '',
    ].join('\n')
  )
  execFileSync('git', ['init', '-b', 'main', semilla], { stdio: 'pipe' })
  identidad(semilla)
  // Sin conversion de fin de linea: el registro se compara byte a byte.
  git(semilla, 'config', 'core.autocrlf', 'false')
  git(semilla, 'add', '.')
  git(semilla, 'commit', '-m', 'chore: semilla del Vault')

  const remoto = path.join(base, 'remoto.git')
  execFileSync('git', ['clone', '--bare', semilla, remoto], { stdio: 'pipe' })
  return { base, remoto, local: clonar(base, remoto, 'local') }
}

function clonar(base, remoto, nombre) {
  const dir = path.join(base, nombre)
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', remoto, dir], { stdio: 'pipe' })
  identidad(dir)
  git(dir, 'config', 'core.autocrlf', 'false')
  return dir
}

const registroLocal = (vault) => fs.readFileSync(path.join(vault, ...REGISTRO.split('/')), 'utf8')
const registroRemoto = (remoto) => execFileSync('git', ['--git-dir', remoto, 'show', `main:${REGISTRO}`], { encoding: 'utf8' })

// --- el prefijo es el unico dato del alta

test('--vault-prefix solo: el nombre sale del repo y el alta se completa', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const { local, remoto } = vaultConRemoto()

  assert.equal(await main(['init', ...YES, '--vault-path', local, '--vault-prefix', 'ABC'], dir), 0)

  assert.deepEqual(leerRegistroDePrefijos(local).find((f) => f.prefijo === 'ABC'), { prefijo: 'ABC', proyecto: 'proyecto-nuevo' })
  assert.match(registroRemoto(remoto), /\| ABC\s+\| proyecto-nuevo \|/, 'el prefijo no se publico en el remoto')
  assert.ok(has(local, 'Project-ABC/milestones.md'))
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-ABC')
})

test('nombrePorDefecto: el repo del remoto gana sobre package.json y la carpeta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude nombre '))
  assert.equal(nombrePorDefecto(dir), path.basename(dir))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'del-paquete' }))
  assert.equal(nombrePorDefecto(dir), 'del-paquete')
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' })
  git(dir, 'remote', 'add', 'origin', 'https://github.com/soutecdev/del-remoto.git')
  assert.equal(nombrePorDefecto(dir), 'del-remoto')
})

// --- unicidad contra el Vault sincronizado

test('un prefijo que otro registro despues del ultimo pull se rechaza, aunque este clon no lo conociera', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const { base, local, remoto } = vaultConRemoto()

  // Otra persona da de alta ABC desde su maquina; el clon local no se entera.
  const otra = clonar(base, remoto, 'otra')
  fs.appendFileSync(path.join(otra, ...REGISTRO.split('/')), '| ABC | de-otra-persona | @otra | 2026-11-20 | activo |\n')
  git(otra, 'commit', '-am', 'chore: alta del prefijo ABC en el registro')
  git(otra, 'push')
  assert.ok(!registroLocal(local).includes('ABC'), 'el clon local no deberia conocer ABC todavia')

  assert.equal(await main(['init', ...YES, '--vault-path', local, '--vault-prefix', 'ABC'], dir), 0, 'el Vault nunca bloquea la instalacion')

  assert.equal(registroLocal(local), registroRemoto(remoto), 'el registro local no quedo igual al del remoto')
  assert.equal(leerRegistroDePrefijos(local).filter((f) => f.prefijo === 'ABC').length, 1, 'ABC quedo duplicado')
  assert.match(registroLocal(local), /de-otra-persona/)
  assert.ok(!has(local, 'Project-ABC'), 'se sembro la carpeta de un prefijo ajeno')
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

test('si el prefijo no se puede publicar, no queda nada a medias', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const { local, remoto } = vaultConRemoto()
  // El remoto rechaza todo push: sin permiso de escritura sobre el Vault.
  const hook = path.join(remoto, 'hooks', 'pre-receive')
  fs.mkdirSync(path.dirname(hook), { recursive: true })
  fs.writeFileSync(hook, '#!/bin/sh\necho "sin permiso" >&2\nexit 1\n', { mode: 0o755 })
  const antes = { registro: registroLocal(local), head: git(local, 'rev-parse', 'HEAD') }

  assert.equal(await main(['init', ...YES, '--vault-path', local, '--vault-prefix', 'ABC'], dir), 0, 'el Vault nunca bloquea la instalacion')

  assert.equal(registroLocal(local), antes.registro, 'la fila sin publicar quedo en el clon local')
  assert.equal(git(local, 'rev-parse', 'HEAD'), antes.head, 'quedo un commit local sin publicar')
  assert.equal(git(local, 'status', '--porcelain'), '', 'el clon del Vault quedo sucio')
  assert.ok(!registroRemoto(remoto).includes('ABC'))
  assert.ok(!has(local, 'Project-ABC'), 'se sembro la carpeta de un prefijo sin publicar')
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

test('sin poder sincronizar el Vault no se da de alta nada', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const { local, remoto } = vaultConRemoto()
  fs.rmSync(remoto, { recursive: true, force: true })
  const antes = registroLocal(local)

  assert.equal(await main(['init', ...YES, '--vault-path', local, '--vault-prefix', 'ABC'], dir), 0)

  assert.equal(registroLocal(local), antes)
  assert.ok(!has(local, 'Project-ABC'))
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

// --- la ruta del Vault se resuelve sola

function conHome(fn) {
  const previo = process.env.SOUCLAUDE_HOME
  process.env.SOUCLAUDE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude casa '))
  return Promise.resolve(fn(process.env.SOUCLAUDE_HOME)).finally(() => {
    process.env.SOUCLAUDE_HOME = previo
  })
}

function repoEn(...segmentos) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude ruta ')), ...segmentos)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  return dir
}

test('rutasDelVault: junto al repo, salvo que el repo este en OneDrive', () =>
  conHome((home) => {
    const fuera = repoEn('proyecto')
    assert.equal(rutasDelVault(fuera).destino, path.join(path.dirname(fuera), 'soubunker-vault'))

    const dentro = repoEn('OneDrive - ACME', 'proyecto')
    assert.equal(rutasDelVault(dentro).destino, path.join(home, 'repos', 'soubunker-vault'))
    assert.equal(rutasDelVault(dentro).detectado, null)

    // Un clon que ya esta en ~/repos se detecta desde cualquier repo.
    fs.mkdirSync(path.join(home, 'repos', 'soubunker-vault', '00-System'), { recursive: true })
    assert.equal(rutasDelVault(fuera).detectado, path.join(home, 'repos', 'soubunker-vault'))
  }))

test('--vault-clone sin ruta, con el repo en OneDrive: el Vault se clona fuera de OneDrive', () =>
  conHome(async (home) => {
    const { remoto } = vaultConRemoto()
    const dir = repoEn('OneDrive - ACME', 'proyecto')

    assert.equal(await main(['init', ...YES, '--vault-repo', remoto, '--vault-clone'], dir), 0)

    const esperado = path.join(home, 'repos', 'soubunker-vault')
    assert.ok(fs.existsSync(path.join(esperado, '00-System')), 'el Vault no se clono en ~/repos')
    assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'soubunker-vault')), 'el Vault se clono dentro de OneDrive')
    assert.equal(readVaultConfig(dir).path, esperado.split(path.sep).join('/'))
  }))

// --- el alias de contribuyente

test('aliasDesdeNombre: primer nombre, sin tildes ni mayusculas', () => {
  assert.equal(aliasDesdeNombre('María José Pérez'), 'maria')
  assert.equal(aliasDesdeNombre('Ignacio A'), 'ignacio')
  assert.equal(aliasDesdeNombre('  ana.gomez  '), 'ana.gomez')
  assert.equal(aliasDesdeNombre(''), null)
  assert.equal(aliasDesdeNombre(null), null)
  assert.equal(aliasDesdeNombre('日本'), null)
})

function repoConNombre(nombre) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude quien '))
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' })
  git(dir, 'config', 'user.name', nombre)
  return dir
}

test('sin terminal, el alias se deduce del nombre de git y queda registrado', async () => {
  const dir = repoConNombre('María José Pérez')
  writeVaultConfig(dir, { path: '/un/vault', repo: null })

  await asegurarQuien(dir, { flags: {}, yes: true, esCI: false })

  assert.equal(readVaultConfig(dir).quien, 'maria')
})

test('el alias que la maquina ya usa gana sobre el deducido, y --vault-quien sobre los dos', async () => {
  const dir = repoConNombre('María José Pérez')
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  writeMachineVaultConfig({ path: vault, repo: null, quien: 'majo' })
  writeVaultConfig(dir, { path: vault, repo: null })
  assert.deepEqual(quienPorDefecto(dir), { quien: 'majo', origen: 'maquina' })

  await asegurarQuien(dir, { flags: {}, yes: true, esCI: false })
  assert.equal(readVaultConfig(dir).quien, 'majo')

  await asegurarQuien(dir, { flags: { 'vault-quien': 'mjp' }, yes: true, esCI: false })
  assert.equal(readVaultConfig(dir).quien, 'mjp')
})

test('en CI no se deduce ningun alias: un runner no es un contribuyente', async () => {
  const dir = repoConNombre('github-actions')
  writeVaultConfig(dir, { path: '/un/vault', repo: null })

  await asegurarQuien(dir, { flags: {}, yes: true, esCI: true })

  assert.equal(readVaultConfig(dir).quien, undefined)
})

// --- el diagnostico ya no pide lo que se deduce

const hechosBase = {
  maquina: { node: { version: '22.11.0', minimo: '22.4', ok: true }, git: { instalado: true }, gh: { instalado: true, autenticado: true } },
  carpeta: { ruta: '/repos/acme', vacia: false, soloAndamiaje: false, enOneDrive: false, nombre: 'acme' },
  repo: {
    esRepo: true,
    raiz: '/repos/acme',
    enRaiz: true,
    tieneCommits: true,
    arbolLimpio: true,
    remoto: 'https://github.com/soutecdev/acme.git',
    github: 'soutecdev/acme',
    ramasLocales: { main: true, dev: true },
    ramasRemotas: { main: true, dev: true },
  },
  harness: { instalado: false, version: null, disponible: '3.21.0', modo: null, skills: null, lockCorrupto: false, estructuraPrevia: [] },
}
const ids = (lista) => lista.map((x) => x.id)

test('diagnostico: con un alias deducible, "quien" deja de ser un pendiente', () => {
  const vault = { configurado: true, origen: 'repo', ruta: '/v', existe: true, pareceVault: true, proyecto: 'Project-ACM', proyectoExiste: true, proyectos: ['Project-ACM'], quien: null }
  assert.deepEqual(ids(clasificar({ ...hechosBase, vault: { ...vault, quienPorDefecto: 'ana' } }).pendientes), [])
  assert.deepEqual(ids(clasificar({ ...hechosBase, vault: { ...vault, quienPorDefecto: null } }).pendientes), ['quien'])
})

test('diagnostico: sin Vault en la maquina, el pendiente dice donde se clona solo', () => {
  const { pendientes } = clasificar({ ...hechosBase, vault: { configurado: false, hermano: null, destino: 'C:/Users/ana/repos/soubunker-vault' } })
  assert.deepEqual(ids(pendientes), ['conectar-vault'])
  assert.match(pendientes[0].mensaje, /--vault-clone/)
  assert.match(pendientes[0].mensaje, /C:\/Users\/ana\/repos\/soubunker-vault/)
})
