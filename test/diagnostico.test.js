import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli.js'
import { mkRepo, read, has, tree } from './helpers.js'
import { clasificar, recolectar, nodeCumple, slugDeGitHub, NODE_MINIMO, CASOS } from '../src/core/diagnostico.js'
import { loadManifest } from '../src/core/manifest.js'
import { leerRegistroDePrefijos, machineConfigPath, VAULT_CONFIG } from '../src/core/vault.js'

// SHS-M53: una casuistica de instalacion = un test. clasificar() es pura, asi
// que cada caso se arma como un objeto de hechos; recolectar() y el CLI se
// prueban contra repos git reales en el temporal.
const REPO = fileURLToPath(new URL('..', import.meta.url))
const CLI = path.join(REPO, 'bin', 'cli.mjs')

beforeEach(() => {
  fs.rmSync(machineConfigPath(), { force: true })
})

// Hechos de un repo "ideal": maquina completa, repo en GitHub con main y dev,
// sin harness, Vault conectado con proyecto y contribuyente. Cada test pisa
// solo lo que define su casuistica.
function hechos(cambios = {}) {
  const base = {
    maquina: {
      node: { version: '22.11.0', minimo: '22.4', ok: true },
      git: { instalado: true, version: '2.49.0' },
      gh: { instalado: true, autenticado: true },
    },
    carpeta: { ruta: '/repos/acme', vacia: false, soloAndamiaje: false, enOneDrive: false, stack: 'Node.js', nombre: 'acme' },
    repo: {
      esRepo: true,
      raiz: '/repos/acme',
      enRaiz: true,
      rama: 'main',
      tieneCommits: true,
      arbolLimpio: true,
      remoto: 'https://github.com/soutecdev/acme.git',
      github: 'soutecdev/acme',
      ramasLocales: { main: true, dev: true },
      ramasRemotas: { main: true, dev: true },
    },
    harness: { instalado: false, version: null, disponible: '3.21.0', modo: null, skills: null, lockCorrupto: false, estructuraPrevia: [] },
    vault: {
      configurado: true,
      origen: 'repo',
      hermano: null,
      ruta: '/repos/soubunker-vault',
      existe: true,
      pareceVault: true,
      proyecto: 'Project-ACM',
      proyectoExiste: true,
      quien: 'ana',
      proyectos: ['Project-ACM'],
      prefijosRegistrados: ['ACM'],
      segunRegistro: 'Project-ACM',
    },
  }
  const out = structuredClone(base)
  for (const [seccion, valores] of Object.entries(cambios)) Object.assign(out[seccion], valores)
  return out
}

const ids = (lista) => lista.map((x) => x.id)

test('todo caso que devuelve clasificar esta en el catalogo CASOS', () => {
  assert.ok(CASOS.includes(clasificar(hechos()).caso))
})

test('repo con codigo, completo: init sin bloqueos, avisos ni pendientes', () => {
  const d = clasificar(hechos())
  assert.equal(d.caso, 'repo-con-codigo')
  assert.equal(d.comando, 'init')
  assert.deepEqual([d.bloqueos, d.avisos, d.pendientes], [[], [], []])
})

test('proyecto desde cero: carpeta vacia sin git pide git init y crear el repo', () => {
  const d = clasificar(hechos({ carpeta: { vacia: true, soloAndamiaje: true }, repo: { esRepo: false } }))
  assert.equal(d.caso, 'proyecto-desde-cero')
  assert.equal(d.comando, 'init')
  assert.deepEqual(ids(d.pendientes), ['git-init', 'crear-repo-github', 'primer-commit', 'pushear-main', 'crear-dev'])
  assert.deepEqual(d.bloqueos, [])
})

test('carpeta con archivos y sin git: es otro caso que el proyecto desde cero', () => {
  const d = clasificar(hechos({ repo: { esRepo: false } }))
  assert.equal(d.caso, 'carpeta-sin-git')
  assert.ok(ids(d.pendientes).includes('git-init'))
})

test('carpeta sin git con CLAUDE.md hecho a mano: corresponde adopt', () => {
  const d = clasificar(hechos({ repo: { esRepo: false }, harness: { estructuraPrevia: ['CLAUDE.md'] } }))
  assert.equal(d.comando, 'adopt')
})

test('repo local sin remoto: pide crear o conectar el repo de GitHub', () => {
  const d = clasificar(
    hechos({ repo: { remoto: null, github: null, ramasRemotas: null, ramasLocales: { main: true, dev: false } } })
  )
  assert.equal(d.caso, 'repo-sin-remoto')
  assert.deepEqual(ids(d.pendientes), ['crear-repo-github', 'crear-dev'])
})

test('repo nuevo y vacio recien creado: sin commits, sin dev y sin main en el remoto', () => {
  const d = clasificar(
    hechos({
      carpeta: { soloAndamiaje: true },
      repo: { tieneCommits: false, ramasLocales: { main: false, dev: false }, ramasRemotas: { main: false, dev: false } },
    })
  )
  assert.equal(d.caso, 'repo-vacio')
  assert.deepEqual(ids(d.pendientes), ['primer-commit', 'crear-dev', 'pushear-main'])
})

test('dev solo en local: se pide pushearla, no crearla', () => {
  const d = clasificar(hechos({ repo: { ramasRemotas: { main: true, dev: false } } }))
  assert.deepEqual(ids(d.pendientes), ['pushear-dev'])
})

test('estructura Claude hecha a mano: adopt, nunca init', () => {
  const d = clasificar(hechos({ harness: { estructuraPrevia: ['CLAUDE.md', '.claude'] } }))
  assert.equal(d.caso, 'estructura-previa')
  assert.equal(d.comando, 'adopt')
})

test('harness de una version anterior: upgrade', () => {
  const d = clasificar(hechos({ harness: { instalado: true, version: '3.16.2', modo: 'equipo' } }))
  assert.equal(d.caso, 'harness-desactualizado')
  assert.equal(d.comando, 'upgrade')
})

test('harness al dia: no hay comando que correr', () => {
  const d = clasificar(hechos({ harness: { instalado: true, version: '3.21.0', modo: 'equipo' } }))
  assert.equal(d.caso, 'harness-al-dia')
  assert.equal(d.comando, null)
})

test('integrante o maquina nueva: harness instalado pero el repo sin Vault conectado en esta maquina', () => {
  const sinVault = clasificar(
    hechos({ harness: { instalado: true, version: '3.21.0', modo: 'equipo' }, vault: { configurado: false, ruta: null, origen: null } })
  )
  assert.equal(sinVault.caso, 'maquina-nueva')
  assert.equal(sinVault.comando, 'upgrade')
  assert.ok(ids(sinVault.pendientes).includes('conectar-vault'))

  // El Vault ya esta en la maquina (config de maquina o hermano), pero este
  // repo todavia no tiene su vault.local.json: sigue siendo maquina nueva.
  const porMaquina = clasificar(
    hechos({ harness: { instalado: true, version: '3.21.0', modo: 'equipo' }, vault: { origen: 'maquina', proyecto: null, proyectoExiste: false } })
  )
  assert.equal(porMaquina.caso, 'maquina-nueva')
  assert.ok(!ids(porMaquina.pendientes).includes('conectar-vault'))
})

test('modo solo: no se pide la rama dev ni main en el remoto', () => {
  const d = clasificar(
    hechos({
      harness: { instalado: true, version: '3.20.0', modo: 'solo' },
      repo: { ramasLocales: { main: true, dev: false }, ramasRemotas: { main: false, dev: false } },
    })
  )
  assert.deepEqual(ids(d.pendientes), [])
})

test('Node anterior al minimo y git ausente bloquean', () => {
  const d = clasificar(hechos({ maquina: { node: { version: '20.11.0', minimo: '22.4', ok: false }, git: { instalado: false, version: null } } }))
  assert.deepEqual(ids(d.bloqueos), ['node', 'git'])
})

test('gh ausente o sin autenticar avisa con la instruccion, sin bloquear', () => {
  const sin = clasificar(hechos({ maquina: { gh: { instalado: false, autenticado: false } } }))
  assert.deepEqual(ids(sin.avisos), ['gh'])
  const sinLogin = clasificar(hechos({ maquina: { gh: { instalado: true, autenticado: false } } }))
  assert.deepEqual(ids(sinLogin.avisos), ['gh-auth'])
  assert.match(sinLogin.avisos[0].solucion, /gh auth login/)
  assert.deepEqual(sinLogin.bloqueos, [])
})

test('subdirectorio de un repo bloquea y nombra la raiz', () => {
  const d = clasificar(hechos({ repo: { enRaiz: false, raiz: '/repos/mono' } }))
  assert.deepEqual(ids(d.bloqueos), ['subdirectorio'])
  assert.match(d.bloqueos[0].solucion, /\/repos\/mono/)
})

test('lockfile corrupto bloquea', () => {
  assert.deepEqual(ids(clasificar(hechos({ harness: { lockCorrupto: true } })).bloqueos), ['lockfile-corrupto'])
})

test('carpeta en OneDrive, arbol sucio y remoto fuera de GitHub avisan', () => {
  const d = clasificar(
    hechos({ carpeta: { enOneDrive: true }, repo: { arbolLimpio: false, remoto: 'https://dev.azure.com/x/y/_git/z', github: null } })
  )
  assert.deepEqual(ids(d.avisos), ['onedrive', 'remoto-no-github', 'arbol-sucio'])
})

test('remoto que no se pudo consultar: se avisa y no se inventa que falta dev', () => {
  const d = clasificar(hechos({ repo: { ramasRemotas: null } }))
  assert.deepEqual(ids(d.avisos), ['remoto-inaccesible'])
  assert.deepEqual(d.pendientes, [])
})

test('Vault: sin clon en la maquina, ruta rota y carpeta que no es un Vault', () => {
  assert.deepEqual(ids(clasificar(hechos({ vault: { configurado: false, ruta: null, hermano: null } })).pendientes), ['conectar-vault'])
  assert.deepEqual(ids(clasificar(hechos({ vault: { existe: false, pareceVault: false } })).avisos), ['vault-ruta'])
  assert.deepEqual(ids(clasificar(hechos({ vault: { pareceVault: false } })).avisos), ['vault-invalido'])
})

test('Vault: proyecto sin declarar se resuelve por el registro o pide el alta de un prefijo', () => {
  const conocido = clasificar(hechos({ vault: { proyecto: null, proyectoExiste: false } }))
  assert.deepEqual(ids(conocido.pendientes), ['declarar-proyecto'])
  assert.doesNotMatch(conocido.pendientes[0].mensaje, /vault-seed/)

  const sinCarpeta = clasificar(hechos({ vault: { proyecto: null, proyectoExiste: false, proyectos: [] } }))
  assert.match(sinCarpeta.pendientes[0].mensaje, /--vault-seed/)

  const desconocido = clasificar(hechos({ vault: { proyecto: null, proyectoExiste: false, segunRegistro: null } }))
  assert.deepEqual(ids(desconocido.pendientes), ['alta-prefijo'])
  assert.match(desconocido.pendientes[0].mensaje, /--vault-prefix/)
})

test('Vault: proyecto declarado que no existe y contribuyente sin alias', () => {
  assert.deepEqual(ids(clasificar(hechos({ vault: { proyectoExiste: false } })).avisos), ['vault-proyecto'])
  assert.deepEqual(ids(clasificar(hechos({ vault: { quien: null } })).pendientes), ['quien'])
})

// --- helpers puros

test('nodeCumple respeta el minimo, que coincide con package.json y bin/cli.mjs', () => {
  assert.equal(nodeCumple('22.4.0'), true)
  assert.equal(nodeCumple('v24.1.0'), true)
  assert.equal(nodeCumple('22.3.9'), false)
  assert.equal(nodeCumple('20.19.0'), false)

  const minimo = NODE_MINIMO.join('.')
  assert.equal(JSON.parse(read(REPO, 'package.json')).engines.node, `>=${minimo}`)
  assert.ok(read(REPO, 'bin/cli.mjs').includes(`var MINIMO = [${NODE_MINIMO.join(', ')}]`), 'bin/cli.mjs comprueba otro minimo')
})

test('bin/cli.mjs no usa top-level await: un Node viejo tiene que poder leerlo', () => {
  assert.doesNotMatch(read(REPO, 'bin/cli.mjs'), /^(const|let|import) /m)
})

test('slugDeGitHub: https, ssh y remotos de otro host', () => {
  assert.equal(slugDeGitHub('https://github.com/soutecdev/acme.git'), 'soutecdev/acme')
  assert.equal(slugDeGitHub('git@github.com:soutecdev/acme.git'), 'soutecdev/acme')
  assert.equal(slugDeGitHub('https://github.com/soutecdev/acme'), 'soutecdev/acme')
  assert.equal(slugDeGitHub('https://dev.azure.com/org/p/_git/acme'), null)
  assert.equal(slugDeGitHub(null), null)
})

// --- recolectar contra el disco y git reales

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' })
}

function carpetaTemporal() {
  // Padre propio: el hermano ../soubunker-vault no se comparte entre tests.
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude diag '))
  const dir = path.join(padre, 'proyecto')
  fs.mkdirSync(dir)
  return dir
}

function repoReal({ commit = true, ramas = [] } = {}) {
  const dir = carpetaTemporal()
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@souclaude.local')
  git(dir, 'config', 'user.name', 'test')
  if (commit) {
    fs.writeFileSync(path.join(dir, 'README.md'), '# acme\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'chore: inicio')
    for (const r of ramas) git(dir, 'branch', r)
  }
  return dir
}

function conRemoto(dir, ramas) {
  const remoto = path.join(path.dirname(dir), 'origen.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto], { stdio: 'pipe' })
  git(dir, 'remote', 'add', 'origin', remoto)
  for (const r of ramas) git(dir, 'push', 'origin', r)
  return remoto
}

const leer = (dir) => recolectar(dir, { manifest: loadManifest() })

test('recolectar: carpeta vacia sin git es un proyecto desde cero', () => {
  const h = leer(carpetaTemporal())
  assert.equal(h.repo.esRepo, false)
  assert.equal(h.carpeta.vacia, true)
  assert.equal(clasificar(h).caso, 'proyecto-desde-cero')
})

test('recolectar: repo recien inicializado, sin commits ni remoto', () => {
  const h = leer(repoReal({ commit: false }))
  assert.equal(h.repo.esRepo, true)
  assert.equal(h.repo.enRaiz, true)
  assert.equal(h.repo.rama, 'main')
  assert.equal(h.repo.tieneCommits, false)
  assert.equal(h.repo.remoto, null)
  assert.equal(clasificar(h).caso, 'repo-sin-remoto')
})

test('recolectar: las ramas del remoto se le preguntan al remoto', () => {
  const dir = repoReal({ ramas: ['dev'] })
  conRemoto(dir, ['main'])
  const h = leer(dir)
  assert.deepEqual(h.repo.ramasLocales, { main: true, dev: true })
  assert.deepEqual(h.repo.ramasRemotas, { main: true, dev: false })
  assert.deepEqual(ids(clasificar(h).pendientes).filter((id) => id.includes('dev')), ['pushear-dev'])
})

test('recolectar: un subdirectorio del repo no esta en la raiz', () => {
  const dir = repoReal()
  const sub = path.join(dir, 'paquetes', 'api')
  fs.mkdirSync(sub, { recursive: true })
  const h = leer(sub)
  assert.equal(h.repo.esRepo, true)
  assert.equal(h.repo.enRaiz, false)
})

test('recolectar: arbol sucio, estructura previa y lockfile corrupto', () => {
  const dir = repoReal()
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# a mano\n')
  let h = leer(dir)
  assert.equal(h.repo.arbolLimpio, false)
  assert.deepEqual(h.harness.estructuraPrevia, ['CLAUDE.md'])

  fs.mkdirSync(path.join(dir, '.claude'))
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), '<<<<<<< HEAD\n{')
  h = leer(dir)
  assert.equal(h.harness.lockCorrupto, true)
  assert.equal(h.harness.instalado, false)
})

test('recolectar no escribe nada: es de solo lectura', () => {
  const dir = repoReal()
  const antes = tree(dir)
  leer(dir)
  assert.deepEqual(tree(dir), antes)
})

// --- el comando y las guardas de la instalacion

test('diagnostico --json: imprime solo JSON y sale 0 sin bloqueos', () => {
  const dir = repoReal()
  const r = spawnSync(process.execPath, [CLI, 'diagnostico', '--json'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const d = JSON.parse(r.stdout)
  assert.equal(d.caso, 'repo-sin-remoto')
  assert.equal(d.comando, 'init')
  assert.match(d.invocacion, /^npx github:/)
})

test('diagnostico sale 1 cuando hay bloqueos', () => {
  const dir = repoReal()
  const sub = path.join(dir, 'api')
  fs.mkdirSync(sub)
  const r = spawnSync(process.execPath, [CLI, 'diagnostico', '--json'], { cwd: sub, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.deepEqual(ids(JSON.parse(r.stdout).bloqueos), ['subdirectorio'])
})

test('init en un subdirectorio del repo falla sin escribir nada', async () => {
  const dir = repoReal()
  const sub = path.join(dir, 'api')
  fs.mkdirSync(sub)
  assert.equal(await main(['init', '--yes', '--no-vault', '--no-cli-global'], sub), 1)
  assert.deepEqual(fs.readdirSync(sub), [])
  assert.ok(!has(dir, 'CLAUDE.md'))
})

test('init en una carpeta sin git instala igual: es el proyecto desde cero', async () => {
  const dir = carpetaTemporal()
  assert.equal(await main(['init', '--yes', '--name', 'acme', '--no-vault', '--no-cli-global'], dir), 0)
  assert.ok(has(dir, 'CLAUDE.md'))
  assert.ok(has(dir, '.claude/harness.json'))
})

test('sin terminal y sin --yes: error accionable, exit 1 y ni un byte escrito', () => {
  const dir = repoReal()
  const antes = tree(dir)
  const env = { ...process.env }
  delete env.CI
  const r = spawnSync(process.execPath, [CLI, 'init', '--no-vault', '--no-cli-global', '--no-github-protect'], {
    cwd: dir,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(r.status, 1, `salio ${r.status}: ${r.stderr}`)
  assert.match(`${r.stdout}${r.stderr}`, /Sin terminal interactiva/)
  assert.match(`${r.stdout}${r.stderr}`, /--yes/)
  assert.deepEqual(tree(dir), antes)
})

test('--enforcer es un flag valido', async () => {
  const dir = mkRepo({ 'README.md': '' })
  assert.equal(await main(['init', '--yes', '--no-vault', '--enforcer', 'ArchUnit'], dir), 0)
  assert.equal(JSON.parse(read(dir, '.claude/harness.json')).vars.ARCH_ENFORCER, 'ArchUnit')
})

// --- alta de un proyecto nuevo del Vault sin terminal

function mkVault(proyectos = [], filas = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  fs.mkdirSync(path.join(dir, '00-System', 'templates'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '00-System', 'id-registry.md'),
    [
      '| Prefijo | Proyecto | Dueno | Fecha de alta | Estado |',
      '|---------|----------|-------|---------------|--------|',
      ...filas.map(([prefijo, proyecto]) => `| ${prefijo} | ${proyecto} | @x | 2026-08-20 | activo |`),
      '',
    ].join('\n'),
    'utf8'
  )
  for (const p of proyectos) fs.mkdirSync(path.join(dir, p), { recursive: true })
  return dir
}

const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const registro = (vault) => fs.readFileSync(path.join(vault, '00-System', 'id-registry.md'), 'utf8')

test('--vault-prefix da de alta el proyecto, lo siembra y lo declara, sin terminal', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const vault = mkVault(['Project-CSC', 'Project-OBS'], [['SHS', 'souclaude-harness']])

  const flags = ['--vault-path', vault, '--vault-prefix', 'abc', '--vault-project-name', 'Mi Proyecto', '--vault-owner', '@ana', '--vault-quien', 'ana']
  assert.equal(await main(['init', ...YES, ...flags], dir), 0)

  assert.deepEqual(leerRegistroDePrefijos(vault).find((f) => f.prefijo === 'ABC'), { prefijo: 'ABC', proyecto: 'Mi Proyecto' })
  assert.match(registro(vault), /@ana/)
  assert.ok(has(vault, 'Project-ABC/milestones.md'))
  const cfg = JSON.parse(read(dir, VAULT_CONFIG))
  assert.equal(cfg.project, 'Project-ABC')
  assert.equal(cfg.quien, 'ana')

  // Segunda corrida del mismo comando: nada que dar de alta, nada duplicado.
  const antes = registro(vault)
  assert.equal(await main(['upgrade', ...YES, ...flags], dir), 0)
  assert.equal(registro(vault), antes)
})

test('--vault-prefix rechaza sin escribir: prefijo repetido, invalido, sin nombre o con "|"', async () => {
  const casos = [
    ['--vault-prefix', 'SHS', '--vault-project-name', 'Otro'],
    ['--vault-prefix', 'A1', '--vault-project-name', 'Otro'],
    ['--vault-prefix', 'ABC'],
    ['--vault-prefix', 'ABC', '--vault-project-name', 'Otro | activo |'],
  ]
  for (const flags of casos) {
    const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
    const vault = mkVault(['Project-CSC', 'Project-SHS'], [['SHS', 'souclaude-harness']])
    const antes = registro(vault)
    assert.equal(await main(['init', ...YES, '--vault-path', vault, ...flags], dir), 0, 'el Vault nunca bloquea la instalacion')
    assert.equal(registro(vault), antes, `se toco el registro con ${flags.join(' ')}`)
    assert.ok(!has(vault, 'Project-ABC'), `se sembro una carpeta con ${flags.join(' ')}`)
    assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
  }
})
