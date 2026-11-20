import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { main } from '../src/cli.js'
import { mkRepo, read } from './helpers.js'
import { MODOS } from '../src/core/plan.js'
import { POLITICAS } from '../src/core/verify.js'

// Los esquemas JSON de schemas/ son el contrato de FORMA del manifest y del
// lockfile: lo que usa el editor para validar y autocompletar mientras se edita.
// Para que no se desfasen del codigo, aca se comprueba que el manifest real y un
// lockfile recien escrito los cumplen, que rechazan los errores tipicos y que
// sus listas (politicas, modos) son las del codigo. Sin dependencias: el
// validador de abajo entiende solo las palabras clave que los esquemas usan, y
// un test exige que no usen otras.
const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const leerJson = (...p) => JSON.parse(fs.readFileSync(path.join(RAIZ, ...p), 'utf8'))
const ESQUEMA_MANIFEST = leerJson('schemas', 'harness.manifest.schema.json')
const ESQUEMA_LOCK = leerJson('schemas', 'harness.lock.schema.json')
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']

const ANOTACIONES = ['$schema', '$id', '$defs', 'title', 'description']
const ENTENDIDAS = ['$ref', 'type', 'enum', 'const', 'pattern', 'minLength', 'items', 'minItems', 'uniqueItems', 'required', 'properties', 'additionalProperties', 'allOf', 'if', 'then']

const tipoDe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)

// Devuelve la lista de errores ("ruta: motivo"); vacia = valido.
function validar(esquema, valor, raiz = esquema, ruta = '$') {
  if (esquema.$ref) {
    const nombre = esquema.$ref.replace('#/$defs/', '')
    assert.ok(raiz.$defs?.[nombre], `$ref sin definicion: ${esquema.$ref}`)
    return validar(raiz.$defs[nombre], valor, raiz, ruta)
  }
  const errores = []
  const mal = (motivo) => errores.push(`${ruta}: ${motivo}`)
  const tipo = tipoDe(valor)
  if (esquema.type) {
    const admitidos = [esquema.type].flat()
    if (!admitidos.includes(tipo) && !(tipo === 'integer' && admitidos.includes('number'))) mal(`se esperaba ${admitidos.join('|')}, hay ${tipo}`)
  }
  if (esquema.enum && !esquema.enum.includes(valor)) mal(`${JSON.stringify(valor)} no esta en ${JSON.stringify(esquema.enum)}`)
  if ('const' in esquema && valor !== esquema.const) mal(`debe ser ${JSON.stringify(esquema.const)}`)
  if (tipo === 'string') {
    if (esquema.minLength != null && valor.length < esquema.minLength) mal('demasiado corto')
    if (esquema.pattern && !new RegExp(esquema.pattern).test(valor)) mal(`${JSON.stringify(valor)} no cumple ${esquema.pattern}`)
  }
  if (tipo === 'array') {
    if (esquema.minItems != null && valor.length < esquema.minItems) mal('lista demasiado corta')
    if (esquema.uniqueItems && new Set(valor.map((x) => JSON.stringify(x))).size !== valor.length) mal('elementos repetidos')
    if (esquema.items) valor.forEach((x, i) => errores.push(...validar(esquema.items, x, raiz, `${ruta}[${i}]`)))
  }
  if (tipo === 'object') {
    for (const clave of esquema.required ?? []) if (!(clave in valor)) mal(`falta "${clave}"`)
    for (const [clave, v] of Object.entries(valor)) {
      if (esquema.properties?.[clave]) errores.push(...validar(esquema.properties[clave], v, raiz, `${ruta}.${clave}`))
      else if (esquema.additionalProperties === false) mal(`clave desconocida "${clave}"`)
      else if (typeof esquema.additionalProperties === 'object') errores.push(...validar(esquema.additionalProperties, v, raiz, `${ruta}.${clave}`))
    }
  }
  for (const parte of esquema.allOf ?? []) errores.push(...validar(parte, valor, raiz, ruta))
  if (esquema.if && validar(esquema.if, valor, raiz, ruta).length === 0 && esquema.then) errores.push(...validar(esquema.then, valor, raiz, ruta))
  return errores
}

test('esquemas: solo usan palabras clave que este validador entiende', () => {
  const recorrer = (nodo, donde) => {
    if (Array.isArray(nodo)) return nodo.forEach((x, i) => recorrer(x, `${donde}[${i}]`))
    if (!nodo || typeof nodo !== 'object') return
    for (const [clave, v] of Object.entries(nodo)) {
      assert.ok([...ANOTACIONES, ...ENTENDIDAS].includes(clave), `${donde}: palabra clave "${clave}" que el test no valida`)
      if (clave === 'properties' || clave === '$defs') for (const [k, sub] of Object.entries(v)) recorrer(sub, `${donde}.${clave}.${k}`)
      else if (['items', 'additionalProperties', 'if', 'then', 'allOf'].includes(clave)) recorrer(v, `${donde}.${clave}`)
    }
  }
  recorrer(ESQUEMA_MANIFEST, 'manifest')
  recorrer(ESQUEMA_LOCK, 'lock')
})

test('esquemas: sus listas de politicas y modos son las del codigo', () => {
  assert.deepEqual(ESQUEMA_MANIFEST.$defs.file.properties.policy.enum, POLITICAS)
  assert.deepEqual(ESQUEMA_MANIFEST.$defs.modos.items.enum, MODOS)
  assert.deepEqual(ESQUEMA_LOCK.properties.modo.enum, MODOS)
  // En el lockfile, append-block no va en `files` sino en `blocks`.
  assert.deepEqual(ESQUEMA_LOCK.$defs.archivo.properties.policy.enum, POLITICAS.filter((p) => p !== 'append-block'))
})

test('esquemas: el manifest real cumple el suyo y lo declara para el editor', () => {
  const manifest = leerJson('templates', 'harness.manifest.json')
  assert.deepEqual(validar(ESQUEMA_MANIFEST, manifest), [])
  assert.ok(fs.existsSync(path.join(RAIZ, 'templates', manifest.$schema)), `"$schema" del manifest apunta a un archivo que no existe: ${manifest.$schema}`)
})

test('esquemas: el del manifest rechaza los errores tipicos al editarlo', () => {
  const manifest = leerJson('templates', 'harness.manifest.json')
  const conEntry = (cambio) => ({ ...manifest, files: [{ id: 'x', src: 'base/x.md', dest: 'x.md', policy: 'managed', ...cambio }] })
  const falla = (m, patron) => assert.match(validar(ESQUEMA_MANIFEST, m).join(' | '), patron)

  falla(conEntry({ policy: 'manged' }), /policy: "manged" no esta en/)
  falla(conEntry({ polcy: 'managed' }), /clave desconocida "polcy"/)
  falla(conEntry({ modos: ['duo'] }), /modos\[0\]: "duo" no esta en/)
  falla(conEntry({ modos: [] }), /modos: lista demasiado corta/)
  falla(conEntry({ when: 'repo-vacio' }), /when: "repo-vacio" no cumple/)
  falla(conEntry({ binary: true, policy: 'user-owned' }), /policy: debe ser "managed"/)
  falla(conEntry({ binary: true, render: true }), /render: debe ser false/)
  for (const dest of ['../fuera.md', '/etc/passwd', 'C:/x.md', 'a/../b.md', './x.md', 'a//b.md', 'carpeta/']) {
    falla(conEntry({ dest }), /dest: .* no cumple/)
  }
  falla({ ...manifest, harnessVersion: 'v3.19' }, /harnessVersion: "v3\.19" no cumple/)
  falla({ ...manifest, fles: [] }, /clave desconocida "fles"/)
  const { files, ...sinFiles } = manifest
  falla(sinFiles, /falta "files"/)
  // Y no rechaza lo valido: un entry minimo, uno binario y uno por stack.
  assert.deepEqual(validar(ESQUEMA_MANIFEST, conEntry({})), [])
  assert.deepEqual(validar(ESQUEMA_MANIFEST, conEntry({ binary: true })), [])
  assert.deepEqual(validar(ESQUEMA_MANIFEST, conEntry({ when: 'stack:node', modos: ['solo'], skill: 'adr-new', dest: '.claude/a b/x.md' })), [])
})

for (const [modo, flags] of [['equipo', []], ['solo', ['--solo']]]) {
  test(`esquemas: el lockfile que escribe init en modo ${modo} cumple el suyo`, async () => {
    const dir = mkRepo({ 'package.json': '{"name":"acme"}\n' })
    assert.equal(await main(['init', ...YES, ...flags], dir), 0)
    const lock = JSON.parse(read(dir, '.claude/harness.json'))
    assert.equal(lock.modo, modo)
    assert.ok(Object.keys(lock.files).length > 10)
    assert.deepEqual(validar(ESQUEMA_LOCK, lock), [])
  })
}

test('esquemas: el del lockfile acepta uno minimo y rechaza entradas mal formadas', () => {
  assert.deepEqual(validar(ESQUEMA_LOCK, { harnessVersion: '0.0.0', files: {}, blocks: {}, vars: {} }), [])
  // Un lockfile de un CLI mas nuevo puede traer claves de nivel superior que este no conoce.
  assert.deepEqual(validar(ESQUEMA_LOCK, { harnessVersion: '9.0.0', files: {}, algoNuevo: true }), [])
  const con = (entrada) => ({ harnessVersion: '3.18.1', files: { 'CLAUDE.md': entrada } })
  assert.deepEqual(validar(ESQUEMA_LOCK, con({ policy: 'managed', hash: '0123456789abcdef' })), [])
  assert.match(validar(ESQUEMA_LOCK, con({ policy: 'managed', hash: 'no-es-un-hash' })).join(), /hash: .* no cumple/)
  assert.match(validar(ESQUEMA_LOCK, con({ policy: 'append-block', hash: '0123456789abcdef' })).join(), /policy: "append-block" no esta en/)
  assert.match(validar(ESQUEMA_LOCK, con({ hash: '0123456789abcdef' })).join(), /falta "policy"/)
  assert.match(validar(ESQUEMA_LOCK, { harnessVersion: '3.18.1', files: {}, modo: 'duo' }).join(), /modo: "duo" no esta en/)
  assert.match(validar(ESQUEMA_LOCK, { files: {} }).join(), /falta "harnessVersion"/)
})
