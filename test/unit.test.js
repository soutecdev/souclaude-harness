import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashContent, normalize } from '../src/core/hash.js'
import { render, missingVars } from '../src/core/render.js'
import { buildBlock, upsertBlock, extractBlock, BEGIN } from '../src/core/block.js'
import { seedMerge } from '../src/core/jsonmerge.js'
import { lt } from '../src/core/lockfile.js'
import { loadManifest, readTemplate } from '../src/core/manifest.js'
import { MODOS } from '../src/core/plan.js'

test('hash: CRLF y LF dan el mismo hash', () => {
  assert.equal(hashContent('a\r\nb\r\n'), hashContent('a\nb\n'))
  assert.equal(hashContent('a\nb'), hashContent('a\nb\n\n'))
  assert.equal(normalize('x\r\ny\n'), 'x\ny')
})

test('hash: contenido distinto da hash distinto', () => {
  assert.notEqual(hashContent('a'), hashContent('b'))
})

test('render: sustituye vars y deja intacto lo que no conoce', () => {
  assert.equal(render('hola {{NAME}}', { NAME: 'mundo' }), 'hola mundo')
  assert.equal(render('{{UNKNOWN}}', {}), '{{UNKNOWN}}')
  assert.deepEqual(missingVars('{{A}} {{B}}', { A: 1 }), ['B'])
})

test('block: upsert reemplaza in-place, no duplica', () => {
  const v1 = buildBlock(['node_modules/'], '1.0.0')
  const v2 = buildBlock(['node_modules/', 'dist/'], '1.1.0')

  const original = '# mis reglas\n*.tmp\ncustom/'
  const once = upsertBlock(original, v1)
  const twice = upsertBlock(once, v2)

  // Las lineas del usuario sobreviven intactas. Esto es P8 mecanizado.
  assert.ok(twice.includes('# mis reglas'))
  assert.ok(twice.includes('*.tmp'))
  assert.ok(twice.includes('custom/'))

  // Un solo bloque, no dos. Si los marcadores llevaran la version, aca habria dos.
  assert.equal(twice.split(BEGIN).length - 1, 1)
  assert.ok(twice.includes('dist/'))
  assert.equal(extractBlock(twice), v2)
})

test('block: en archivo inexistente escribe solo el bloque', () => {
  const block = buildBlock(['x'], '1.0.0')
  assert.equal(upsertBlock(null, block), block)
})

test('seedMerge: nunca pisa un valor que el usuario escribio', () => {
  const user = { effortLevel: 'xhigh', permissions: { deny: ['Read(./mi-secreto)'] } }
  const seed = { effortLevel: 'medium', permissions: { deny: ['Read(./.env)'], ask: ['Bash(git push:*)'] } }
  const out = seedMerge(user, seed)

  // El dev eligio xhigh. Un upgrade no tiene derecho a devolverselo a medium.
  assert.equal(out.effortLevel, 'xhigh')
  // Los arrays se unen, con lo del usuario primero.
  assert.deepEqual(out.permissions.deny, ['Read(./mi-secreto)', 'Read(./.env)'])
  // Las claves que faltaban sí se agregan.
  assert.deepEqual(out.permissions.ask, ['Bash(git push:*)'])
})

test('seedMerge: sin archivo previo devuelve el seed entero', () => {
  assert.deepEqual(seedMerge(null, { a: 1 }), { a: 1 })
})

test('lt: comparacion semver', () => {
  assert.ok(lt('0.0.0', '1.0.0'))
  assert.ok(lt('1.0.0', '1.0.1'))
  assert.ok(!lt('1.0.0', '1.0.0'))
  assert.ok(!lt('2.0.0', '1.9.9'))
})

test('manifest: todos los templates declarados existen en disco', () => {
  const manifest = loadManifest()
  for (const f of manifest.files) {
    if (f.policy === 'append-block') continue
    assert.doesNotThrow(() => readTemplate(f.src), `falta el template ${f.src}`)
  }
})

test('manifest: ningun dest con dos entries emitibles en el mismo modo, salvo merge-json (se funden en computePlan, ver plan.js)', () => {
  const byDest = new Map()
  for (const f of loadManifest().files) {
    const group = byDest.get(f.dest) ?? []
    group.push(f)
    byDest.set(f.dest, group)
  }
  for (const [dest, group] of byDest) {
    if (group.length < 2) continue
    // La misma regla que findDuplicateDests (SHS-M34): entries de modos
    // disjuntos (CLAUDE.md equipo vs solo) nunca se emiten juntos, asi que
    // pueden compartir dest; dentro de un mismo modo, solo merge-json convive.
    for (const modo of MODOS) {
      const activos = group.filter((f) => !f.modos || f.modos.includes(modo))
      if (activos.length < 2) continue
      assert.ok(activos.every((f) => f.policy === 'merge-json'), `dest duplicado emitible en modo ${modo}: "${dest}"`)
    }
  }
})
