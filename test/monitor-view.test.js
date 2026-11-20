import { test } from 'node:test'
import assert from 'node:assert/strict'

import { construirVista } from '../src/monitor/domain/arbol.js'
import { fusionar, vacio } from '../src/monitor/domain/consumo.js'
import { createSnapshotSource } from '../src/monitor/adapters/snapshot-source.js'
import { resolveClaudeHome } from '../src/monitor/adapters/claude-home.js'
import { mkClaudeHome, lineaAssistant, lineaTitulo, lineaCierre } from './helpers-monitor.js'

// Este archivo responde: "construirVista (src/monitor/domain/arbol.js) arma el
// arbol proyecto -> sesion -> agente sin mentir en los numeros?". Es el modulo
// mas complejo del dominio del monitor -- agrupa, atribuye, ordena y recorta --
// y el peor modo de fallo no es una excepcion sino un numero plausible pero
// falso. `ahora` siempre entra fijo (nunca Date.now()); ningun test toca el
// filesystem real de ~/.claude, salvo el test de integracion final, que arma
// su propio home falso con test/helpers-monitor.js.

// Instante fijo de referencia para todos los tests unitarios: 15-sep-2026,
// bien despues del corte del precio introductorio de sonnet (31-ago-2026), asi
// el costo de sonnet siempre usa el precio normal (3.00 / 15.00 por MTok) sin
// tener que pensar en la ventana de descuento en cada caso.
const AHORA = Date.UTC(2026, 8, 15, 12, 0, 0)

// Fabrica un evento del dominio (la forma que consume arbol.js, NO la linea
// cruda del transcript -- eso ya lo cubre eventos.test en monitor-domain.test.js).
// Todos los campos tienen un default razonable; `uso` se fusiona aparte para
// no tener que repetir los 6 campos en cada caso de prueba.
function ev(over = {}) {
  const { uso: usoOver, ...resto } = over
  return {
    sessionId: 's-default',
    agentId: null,
    cwd: 'C:\\Users\\test\\proyecto',
    rama: 'main',
    modeloId: 'claude-sonnet-5',
    effort: null,
    tipoAgente: 'principal',
    ts: AHORA,
    ...resto,
    uso: { entrada: 0, salida: 0, cacheCreacion: 0, cacheLectura: 0, cache1h: 0, cache5m: 0, ...usoOver },
  }
}

// ---------------------------------------------------------------------------
// Agregacion y totales
// ---------------------------------------------------------------------------

// Snapshot compartido por los tres tests de totales (agregacion, inmunidad a
// `top` y filtro): 2 proyectos, 3 sesiones, 2 subagentes.
//
// Proyecto A (proyA): sesion s1 (principal 100/50 + subagente agent-a1 200/100)
//                      sesion s2 (principal 50/25, sin subagentes)
// Proyecto B (proyB): sesion s3 (principal 300/150 + subagente agent-b1 10/5)
//
// Costo (sonnet normal: entrada 3.00, salida 15.00 USD/MTok):
//   s1 principal: (100*3+50*15)/1e6  = 0.00105
//   agent-a1:     (200*3+100*15)/1e6 = 0.00210
//   s2 principal: (50*3+25*15)/1e6   = 0.000525
//   s3 principal: (300*3+150*15)/1e6 = 0.00315
//   agent-b1:     (10*3+5*15)/1e6    = 0.000105
//   total                            = 0.006930
function snapshotTotales() {
  return {
    eventos: [
      ev({ sessionId: 's1', agentId: null, cwd: 'C:\\Users\\test\\proyA', ts: AHORA - 1000, uso: { entrada: 100, salida: 50 } }),
      ev({ sessionId: 's1', agentId: 'agent-a1', cwd: 'C:\\Users\\test\\proyA', ts: AHORA - 900, uso: { entrada: 200, salida: 100 } }),
      ev({ sessionId: 's2', agentId: null, cwd: 'C:\\Users\\test\\proyA', ts: AHORA - 800, uso: { entrada: 50, salida: 25 } }),
      ev({ sessionId: 's3', agentId: null, cwd: 'C:\\Users\\test\\proyB', ts: AHORA - 700, uso: { entrada: 300, salida: 150 } }),
      ev({ sessionId: 's3', agentId: 'agent-b1', cwd: 'C:\\Users\\test\\proyB', ts: AHORA - 600, uso: { entrada: 10, salida: 5 } }),
    ],
  }
}

test('arbol: totales de 2 proyectos/3 sesiones/2 subagentes coinciden con la cuenta hecha a mano', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA })

  assert.equal(vista.totales.llamadas, 5)
  assert.equal(vista.totales.entrada, 660) // 100+200+50+300+10
  assert.equal(vista.totales.salida, 330) // 50+100+25+150+5
  assert.equal(vista.totales.costoUsd.toFixed(6), '0.006930')

  assert.equal(vista.proyectos.length, 2)
  assert.equal(vista.proyectos[0].sesiones.length + vista.proyectos[1].sesiones.length, 3)
})

test('arbol: la suma de los consumos de los proyectos es igual a totales', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA })

  const sumaProyectos = vista.proyectos.reduce((acc, p) => fusionar(acc, p.consumo), vacio())

  assert.equal(sumaProyectos.llamadas, vista.totales.llamadas)
  assert.equal(sumaProyectos.entrada, vista.totales.entrada)
  assert.equal(sumaProyectos.salida, vista.totales.salida)
  assert.equal(sumaProyectos.costoUsd.toFixed(6), vista.totales.costoUsd.toFixed(6))
})

test('arbol: un evento con agentId null suma a la sesion pero no crea una fila en agentes', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA })

  const proyA = vista.proyectos.find((p) => p.nombre === 'proyA')
  const s2 = proyA.sesiones.find((s) => s.sessionId === 's2')

  assert.ok(s2, 'la sesion s2 (solo principal, sin subagentes) debe existir')
  assert.equal(s2.consumo.entrada, 50)
  assert.equal(s2.consumo.salida, 25)
  assert.equal(s2.agentes.length, 0)
})

// ---------------------------------------------------------------------------
// totales es inmune a `top` -- el invariante central del modulo
// ---------------------------------------------------------------------------

test('arbol: con top:1, totales NO cambia respecto de la vista sin recorte', () => {
  const sinTop = construirVista(snapshotTotales(), { ahora: AHORA })
  const conTop = construirVista(snapshotTotales(), { ahora: AHORA, top: 1 })

  assert.deepEqual(conTop.totales, sinTop.totales)
  // El recorte si debe haber actuado: de 2 proyectos solo queda 1 visible.
  assert.equal(conTop.proyectos.length, 1)
  assert.equal(sinTop.proyectos.length, 2)
})

test('arbol: consumo visible + recortes.proyectos.consumoOtros vuelve a dar el total', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA, top: 1 })

  // orden por defecto es 'tokens': proyA (350+175=525 tokens) > proyB (310+155=465),
  // asi que con top:1 solo proyA queda visible y proyB se recorta.
  assert.equal(vista.proyectos.length, 1)
  assert.equal(vista.proyectos[0].nombre, 'proyA')

  const visible = vista.proyectos.reduce((acc, p) => fusionar(acc, p.consumo), vacio())
  const reconstruido = fusionar(visible, vista.recortes.proyectos.consumoOtros)

  assert.equal(reconstruido.entrada, vista.totales.entrada)
  assert.equal(reconstruido.salida, vista.totales.salida)
  assert.equal(reconstruido.costoUsd.toFixed(6), vista.totales.costoUsd.toFixed(6))
})

test('arbol: un filtro de proyecto SI acota los totales (a diferencia de top)', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA, filtros: { proyecto: 'proya' } })

  // Solo el universo de proyA: llamadas 3, entrada 350, salida 175.
  assert.equal(vista.totales.llamadas, 3)
  assert.equal(vista.totales.entrada, 350)
  assert.equal(vista.totales.salida, 175)
  assert.equal(vista.proyectos.length, 1)
  assert.equal(vista.proyectos[0].nombre, 'proyA')
})

// ---------------------------------------------------------------------------
// Atribucion del tipo de agente: metas -> cierres[].agentType -> evento.tipoAgente
// ---------------------------------------------------------------------------

test('atribucion: sin meta ni cierre, el tipo sale de evento.tipoAgente y descripcion es null', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', agentId: 'ag1', tipoAgente: 'subagente', ts: AHORA - 100, uso: { entrada: 1, salida: 1 } })],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })
  const agente = vista.proyectos[0].sesiones[0].agentes[0]

  assert.equal(agente.tipo, 'subagente')
  assert.equal(agente.descripcion, null)
})

test('atribucion: con cierre pero sin meta, gana cierres[].agentType sobre evento.tipoAgente', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', agentId: 'ag1', tipoAgente: 'subagente', ts: AHORA - 100, uso: { entrada: 1, salida: 1 } })],
    cierres: [
      {
        agentId: 'ag1',
        agentType: 'general-purpose',
        resolvedModel: null,
        totalTokens: 2,
        totalDurationMs: 1000,
        totalToolUseCount: 1,
        toolStats: null,
      },
    ],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })
  const agente = vista.proyectos[0].sesiones[0].agentes[0]

  assert.equal(agente.tipo, 'general-purpose')
  assert.equal(agente.descripcion, null) // sigue sin meta
})

test('atribucion: metas gana incluso cuando discrepa con cierres[].agentType y evento.tipoAgente', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', agentId: 'ag1', tipoAgente: 'subagente', ts: AHORA - 100, uso: { entrada: 1, salida: 1 } })],
    cierres: [
      {
        agentId: 'ag1',
        agentType: 'general-purpose',
        resolvedModel: null,
        totalTokens: 2,
        totalDurationMs: 1000,
        totalToolUseCount: 1,
        toolStats: null,
      },
    ],
    metas: [{ agentId: 'ag1', agentType: 'reviewer', description: 'Revision de PR' }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })
  const agente = vista.proyectos[0].sesiones[0].agentes[0]

  assert.equal(agente.tipo, 'reviewer')
  assert.equal(agente.descripcion, 'Revision de PR')
})

// ---------------------------------------------------------------------------
// Agrupacion por proyecto: la clave es cwd, no slug
// ---------------------------------------------------------------------------

test('agrupacion: dos slugs iguales con cwd distinto son dos proyectos', () => {
  const snapshot = {
    eventos: [
      ev({ sessionId: 's1', cwd: 'C:\\Users\\a\\proj', ts: AHORA - 100, uso: { entrada: 1, salida: 1 } }),
      ev({ sessionId: 's2', cwd: 'C:\\Users\\b\\proj', ts: AHORA - 100, uso: { entrada: 1, salida: 1 } }),
    ],
    archivos: [
      { sessionId: 's1', slug: 'mismo-slug', mtimeMs: 1, kind: 'session' },
      { sessionId: 's2', slug: 'mismo-slug', mtimeMs: 1, kind: 'session' },
    ],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })

  assert.equal(vista.proyectos.length, 2)
})

test('agrupacion: C:\\ruta y c:\\ruta son el mismo proyecto (normalizacion de unidad)', () => {
  const snapshot = {
    eventos: [
      ev({ sessionId: 's1', cwd: 'C:\\Users\\test\\Proyecto', ts: AHORA - 100, uso: { entrada: 10, salida: 5 } }),
      ev({ sessionId: 's2', cwd: 'c:\\Users\\test\\Proyecto', ts: AHORA - 100, uso: { entrada: 20, salida: 10 } }),
    ],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })

  assert.equal(vista.proyectos.length, 1)
  assert.equal(vista.proyectos[0].consumo.entrada, 30)
  assert.equal(vista.proyectos[0].sesiones.length, 2)
})

test('agrupacion: sin cwd en los eventos, el cwd sale de vivos', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', cwd: undefined, ts: AHORA - 100, uso: { entrada: 1, salida: 1 } })],
    vivos: [{ sessionId: 's1', cwd: 'C:\\Users\\test\\desde-vivo', procesoVivo: true, pid: 111, startedAt: AHORA - 1000 }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })

  assert.equal(vista.proyectos.length, 1)
  assert.equal(vista.proyectos[0].ruta, 'C:\\Users\\test\\desde-vivo')
})

test('agrupacion: sin cwd ni en eventos ni en vivos, se agrupa por slug y ruta queda null', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', cwd: undefined, ts: AHORA - 100, uso: { entrada: 1, salida: 1 } })],
    archivos: [{ sessionId: 's1', slug: 'mi-slug', mtimeMs: 1, kind: 'session' }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })

  assert.equal(vista.proyectos.length, 1)
  assert.equal(vista.proyectos[0].ruta, null)
  assert.equal(vista.proyectos[0].slug, 'mi-slug')
})

// ---------------------------------------------------------------------------
// Estado y agentes activos
// ---------------------------------------------------------------------------

test('estado: una sesion con procesoVivo:true nunca queda terminado aunque su ultima escritura sea de horas', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', ts: AHORA - 5 * 3_600_000, uso: { entrada: 1, salida: 1 } })],
    vivos: [{ sessionId: 's1', cwd: 'C:\\Users\\test\\vivo', procesoVivo: true, pid: 222, startedAt: AHORA - 6 * 3_600_000 }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })
  const sesion = vista.proyectos[0].sesiones[0]

  assert.notEqual(sesion.estado, 'terminado')
})

test('estado: un agente con cierre queda terminado aunque el pid de la sesion padre siga vivo', () => {
  const snapshot = {
    eventos: [ev({ sessionId: 's1', agentId: 'ag1', ts: AHORA - 1000, uso: { entrada: 1, salida: 1 } })],
    cierres: [
      {
        agentId: 'ag1',
        agentType: 'x',
        resolvedModel: null,
        totalTokens: 2,
        totalDurationMs: 1000,
        totalToolUseCount: 1,
        toolStats: null,
      },
    ],
    vivos: [{ sessionId: 's1', cwd: 'C:\\Users\\test\\vivo', procesoVivo: true, pid: 333, startedAt: AHORA - 2000 }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA })
  const agente = vista.proyectos[0].sesiones[0].agentes[0]

  assert.equal(agente.estado, 'terminado')
})

test('estado: agentesActivos no se recorta con top -- 12 agentes activos siguen siendo 12 con top:2', () => {
  const eventos = []
  for (let i = 1; i <= 12; i++) {
    eventos.push(
      ev({ sessionId: 's1', agentId: `ag-${i}`, ts: AHORA - 1000, uso: { entrada: 1, salida: 1 } }),
    )
  }
  const snapshot = {
    eventos,
    vivos: [{ sessionId: 's1', cwd: 'C:\\Users\\test\\vivo', procesoVivo: true, pid: 444, startedAt: AHORA - 2000 }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA, top: 2 })

  assert.equal(vista.agentesActivos.length, 12)
  assert.equal(vista.proyectos[0].sesiones[0].agentes.length, 2)
})

// ---------------------------------------------------------------------------
// Ordenamiento
// ---------------------------------------------------------------------------

// 3 proyectos con tokens, costo y recencia deliberadamente NO correlacionados,
// para que cada criterio de orden produzca un orden distinto:
//   tokens (desc): proj1 (300) > proj3 (200) > proj2 (100)
//   costo  (desc): proj2 (0.0015, todo salida) > proj1 (0.0009) > proj3 (0.0006)
//   reciente (desc, ts mas nuevo primero): proj1 > proj2 > proj3
function snapshotOrden() {
  return {
    eventos: [
      ev({ sessionId: 's1', cwd: 'C:\\Users\\test\\proj1', ts: AHORA - 100, uso: { entrada: 300, salida: 0 } }),
      ev({ sessionId: 's2', cwd: 'C:\\Users\\test\\proj2', ts: AHORA - 500_000, uso: { entrada: 0, salida: 100 } }),
      ev({ sessionId: 's3', cwd: 'C:\\Users\\test\\proj3', ts: AHORA - 9_000_000, uso: { entrada: 200, salida: 0 } }),
    ],
  }
}

test('orden: orden:"tokens" ordena los proyectos por volumen de tokens descendente', () => {
  const vista = construirVista(snapshotOrden(), { ahora: AHORA, orden: 'tokens' })
  assert.deepEqual(vista.proyectos.map((p) => p.nombre), ['proj1', 'proj3', 'proj2'])
})

test('orden: orden:"costo" ordena los proyectos por costoUsd descendente', () => {
  const vista = construirVista(snapshotOrden(), { ahora: AHORA, orden: 'costo' })
  assert.deepEqual(vista.proyectos.map((p) => p.nombre), ['proj2', 'proj1', 'proj3'])
})

test('orden: orden:"reciente" ordena los proyectos por ultimoTs descendente', () => {
  const vista = construirVista(snapshotOrden(), { ahora: AHORA, orden: 'reciente' })
  assert.deepEqual(vista.proyectos.map((p) => p.nombre), ['proj1', 'proj2', 'proj3'])
})

test('orden: las sesiones activas van primero sin importar el criterio de orden', () => {
  const snapshot = {
    eventos: [
      // Sesion terminada (sin entrada en `vivos`) con MUCHOS mas tokens.
      ev({ sessionId: 's-alta', cwd: 'C:\\Users\\test\\proyOrden', ts: AHORA - 100_000, uso: { entrada: 1000, salida: 0 } }),
      // Sesion activa (pid vivo) con pocos tokens.
      ev({ sessionId: 's-activa', cwd: 'C:\\Users\\test\\proyOrden', ts: AHORA - 100, uso: { entrada: 10, salida: 0 } }),
    ],
    vivos: [{ sessionId: 's-activa', cwd: 'C:\\Users\\test\\proyOrden', procesoVivo: true, pid: 555, startedAt: AHORA - 200 }],
  }
  const vista = construirVista(snapshot, { ahora: AHORA, orden: 'tokens' })
  const sesiones = vista.proyectos[0].sesiones

  assert.equal(sesiones[0].sessionId, 's-activa')
  assert.notEqual(sesiones[0].estado, 'terminado')
  assert.equal(sesiones[1].sessionId, 's-alta')
})

// ---------------------------------------------------------------------------
// Casos vacios
// ---------------------------------------------------------------------------

test('vacio: un snapshot completamente vacio da una vista valida sin lanzar', () => {
  assert.doesNotThrow(() => construirVista({}, { ahora: AHORA }))

  const vista = construirVista({}, { ahora: AHORA })
  assert.deepEqual(vista.proyectos, [])
  assert.equal(vista.totales.llamadas, 0)
  assert.equal(vista.totales.entrada, 0)
  assert.equal(vista.totales.salida, 0)
  assert.equal(vista.totales.costoUsd, 0)
})

test('vacio: limites:null se propaga como null, nunca como un objeto en ceros', () => {
  const conLimitesNull = construirVista({ limites: null }, { ahora: AHORA })
  assert.equal(conLimitesNull.limites, null)

  const sinLimites = construirVista({}, { ahora: AHORA })
  assert.equal(sinLimites.limites, null)
})

// ---------------------------------------------------------------------------
// Integracion: snapshot real armado por createSnapshotSource sobre un home
// falso (nunca ~/.claude real), pasado tal cual a construirVista.
// ---------------------------------------------------------------------------

test('integracion: un snapshot real de createSnapshotSource arma correctamente proyecto/sesion/agente', async () => {
  const home = mkClaudeHome({
    proyectos: {
      'test-proyecto': {
        'sess-int.jsonl': [
          lineaAssistant({
            sessionId: 'sess-int',
            ts: AHORA - 120_000,
            cwd: 'C:\\Users\\test\\proyecto-integ',
            modelo: 'claude-sonnet-5',
            entrada: 100,
            salida: 50,
          }),
          lineaTitulo({ sessionId: 'sess-int', titulo: 'Sesion de integracion' }),
        ],
        'sess-int/subagents/agent-sub1.jsonl': [
          lineaAssistant({
            sessionId: 'sess-int',
            agentId: 'sub1',
            ts: AHORA - 100_000,
            cwd: 'C:\\Users\\test\\proyecto-integ',
            modelo: 'claude-sonnet-5',
            entrada: 20,
            salida: 10,
          }),
          lineaCierre({ agentId: 'sub1', agentType: 'general-purpose', resolvedModel: 'claude-sonnet-5', totalDurationMs: 8000 }),
        ],
      },
    },
    sesiones: [{ sessionId: 'sess-int', cwd: 'C:\\Users\\test\\proyecto-integ', startedAt: AHORA - 200_000, pid: process.pid }],
  })

  const paths = resolveClaudeHome({ override: home })
  const source = createSnapshotSource({ paths })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })

  const vista = construirVista(snapshot, { ahora: AHORA })

  assert.equal(vista.proyectos.length, 1)
  const proyecto = vista.proyectos[0]
  assert.equal(proyecto.nombre, 'proyecto-integ')
  assert.equal(proyecto.sesiones.length, 1)

  const sesion = proyecto.sesiones[0]
  assert.equal(sesion.titulo, 'Sesion de integracion')
  assert.equal(sesion.agentes.length, 1)

  const agente = sesion.agentes[0]
  // El .meta.json que mkClaudeHome genera por defecto para agent-sub1.jsonl.
  assert.equal(agente.descripcion, 'Tarea de prueba')
  assert.equal(agente.tipo, 'general-purpose')
  // Tiene cierre -> terminado, aunque la sesion padre (pid = process.pid) siga viva.
  assert.equal(agente.estado, 'terminado')

  assert.equal(vista.totales.entrada, 120) // 100 (principal) + 20 (subagente)
  assert.equal(vista.totales.salida, 60) // 50 + 10
})

// ---------------------------------------------------------------------------
// registroExtra (SHS-H3-T105): collect() lo agrega al snapshot leyendo
// usageHistory.leer() -- la ESCRITURA sigue siendo de commands/monitor.js
// (SHS-H3-T104, registrarHistorico), esto solo cubre la LECTURA hacia adentro.
// ---------------------------------------------------------------------------

test('snapshot-source: collect() agrega registroExtra a partir de usageHistory.leer()', async () => {
  const home = mkClaudeHome({})
  const paths = resolveClaudeHome({ override: home })
  const registroFake = {
    abierto: { detectadoEn: AHORA - 25 * 60 * 60_000, usado: 21.36, limite: 20, moneda: 'USD', cerradoEn: null },
    archivados: [],
  }
  const usageHistory = { leer: () => registroFake }

  const source = createSnapshotSource({ paths, usageHistory })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })

  assert.deepEqual(snapshot.registroExtra, registroFake)
})

// El typedef Snapshot de application/ports.js es el unico contrato escrito entre
// el adaptador y el dominio, y habia quedado tres campos atras de lo que
// collect() devuelve. Este test lo ata al objeto real para que no vuelva a pasar.
test('snapshot-source: el typedef Snapshot de ports.js declara exactamente los campos que collect() devuelve', async () => {
  const fs = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const ports = fs.readFileSync(fileURLToPath(new URL('../src/monitor/application/ports.js', import.meta.url)), 'utf8')
  const bloque = ports.slice(ports.indexOf('@typedef {object} Snapshot'), ports.indexOf('*/', ports.indexOf('@typedef {object} Snapshot')))
  const declarados = [...bloque.matchAll(/@property \{.*\} (\w+)/g)].map((m) => m[1])
  assert.ok(declarados.length > 0, 'no se encontro el typedef Snapshot en ports.js')

  const source = createSnapshotSource({ paths: resolveClaudeHome({ override: mkClaudeHome({}) }) })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })
  assert.deepEqual([...declarados].sort(), Object.keys(snapshot).sort())
})

test('snapshot-source: sin usageHistory inyectado, registroExtra queda vacio (nunca se inventa)', async () => {
  const home = mkClaudeHome({})
  const paths = resolveClaudeHome({ override: home })

  const source = createSnapshotSource({ paths })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })

  assert.deepEqual(snapshot.registroExtra, { abierto: null, archivados: [] })
})

// ---------------------------------------------------------------------------
// Aviso de limites viejos a partir de usageFetcher.estado() (SHS-H3-T106).
// `estado()` ya existia en usage-fetcher.js sin consumidor real fuera de su
// propio test; esto lo conecta al canal de avisos que ya arma este paso.
// ---------------------------------------------------------------------------

test('snapshot-source: con el fetcher en backoff, avisos incluye una entrada que menciona "sin refrescar"', async () => {
  const home = mkClaudeHome({})
  const paths = resolveClaudeHome({ override: home })
  const usageFetcher = { estado: () => ({ fallosSeguidos: 4, backoffHasta: AHORA + 900_000 }) }

  const source = createSnapshotSource({ paths, usageFetcher })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })

  const hayAviso = snapshot.avisos.some((a) => (a?.reason ?? '').includes('sin refrescar'))
  assert.ok(hayAviso, 'debe existir un aviso que mencione "sin refrescar"')
})

test('snapshot-source: con el fetcher sano (sin fallos ni backoff), no aparece el aviso de datos viejos', async () => {
  const home = mkClaudeHome({})
  const paths = resolveClaudeHome({ override: home })
  const usageFetcher = { estado: () => ({ fallosSeguidos: 0, backoffHasta: null }) }

  const source = createSnapshotSource({ paths, usageFetcher })
  const snapshot = await source.collect({ window: { desde: 0, hasta: AHORA }, ahora: AHORA })

  const hayAviso = snapshot.avisos.some((a) => (a?.reason ?? '').includes('sin refrescar'))
  assert.equal(hayAviso, false)
})

// ---------------------------------------------------------------------------
// Vistas del registro del Vault en el panel (SHS-M3-T005)
// ---------------------------------------------------------------------------

function registroDeUsage(extra = {}) {
  return {
    version: 1,
    sessionId: 'sesion-vault-1',
    generadoEn: new Date(AHORA - 60_000).toISOString(),
    inicio: new Date(AHORA - 3_600_000).toISOString(),
    fin: new Date(AHORA - 120_000).toISOString(),
    proyecto: 'souclaude',
    rama: 'feature/SHS-M3-T005-panel-vivo-usage',
    milestone: 'SHS-M3',
    quien: 'ignacio',
    cuenta: { uuid: 'uuid-1', alias: 'dev' },
    maquina: { machineID: 'maq-1', hostname: 'PC01' },
    tokens: { entrada: 1000, salida: 100, cacheCreacion: 0, cacheLectura: 0 },
    costoUsd: 0.5,
    llamadas: 3,
    porModelo: [],
    ...extra,
  }
}

test('arbol: equipoActivo trae solo las sesiones frescas del registro, ordenadas por frescura', () => {
  const fresca = registroDeUsage()
  const vieja = registroDeUsage({
    sessionId: 'sesion-vault-2',
    quien: 'colega',
    generadoEn: new Date(AHORA - 3_600_000).toISOString(),
    fin: new Date(AHORA - 3_600_000).toISOString(),
  })
  const vista = construirVista({ ...snapshotTotales(), registrosUsage: [fresca, vieja] }, { ahora: AHORA })

  assert.equal(vista.equipoActivo.length, 1)
  assert.equal(vista.equipoActivo[0].quien, 'ignacio')
  assert.equal(vista.equipoActivo[0].frescuraMs, 60_000)
})

test('arbol: sin Vault configurado (registrosUsage null) equipoActivo es null', () => {
  const vista = construirVista(snapshotTotales(), { ahora: AHORA })
  assert.equal(vista.equipoActivo, null)
})

test('arbol: con Vault configurado pero sin registros, equipoActivo es lista vacia (nadie activo), no null', () => {
  const vista = construirVista({ ...snapshotTotales(), registrosUsage: [] }, { ahora: AHORA })
  assert.deepEqual(vista.equipoActivo, [])
})
