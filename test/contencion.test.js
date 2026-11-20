import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../src/cli.js'
import { mkRepo, read, has, write, snapshot } from './helpers.js'
import { loadManifest } from '../src/core/manifest.js'
import { resolveDetected } from '../src/core/detect.js'
import { readLockfile, writeLockfile } from '../src/core/lockfile.js'
import { computePlan, CREATE } from '../src/core/plan.js'
import { apply } from '../src/core/apply.js'
import { hashContent } from '../src/core/hash.js'
import { esDestSeguro, leerParaElPlan } from '../src/core/fsx.js'

// Dos garantias del motor que antes dependian de que nada fallara:
//
//  1. "Un archivo tuyo nunca se sobrescribe en silencio" tambien cuando el
//     archivo existe pero NO SE PUEDE LEER. Antes, cualquier error de lectura se
//     trataba como "no existe" y el motor escribia encima, sin .new ni backup.
//  2. Nada se lee, escribe ni borra FUERA del repo, diga lo que diga el lockfile
//     (que se commitea y llega por PR) o el plan que reciba apply().
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']

function planDe(dir) {
  const manifest = loadManifest()
  const lock = readLockfile(dir)
  const detected = resolveDetected(dir, lock)
  const vars = lock?.vars ?? {}
  return { manifest, lock, detected, vars, plan: computePlan({ manifest, cwd: dir, lock, vars, detected }) }
}

test('esDestSeguro: solo rutas POSIX relativas dentro del repo', () => {
  for (const ok of ['CLAUDE.md', '.claude/settings.json', '.github/workflows/ci.yml', 'docs/decisions/_template.md', 'a..b/c', '.env.example']) {
    assert.equal(esDestSeguro(ok), true, ok)
  }
  for (const mal of [
    '../victima.txt',
    'docs/../../victima.txt',
    '/etc/passwd',
    '\\\\servidor\\recurso\\x',
    'C:/Windows/x',
    'c:\\Windows\\x',
    '..',
    '.',
    './CLAUDE.md',
    'docs//x.md',
    'docs/',
    'docs\\..\\..\\x',
    'x\0y',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(esDestSeguro(mal), false, String(mal))
  }
})

test('leerParaElPlan: ausente es null; existente e ilegible es un error que nombra el archivo', () => {
  const dir = mkRepo({ 'hay.txt': 'hola\n' })
  assert.equal(leerParaElPlan(path.join(dir, 'no-hay.txt'), 'no-hay.txt'), null)
  assert.equal(leerParaElPlan(path.join(dir, 'hay.txt', 'adentro.txt'), 'hay.txt/adentro.txt'), null, 'ENOTDIR tambien es ausente')
  assert.equal(leerParaElPlan(path.join(dir, 'hay.txt'), 'hay.txt'), 'hola\n')
  assert.ok(Buffer.isBuffer(leerParaElPlan(path.join(dir, 'hay.txt'), 'hay.txt', { binario: true })))
  // Una carpeta donde se esperaba un archivo: existe y no se puede leer como archivo.
  fs.mkdirSync(path.join(dir, 'carpeta.md'))
  assert.throws(() => leerParaElPlan(path.join(dir, 'carpeta.md'), 'carpeta.md'), /No se pudo leer carpeta\.md .*No se escribio nada/s)
})

// La carpeta-en-lugar-de-archivo es el caso portable (EISDIR en todo SO) del
// mismo problema que EBUSY/EPERM en Windows o un placeholder de OneDrive sin
// conexion: el archivo "esta" pero la lectura falla.
test('NUNCA SE PISA, tampoco si no se pudo leer: el plan corta antes de escribir un byte', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  fs.mkdirSync(path.join(dir, 'CLAUDE.md'))
  write(dir, 'CLAUDE.md/guardado.txt', 'algo del usuario\n')
  const antes = snapshot(dir)

  assert.equal(await main(['init', ...YES], dir), 1, 'el comando debe fallar, no instalar a medias')
  assert.equal(snapshot(dir), antes, 'se escribio algo aunque el plan no pudo leer un archivo')
  assert.ok(!has(dir, '.claude/harness.json'), 'quedo un lockfile de una instalacion que no ocurrio')
})

test(
  'NUNCA SE PISA: un CLAUDE.md del usuario sin permiso de lectura no se trata como ausente',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async () => {
    const mio = '# MI CLAUDE.md\n\nReglas escritas a mano por el equipo.\n'
    const dir = mkRepo({ 'package.json': '{"name":"acme"}\n', 'CLAUDE.md': mio })
    const ruta = path.join(dir, 'CLAUDE.md')
    fs.chmodSync(ruta, 0o200) // se puede escribir, no leer
    try {
      assert.equal(await main(['init', ...YES], dir), 1)
    } finally {
      fs.chmodSync(ruta, 0o644)
    }
    assert.equal(read(dir, 'CLAUDE.md'), mio, 'el archivo ilegible del usuario fue sobrescrito con la plantilla')
    assert.ok(!has(dir, '.claude/harness.json'))
  }
)

test('lockfile con una clave fuera del repo: --prune no la lee, no la borra y la saca del lockfile', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)

  // Un archivo AJENO al repo, al lado, y un lockfile adulterado que lo reclama
  // como "archivo del harness, intacto": antes eso era un borrado sin confirmar.
  const victima = path.join(path.dirname(dir), `${path.basename(dir)}-victima.txt`)
  fs.writeFileSync(victima, 'archivo ajeno al repo\n')
  const clave = `../${path.basename(victima)}`
  const lock = readLockfile(dir)
  lock.files[clave] = { policy: 'managed', hash: hashContent('archivo ajeno al repo\n') }
  lock.files['/etc/hosts'] = { policy: 'managed', hash: 'x' }
  writeLockfile(dir, lock)

  const { plan, manifest, detected, vars } = planDe(dir)
  assert.ok(!plan.actions.some((a) => a.dest === clave || a.dest === '/etc/hosts'), 'se planifico una accion sobre una ruta fuera del repo')
  assert.deepEqual(plan.ignorados.map((i) => i.dest).sort(), ['/etc/hosts', clave].sort())

  const res = apply({ plan, cwd: dir, manifest, vars, detected, lock: readLockfile(dir), prune: true, pruneEdited: true })
  assert.deepEqual(res.removed, [])
  assert.ok(fs.existsSync(victima), 'el archivo de fuera del repo fue borrado')
  assert.deepEqual(Object.keys(readLockfile(dir).files).filter((k) => !esDestSeguro(k)), [], 'la clave adulterada sobrevivio en el lockfile')

  // Y por el CLI completo, igual.
  writeLockfile(dir, { ...readLockfile(dir), files: { ...readLockfile(dir).files, [clave]: lock.files[clave] } })
  assert.equal(await main(['upgrade', ...YES, '--prune'], dir), 0)
  assert.ok(fs.existsSync(victima))
  fs.rmSync(victima)
})

test('apply: un plan con una ruta fuera del repo no escribe nada, ni siquiera las acciones validas', () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  const manifest = loadManifest()
  const detected = resolveDetected(dir, null)
  const fuera = path.join(path.dirname(dir), `${path.basename(dir)}-escrito.txt`)
  const buena = { dest: 'ok.md', writePath: 'ok.md', policy: 'managed', verdict: CREATE, reasons: [], content: 'ok\n' }

  for (const mala of [
    { dest: 'x.md', writePath: `../${path.basename(fuera)}` },
    { dest: `../${path.basename(fuera)}`, writePath: 'x.md' },
    { dest: 'x.md', writePath: fuera },
  ]) {
    const plan = { actions: [buena, { policy: 'managed', verdict: CREATE, reasons: [], content: 'pwned\n', ...mala }], dirs: [], skills: [], modo: 'equipo' }
    assert.throws(() => apply({ plan, cwd: dir, manifest, vars: {}, detected, lock: null }), /bloqueado: ruta fuera del repo/)
    assert.ok(!fs.existsSync(fuera), 'se escribio fuera del repo')
    assert.ok(!has(dir, 'ok.md'), 'se aplico parte de un plan invalido')
    assert.ok(!has(dir, '.claude/harness.json'))
  }
  const dirs = { actions: [buena], dirs: [{ dest: '../afuera' }], skills: [], modo: 'equipo' }
  assert.throws(() => apply({ plan: dirs, cwd: dir, manifest, vars: {}, detected, lock: null }), /bloqueado: ruta fuera del repo/)
  assert.ok(!has(dir, 'ok.md'))
})

test('computePlan: un dest del manifest fuera del repo es un manifest invalido', () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  const manifest = loadManifest()
  const roto = { ...manifest, files: [...manifest.files, { id: 'malo', src: 'base/notes.md', dest: '../notes.md', policy: 'managed' }] }
  assert.throws(
    () => computePlan({ manifest: roto, cwd: dir, lock: null, vars: {}, detected: resolveDetected(dir, null) }),
    /manifest invalido: el entry "malo" tiene un dest fuera del repo/
  )
})

test('--prune con --no-backup: lo borrado se respalda igual y el respaldo se reporta', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  // Un archivo que el harness emitio y que el manifest ya no declara.
  write(dir, 'docs/viejo.md', 'contenido emitido por una version anterior\n')
  const lock = readLockfile(dir)
  lock.files['docs/viejo.md'] = { policy: 'managed', hash: hashContent('contenido emitido por una version anterior\n') }
  writeLockfile(dir, lock)

  const { plan, manifest, detected, vars } = planDe(dir)
  const res = apply({ plan, cwd: dir, manifest, vars, detected, lock: readLockfile(dir), prune: true, backup: false })
  assert.deepEqual(res.removed, ['docs/viejo.md'])
  assert.ok(res.backupRoot, 'se borro un archivo y no se informo donde quedo el respaldo')
  assert.equal(read(dir, `.claude/${path.basename(res.backupRoot)}/docs/viejo.md`), 'contenido emitido por una version anterior\n')
})

// README ("La garantia") y --help: "--force exige tipear FORCE". No existia: con
// `upgrade --force --yes` los archivos editados por el usuario se sobrescribian
// sin la confirmacion escrita prometida.
async function repoConConflicto() {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  // Conflicto real: el usuario edito progress/README.md (managed) Y el template
  // "cambio" (el lockfile recuerda otro hash que el que hoy emite el harness).
  const mio = `${read(dir, 'progress/README.md')}\nuna nota del equipo\n`
  write(dir, 'progress/README.md', mio)
  const lock = readLockfile(dir)
  lock.files['progress/README.md'].hash = hashContent('lo que emitio una version anterior\n')
  writeLockfile(dir, lock)
  return { dir, mio }
}

test('--force sin la confirmacion escrita no pisa nada: la propuesta queda en .new (--yes no la implica)', async () => {
  const { dir, mio } = await repoConConflicto()
  // helpers.js fija CI=true: como con BORRAR, en CI la confirmacion se deniega.
  assert.equal(await main(['upgrade', ...YES, '--force'], dir), 0)
  assert.equal(read(dir, 'progress/README.md'), mio, '--force --yes sobrescribio un archivo editado sin la confirmacion FORCE')
  assert.ok(has(dir, 'progress/README.md.new'))
})

test('--force con FORCE tipeado: pisa en el lugar y deja backup; con otra palabra, no', async () => {
  const { planAndApply } = await import('../src/commands/_shared.js')
  const ui = await import('../src/ui.js')
  for (const [respuesta, pisa] of [[false, false], [true, true]]) {
    const { dir, mio } = await repoConConflicto()
    const manifest = loadManifest()
    const lock = readLockfile(dir)
    const detected = resolveDetected(dir, lock)
    const pedidos = []
    const prompts = { ...ui, confirmDestructive: async (p) => (pedidos.push(p), respuesta) }
    const flags = { yes: true, force: true, solo: false, equipo: false }
    assert.equal(await planAndApply({ manifest, cwd: dir, lock, vars: lock.vars, detected, flags, title: 'upgrade', prompts }), 0)

    assert.equal(pedidos.length, 1, 'no se pidio la confirmacion escrita')
    assert.equal(pedidos[0].word, 'FORCE')
    assert.match(pedidos[0].message, /progress\/README\.md/)
    assert.equal(read(dir, 'progress/README.md') === mio, !pisa)
    assert.equal(has(dir, 'progress/README.md.new'), !pisa)
    if (pisa) {
      const backup = fs.readdirSync(path.join(dir, '.claude')).find((e) => e.startsWith('backup-'))
      assert.equal(read(dir, `.claude/${backup}/progress/README.md`), mio, 'se piso sin respaldar la version del usuario')
    }
  }
})

test('--force --dry-run no pregunta y no escribe', async () => {
  const { dir, mio } = await repoConConflicto()
  const antes = snapshot(dir)
  assert.equal(await main(['upgrade', ...YES, '--force', '--dry-run'], dir), 0)
  assert.equal(snapshot(dir), antes)
  assert.equal(read(dir, 'progress/README.md'), mio)
})
