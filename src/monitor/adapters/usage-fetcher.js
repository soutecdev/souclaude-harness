import fs from 'node:fs'
import path from 'node:path'

// Refresco propio de los limites de plan.
//
// POR QUE EXISTE: `cachedUsageUtilization` de ~/.claude.json solo se reescribe
// cuando el humano corre /usage. Verificado con un poller: cero refrescos en 12
// minutos de actividad continua, y `claude auth status` tampoco lo toca. El
// panel terminaba mostrando un dato de 20-50 minutos de antiguedad. Aca le
// pegamos al mismo endpoint que usa Claude Code y cacheamos aparte.
//
// El cuerpo de la respuesta ES el objeto de utilizacion: tiene exactamente la
// misma forma que `cachedUsageUtilization.utilization`. Por eso el mapeo a
// nombres de dominio vive una sola vez, en usage-limits-reader.js.
//
// ============================ SEGURIDAD ============================
// ~/.claude/.credentials.json es probablemente el archivo mas sensible de la
// maquina: ademas del token de Claude guarda los tokens OAuth de todos los
// conectores MCP de terceros (GitHub, Slack, Notion, Figma, Datadog...). Y este
// mismo proyecto tiene un publicador que escribe a un repo git compartido, asi
// que una fuga seria catastrofica y silenciosa. Reglas de este modulo:
//
//   1. Se lee UNICAMENTE `claudeAiOauth.accessToken`. El objeto parseado es
//      local a `readAccessToken` y muere ahi: no se guarda en el closure, no se
//      devuelve, no se pasa a nadie. `mcpOAuth` jamas se toca.
//   2. El token no sale del proceso: no se escribe a disco, no se loguea, no lo
//      devuelve ninguna funcion exportada, no viaja en ningun objeto de retorno.
//   3. Ningun error se propaga ni se guarda. En vez de sanitizar mensajes de
//      excepcion (que podrian arrastrar la cabecera Authorization) directamente
//      no los conservamos: `obtener` devuelve null y el estado solo cuenta
//      fallos. Es la garantia mas fuerte y la mas barata de auditar.
//   4. Sin refresco de token. Un 401 se trata como fallo comun: NO tocamos
//      `refreshToken` ni renovamos nada, eso es trabajo de Claude Code. Menos
//      superficie sobre credenciales.
//   5. El cache propio contiene solo { fetchedAtMs, utilization }.
// ===================================================================

export const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
export const TTL_REFRESCO_MS = 5 * 60_000

const BACKOFF_MEDIO_MS = 15 * 60_000 // 3-5 fallos seguidos
const BACKOFF_LARGO_MS = 60 * 60_000 // 6 o mas

// fetch global (undici) y no node:https: el codigo queda mucho mas corto, trae
// AbortSignal.timeout para el corte por tiempo, y el motor >=22.4 lo garantiza.
// node:https ademas obliga a armar el request a mano, que es justo donde uno
// termina construyendo strings con la cabecera Authorization adentro.
export function createUsageFetcher({
  paths,
  ttlMs = TTL_REFRESCO_MS,
  timeoutMs = 10_000,
  fetchImpl,
} = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  const credentialsFile = paths ? path.join(paths.home, '.credentials.json') : null
  const cacheFile = paths ? path.join(paths.home, 'souclaude', 'usage-cache.json') : null

  let ultimoIntentoMs = null
  let ultimoOkMs = null
  let fallosSeguidos = 0
  let backoffHasta = null

  function estado() {
    return { ultimoIntentoMs, ultimoOkMs, fallosSeguidos, backoffHasta }
  }

  function registrarFallo(now) {
    fallosSeguidos += 1
    // 1-2 fallos: reintento normal (el TTL ya espacia). Un portatil sin red no
    // puede pegarle al endpoint cada 5 minutos para siempre.
    if (fallosSeguidos >= 6) backoffHasta = now + BACKOFF_LARGO_MS
    else if (fallosSeguidos >= 3) backoffHasta = now + BACKOFF_MEDIO_MS
    else backoffHasta = null
  }

  async function obtener({ ahora, force = false } = {}) {
    const now = ahora ?? Date.now()
    if (!paths) return null

    const cache = await readCache(cacheFile)

    // Guarda de TTL: cache propio fresco, no se toca la red.
    if (!force && cache && now - cache.fetchedAtMs < ttlMs) {
      return { utilization: cache.utilization, fetchedAtMs: cache.fetchedAtMs, origen: 'cache-propio' }
    }

    // Backoff activo: tampoco se toca la red. Se devuelve lo ultimo que haya.
    if (!force && backoffHasta !== null && now < backoffHasta) {
      return fallback(cache)
    }

    ultimoIntentoMs = now

    const token = await readAccessToken(credentialsFile)
    if (!token) {
      registrarFallo(now)
      return fallback(cache)
    }

    const utilization = await pedirUtilizacion(doFetch, token, timeoutMs)
    if (!utilization) {
      registrarFallo(now)
      return fallback(cache)
    }

    fallosSeguidos = 0
    backoffHasta = null
    ultimoOkMs = now

    await writeCache(cacheFile, { fetchedAtMs: now, utilization })
    return { utilization, fetchedAtMs: now, origen: 'red' }
  }

  return { obtener, estado }
}

function fallback(cache) {
  if (!cache) return null
  return { utilization: cache.utilization, fetchedAtMs: cache.fetchedAtMs, origen: 'cache-propio' }
}

// El token vive solo dentro de esta funcion y de `pedirUtilizacion`. Ningun
// try/catch guarda el error: un mensaje de excepcion podria arrastrar la
// cabecera Authorization.
async function pedirUtilizacion(doFetch, token, timeoutMs) {
  if (typeof doFetch !== 'function') return null
  // Timer propio (ref'd) en vez de AbortSignal.timeout: ese usa un timer
  // unref'd, y si el event loop se queda sin trabajo referenciado antes de que
  // dispare (Node 22 bajo `node --test`), el proceso termina con la promesa
  // colgada para siempre ("Promise resolution is still pending but the event
  // loop has already resolved") y arrastra en cascada los tests siguientes.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
      },
      signal: controller.signal,
      // El token solo viaja al host de ENDPOINT: una redireccion (endpoint
      // interno y no documentado, puede cambiar) se trata como un fallo mas en
      // vez de seguirla con la cabecera Authorization puesta.
      redirect: 'error',
    })

    // 401 incluido: se trata como un fallo mas. No renovamos el token.
    if (!res || res.status !== 200) return null

    return soloUtilizacion(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// La respuesta se reduce a los cuatro campos que el monitor entiende, y solo se
// acepta si al menos uno trae datos con la forma esperada. El endpoint es
// interno y puede cambiar: un 200 con otra forma producia limites vacios que,
// por ser la lectura mas reciente, le ganaban 5 minutos al cache valido de
// ~/.claude.json, y el comando salia con 0 ("todo bien"). Ahora cuenta como un
// fallo mas y se cae al cache, que es lo que promete el README. De paso, al
// cache propio ya no llega ningun campo que la API agregue manana.
export function soloUtilizacion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const ventana = (v) => (v && typeof v === 'object' && typeof v.utilization === 'number' ? v : null)
  const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
  const utilizacion = {
    five_hour: ventana(body.five_hour),
    seven_day: ventana(body.seven_day),
    limits: Array.isArray(body.limits) ? body.limits : [],
    extra_usage: objeto(body.extra_usage),
  }
  const hayDatos = utilizacion.five_hour || utilizacion.seven_day || utilizacion.limits.length > 0 || utilizacion.extra_usage
  return hayDatos ? utilizacion : null
}

// Lee EXCLUSIVAMENTE claudeAiOauth.accessToken. El objeto parseado (que
// contiene los tokens OAuth de todos los conectores MCP) no sobrevive a este
// scope: no se retorna, no se cachea, no se pasa a nadie.
async function readAccessToken(credentialsFile) {
  if (!credentialsFile) return null
  try {
    const parsed = JSON.parse(await fs.promises.readFile(credentialsFile, 'utf8'))
    const token = parsed?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    return null
  }
}

async function readCache(cacheFile) {
  if (!cacheFile) return null
  try {
    const data = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'))
    if (typeof data?.fetchedAtMs !== 'number') return null
    if (!data.utilization || typeof data.utilization !== 'object') return null
    return { fetchedAtMs: data.fetchedAtMs, utilization: data.utilization }
  } catch {
    return null
  }
}

// Escritura directa, sin temp+rename: ese patron "atomico" es justo el que
// falla con EPERM bajo sync de OneDrive (ver src/core/fsx.js).
async function writeCache(cacheFile, { fetchedAtMs, utilization }) {
  if (!cacheFile) return
  try {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true })
    // Solo estos dos campos. Nunca el token, nunca la respuesta cruda.
    await fs.promises.writeFile(cacheFile, JSON.stringify({ fetchedAtMs, utilization }, null, 2) + '\n', 'utf8')
  } catch {
    // Sin cache en disco el fetcher sigue funcionando, solo pierde la guarda
    // entre procesos. No es motivo para romper un tick del panel.
  }
}

const PATRONES_SECRETO = [
  /sk-ant-[A-Za-z0-9_-]{8,}/, // claves de Anthropic
  /sk-[A-Za-z0-9_-]{16,}/, // formato generico sk-
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i, // cabecera pegada por accidente
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/, // GitHub
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/, // Slack
  /\bya29\.[A-Za-z0-9_-]{10,}/, // Google OAuth
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /[A-Za-z0-9_-]{60,}/, // cualquier chorizo base64/url-safe largo
]

// Red de seguridad, NO la defensa principal. La defensa principal es que el
// token nunca sale de usage-fetcher.js y que el cache propio solo guarda
// { fetchedAtMs, utilization }. Esto es el ultimo filtro antes de que algo se
// escriba a un repo compartido, y como todo detector por patron tiene falsos
// positivos (un hash largo dispara la ultima regla) y falsos negativos (un
// formato de token que no previmos). Nunca lo uses como unica garantia.
export function contieneSecreto(texto) {
  if (typeof texto !== 'string' || texto.length === 0) return false
  return PATRONES_SECRETO.some((re) => re.test(texto))
}
