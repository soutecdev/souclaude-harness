import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../src/cli.js'
import fs from 'node:fs'
import path from 'node:path'
import { mkRepo, read, write, has, snapshot, replan, verdicts } from './helpers.js'
import { OBSOLETE, NOOP, CONFLICT, MIGRATE, computePlan } from '../src/core/plan.js'
import { apply } from '../src/core/apply.js'
import { loadManifest } from '../src/core/manifest.js'
import { detect, resolveDetected } from '../src/core/detect.js'
import { readLockfile } from '../src/core/lockfile.js'
import { hashContent } from '../src/core/hash.js'

const YES = ['--yes', '--name', 'kit', '--type', 'backend', '--lang', 'es']

// El Kit v0 tal como existe hoy: settings.json con 4 claves que Claude Code ignora,
// un .claudeignore que nunca hizo nada, y un CLAUDE.md hecho a mano.
function kitV0() {
  return mkRepo({
    'package.json': '{"name":"proyecto-viejo"}',
    'CLAUDE.md': '# CLAUDE.md — Proyecto viejo\n\n## Metodología CCEM\nVerificar instalación: `ls ~/.claude/skills/ccem-*`\n',
    '.claude/settings.json': JSON.stringify(
      {
        model: 'opusplan',
        effort: 'medium',
        auto_confirm_destructive: false,
        display_tools: 'lean',
        token_budget_warning: 100000,
      },
      null,
      2
    ),
    '.claudeignore': '# Lockfiles (mucho texto, poco valor para Claude)\npackage-lock.json\n',
    'docs/constitution.md': '# Constitución\n\n### P7 — Simplicity First\nMínimo código.\n',
    '.gitignore': 'node_modules/\n',
  })
}

test('migracion v0: las 4 claves invalidas del settings.json se remueven', async () => {
  const dir = kitV0()

  assert.equal(await main(['upgrade', ...YES], dir), 0)

  const settings = JSON.parse(read(dir, '.claude/settings.json'))

  for (const bad of ['effort', 'auto_confirm_destructive', 'display_tools', 'token_budget_warning']) {
    assert.ok(!(bad in settings), `la clave invalida "${bad}" sobrevivio al upgrade`)
  }

  // model: "opusplan" tampoco es un valor valido, pero es un valor que el usuario
  // escribio. La migracion remueve claves invalidas, no juzga valores: el seed-merge
  // lo respeta. Removerlo seria una decision aparte, explicita.
  assert.equal(settings.model, 'opusplan')

  // Y lo que el harness aporta se agrega sin pisar nada.
  assert.equal(settings.effortLevel, 'medium')
  assert.ok(settings.permissions.deny.includes('Read(./.env)'))
})

test('migracion v0: el .claudeignore se marca obsoleto, pero NO se borra solo', async () => {
  const dir = kitV0()
  await main(['upgrade', ...YES], dir)

  // Sigue ahi: borrar es destructivo y --prune no se pidio (P5).
  assert.ok(has(dir, '.claudeignore'))

  const plan = replan(dir)
  const obsoletos = verdicts(plan)[OBSOLETE] ?? []
  assert.deepEqual(obsoletos, ['.claudeignore'])

  const razon = plan.actions.find((a) => a.dest === '.claudeignore').reasons[0]
  assert.match(razon, /nunca soporto \.claudeignore/)
})

test('migracion v0: --prune solo NO alcanza para el .claudeignore (no hay lockfile previo, no se puede verificar si lo editaron)', async () => {
  const dir = kitV0()
  await main(['upgrade', ...YES], dir)

  const manifest = loadManifest()
  const lock = readLockfile(dir)
  const detected = detect(dir)
  const plan = replan(dir)

  const res = apply({ plan, cwd: dir, manifest, vars: lock.vars, detected, lock, prune: true, backup: true })

  assert.ok(has(dir, '.claudeignore'), 'un obsoleto sin lockfile previo no se puede clasificar como sin editar, y se borro igual')
  assert.deepEqual(res.removed, [])
})

test('migracion v0: --prune + pruneEdited borra el .claudeignore, con backup', async () => {
  const dir = kitV0()
  await main(['upgrade', ...YES], dir)

  // --prune de un obsoleto editado (o sin lockfile) exige la confirmacion escrita
  // interactiva, asi que en test se ejercita apply() directo con pruneEdited: true.
  // Es la misma ruta de codigo que corre tras el "BORRAR".
  const manifest = loadManifest()
  const lock = readLockfile(dir)
  const detected = detect(dir)
  const plan = replan(dir)

  const res = apply({ plan, cwd: dir, manifest, vars: lock.vars, detected, lock, prune: true, pruneEdited: true, backup: true })

  assert.ok(!has(dir, '.claudeignore'), 'el .claudeignore no se borro')
  assert.deepEqual(res.removed, ['.claudeignore'])
  // Backup antes de borrar: P6.
  assert.ok(res.backupRoot)
  assert.ok(has(dir, `.claude/${res.backupRoot.split(/[\\/]/).pop()}/.claudeignore`))
})

test('migracion v0: el CLAUDE.md hecho a mano NO se pisa', async () => {
  const dir = kitV0()
  const original = read(dir, 'CLAUDE.md')

  await main(['upgrade', ...YES], dir)

  assert.equal(read(dir, 'CLAUDE.md'), original)
  assert.ok(has(dir, 'CLAUDE.md.new'))

  // El .new apunta a las skills project-local, no al `ls ~/.claude/skills/` viejo.
  const propuesta = read(dir, 'CLAUDE.md.new')
  assert.ok(propuesta.includes('.claude/skills/'))
  assert.ok(!propuesta.includes('ls ~/.claude/skills/ccem-*'))
})

test('migracion v0: lo que faltaba se crea (las skills del catalogo)', async () => {
  const dir = kitV0()
  await main(['upgrade', ...YES], dir)

  for (const s of [
    'soutec-github',
    'it-security-review',
    'security-report-standard',
    'soutec-md-a-pdf',
    'adr-new',
    'harness-upgrade',
  ]) {
    assert.ok(has(dir, `.claude/skills/${s}/SKILL.md`), `no se creo la skill ${s}`)
  }
  // Y nada del flujo SDD viejo.
  assert.ok(!has(dir, '.claude/agents/orchestrator.md'))
  assert.ok(!has(dir, 'specs/_templates/spec-template.md'))
})

test('migracion v0: backup de todo lo sobrescrito', async () => {
  const dir = kitV0()
  await main(['upgrade', ...YES], dir)

  const backups = (await import('node:fs')).readdirSync(
    (await import('node:path')).join(dir, '.claude')
  ).filter((e) => e.startsWith('backup-'))

  assert.equal(backups.length, 1, 'no se creo el directorio de backup')
  // settings.json fue sobrescrito (migracion + merge), asi que su version previa
  // tiene que estar guardada.
  assert.ok(has(dir, `.claude/${backups[0]}/.claude/settings.json`))
  const previo = JSON.parse(read(dir, `.claude/${backups[0]}/.claude/settings.json`))
  assert.equal(previo.display_tools, 'lean', 'el backup no tiene el contenido original')
})

test('adopt sobre el Kit v0: escribe el lockfile y no toca ni un archivo', async () => {
  const dir = kitV0()
  const antes = snapshot(dir, { includeLockfile: true })

  assert.equal(await main(['adopt', ...YES], dir), 0)

  const despues = snapshot(dir, { includeLockfile: false })
  assert.equal(despues, antes, 'adopt modifico un archivo')
  assert.ok(has(dir, '.claude/harness.json'))

  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  assert.equal(lock.adopted, true)
  assert.equal(lock.harnessVersion, '0.0.0')

  // Nada del Kit coincide byte a byte con el harness v1, asi que el lockfile no
  // reclama nada. Reclamar un archivo modificado seria autorizar al upgrade a pisarlo.
  assert.equal(lock.files['CLAUDE.md'], undefined)
  assert.equal(lock.files['.claude/settings.json'], undefined)
})

test('upgrade despues de adopt: converge y queda idempotente', async () => {
  const dir = kitV0()
  await main(['adopt', ...YES], dir)
  await main(['upgrade', ...YES], dir)

  const estable = snapshot(dir)
  await main(['upgrade', ...YES], dir)
  assert.equal(snapshot(dir), estable, 'el segundo upgrade no fue idempotente')

  // Lo unico que queda pendiente es el .claudeignore obsoleto (requiere --prune)
  // y el CLAUDE.md del usuario (que nunca se pisa).
  const pendientes = Object.keys(verdicts(replan(dir))).filter((v) => v !== NOOP)
  assert.deepEqual(pendientes.sort(), ['foreign', 'obsolete'])
})

// Un obsoleto de verdad (declarado en el lockfile, ya no en el manifest): si el
// contenido en disco sigue siendo exactamente lo que el harness escribio, es
// contenido del harness y --prune lo borra sin pedir confirmacion (autoPrune).
// Si el usuario lo edito, --prune exige la confirmacion escrita de siempre.
test('computePlan: obsoleto sin editar (hash intacto) se marca autoPrune, editado no', () => {
  const contenidoOriginal = 'contenido que escribio el harness\n'
  const dir = mkRepo({ 'viejo/intacto.md': contenidoOriginal, 'viejo/editado.md': 'lo que el usuario dejo\n' })
  const manifest = { harnessVersion: '1.0.0', files: [], obsolete: [] }
  const lock = {
    harnessVersion: '1.0.0',
    files: {
      'viejo/intacto.md': { policy: 'managed', hash: hashContent(contenidoOriginal) },
      'viejo/editado.md': { policy: 'managed', hash: hashContent('contenido que escribio el harness, version anterior\n') },
    },
  }
  const detected = resolveDetected(dir, null)

  const plan = computePlan({ manifest, cwd: dir, lock, vars: {}, detected })
  const porDest = Object.fromEntries(plan.actions.map((a) => [a.dest, a]))

  assert.equal(porDest['viejo/intacto.md'].verdict, OBSOLETE)
  assert.equal(porDest['viejo/intacto.md'].autoPrune, true)

  assert.equal(porDest['viejo/editado.md'].verdict, OBSOLETE)
  assert.equal(porDest['viejo/editado.md'].autoPrune, false)
})

// SHS-M37-T005: el CLAUDE.md de un consumidor instalado con v3.14.0 o antes dice
// `git -C "<vault>" pull --rebase` (equipo) o `npx souclaude vault-sync --push ...`
// (solo): las dos piden confirmacion. Es user-owned y casi siempre esta editado,
// asi que sin migracion la linea nueva solo llegaria al .new.
const LINEA_EQUIPO = { nueva: '`souclaude vault-sync` y lee', vieja: '`git -C "<vault>" pull --rebase` y lee' }
const LINEA_SOLO = {
  nueva: '`souclaude vault-sync --push -m "docs: worklog" --paths Project-<PREFIJO>`',
  vieja: '`npx souclaude vault-sync --push -m "docs: worklog"`',
}
const EDICION = '\n## Notas del equipo\n\nEsto lo escribio el dev y no se toca.\n'

// Deja el repo como si lo hubiera instalado la v3.14.0 y el dev hubiera editado el
// CLAUDE.md. `plantillaCambio`: el lockfile guarda el hash de la plantilla vieja
// (conflict) o el de la actual (local-edit).
async function instaladoEnV314({ solo = false, plantillaCambio = true } = {}) {
  const dir = mkRepo({ 'package.json': '{"name":"consumidor"}' })
  assert.equal(await main(['init', ...YES, ...(solo ? ['--solo'] : [])], dir), 0)
  const { nueva, vieja } = solo ? LINEA_SOLO : LINEA_EQUIPO
  const actual = read(dir, 'CLAUDE.md')
  assert.ok(actual.includes(nueva), 'la plantilla actual ya no trae la linea nueva: ajustar el test')
  const vieja314 = actual.replace(nueva, vieja)
  write(dir, 'CLAUDE.md', vieja314 + EDICION)
  const lock = JSON.parse(read(dir, '.claude/harness.json'))
  lock.harnessVersion = '3.14.0'
  lock.files['CLAUDE.md'].hash = hashContent(plantillaCambio ? vieja314 : actual)
  write(dir, '.claude/harness.json', JSON.stringify(lock, null, 2))
  return { dir, hashPrevio: lock.files['CLAUDE.md'].hash }
}

for (const solo of [false, true]) {
  const modo = solo ? 'solo' : 'equipo'
  const { nueva, vieja } = solo ? LINEA_SOLO : LINEA_EQUIPO

  test(`migracion v3 (${modo}): el CLAUDE.md editado pasa a souclaude vault-sync en el lugar, sin perder lo del dev`, async () => {
    const { dir, hashPrevio } = await instaladoEnV314({ solo })

    const plan = replan(dir)
    const acciones = plan.actions.filter((a) => a.dest === 'CLAUDE.md').map((a) => a.verdict).sort()
    assert.deepEqual(acciones, [CONFLICT, MIGRATE])

    assert.equal(await main(['upgrade', ...YES], dir), 0)

    const claude = read(dir, 'CLAUDE.md')
    assert.ok(claude.includes(nueva), 'la instruccion nueva no llego al CLAUDE.md')
    assert.ok(!claude.includes(vieja), 'la instruccion vieja sobrevivio')
    assert.ok(claude.endsWith(EDICION), 'se perdio la edicion del dev')
    // La plantilla tambien cambio: el .new sigue saliendo como siempre.
    assert.ok(has(dir, 'CLAUDE.md.new'))

    // Backup del original antes de tocarlo.
    const backups = fs.readdirSync(path.join(dir, '.claude')).filter((e) => e.startsWith('backup-'))
    assert.equal(backups.length, 1)
    assert.ok(read(dir, `.claude/${backups[0]}/CLAUDE.md`).includes(vieja))

    // El archivo sigue siendo del dev: el lockfile no reclama el hash migrado.
    const lock = JSON.parse(read(dir, '.claude/harness.json'))
    assert.equal(lock.files['CLAUDE.md'].hash, hashPrevio)
  })
}

test('migracion v3: editado con la plantilla sin cambios -> solo la migracion, sin .new', async () => {
  const { dir } = await instaladoEnV314({ plantillaCambio: false })

  const plan = replan(dir)
  assert.deepEqual(plan.actions.filter((a) => a.dest === 'CLAUDE.md').map((a) => a.verdict), [MIGRATE])

  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.ok(read(dir, 'CLAUDE.md').includes(LINEA_EQUIPO.nueva))
  assert.ok(read(dir, 'CLAUDE.md').endsWith(EDICION))
  assert.ok(!has(dir, 'CLAUDE.md.new'))
})

test('migracion v3: si el dev reescribio la linea a su manera, no se toca', async () => {
  const { dir } = await instaladoEnV314()
  const propia = read(dir, 'CLAUDE.md').replace(LINEA_EQUIPO.vieja, '`git -C "<vault>" pull --rebase` (a mi manera) y lee')
  write(dir, 'CLAUDE.md', propia)

  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.equal(read(dir, 'CLAUDE.md'), propia)
})

test('migracion v3: despues del upgrade no se vuelve a migrar ni a escribir el CLAUDE.md', async () => {
  const { dir } = await instaladoEnV314()
  assert.equal(await main(['upgrade', ...YES], dir), 0)
  const despues = read(dir, 'CLAUDE.md')

  const verd = replan(dir).actions.filter((a) => a.dest === 'CLAUDE.md').map((a) => a.verdict)
  assert.ok(!verd.includes(MIGRATE), 'la migracion se volvio a planificar')

  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.equal(read(dir, 'CLAUDE.md'), despues)
})
