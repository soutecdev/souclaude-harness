import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../src/cli.js'
import { mkRepo, read, write, has, snapshot } from './helpers.js'
import { readLockfile } from '../src/core/lockfile.js'
import { parseJson, sinBom } from '../src/core/jsonmerge.js'

// Entradas que en la practica llegan rotas de formas previsibles: un JSON
// guardado con BOM por una herramienta de Windows, y un lockfile que quedo con
// marcadores de conflicto porque dos ramas corrieron `upgrade`.
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const BOM = '\uFEFF'

test('sinBom / parseJson: el BOM inicial no vuelve invalido un JSON', () => {
  assert.equal(sinBom(`${BOM}{"a":1}`), '{"a":1}')
  assert.equal(sinBom('{"a":1}'), '{"a":1}')
  assert.equal(sinBom(null), null)
  assert.deepEqual(parseJson(`${BOM}{"a":1}`, 'x.json'), { a: 1 })
  assert.throws(() => parseJson('{ roto', 'x.json'), /x\.json no es JSON valido/)
})

test('upgrade: un settings.json guardado con BOM (PowerShell 5.1) no aborta el upgrade', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  const settings = JSON.parse(read(dir, '.claude/settings.json'))
  settings.model = 'sonnet' // una preferencia del usuario que tiene que sobrevivir
  write(dir, '.claude/settings.json', BOM + JSON.stringify(settings, null, 2))

  assert.equal(await main(['upgrade', ...YES], dir), 0)
  const despues = read(dir, '.claude/settings.json')
  assert.notEqual(despues.charCodeAt(0), 0xfeff, 'el settings.json reescrito conserva el BOM')
  assert.equal(JSON.parse(despues).model, 'sonnet')
})

test('lockfile con BOM se lee igual; vacio o ausente es "sin harness"', () => {
  const dir = mkRepo({ '.claude/harness.json': `${BOM}{"harnessVersion":"3.0.0"}` })
  assert.equal(readLockfile(dir).harnessVersion, '3.0.0')
  assert.deepEqual(readLockfile(dir).files, {})
  assert.equal(readLockfile(mkRepo({ '.claude/harness.json': '' })), null)
  assert.equal(readLockfile(mkRepo({})), null)
})

test('lockfile dañado: error que lo nombra, en vez de tratar al repo como "sin harness"', async () => {
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  write(dir, 'CLAUDE.md', `${read(dir, 'CLAUDE.md')}\nuna regla del equipo\n`)
  const original = read(dir, '.claude/harness.json')

  for (const dañado of [
    `<<<<<<< HEAD\n${original}=======\n${original}>>>>>>> otra-rama\n`, // conflicto de merge sin resolver
    original.slice(0, Math.floor(original.length / 2)), // truncado
    '[]',
    '"texto"',
    '{"files": []}',
  ]) {
    write(dir, '.claude/harness.json', dañado)
    assert.throws(() => readLockfile(dir), /\.claude\/harness\.json existe pero no es un lockfile valido/)
    const antes = snapshot(dir, { includeLockfile: true })
    // Ni el comando explicito ni la autodeteccion (sin comando) lo toman por un repo sin harness.
    for (const argv of [['upgrade', ...YES], ['status'], YES]) {
      assert.equal(await main(argv, dir), 1, `${argv[0]} deberia fallar con el lockfile dañado`)
    }
    assert.equal(snapshot(dir, { includeLockfile: true }), antes, 'se escribio algo con el lockfile dañado')
    assert.ok(!has(dir, 'CLAUDE.md.new'))
  }

  // Reparado, todo sigue como antes.
  write(dir, '.claude/harness.json', original)
  assert.equal(await main(['upgrade', ...YES], dir), 0)
})

// --- Textos que el harness instala o imprime ------------------------------------

// Decision ya tomada por el propio repo (CHANGELOG 3.14.1) y que no se habia
// terminado de aplicar: fuera de este repo, `npx souclaude` no trae el harness,
// trae lo que haya en el registro publico de npm con ese nombre -- que no es
// nuestro y cualquiera puede registrar. Este test es el candado.
test('ninguna plantilla, mensaje del CLI ni guia manda a correr `npx souclaude` (nombre corto)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const PERMITIDAS = [
    /no uses `npx souclaude`/, // la advertencia misma (progress/README.md)
    /'`npx souclaude vault-sync --push -m "docs: worklog"`'/, // el texto viejo que una migracion reemplaza
    /^\s*\/\//, // comentarios del codigo que explican por que no se usa
  ]
  const hallazgos = []
  const revisar = (abs) => {
    if (!/\.(md|mjs|js|json|yml|txt|example|html|svg)$/.test(abs)) return
    fs.readFileSync(abs, 'utf8').split('\n').forEach((linea, i) => {
      if (/npx souclaude(?!-harness)/.test(linea) && !PERMITIDAS.some((p) => p.test(linea))) {
        hallazgos.push(`${path.relative(raiz, abs)}:${i + 1}`)
      }
    })
  }
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(abs)
      else revisar(abs)
    }
  }
  recorrer(path.join(raiz, 'templates'))
  recorrer(path.join(raiz, 'src'))
  // Las guias, infografias y laminas son lo que un dev nuevo copia y pega en una
  // maquina sin nada instalado: ahi el nombre corto si sale al registro publico.
  // Los ADR quedan fuera: son el registro historico de lo que se decidio.
  for (const e of fs.readdirSync(path.join(raiz, 'docs'), { withFileTypes: true })) {
    const abs = path.join(raiz, 'docs', e.name)
    if (!e.isDirectory()) revisar(abs)
    else if (e.name !== 'decisions') recorrer(abs)
  }
  for (const suelto of ['README.md', 'MAINTAINERS.md']) revisar(path.join(raiz, suelto))
  assert.deepEqual(hallazgos, [], `usa la forma con el repo (npx github:soutecdev/souclaude-harness#v3) o el CLI global: ${hallazgos.join(', ')}`)
})

test('comandoNpx: siempre el repo de GitHub con el tag movil de la serie', async () => {
  const { comandoNpx } = await import('../src/core/vault.js')
  assert.match(comandoNpx(), /^npx github:soutecdev\/souclaude-harness#v\d+$/)
})

test('el comentario que el hook reglas-pr publica en los PR ya no afirma que Actions esta en pausa', async () => {
  const { comentario } = await import('../templates/base/claude/hooks/reglas-pr.mjs')
  const texto = comentario({ sha: 'abcdef1234', resultados: [{ grupo: 'secretos', bloqueante: true, status: 0, salida: '[OK  ] sin-secretos' }] })
  assert.doesNotMatch(texto, /en pausa|SHS-M36/)
  assert.match(texto, /abcdef1/)
  assert.match(texto, /reglas-\*/)
})

// El CLAUDE.md de equipo que emitieron 3.14-3.18 le dice al agente que Actions
// esta en pausa. Es user-owned y casi siempre esta editado: sin migracion, el
// upgrade solo dejaria un .new y la instruccion falsa seguiria mandando.
test('upgrade: los pasajes de "Actions en pausa" del CLAUDE.md se corrigen en el lugar, sin tocar lo del usuario', async () => {
  const VIEJO_TAGS = [
    '  Los **tags de versión** (`vX.Y.Z` + tag móvil por major) sí puedo crearlos, solo al',
    '  publicar y después del merge de release `dev` → `main`: mientras GitHub Actions',
    '  esté en pausa (SHS-M36), con `git fetch origin && node scripts/tag-release.mjs',
    '  --ref origin/main`.',
  ].join('\n')
  const VIEJO_CHECKS = '- **Checks de PR en la sesión** (Actions en pausa, SHS-M36): el hook `reglas-pr` de'
  const { writeLockfile } = await import('../src/core/lockfile.js')

  for (const eol of ['\n', '\r\n']) {
    const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
    assert.equal(await main(['init', ...YES], dir), 0)
    const nuevo = read(dir, 'CLAUDE.md')
    const inicioTags = nuevo.indexOf('  Los **tags de versión**')
    const finTags = nuevo.indexOf('--ref origin/main`.') + '--ref origin/main`.'.length
    assert.ok(inicioTags > 0 && finTags > inicioTags)
    // Asi lo dejo instalado una version anterior, mas una regla que agrego el equipo.
    const instalado = (nuevo.slice(0, inicioTags) + VIEJO_TAGS + nuevo.slice(finTags))
      .replace('- **Checks de PR en la sesión** (además de los workflows `reglas-*` de CI): el hook `reglas-pr` de', VIEJO_CHECKS)
      .concat('\n## Reglas del equipo\n\n- Una regla nuestra.\n')
      .replaceAll('\n', eol)
    assert.match(instalado, /en pausa \(SHS-M36\)/)
    write(dir, 'CLAUDE.md', instalado)
    writeLockfile(dir, { ...readLockfile(dir), harnessVersion: '3.18.1' })

    assert.equal(await main(['upgrade', ...YES], dir), 0)
    const despues = read(dir, 'CLAUDE.md')
    assert.doesNotMatch(despues, /en pausa|SHS-M36/, 'la instruccion falsa sobrevivio al upgrade')
    assert.match(despues, /los crea el workflow\r?\n  `tag-release\.yml`/)
    assert.match(despues, /además de los workflows `reglas-\*` de CI/)
    assert.ok(despues.includes('## Reglas del equipo\n\n- Una regla nuestra.'), 'se perdio la edicion del equipo')
    assert.ok(!despues.includes('\r\n'), 'el motor escribe siempre LF, tambien al migrar un archivo que estaba en CRLF')
    assert.ok(!has(dir, 'CLAUDE.md.new'), 'el template no cambio: no corresponde un .new')
  }
})

// protegeBranchMain REEMPLAZA la proteccion existente de `main` en cada init y
// upgrade del modo equipo. No habia forma de decirle que no.
test('--no-github-protect: init/upgrade no tocan la proteccion de main', async () => {
  const { githubProtectionStep } = await import('../src/commands/_shared.js')
  const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
  assert.equal(await main(['init', ...YES], dir), 0)
  let llamadas = 0
  const protege = () => { llamadas += 1 }
  assert.equal(githubProtectionStep({ code: 0, cwd: dir, flags: {}, protege }), 0)
  assert.equal(llamadas, 1, 'por defecto, en modo equipo, la proteccion se configura')
  assert.equal(githubProtectionStep({ code: 0, cwd: dir, flags: { 'github-protect': false }, protege }), 0)
  assert.equal(llamadas, 1, 'con --no-github-protect no se llama a GitHub')
  // El flag existe en el CLI (parseArgs es estricto) y no altera el resto del comando.
  assert.equal(await main(['upgrade', ...YES, '--no-github-protect'], dir), 0)
})
