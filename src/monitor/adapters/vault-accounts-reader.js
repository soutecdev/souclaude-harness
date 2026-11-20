import fs from 'node:fs'
import path from 'node:path'
import { CARPETA_MONITOR } from './vault-monitor-publisher.js'
import { gitReal } from '../../core/vault-sync.js'

// Lee los snapshots de cuenta que las maquinas del equipo publican en
// <vault>/00-System/monitor/*.json (ver vault-monitor-publisher.js y el ADR
// 20260810-monitor-snapshots-en-vault). Este adaptador NO valida ni fusiona:
// entrega los snapshots crudos + avisos, y es el dominio
// (cuentas.consolidarCuentas) quien decide que fila gana.
//
// SIEMPRE lee el working tree local del Vault: lectura de disco barata que
// puede correr en cada tick (con cache por TTL). El refresco REMOTO es
// opcional y ortogonal: si se inyecta `git`, un pull --rebase propio con su
// intervalo y backoff, siempre fuera del camino del render (fire-and-forget).
// Cuando el monitor tambien publica (--publish), el pull del publisher ya
// refresca el clon y aca no hace falta ninguno.

export const TTL_LECTURA_MS = 60_000
export const INTERVALO_PULL_MS = 5 * 60_000
export const VERSION_SOPORTADA = 1

const BACKOFF_MEDIO_MS = 15 * 60_000
const BACKOFF_LARGO_MS = 60 * 60_000

export function createVaultAccountsReader({
  vaultPath,
  ttlMs = TTL_LECTURA_MS,
  git = null,
  pullIntervaloMs = INTERVALO_PULL_MS,
} = {}) {
  let cache = null // { leidoEnMs, valor }

  let enPull = false
  let ultimoPullMs = null
  let fallosPull = 0
  let backoffHasta = null

  /**
   * Snapshots crudos del working tree + avisos. Nunca lanza.
   * @returns {Promise<{cuentas: object[], warnings: object[]}>}
   */
  async function leer({ ahora } = {}) {
    const now = typeof ahora === 'number' ? ahora : Date.now()
    if (!vaultPath) return { cuentas: [], warnings: [] }

    // El pull (si corresponde) se dispara y NO se espera: el tick de este
    // mismo instante lee lo que ya hay en disco; el proximo vera lo nuevo.
    if (git) refrescar(now)

    if (cache && now - cache.leidoEnMs < ttlMs) return cache.valor

    const valor = leerCarpeta(path.join(vaultPath, ...CARPETA_MONITOR.split('/')))
    cache = { leidoEnMs: now, valor }
    return valor
  }

  function refrescar(now) {
    if (enPull) return
    if (backoffHasta !== null && now < backoffHasta) return
    if (ultimoPullMs !== null && now - ultimoPullMs < pullIntervaloMs) return

    enPull = true
    ultimoPullMs = now
    Promise.resolve(git(['-C', vaultPath, 'pull', '--rebase']))
      .then(() => {
        fallosPull = 0
        backoffHasta = null
      })
      .catch(() => {
        fallosPull += 1
        if (fallosPull >= 6) backoffHasta = now + BACKOFF_LARGO_MS
        else if (fallosPull >= 3) backoffHasta = now + BACKOFF_MEDIO_MS
      })
      .finally(() => {
        enPull = false
      })
  }

  function estado() {
    return { ultimoPullMs, fallosPull, backoffHasta }
  }

  return { leer, estado }
}

function leerCarpeta(carpeta) {
  let nombres
  try {
    nombres = fs.readdirSync(carpeta).filter((n) => n.endsWith('.json'))
  } catch {
    // Sin carpeta no hay cuentas remotas: equipo que todavia no publica nada.
    return { cuentas: [], warnings: [] }
  }

  const cuentas = []
  const warnings = []
  for (const nombre of nombres) {
    const ruta = path.join(carpeta, nombre)
    let snapshot
    try {
      snapshot = JSON.parse(fs.readFileSync(ruta, 'utf8'))
    } catch {
      warnings.push({ file: ruta, reason: 'snapshot de cuenta corrupto: se ignora' })
      continue
    }
    if (snapshot?.version !== VERSION_SOPORTADA) {
      warnings.push({ file: ruta, reason: `snapshot de cuenta version ${snapshot?.version ?? '?'}: este monitor solo entiende v${VERSION_SOPORTADA}` })
      continue
    }
    if (typeof snapshot?.cuenta?.accountUuid !== 'string' || snapshot.cuenta.accountUuid === '') {
      warnings.push({ file: ruta, reason: 'snapshot de cuenta sin accountUuid: se ignora' })
      continue
    }
    cuentas.push(snapshot)
  }
  return { cuentas, warnings }
}

// Exportado para que monitor.js arme el pull opcional. Es el mismo git de
// core/vault-sync.js: con plazo y sin prompts de credenciales, que sobre el
// panel en vivo (TTY en modo raw) se escribirian encima de la pantalla.
export function gitAsync(args) {
  return gitReal(args)
}
