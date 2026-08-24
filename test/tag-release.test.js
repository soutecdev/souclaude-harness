import { test } from 'node:test'
import assert from 'node:assert/strict'

import { versionDePackageJson, tagInmutable, tagMovil } from '../scripts/tag-release.mjs'

test('versionDePackageJson: lee la version SemVer del package.json', () => {
  assert.equal(versionDePackageJson('{"version": "3.6.0"}'), '3.6.0')
})

test('versionDePackageJson: rechaza version ausente', () => {
  assert.throws(() => versionDePackageJson('{}'), /versión SemVer válida/)
})

test('versionDePackageJson: rechaza version no-SemVer', () => {
  assert.throws(() => versionDePackageJson('{"version": "v3.6"}'), /versión SemVer válida/)
})

test('tagInmutable: antepone la v a la version completa', () => {
  assert.equal(tagInmutable('3.6.0'), 'v3.6.0')
})

test('tagMovil: solo el major, con v', () => {
  assert.equal(tagMovil('3.6.0'), 'v3')
  assert.equal(tagMovil('10.2.1'), 'v10')
})
