#!/usr/bin/env node
// Este archivo tiene que poder leerlo un Node viejo: sin top-level await ni
// sintaxis moderna, y sin importar nada antes de comprobar la version. Con un
// Node anterior, el import de src/ fallaba con un SyntaxError que no decia que
// el problema era la version (SHS-M53). El minimo se repite en
// src/core/diagnostico.js y package.json#engines: un test los mantiene iguales.
var MINIMO = [22, 4]
var actual = process.versions.node.split('.').map(Number)
if (actual[0] < MINIMO[0] || (actual[0] === MINIMO[0] && actual[1] < MINIMO[1])) {
  console.error('souclaude necesita Node ' + MINIMO.join('.') + ' o superior y esta terminal usa Node ' + process.versions.node + '.')
  console.error('Instala una version actual (https://nodejs.org), reabre la terminal y repite el comando.')
  process.exit(1)
}

import('../src/cli.js')
  .then(function (m) { return m.main(process.argv.slice(2), process.cwd()) })
  .then(function (code) { process.exit(code) })
  .catch(function (err) {
    console.error(err)
    process.exit(1)
  })
