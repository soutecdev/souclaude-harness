import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { main } from '../src/cli.js'
import { mkRepo, read, has, snapshot } from './helpers.js'
import {
  cloneVault,
  looksLikeVault,
  readVaultConfig,
  writeVaultConfig,
  VAULT_CONFIG,
  harnessDocsUrl,
  isInsideCwd,
  ensureVault,
  carpetaProyecto,
  leerRegistroDePrefijos,
} from '../src/core/vault.js'
import { loadManifest } from '../src/core/manifest.js'

// helpers.js pone CI=true, asi que todo lo que pasa por main() corre en modo
// no interactivo: es justo el camino que hay que blindar (nunca clonar solo).
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']

// Un Vault de mentira pero real: carpeta con 00-System/, que es la senal que usa
// looksLikeVault. No hace falta que sea un repo git para conectarlo.
// `filas` son pares [prefijo, proyecto] para el registro de prefijos del Vault
// (00-System/id-registry.md). Sin filas queda solo el encabezado, que es como se
// comportaba el Vault de prueba antes de que el registro se leyera.
function mkVault(proyectos = [], filas = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault '))
  fs.mkdirSync(path.join(dir, '00-System', 'templates'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '00-System', 'id-registry.md'),
    [
      '# Registro de prefijos - fuente unica. Un prefijo = un proyecto.',
      '',
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

// mkRepo() crea el repo bajo os.tmpdir() directo, asi que path.dirname(cwd) es
// SIEMPRE os.tmpdir() -- el sibling ../soubunker-vault que usa ensureVault por
// default terminaria siendo una ruta COMPARTIDA entre tests. Para los tests que
// ejercen la autodeteccion del sibling o el clonado real, cada repo va adentro
// de un padre unico para que su "afuera" tambien sea unico.
function mkIsolatedRepo() {
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude aislado '))
  const dir = path.join(padre, 'proyecto')
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  return dir
}

// Repo git local que sirve de origen para probar el clone sin tocar la red.
function mkVaultRepo() {
  const dir = mkVault()
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@souclaude.local')
  git('config', 'user.name', 'test')
  git('add', '.')
  git('commit', '-m', 'chore: semilla del Vault')
  return dir
}

test('--vault-path conecta el Vault sin preguntar y sin clonar', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  const cfg = JSON.parse(read(dir, VAULT_CONFIG))
  assert.equal(cfg.path, vault.split(path.sep).join('/'), 'la ruta se guarda en POSIX')
  assert.ok(!cfg.path.includes('\\'), 'quedo una ruta con separadores de Windows')
})

test('la ruta del Vault NUNCA va al lockfile: es de esta maquina', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()
  await main(['init', ...YES, '--vault-path', vault], dir)

  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.equal(lock.vars.VAULT_REPO, loadManifest().vault.repo)
  assert.equal(lock.vars.VAULT_PATH, undefined, 'la ruta local se filtro al lockfile commiteado')
})

test('el .gitignore emitido ignora la config local del Vault', async () => {
  const dir = mkRepo({ 'README.md': '' })
  await main(['init', ...YES], dir)
  assert.ok(read(dir, '.gitignore').includes(VAULT_CONFIG))
})

test('--no-vault no toca la conexion con el Vault', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  assert.equal(await main(['init', ...YES, '--no-vault', '--vault-path', vault], dir), 0)
  assert.ok(!has(dir, VAULT_CONFIG), '--no-vault escribio la config igual')
})

// La decision: git clone es red y disco. En CI correria en cada corrida, asi que
// el modo no interactivo jamas clona -- solo conecta lo que ya existe.
test('sin --vault-path, el modo no interactivo no clona ni escribe nada', async () => {
  const dir = mkRepo({ 'README.md': '' })

  assert.equal(await main(['init', ...YES], dir), 0)
  assert.ok(!has(dir, VAULT_CONFIG))
})

test('una ruta de Vault inexistente no rompe la instalacion', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const fantasma = path.join(os.tmpdir(), 'souclaude vault que no existe')

  assert.equal(await main(['init', ...YES, '--vault-path', fantasma], dir), 0)
  assert.ok(!has(dir, VAULT_CONFIG), 'se conecto un Vault que no existe')
})

test('--dry-run tampoco escribe la config del Vault', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  assert.equal(await main(['init', ...YES, '--dry-run', '--vault-path', vault], dir), 0)
  assert.ok(!has(dir, VAULT_CONFIG))
})

test('IDEMPOTENCIA: reconectar el mismo Vault no cambia un byte', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  await main(['init', ...YES, '--vault-path', vault], dir)
  const before = snapshot(dir)

  await main(['init', ...YES], dir)
  assert.equal(snapshot(dir), before, 'la segunda corrida modifico archivos')
})

test('la config ya escrita se relee y no se vuelve a preguntar', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()
  await main(['init', ...YES, '--vault-path', vault], dir)

  assert.equal(readVaultConfig(dir).path, vault.split(path.sep).join('/'))
})

test('cloneVault clona de verdad y el resultado parece un Vault', () => {
  const origen = mkVaultRepo()
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude dest ')), 'soubunker-vault')

  cloneVault(origen, destino)

  assert.ok(looksLikeVault(destino), 'el clon no tiene 00-System/')
  assert.ok(fs.existsSync(path.join(destino, '00-System', 'id-registry.md')))
})

test('el manifest declara el repo canonico del Vault', () => {
  assert.match(loadManifest().vault.repo, /soubunker-vault/)
})

// docs/vault-guide.md declara que no se distribuye a repos consumidores (es singleton
// por organizacion), asi que el mensaje de ayuda no puede apuntar a una ruta local
// (docs/vault-setup.md) que jamas existe en el repo destino -- tiene que ser la URL
// donde el archivo si vive.
test('el hint del Vault apunta a una URL de GitHub, no a una ruta local', () => {
  const url = harnessDocsUrl('docs/vault-setup.md')
  assert.match(url, /^https:\/\/github\.com\/.+\/blob\/main\/docs\/vault-setup\.md$/)
  assert.ok(!url.startsWith('docs/'), 'quedo como ruta relativa en vez de URL')
})

test('isInsideCwd: un descendiente del repo esta adentro', () => {
  const cwd = mkRepo({ 'README.md': '' })
  assert.ok(isInsideCwd(cwd, path.join(cwd, 'sub', 'dir')))
})

test('isInsideCwd: un hermano del repo NO esta adentro', () => {
  const cwd = mkRepo({ 'README.md': '' })
  assert.ok(!isInsideCwd(cwd, path.join(path.dirname(cwd), 'sibling')))
})

test('isInsideCwd: el propio cwd cuenta como adentro', () => {
  const cwd = mkRepo({ 'README.md': '' })
  assert.ok(isInsideCwd(cwd, cwd))
})

test('isInsideCwd: discos distintos en Windows nunca estan adentro', { skip: process.platform !== 'win32' }, () => {
  assert.ok(!isInsideCwd('C:\\repo', 'D:\\repo'))
})

// --- Sibling autodetectado -------------------------------------------------

test('con el sibling ../soubunker-vault ya clonado, se conecta sin preguntar nada', async () => {
  const cwd = mkIsolatedRepo()
  const sibling = path.join(path.dirname(cwd), 'soubunker-vault')
  fs.mkdirSync(path.join(sibling, '00-System'), { recursive: true })

  const noPrompt = {
    text: () => assert.fail('no debia preguntar: el sibling ya estaba detectado'),
    confirm: () => assert.fail('no debia preguntar: el sibling ya estaba detectado'),
  }
  const abs = await ensureVault({
    cwd,
    flags: {},
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts: noPrompt,
  })
  assert.equal(abs, sibling)
  assert.equal(readVaultConfig(cwd).path, sibling.split(path.sep).join('/'))
})

// --- --vault-clone (camino no interactivo) ---------------------------------

test('--vault-path dentro del repo + --vault-clone --yes no clona nada', async () => {
  const dir = mkIsolatedRepo()
  const dentro = path.join(dir, 'vault')

  assert.equal(await main(['init', ...YES, '--vault-path', dentro, '--vault-clone'], dir), 0)
  assert.ok(!has(dir, VAULT_CONFIG), 'se conecto o clono un Vault dentro del propio repo')
  assert.ok(!fs.existsSync(dentro), 'se creo la carpeta de destino dentro del repo')
})

test('--vault-clone --yes con destino valido clona sin ningun prompt', async () => {
  const dir = mkIsolatedRepo()
  const origen = mkVaultRepo()
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude clone ')), 'soubunker-vault')

  assert.equal(await main(['init', ...YES, '--vault-repo', origen, '--vault-path', destino, '--vault-clone'], dir), 0)
  assert.ok(looksLikeVault(destino))
  assert.equal(readVaultConfig(dir).path, destino.split(path.sep).join('/'))
})

// --- Camino interactivo: una sola pregunta, reintenta si cae dentro --------

test('camino interactivo: quien rechaza el default y tipea una ruta dentro del repo, se rechaza y se vuelve a preguntar', async () => {
  const cwd = mkIsolatedRepo()
  const origen = mkVaultRepo()
  const afuera = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude afuera ')), 'vault')

  let textCalls = 0
  const prompts = {
    // Rechaza el default sugerido -- el unico camino donde se llega a tipear una ruta.
    confirm: () => false,
    text: () => {
      textCalls += 1
      // Primera respuesta: cae dentro del repo -> se rechaza. Segunda: afuera.
      return textCalls === 1 ? path.join(cwd, 'vault-adentro') : afuera
    },
  }

  const abs = await ensureVault({
    cwd,
    flags: { 'vault-repo': origen },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts,
  })

  assert.equal(textCalls, 2, 'no reintento tras la ruta invalida')
  assert.equal(abs, afuera)
  assert.ok(looksLikeVault(afuera))
})

test('camino interactivo: sin Vault detectado, una sola confirmacion y sin preguntar la ruta', async () => {
  const cwd = mkIsolatedRepo()
  const origen = mkVaultRepo()

  let textCalls = 0
  let confirmCalls = 0
  const prompts = {
    text: () => {
      textCalls += 1
      return assert.fail('no debia preguntar la ruta: el default ya cae afuera del repo')
    },
    confirm: () => {
      confirmCalls += 1
      return true
    },
  }

  const abs = await ensureVault({
    cwd,
    flags: { 'vault-repo': origen },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts,
  })

  assert.equal(textCalls, 0, 'pregunto la ruta pudiendo usar el default (ya afuera del repo)')
  assert.equal(confirmCalls, 1, 'el camino interactivo hizo mas de una confirmacion')
  assert.equal(abs, path.join(path.dirname(cwd), 'soubunker-vault'))
})

// --- "project": la carpeta Project-<PREFIJO> se DECLARA, no se adivina ------
//
// Sin este campo, carpetaProyecto() cae al respaldo "si el Vault tiene una sola
// carpeta, es esa". Eso acierta hoy y deja de acertar -- sin error, en todas las
// maquinas a la vez -- en cuanto el Vault tiene dos proyectos: el monitor deja
// de publicar las lineas de sessions.md. Estos tests fijan que la respuesta
// quede escrita, incluso cuando es obvia.

test('con UNA sola carpeta Project-*, el proyecto se DECLARA en vez de quedar inferido', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-SHS'])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

// El caso que rompe hoy: con dos carpetas no hay nada que inferir, asi que sin
// respuesta explicita no se inventa una.
test('con VARIAS carpetas y sin --vault-project, el modo no interactivo no declara ninguna', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-CSC', 'Project-SHS'])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  const cfg = JSON.parse(read(dir, VAULT_CONFIG))
  assert.equal(cfg.project, undefined, 'se declaro un proyecto adivinando entre varios')
  assert.ok(cfg.path, 'el Vault tampoco se conecto: el proyecto no puede bloquear la conexion')
})

test('--vault-project declara la carpeta pedida sin preguntar', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-CSC', 'Project-SHS'])

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-CSC'], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-CSC')
})

test('--vault-project con una carpeta inexistente avisa y NO persiste el typo', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-SHS'])

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-SSH'], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

// "project" se usa como segmento de ruta contra la raiz del Vault, asi que la
// forma se valida aunque no haya carpetas contra que contrastar el nombre.
test('--vault-project rechaza cualquier cosa que no sea un nombre de carpeta de proyecto', async () => {
  const vault = mkVault()

  for (const basura of ['../fuera', 'Project-a/b', 'otra-cosa', 'Project-']) {
    const dir = mkRepo({ 'README.md': '' })
    assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-project', basura], dir), 0)
    assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined, `se persistio "${basura}"`)
  }
})

// Con el Vault todavia sin carpetas (recien clonado, o antes de que T002 siembre
// la del proyecto) un nombre bien formado si se acepta.
test('--vault-project se acepta en un Vault sin carpetas si el nombre esta bien formado', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-CSC'], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-CSC')
})

test('lo ya declarado es sticky: un upgrade sin flags no lo vuelve a resolver', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-CSC', 'Project-SHS'])
  await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-CSC'], dir)

  assert.equal(await main(['upgrade', ...YES], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-CSC')
})

// Prioridad de resolveSkills: el flag explicito gana sobre lo guardado. Un flag
// que se ignora en silencio seria el mismo problema con otra cara.
test('--vault-project explicito corrige lo ya declarado', async () => {
  const dir = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-CSC', 'Project-SHS'])
  await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-CSC'], dir)

  await main(['upgrade', ...YES, '--vault-project', 'Project-SHS'], dir)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

test('camino interactivo: con varias carpetas se pregunta, con el repo homonimo como default', async () => {
  const padre = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude proyecto '))
  const cwd = path.join(padre, 'shs')
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true })
  const vault = mkVault(['Project-CSC', 'Project-OBS', 'Project-SHS'])

  let opciones = null
  let sugerido = null
  const prompts = {
    text: () => '',
    select: ({ options, initialValue }) => {
      opciones = options.map((o) => o.value)
      sugerido = initialValue
      return 'Project-OBS'
    },
  }

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts,
  })

  assert.deepEqual(
    opciones,
    ['Project-CSC', 'Project-OBS', 'Project-SHS', '__crear_nuevo__'],
    'las carpetas no se ofrecieron ordenadas, con "crear nuevo" al final'
  )
  assert.equal(sugerido, 'Project-SHS', 'el default no salio del nombre del repo')
  assert.equal(readVaultConfig(cwd).project, 'Project-OBS', 'se persistio el default en vez de lo elegido')
})

test('camino interactivo: "Crear proyecto nuevo" registra el prefijo y siembra la carpeta', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const vault = mkVault(['Project-CSC', 'Project-OBS'], [['SHS', 'souclaude-harness']])

  const textos = ['ABC', 'Mi Proyecto Nuevo', '@leonardo']
  const prompts = {
    text: () => textos.shift(),
    select: ({ options }) => options.find((o) => o.value === '__crear_nuevo__').value,
  }

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts,
  })

  const registro = leerRegistroDePrefijos(vault)
  assert.deepEqual(
    registro.find((f) => f.prefijo === 'ABC'),
    { prefijo: 'ABC', proyecto: 'Mi Proyecto Nuevo' },
    'el prefijo nuevo no quedo en el registro'
  )
  assert.ok(read(vault, '00-System/id-registry.md').includes('@leonardo'), 'el dueno no quedo en la fila')
  for (const rel of ARCHIVOS_BASE) assert.ok(has(vault, `Project-ABC/${rel}`), `falta ${rel} en la carpeta sembrada`)
  assert.equal(readVaultConfig(cwd).project, 'Project-ABC', 'no se declaro el proyecto creado')
})

test('"Crear proyecto nuevo" con un prefijo ya registrado no escribe nada', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-nuevo' }) })
  const vault = mkVault(['Project-CSC', 'Project-SHS'], [['SHS', 'souclaude-harness']])
  const antes = fs.readFileSync(path.join(vault, '00-System', 'id-registry.md'), 'utf8')

  const prompts = {
    text: () => 'SHS',
    select: ({ options }) => options.find((o) => o.value === '__crear_nuevo__').value,
  }

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts,
  })

  assert.equal(fs.readFileSync(path.join(vault, '00-System', 'id-registry.md'), 'utf8'), antes, 'se toco el registro con un prefijo repetido')
  assert.equal(readVaultConfig(cwd).project, undefined, 'quedo un project declarado sin haberse creado nada')
})

test('un project declarado que ya no existe en el Vault se avisa pero no se pisa', async () => {
  const cwd = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-SHS'])
  await main(['init', ...YES, '--vault-path', vault, '--vault-project', 'Project-SHS'], cwd)

  fs.rmSync(path.join(vault, 'Project-SHS'), { recursive: true })
  assert.equal(await main(['upgrade', ...YES], cwd), 0)

  assert.equal(JSON.parse(read(cwd, VAULT_CONFIG)).project, 'Project-SHS', 'se borro lo declarado por el usuario')
})

test('el paso del proyecto nunca rompe la instalacion, ni con prompts inservibles', async () => {
  const cwd = mkRepo({ 'README.md': '' })
  const vault = mkVault(['Project-CSC', 'Project-SHS'])

  const abs = await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts: {
      text: () => '',
      select: () => {
        throw new Error('prompt roto')
      },
    },
  })

  assert.equal(abs, vault, 'un fallo del prompt tumbo la conexion con el Vault')
  assert.equal(readVaultConfig(cwd).path, vault.split(path.sep).join('/'))
})

// --- Resolucion por el registro de prefijos del Vault (SHS-M5-T003) --------
//
// El registro (00-System/id-registry.md) es la fuente unica que dice que
// proyecto es cada repo. Leerlo permite resolver SIN preguntar, que es lo unico
// que quedaba sin cubrir: un `upgrade --yes` sobre una instalacion vieja.

test('leerRegistroDePrefijos: parsea la tabla y saltea encabezado, separador y comentarios', () => {
  const vault = mkVault([], [['SHS', 'souclaude-harness'], ['CSC', 'Chatbot Spacar']])

  assert.deepEqual(leerRegistroDePrefijos(vault), [
    { prefijo: 'SHS', proyecto: 'souclaude-harness' },
    { prefijo: 'CSC', proyecto: 'Chatbot Spacar' },
  ])
})

test('leerRegistroDePrefijos: un Vault sin registro devuelve [] en vez de romper', () => {
  assert.deepEqual(leerRegistroDePrefijos(path.join(os.tmpdir(), `souclaude sin registro ${process.pid}`)), [])
})

test('el registro resuelve el proyecto sin preguntar, aun con varias carpetas', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC', 'Project-OBS', 'Project-SHS'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

// El caso que T003 vino a cerrar: hasta T001 esto solo emitia un warning y la
// instalacion quedaba sin "project" para siempre.
test('BACKFILL: un upgrade --yes sobre una instalacion vieja sin "project" lo completa por el registro', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC', 'Project-OBS', 'Project-SHS'], [['SHS', 'souclaude-harness']])
  await main(['init', ...YES, '--vault-path', vault], dir)

  // Se simula la instalacion previa a T001: path y repo persistidos, sin project.
  const cfg = JSON.parse(read(dir, VAULT_CONFIG))
  delete cfg.project
  fs.writeFileSync(path.join(dir, ...VAULT_CONFIG.split('/')), JSON.stringify(cfg), 'utf8')

  assert.equal(await main(['upgrade', ...YES], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

test('si el registro apunta a una carpeta que no esta en el Vault, NO se declara la unica que hay', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.equal(
    JSON.parse(read(dir, VAULT_CONFIG)).project,
    undefined,
    'se declaro el proyecto de OTRO repo por ser la unica carpeta'
  )
})

test('un repo que no figura en el registro sigue cayendo en la unica carpeta que hay', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-sin-registrar' }) })
  const vault = mkVault(['Project-SHS'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

// Sin fuzzy: parecerse al nombre registrado no alcanza. Una coincidencia
// aproximada seria otra forma de adivinar, que es justo lo que se corrigio.
test('el registro no matchea por parecido: un nombre distinto no resuelve', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude' }) })
  const vault = mkVault(['Project-CSC', 'Project-SHS'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})


// --- Sembrado de la carpeta del proyecto (SHS-M5-T002) ---------------------
//
// Si el registro de prefijos ya asocia este repo a un Project-<PREFIJO> que
// todavia no existe en el Vault, el CLI lo crea. Es la unica escritura del
// harness en el repo COMPARTIDO de la organizacion, asi que las dos mitades de
// estos tests son igual de importantes: que siembre cuando corresponde y que
// NO escriba nada en ningun otro caso.

// El frontmatter exacto que el plugin Kanban de Obsidian necesita para
// renderizar el archivo como tablero. Es contrato, no estetica.
const FRONTMATTER = `---
kanban-plugin: board
---`

const ARCHIVOS_BASE = ['milestones.md', 'kanban.md', 'sessions.md', 'progress/history.md', 'OBSERVATORIO.md']

const proyectosEn = (vault) => fs.readdirSync(vault).filter((n) => n.startsWith('Project-')).sort()

test('--vault-seed siembra la carpeta que el registro asocia al repo, con sus archivos base', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-seed'], dir), 0)

  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
  for (const rel of ARCHIVOS_BASE) assert.ok(has(vault, `Project-SHS/${rel}`), `falta ${rel}`)
  // plans/ nace vacia y git no versiona directorios vacios: sin el .gitkeep la
  // carpeta no sobrevive al commit.
  assert.ok(has(vault, 'Project-SHS/plans/.gitkeep'), 'plans/ quedo sin materializar')
})

// El Vault de prueba no es un repo git, asi que pushSeguro falla de verdad. Lo
// que se fija aca es la degradacion: la carpeta queda en el clon local y el
// repo igual conoce su proyecto -- lo contrario seria perder el sembrado por no
// poder publicarlo.
test('si el push del Vault falla, la carpeta y el "project" sobreviven igual', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault([], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-seed'], dir), 0)

  assert.ok(has(vault, 'Project-SHS/milestones.md'))
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, 'Project-SHS')
})

test('la semilla respeta el formato de tablero del protocolo', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault([], [['SHS', 'souclaude-harness']])
  await main(['init', ...YES, '--vault-path', vault, '--vault-seed'], dir)

  const kanban = read(vault, 'Project-SHS/kanban.md')
  const milestones = read(vault, 'Project-SHS/milestones.md')

  for (const tablero of [kanban, milestones]) {
    assert.ok(tablero.startsWith(FRONTMATTER), 'sin el frontmatter no hay tablero en Obsidian')
    for (const columna of ['## Backlog', '## En curso', '## Hecho']) assert.ok(tablero.includes(columna))
  }
  // La unica diferencia entre los dos tableros: las tareas tienen review, los
  // milestones no.
  assert.ok(kanban.includes('## En review'))
  assert.ok(!milestones.includes('## En review'))
})

// Escribir en el Vault de la organizacion desde una corrida desatendida seria
// una escritura por cada build de CI. Sin el flag explicito, no se toca.
test('desatendido sin --vault-seed: el Vault no se toca y queda el aviso', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC'], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault], dir), 0)

  assert.deepEqual(proyectosEn(vault), ['Project-CSC'], 'se escribio en el Vault sin pedirlo')
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

// Desatendido, el prefijo no se inventa: sin fila en el registro no hay carpeta
// que sembrar, ni siquiera con el flag puesto. Darlo de alta requiere el
// camino interactivo (crearProyectoNuevo, vault-guide §3).
test('--vault-seed no inventa un prefijo: un repo fuera del registro no siembra nada', async () => {
  const dir = mkRepo({ 'package.json': JSON.stringify({ name: 'proyecto-sin-registrar' }) })
  const vault = mkVault([], [['SHS', 'souclaude-harness']])

  assert.equal(await main(['init', ...YES, '--vault-path', vault, '--vault-seed'], dir), 0)

  assert.deepEqual(proyectosEn(vault), [])
  assert.equal(JSON.parse(read(dir, VAULT_CONFIG)).project, undefined)
})

test('camino interactivo: rechazar la creacion deja el Vault intacto y sin project', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-CSC'], [['SHS', 'souclaude-harness']])

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts: { text: () => '', confirm: () => false, select: () => '' },
  })

  assert.deepEqual(proyectosEn(vault), ['Project-CSC'])
  assert.equal(readVaultConfig(cwd).project, undefined)
})

test('camino interactivo: aceptar siembra y publica con pushSeguro, sobre la carpeta y nada mas', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault([], [['SHS', 'souclaude-harness']])
  const llamadas = []
  const git = async (args) => {
    llamadas.push(args.slice(2))
    return ''
  }

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: false,
    prompts: { text: () => '', confirm: () => true, select: () => '' },
    git,
  })

  assert.deepEqual(
    llamadas.map((a) => a[0]),
    ['add', 'commit', 'pull', 'push'],
    'el orden de pushSeguro no se respeto'
  )
  assert.deepEqual(llamadas[0], ['add', 'Project-SHS'], 'el add tiene que acotarse a la carpeta sembrada')
  assert.deepEqual(llamadas[1], ['commit', '-m', 'chore: alta de Project-SHS en el Vault'])
  assert.deepEqual(llamadas[2], ['pull', '--rebase'])
  assert.equal(readVaultConfig(cwd).project, 'Project-SHS')
})

test('upgrade sobre un proyecto ya declarado completa archivos base que faltaban (SHS-M18)', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-SHS'], [['SHS', 'souclaude-harness']])

  // Simula una instalacion vieja: la carpeta ya existe con solo un archivo
  // base (como si SEMILLAS_PROYECTO hubiera agregado los demas despues de
  // que se sembro), y "project" ya esta declarado -- el camino que un
  // upgrade normal recorre.
  fs.writeFileSync(path.join(vault, 'Project-SHS', 'milestones.md'), '# viejo\n', 'utf8')
  writeVaultConfig(cwd, { path: vault, project: 'Project-SHS' })

  const llamadas = []
  const git = async (args) => {
    llamadas.push(args.slice(2))
    return ''
  }

  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: true,
    prompts: { text: () => '', confirm: () => true, select: () => '' },
    git,
  })

  assert.ok(has(path.join(vault, 'Project-SHS'), 'OBSERVATORIO.md'), 'OBSERVATORIO.md deberia haberse completado')
  assert.ok(has(path.join(vault, 'Project-SHS'), 'progress/history.md'), 'progress/history.md deberia haberse completado')
  assert.equal(
    read(path.join(vault, 'Project-SHS'), 'milestones.md'),
    '# viejo\n',
    'lo que ya existia no se pisa'
  )
  assert.deepEqual(
    llamadas.map((a) => a[0]),
    ['add', 'commit', 'pull', 'push'],
    'el backfill tiene que pushear igual que la siembra inicial'
  )
  assert.deepEqual(llamadas[0], ['add', 'Project-SHS'])
  assert.match(llamadas[1][2], /^chore: completa archivos base de Project-SHS en el Vault$/)
  assert.equal(readVaultConfig(cwd).project, 'Project-SHS')
})

test('upgrade repetido sobre un proyecto ya completo no vuelve a escribir ni pushear', async () => {
  const cwd = mkRepo({ 'package.json': JSON.stringify({ name: 'souclaude-harness' }) })
  const vault = mkVault(['Project-SHS'], [['SHS', 'souclaude-harness']])
  writeVaultConfig(cwd, { path: vault, project: 'Project-SHS' })

  const llamadas = []
  const git = async (args) => {
    llamadas.push(args.slice(2))
    return ''
  }

  // Primera corrida: completa lo que falta y pushea.
  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: true,
    prompts: { text: () => '', confirm: () => true, select: () => '' },
    git,
  })
  llamadas.length = 0

  // Segunda corrida (upgrade siguiente): ya no falta nada, no debe pushear.
  await ensureVault({
    cwd,
    flags: { 'vault-path': vault },
    manifest: loadManifest(),
    lock: null,
    yes: true,
    prompts: { text: () => '', confirm: () => true, select: () => '' },
    git,
  })

  assert.deepEqual(llamadas, [], 'sin archivos faltantes no debe llamar a git')
})

// --- Regresion multi-proyecto ----------------------------------------------
//
// carpetaProyecto() es el punto exacto donde el monitor decide en que carpeta
// escribir sessions.md (src/commands/monitor.js:220). Estos dos casos son el
// escenario que rompio en silencio desde el 2026-08-19.

test('carpetaProyecto: con project declarado y varias carpetas devuelve la declarada', () => {
  const vault = mkVault(['Project-CSC', 'Project-OBS', 'Project-SHS'])

  assert.equal(carpetaProyecto(vault, { project: 'Project-OBS' }), 'Project-OBS')
})

test('carpetaProyecto: sin project y con varias carpetas devuelve null — el respaldo no adivina', () => {
  const vault = mkVault(['Project-CSC', 'Project-SHS'])

  assert.equal(carpetaProyecto(vault, {}), null)
})

test('writeVaultConfig preserva project y quien al reescribir (upgrade no borra la identidad)', async () => {
  const { writeVaultConfig } = await import('../src/core/vault.js')
  const cwd = mkRepo({ 'README.md': '' })
  const vault = mkVault()

  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true })
  fs.writeFileSync(
    path.join(cwd, ...VAULT_CONFIG.split('/')),
    JSON.stringify({ path: vault, repo: 'https://x/y.git', project: 'Project-SHS', quien: 'ignacio' }),
    'utf8'
  )

  // Reescritura tipica de un upgrade: solo path + repo. Lo manual sobrevive.
  writeVaultConfig(cwd, { path: vault, repo: null })
  let config = readVaultConfig(cwd)
  assert.equal(config.project, 'Project-SHS')
  assert.equal(config.quien, 'ignacio')
  assert.equal(config.repo, 'https://x/y.git')

  // Pasar quien explicito lo actualiza sin tocar el resto.
  writeVaultConfig(cwd, { path: vault, quien: 'nacho' })
  config = readVaultConfig(cwd)
  assert.equal(config.quien, 'nacho')
  assert.equal(config.project, 'Project-SHS')
})
