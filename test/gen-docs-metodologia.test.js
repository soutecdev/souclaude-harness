import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCHIVOS, leerFuentes, renderBloques, regenerar, correr } from '../scripts/gen-docs-metodologia.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

// El candado de frescura (SHS-M16-P2): si el manifest o package.json cambian sin
// regenerar docs/metodologia, este test pone la suite en rojo.
test('docs-metodologia: las secciones generadas están al día con las fuentes', () => {
  const r = correr({ check: true, raiz: RAIZ })
  assert.equal(r.codigo, 0, r.lineas.join('\n'))
})

test('docs-metodologia: regenerar es determinista (dos pasadas, mismos bytes)', () => {
  const bloques = renderBloques(leerFuentes(RAIZ))
  let verificados = 0
  for (const rel of ARCHIVOS) {
    const abs = path.join(RAIZ, rel)
    if (!existsSync(abs)) continue
    const una = regenerar(readFileSync(abs, 'utf8'), bloques).nuevo
    const dos = regenerar(una, bloques).nuevo
    assert.equal(dos, una, rel)
    verificados++
  }
  assert.ok(verificados > 0, 'ningún archivo de docs/metodologia para verificar')
})

test('docs-metodologia: un bloque drifteado a propósito se detecta y se repara', () => {
  const bloques = renderBloques(leerFuentes(RAIZ))
  const abs = path.join(RAIZ, 'docs/metodologia/01-guia-metodologia.md')
  const original = readFileSync(abs, 'utf8')
  const drifteado = original.replace(
    /(<!-- souclaude:gen version -->)[\s\S]*?(<!-- \/souclaude:gen version -->)/,
    '$1\nversión vieja inventada\n$2'
  )
  assert.notEqual(drifteado, original, 'el drift sintético no se aplicó')
  const reparado = regenerar(drifteado, bloques).nuevo
  assert.notEqual(reparado, drifteado)
  assert.equal(reparado, original)
})

test('docs-metodologia: el catálogo generado refleja el manifest', () => {
  const f = leerFuentes(RAIZ)
  const bloques = renderBloques(f)
  for (const s of f.skills) {
    assert.ok(bloques.skills.includes('`' + s.id + '`'), `falta ${s.id} en la tabla`)
  }
  assert.ok(bloques.skills.includes('obligatoria'))
  assert.ok(bloques.version.includes(`v${f.version}`))
  assert.ok(bloques.instalacion.includes(`#v${f.version.split('.')[0]}`))
})

test('docs-metodologia: respeta el EOL del archivo (working tree con CRLF por autocrlf)', () => {
  const bloques = renderBloques(leerFuentes(RAIZ))
  const lf = 'x\n<!-- souclaude:gen version -->\n<!-- /souclaude:gen version -->\n'
  const crlf = lf.replaceAll('\n', '\r\n')
  const rLf = regenerar(lf, bloques).nuevo
  const rCrlf = regenerar(crlf, bloques).nuevo
  assert.ok(!rLf.includes('\r\n'), 'un archivo LF debe regenerarse en LF')
  assert.ok(!rCrlf.replaceAll('\r\n', '').includes('\n'), 'un archivo CRLF debe regenerarse en CRLF')
  assert.equal(rCrlf, rLf.replaceAll('\n', '\r\n'))
})

test('docs-metodologia: un marcador sin bloque definido corta con error', () => {
  const bloques = renderBloques(leerFuentes(RAIZ))
  const { desconocidos } = regenerar(
    '<!-- souclaude:gen inexistente -->\nx\n<!-- /souclaude:gen inexistente -->',
    bloques
  )
  assert.deepEqual(desconocidos, ['inexistente'])
})

test('docs-metodologia: un id heredado del prototipo (constructor) no cuenta como bloque', () => {
  const bloques = renderBloques(leerFuentes(RAIZ))
  const { desconocidos } = regenerar(
    '<!-- souclaude:gen constructor -->\nx\n<!-- /souclaude:gen constructor -->',
    bloques
  )
  assert.deepEqual(desconocidos, ['constructor'])
})
