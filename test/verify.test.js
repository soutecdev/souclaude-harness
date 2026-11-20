import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadManifest } from '../src/core/manifest.js'
import {
  verifyManifest,
  findOrphanTemplateFiles,
  findOrphanFragments,
  findMissingSrcFiles,
  findDuplicateIds,
  findDuplicateDests,
  findMissingCriticalFiles,
  findInvalidEntries,
} from '../src/core/verify.js'

// Fabrica un directorio temporal con la forma de templates/: root/base/**.
// No se toca templates/ real en ningun caso negativo.
function mkTemplatesRoot(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude verify '))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  return root
}

test('verify: el manifest real del repo no tiene huerfanos', () => {
  const manifest = loadManifest()
  const warnings = findOrphanTemplateFiles(manifest)
  assert.deepEqual(warnings, [])
})

test('verify: el manifest real del repo no tiene src rotos', () => {
  const manifest = loadManifest()
  assert.deepEqual(findMissingSrcFiles(manifest), [])
})

test('verify: el manifest real del repo no tiene ids ni dest duplicados', () => {
  const manifest = loadManifest()
  assert.deepEqual(findDuplicateIds(manifest), [])
  assert.deepEqual(findDuplicateDests(manifest), [])
})

test('verify: el manifest real del repo no tiene criticos faltantes', () => {
  const manifest = loadManifest()
  assert.deepEqual(findMissingCriticalFiles(manifest), [])
})

test('verify: los fragmentos reales de gitignore corresponden todos a base o a un stack', () => {
  assert.deepEqual(findOrphanFragments(), [])
})

test('verify: detecta un fragmento de gitignore que no corresponde a ningun stack', () => {
  const root = mkTemplatesRoot({ 'fragments/gitignore/base.txt': 'x', 'fragments/gitignore/cobol.txt': 'y' })
  const warnings = findOrphanFragments(root)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'orphan-gitignore-fragment')
  assert.match(warnings[0].message, /cobol\.txt/)
})

test('verify: harnessVersion del manifest coincide con la version de package.json', () => {
  const manifest = loadManifest()
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.harnessVersion, pkg.version)
})

test('verify: detecta huerfano cuando templates/base tiene un archivo sin entry', () => {
  const root = mkTemplatesRoot({ 'base/claude/skills/fantasma/SKILL.md': 'x' })
  const manifest = { files: [] }
  const warnings = findOrphanTemplateFiles(manifest, root)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'orphan-template-file')
})

test('verify: detecta src roto cuando el manifest referencia un archivo inexistente', () => {
  const root = mkTemplatesRoot({})
  const manifest = { files: [{ id: 'x', src: 'base/no-existe.md', dest: 'no-existe.md', policy: 'managed' }] }
  const errors = findMissingSrcFiles(manifest, root)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].code, 'missing-src')
})

test('verify: detecta ids y dest duplicados', () => {
  const manifest = {
    files: [
      { id: 'a', src: 'base/a.md', dest: 'a.md', policy: 'managed' },
      { id: 'a', src: 'base/b.md', dest: 'a.md', policy: 'managed' },
    ],
  }
  assert.equal(findDuplicateIds(manifest).length, 1)
  assert.equal(findDuplicateDests(manifest).length, 1)
})

test('verify: dest duplicado no es error cuando todos los entries son merge-json (skills que se funden, ej. jira-sync + azdo-sync sobre .mcp.json)', () => {
  const manifest = {
    files: [
      { id: 'mcp-jira', src: 'base/mcp.json', dest: '.mcp.json', policy: 'merge-json', skill: 'jira-sync' },
      { id: 'mcp-azdo', src: 'base/mcp.azdo.json', dest: '.mcp.json', policy: 'merge-json', skill: 'azdo-sync' },
    ],
  }
  assert.equal(findDuplicateDests(manifest).length, 0)
})

test('verify: dest duplicado SI es error si alguno de los entries no es merge-json', () => {
  const manifest = {
    files: [
      { id: 'mcp-jira', src: 'base/mcp.json', dest: '.mcp.json', policy: 'merge-json', skill: 'jira-sync' },
      { id: 'mcp-managed', src: 'base/mcp.json', dest: '.mcp.json', policy: 'managed' },
    ],
  }
  assert.equal(findDuplicateDests(manifest).length, 1)
})

test('verify: dest duplicado no es error entre modos disjuntos (CLAUDE.md de equipo vs de solo)', () => {
  const manifest = {
    files: [
      { id: 'claude-md', src: 'base/CLAUDE.md', dest: 'CLAUDE.md', policy: 'user-owned', modos: ['equipo'] },
      { id: 'claude-md-solo', src: 'base/CLAUDE-solo.md', dest: 'CLAUDE.md', policy: 'user-owned', modos: ['solo'] },
    ],
  }
  assert.equal(findDuplicateDests(manifest).length, 0)
})

test('verify: dest duplicado SI es error cuando los entries coinciden en algun modo', () => {
  // El entry sin "modos" vale para ambos: choca con el de solo en el modo solo.
  const manifest = {
    files: [
      { id: 'claude-md', src: 'base/CLAUDE.md', dest: 'CLAUDE.md', policy: 'user-owned' },
      { id: 'claude-md-solo', src: 'base/CLAUDE-solo.md', dest: 'CLAUDE.md', policy: 'user-owned', modos: ['solo'] },
    ],
  }
  assert.equal(findDuplicateDests(manifest).length, 1)
})

test('verify: detecta critico faltante cuando el src del entry critical no existe', () => {
  const root = mkTemplatesRoot({})
  const manifest = { files: [{ id: 'claude-md', src: 'base/CLAUDE.md', dest: 'CLAUDE.md', policy: 'user-owned', critical: true }] }
  const errors = findMissingCriticalFiles(manifest, root)
  assert.ok(errors.some((e) => e.code === 'missing-critical'))
})

test('verifyManifest: agrega en errors y warnings, no mezcla tipos', () => {
  const root = mkTemplatesRoot({ 'base/huerfano.md': 'x' })
  const manifest = { files: [{ id: 'roto', src: 'base/no-existe.md', dest: 'no-existe.md', policy: 'managed' }] }
  const { errors, warnings } = verifyManifest(manifest, root)
  assert.ok(errors.every((e) => e.type === 'error'))
  assert.ok(warnings.every((w) => w.type === 'warning'))
  assert.ok(errors.some((e) => e.code === 'missing-src'))
  assert.ok(warnings.some((w) => w.code === 'orphan-template-file'))
})

// --- Validacion estructural: el contrato del manifest, entry por entry ---------

test('verify: el manifest real del repo cumple el contrato estructural', () => {
  assert.deepEqual(findInvalidEntries(loadManifest()), [])
})

test('verify: detecta policy, modos, when, skill y dest invalidos', () => {
  const root = mkTemplatesRoot({ 'base/a.md': 'a\n' })
  const base = { id: 'a', src: 'base/a.md', dest: 'a.md', policy: 'managed' }
  const manifest = (entry, extra = {}) => ({ harnessVersion: '1.0.0', skills: [{ id: 'una' }], files: [{ ...base, ...entry }], ...extra })
  const codigos = (m) => findInvalidEntries(m, root).map((e) => e.code)

  assert.deepEqual(codigos(manifest({})), [])
  assert.deepEqual(codigos(manifest({ skill: 'una', modos: ['equipo'], when: 'stack:node' })), [])
  assert.deepEqual(codigos(manifest({ policy: 'manged' })), ['invalid-policy'], 'un typo de policy caia al default y se trataba como managed')
  assert.deepEqual(codigos(manifest({ modos: ['equpo'] })), ['invalid-modos'], 'un modo inexistente deja el archivo fuera de todos los modos')
  assert.deepEqual(codigos(manifest({ modos: [] })), ['invalid-modos'])
  assert.deepEqual(codigos(manifest({ when: 'stack:cobol' })), ['invalid-when'])
  assert.deepEqual(codigos(manifest({ when: 'repo-vacio' })), ['invalid-when'])
  assert.deepEqual(codigos(manifest({ skill: 'no-existe' })), ['unknown-skill'])
  assert.deepEqual(codigos(manifest({ dest: '../a.md' })), ['invalid-dest'])
  assert.deepEqual(codigos(manifest({ dest: '/etc/a.md' })), ['invalid-dest'])
  assert.deepEqual(codigos(manifest({ src: '../../package.json' })), ['invalid-src'])
  assert.deepEqual(codigos(manifest({ binary: true, render: true })), ['invalid-binary'])
  assert.deepEqual(codigos(manifest({}, { harnessVersion: '3.x' })), ['invalid-version'])
  assert.deepEqual(codigos(manifest({}, { obsolete: [{ dest: '../x', reason: 'r' }] })), ['invalid-dest'])
  assert.deepEqual(codigos(manifest({}, { dirs: [{ dest: 'C:/x' }] })), ['invalid-dest'])
  assert.deepEqual(codigos(manifest({}, { skills: [{ id: 'una' }, { id: 'una' }] })), ['duplicate-skill'])
  assert.deepEqual(codigos(manifest({}, { skills: [{ id: 'una', modos: ['duo'] }] })), ['invalid-modos'])
})

test('verify: un asset binario sin "binary": true y un seed merge-json roto se detectan', () => {
  const root = mkTemplatesRoot({ 'base/seed.json': '{ "a": 1, }', 'base/ok.json': '{"a":1}' })
  fs.writeFileSync(path.join(root, 'base', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]))
  const m = (files) => ({ harnessVersion: '1.0.0', files })
  const codigos = (files) => findInvalidEntries(m(files), root).map((e) => e.code)

  assert.deepEqual(codigos([{ id: 'logo', src: 'base/logo.png', dest: 'logo.png', policy: 'managed' }]), ['binary-sin-declarar'])
  assert.deepEqual(codigos([{ id: 'logo', src: 'base/logo.png', dest: 'logo.png', policy: 'managed', binary: true }]), [])
  assert.deepEqual(codigos([{ id: 'seed', src: 'base/seed.json', dest: 's.json', policy: 'merge-json' }]), ['invalid-json-seed'])
  assert.deepEqual(codigos([{ id: 'seed', src: 'base/ok.json', dest: 's.json', policy: 'merge-json' }]), [])
})
