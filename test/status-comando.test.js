import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { mkRepo, read, write, snapshot } from './helpers.js'
import { main } from '../src/cli.js'

// El comando status es de solo lectura y su codigo de salida es un contrato que
// usan los scripts y los agentes (README: "0 = al dia, 1 = hay upgrade, 2 =
// drift"): 1 solo cuando `upgrade` escribiria algo nuevo.
const YES = ['--yes', '--name', 'acme', '--type', 'backend', '--lang', 'es']
const SKILL = '.claude/skills/soutec-github/SKILL.md'
// Un repo con codigo y sin README propio: tras instalar no queda nada por decidir.
const repoConCodigo = () => mkRepo({ 'package.json': '{"name":"acme"}\n' })

async function conSalida(fn) {
  const trozos = []
  const [out, err] = [process.stdout.write, process.stderr.write]
  process.stdout.write = (s) => (trozos.push(String(s)), true)
  process.stderr.write = (s) => (trozos.push(String(s)), true)
  try {
    return { codigo: await fn(), salida: trozos.join('') }
  } finally {
    process.stdout.write = out
    process.stderr.write = err
  }
}

test('status: en un repo sin harness sale 1 y dice como instalarlo, sin escribir nada', async () => {
  const dir = mkRepo({ 'README.md': '# acme\n' })
  const antes = snapshot(dir)
  const { codigo, salida } = await conSalida(() => main(['status'], dir))
  assert.equal(codigo, 1)
  assert.match(salida, /no tiene harness/)
  assert.match(salida, /souclaude init/)
  assert.equal(snapshot(dir), antes, 'status escribio en el repo')
  assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'status creo .claude/')
})

test('status: recien instalado sale 0; no cambia nada ni con --verbose', async () => {
  const dir = repoConCodigo()
  assert.equal(await main(['init', ...YES], dir), 0)
  const antes = snapshot(dir, { includeLockfile: true })
  const { codigo, salida } = await conSalida(() => main(['status'], dir))
  assert.equal(codigo, 0)
  assert.match(salida, /Al dia/)
  assert.equal((await conSalida(() => main(['status', '--verbose'], dir))).codigo, 0)
  assert.equal(snapshot(dir, { includeLockfile: true }), antes, 'status toco el repo o el lockfile')
})

// El caso mas comun de todos: el repo ya tenia SU README. El harness no lo pisa y
// deja README.md.new. Antes status contaba esa propuesta como "cambio pendiente"
// y quedaba en exit 1 para siempre, mandando a correr un upgrade que no cambia nada.
test('status: una propuesta .new ya escrita es drift (2), no un upgrade pendiente; si falta, si lo es (1)', async () => {
  const mio = '# acme\n\nMi proyecto.\n'
  const dir = mkRepo({ 'README.md': mio })
  assert.equal(await main(['init', ...YES], dir), 0)
  assert.ok(fs.existsSync(path.join(dir, 'README.md.new')), 'el harness propone su README al lado')

  const conPropuesta = await conSalida(() => main(['status'], dir))
  assert.equal(conPropuesta.codigo, 2)
  assert.match(conPropuesta.salida, /1 propuesta\(s\) \.new esperan tu revision: README\.md\.new/)
  assert.match(conPropuesta.salida, /Al dia\..*1 con una propuesta \.new sin resolver/)
  assert.doesNotMatch(conPropuesta.salida, /Corre: souclaude upgrade/)

  // Sin el .new (o con uno viejo), upgrade SI tiene algo que escribir.
  fs.rmSync(path.join(dir, 'README.md.new'))
  assert.equal((await conSalida(() => main(['status'], dir))).codigo, 1)
  fs.writeFileSync(path.join(dir, 'README.md.new'), 'una propuesta vieja\n')
  assert.equal((await conSalida(() => main(['status'], dir))).codigo, 1)
  assert.equal(await main(['upgrade', ...YES], dir), 0)
  assert.equal((await conSalida(() => main(['status'], dir))).codigo, 2)
  assert.equal(read(dir, 'README.md'), mio, 'el README del usuario no se toca en ningun paso')
})

test('status: una edicion local sin cambio en la plantilla sale 2 (al dia, con ediciones)', async () => {
  const dir = repoConCodigo()
  await main(['init', ...YES], dir)
  write(dir, SKILL, read(dir, SKILL) + '\nNota del equipo: aca usamos trunk.\n')
  const { codigo, salida } = await conSalida(() => main(['status'], dir))
  assert.equal(codigo, 2)
  assert.match(salida, /1 con ediciones locales/)
  assert.match(read(dir, SKILL), /Nota del equipo/, 'status no debe tocar la edicion')
})

test('status: un archivo del harness borrado sale 1 (hay algo que upgrade escribiria) y no lo repone', async () => {
  const dir = repoConCodigo()
  await main(['init', ...YES], dir)
  fs.rmSync(path.join(dir, ...SKILL.split('/')))
  const { codigo, salida } = await conSalida(() => main(['status'], dir))
  assert.equal(codigo, 1)
  assert.match(salida, /pendiente\(s\)\. Corre: souclaude upgrade/)
  assert.ok(!fs.existsSync(path.join(dir, ...SKILL.split('/'))), 'status repuso el archivo: eso es trabajo de upgrade')
})

test('status: avisa de las claves de settings.json que Claude Code ignora', async () => {
  const dir = repoConCodigo()
  await main(['init', ...YES], dir)
  const settings = JSON.parse(read(dir, '.claude/settings.json'))
  write(dir, '.claude/settings.json', JSON.stringify({ ...settings, effort: 'high', token_budget_warning: 5000 }, null, 2) + '\n')
  const { salida } = await conSalida(() => main(['status'], dir))
  assert.match(salida, /2 clave\(s\) que Claude Code ignora: effort, token_budget_warning/)
})
