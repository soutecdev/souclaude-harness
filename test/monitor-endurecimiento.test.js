import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agregarUsage } from '../src/monitor/domain/usage-agregado.js'
import { sesionesDeUsage, aplicarLineas as aplicarLineasDeUsage } from '../src/monitor/adapters/vault-usage-db.js'
import { aplicarLineas as aplicarLineasDeSesiones } from '../src/monitor/adapters/vault-sessions-publisher.js'
import { createUsageFetcher, soloUtilizacion } from '../src/monitor/adapters/usage-fetcher.js'
import { accionDeTecla } from '../src/monitor/adapters/tty-renderer.js'

// El monitor lee y escribe un registro COMPARTIDO (el Vault) y consulta un
// endpoint interno que puede cambiar. Estos tests cubren lo que pasa cuando esos
// datos no llegan como se espera: texto con caracteres de control, numeros que no
// son numeros, una publicacion que se reintenta, una respuesta con otra forma.
const c = (n) => String.fromCodePoint(n)
const ESC = c(0x1b)

function registro(extra = {}) {
  return {
    version: 1,
    sessionId: 'sesion-1',
    generadoEn: '2026-11-10T10:00:00.000Z',
    inicio: '2026-11-10T09:00:00.000Z',
    fin: '2026-11-10T10:00:00.000Z',
    proyecto: 'app',
    rama: 'fix/M1-x',
    milestone: 'SHS-M1',
    quien: 'ana',
    cuenta: { uuid: 'uuid-1', alias: 'ana' },
    maquina: { machineID: 'maq-1', hostname: 'portatil' },
    tokens: { entrada: 100, salida: 20, cacheCreacion: 5, cacheLectura: 7 },
    costoUsd: 0.5,
    llamadas: 3,
    porModelo: [{ alias: 'sonnet', tokensIn: 112, tokensOut: 20, costoUsd: 0.5 }],
    ...extra,
  }
}

test('agregarUsage: un numero que no es numero cuenta como 0, no se concatena', () => {
  const r = agregarUsage([
    registro(),
    registro({ sessionId: 'sesion-2', tokens: { entrada: '12', salida: -5, cacheCreacion: Number.NaN, cacheLectura: null }, costoUsd: '9', llamadas: 'muchas', porModelo: [{ alias: 'opus', tokensIn: '7', tokensOut: {}, costoUsd: Infinity }] }),
  ])
  assert.equal(r.totales.tokensIn, 112, 'el "12" de texto se sumo o concateno')
  assert.equal(r.totales.tokensOut, 20)
  assert.equal(typeof r.totales.tokensIn, 'number')
  for (const s of r.sesiones) {
    for (const v of [s.tokensIn, s.tokensOut, s.costoUsd, s.llamadas, ...s.porModelo.flatMap((m) => [m.tokensIn, m.tokensOut, m.costoUsd])]) {
      assert.ok(typeof v === 'number' && Number.isFinite(v) && v >= 0, `valor no numerico en el agregado: ${v}`)
    }
  }
})

test('agregarUsage: el texto del registro compartido entra sin caracteres de control', () => {
  const sucio = `${ESC}[2J${ESC}]0;titulo${c(7)}proyecto${c(0x202e)}-x`
  const r = agregarUsage([
    registro({ proyecto: sucio, quien: `ana${ESC}[31m`, rama: `fix${c(0)}/x`, milestone: `M1${c(0x200b)}`, cuenta: { uuid: 'u', alias: `ali${c(0x9b)}as` }, maquina: { hostname: `pc${ESC}[0m` }, fin: `2026${ESC}[1m-11-10T10:00:00.000Z` }),
  ])
  const visible = JSON.stringify([r.sesiones, r.porProyecto, r.porQuien, r.porMaquina, r.porCuenta, r.porMilestone])
  for (const n of [0x1b, 0x07, 0x00, 0x9b, 0x200b, 0x202e]) {
    assert.ok(!r.sesiones.some((s) => Object.values(s).some((v) => typeof v === 'string' && v.includes(c(n)))), `sobrevivio U+${n.toString(16)} en una sesion`)
  }
  assert.ok(!visible.includes('\\u001b'), 'quedo un ESC en las claves de agrupacion')
  assert.equal(r.sesiones[0].quien, 'ana[31m', 'se quita el caracter de control, no el texto')
  // Los valores normales no cambian.
  const limpio = agregarUsage([registro()]).sesiones[0]
  assert.deepEqual([limpio.proyecto, limpio.rama, limpio.milestone, limpio.quien, limpio.cuentaAlias, limpio.maquina, limpio.fecha], ['app', 'fix/M1-x', 'SHS-M1', 'ana', 'ana', 'portatil', '2026-11-10'])
})

test('sesionesDeUsage: sin carpeta de trabajo conocida no se publica el slug (ruta local codificada)', () => {
  const vista = {
    proyectos: [
      { nombre: 'app', ruta: '/Users/ana/clientes/acme/app', sesiones: [{ sessionId: 'a' }] },
      { nombre: '-Users-ana-clientes-acme-repo-secreto', ruta: null, sesiones: [{ sessionId: 'b' }] },
      { nombre: 'sesion-sin-nada', sesiones: [{ sessionId: 'c' }] },
    ],
  }
  assert.deepEqual(sesionesDeUsage(vista).map((s) => [s.sessionId, s.proyecto]), [['a', 'app'], ['b', null], ['c', null]])
})

for (const [nombre, aplicarLineas] of [['usage', aplicarLineasDeUsage], ['sessions.md', aplicarLineasDeSesiones]]) {
  test(`aplicarLineas (${nombre}): reintentar una publicacion no duplica la linea`, () => {
    const previa = '- 2026-11-10 · rama · 100/20'
    const nueva = '- 2026-11-10 · rama · 250/60'
    const base = `# cabecera\n${previa}\n`
    // Primer intento: reemplaza la previa.
    const uno = aplicarLineas(base, [{ linea: nueva, lineaPrevia: previa }])
    assert.equal(uno, `# cabecera\n${nueva}\n`)
    // El push fallo y el registro local sigue creyendo que la vigente es `previa`:
    // el segundo intento ya no la encuentra. Antes agregaba `nueva` otra vez.
    const dos = aplicarLineas(uno, [{ linea: nueva, lineaPrevia: previa }])
    assert.equal(dos, uno, 'el reintento duplico la linea')
    // Sin linea previa, agrega al final una sola vez.
    const tres = aplicarLineas(aplicarLineas('# cabecera\n', [{ linea: nueva, lineaPrevia: null }]), [{ linea: nueva, lineaPrevia: null }])
    assert.equal(tres, `# cabecera\n${nueva}\n`)
  })

  test(`aplicarLineas (${nombre}): un archivo en CRLF tambien encuentra la linea previa`, () => {
    const previa = '- 2026-11-10 · rama · 100/20'
    const nueva = '- 2026-11-10 · rama · 250/60'
    const salida = aplicarLineas(`# cabecera\r\n${previa}\r\n`, [{ linea: nueva, lineaPrevia: previa }])
    assert.equal(salida.split('\n').filter((l) => l.includes('rama')).length, 1, 'quedaron la previa y la nueva')
    assert.ok(salida.includes(nueva) && !salida.includes(previa))
  })
}

test('soloUtilizacion: acepta la forma conocida y la reduce a sus cuatro campos', () => {
  const real = { five_hour: { utilization: 41, resets_at: 'x' }, seven_day: null, limits: [], extra_usage: null, account_email: 'ana@ejemplo.test', otra_cosa: { a: 1 } }
  assert.deepEqual(soloUtilizacion(real), { five_hour: { utilization: 41, resets_at: 'x' }, seven_day: null, limits: [], extra_usage: null })
  assert.deepEqual(Object.keys(soloUtilizacion({ limits: [{ kind: 'weekly_opus' }] })).sort(), ['extra_usage', 'five_hour', 'limits', 'seven_day'])
  assert.ok(soloUtilizacion({ extra_usage: { is_enabled: true } }))
  // Un 200 con otra forma no es "limites vacios": es un fallo.
  for (const rara of [{}, { data: { five_hour: { utilization: 1 } } }, { five_hour: { utilization: '41' } }, { five_hour: null, seven_day: null, limits: [], extra_usage: null }, { error: 'x' }, [], null, 'texto', 42]) {
    assert.equal(soloUtilizacion(rara), null, JSON.stringify(rara))
  }
})

test('usage-fetcher: un 200 con forma inesperada cuenta como fallo y no pisa el cache', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude fetcher '))
  fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'token-de-prueba' } }))
  let respuesta = { five_hour: { utilization: 33, resets_at: null }, seven_day: null, limits: [], extra_usage: null, campo_nuevo: 'no deberia cachearse' }
  const fetcher = createUsageFetcher({ paths: { home }, ttlMs: 0, fetchImpl: async () => ({ status: 200, json: async () => respuesta }) })

  const bueno = await fetcher.obtener({ ahora: 1000 })
  assert.equal(bueno.origen, 'red')
  const cache = JSON.parse(fs.readFileSync(path.join(home, 'souclaude', 'usage-cache.json'), 'utf8'))
  assert.equal(cache.utilization.campo_nuevo, undefined, 'el cache guardo un campo que el monitor no entiende')

  respuesta = { resultado: 'el endpoint cambio de forma' }
  const raro = await fetcher.obtener({ ahora: 2000 })
  assert.equal(raro.origen, 'cache-propio', 'la respuesta rara se tomo como dato fresco')
  assert.equal(raro.utilization.five_hour.utilization, 33)
  assert.equal(fetcher.estado().fallosSeguidos, 1)
})

test('accionDeTecla: Ctrl+C sale aunque llegue repetido o pegado a otra cosa', () => {
  const CTRL_C = c(3)
  assert.equal(accionDeTecla(CTRL_C), 'interrumpir')
  assert.equal(accionDeTecla(CTRL_C + CTRL_C), 'interrumpir', 'dos Ctrl+C en el mismo chunk no salian')
  assert.equal(accionDeTecla(`x${CTRL_C}`), 'interrumpir')
  assert.equal(accionDeTecla(Buffer.from([3, 3])), 'interrumpir')
  assert.equal(accionDeTecla('q'), 'salir')
  assert.equal(accionDeTecla('qq'), 'salir')
  assert.equal(accionDeTecla('p'), 'pausa')
  for (const otra of ['a', 'quit', `${ESC}[A`, '', ' ']) assert.equal(accionDeTecla(otra), null, JSON.stringify(otra))
})
