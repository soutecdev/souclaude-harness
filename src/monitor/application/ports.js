// Puertos del caso de uso del monitor. Este archivo NO tiene implementacion a
// proposito: es el contrato que build-view.js espera recibir inyectado. Los
// adaptadores (src/monitor/adapters/) implementan estas formas, pero la capa de
// aplicacion nunca los importa — la dependencia va adapters -> application ->
// domain y jamas al reves (P2, verificado por test/monitor-layers.test.js).
//
// Los tipos del dominio (EventoDeUso, Consumo, Ventana, VistaMonitor) viven en
// src/monitor/domain/ y se referencian aca solo por nombre.

/**
 * Snapshot crudo de un tick. Los nombres de los campos son los que consume
 * `construirVista` (domain/arbol.js) tal cual: en espanol, porque es la forma
 * del dominio. El adaptador que lo produce es quien traduce.
 *
 * @typedef {object} Snapshot
 * @property {object[]} eventos   EventoDeUso ya deduplicados y acotados a la ventana.
 * @property {{sessionId: string, titulo: string}[]} titulos
 * @property {object[]} cierres   Cierres de subagente (agentId, agentType, resolvedModel, ...).
 * @property {object[]} metas     .meta.json de cada subagente, con `agentId` inyectado.
 * @property {object[]} archivos  Entradas del indice de transcripts de este tick.
 * @property {object[]} vivos     Procesos de ~/.claude/sessions con procesoVivo resuelto.
 * @property {object|null} limites  Limites de uso ya proyectados al dominio.
 * @property {{abierto: object|null, archivados: object[]}} registroExtra  Historico local de gasto extra; vacio si no se inyecto usageHistory.
 * @property {object|null} cuenta  Identidad de la cuenta local (viene del mismo archivo que los limites); null si no se pudo leer.
 * @property {object[]} cuentasRemotas  Snapshots crudos de las otras cuentas (Vault, SOUCLAUDE_LOCAL_ACCOUNTS); [] sin lector.
 * @property {object[]|null} registrosUsage  Registros v1 del Vault (crudos); null = sin Vault configurado.
 * @property {{file: string, reason: string}[]} avisos  Todos los warnings concatenados.
 */

/**
 * Fuente del snapshot. Es el unico puerto que toca el disco.
 *
 * @typedef {object} SnapshotSource
 * @property {(args: {window: object, ahora: number}) => Promise<Snapshot>} collect
 */

/**
 * Reloj. Existe para que el caso de uso no llame a Date.now() directo: el
 * instante del tick tiene que ser uno solo y tiene que poder fijarse en un test.
 *
 * @typedef {object} Clock
 * @property {() => number} now  Epoch ms.
 */

/**
 * Bitacora del router de modelos. Escritura append-only, nunca bloqueante para
 * el panel: un fallo al escribir no puede tumbar el tick.
 *
 * @typedef {object} RouterLog
 * @property {(line: string) => Promise<void>} append
 */

export {}
