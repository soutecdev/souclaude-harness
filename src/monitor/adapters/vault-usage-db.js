import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { contieneSecreto } from './usage-fetcher.js'
import { milestoneDeRama } from './vault-sessions-publisher.js'
import { pullRebaseSeguro, pushSeguro, gitReal } from '../../core/vault-sync.js'

// Publica en el Vault el registro ESTRUCTURADO de consumo por sesion — la
// "base de datos del monitor" (SHS-M2): un objeto JSON por linea, una linea
// por sesion, en 00-System/monitor/usage/<maquina8>--<AAAA-MM>.jsonl.
// Autorizado por el ADR docs/decisions/20260820-registro-de-consumo-por-sesion-en-vault.md.
// La telemetria cruda (model-router.jsonl, eventos por mensaje) sigue
// prohibida: la granularidad maxima es una linea agregada por sesion.
//
// REGLAS QUE NO SE NEGOCIAN (las mismas de los otros dos publishers):
// - El registro se construye campo por campo (whitelist), jamas volcando un
//   nodo del arbol. Sin prosa libre: el titulo de la sesion queda fuera.
// - contieneSecreto() sobre cada linea como ultimo filtro.
// - Particion por (maquina, mes del INICIO de la sesion): escritores git
//   disjuntos y una sesion nunca cambia de archivo.
// - La linea propia se actualiza en el lugar mientras la sesion crece; una
//   linea ajena o editada a mano no se toca nunca.
// - Cambio material: generadoEn no cuenta como cambio — sin crecimiento real
//   no hay commit.
// - publicar() nunca lanza ni bloquea el render; idempotencia por sessionId
//   en un registro LOCAL (~/.claude/souclaude/usage-publicado.json).

export const INTERVALO_USAGE_MS = 5 * 60_000
export const CARPETA_USAGE = '00-System/monitor/usage'
export const VERSION_REGISTRO = 1

const BACKOFF_MEDIO_MS = 15 * 60_000
const BACKOFF_LARGO_MS = 60 * 60_000
const RETENCION_REGISTRO_MS = 45 * 24 * 60 * 60_000

/**
 * El registro v1 de una sesion, campo por campo (whitelist del ADR 20260820).
 * null si la sesion no consumio nada: una linea de puro cero no registra trabajo.
 */
export function construirRegistroDeSesion(sesion, { cuenta = null, quien = null, machineID = null, hostname = null, ahora } = {}) {
  const consumo = sesion?.consumo ?? null
  if (!consumo) return null
  const tokens = {
    entrada: consumo.entrada ?? 0,
    salida: consumo.salida ?? 0,
    cacheCreacion: consumo.cacheCreacion ?? 0,
    cacheLectura: consumo.cacheLectura ?? 0,
  }
  if (tokens.entrada + tokens.salida + tokens.cacheCreacion + tokens.cacheLectura === 0) return null

  const rama = sanear(sesion.rama)
  return {
    version: VERSION_REGISTRO,
    sessionId: sesion.sessionId,
    generadoEn: iso(ahora),
    inicio: iso(sesion.inicio),
    fin: iso(sesion.ultimoTs),
    // Solo el NOMBRE del proyecto, nunca la ruta local (ADR 20260820): la
    // ruta expone la estructura de discos de la maquina sin aportar al join.
    proyecto: sanear(sesion.proyecto) ?? null,
    rama,
    milestone: milestoneDeRama(rama),
    quien: sanear(quien) ?? null,
    cuenta: {
      uuid: sesion.cuentaUuid ?? cuenta?.accountUuid ?? null,
      alias: sanear(sesion.cuentaAlias) ?? sanear(cuenta?.alias) ?? null,
    },
    maquina: { machineID: machineID ?? null, hostname: sanear(hostname) ?? null },
    tokens,
    costoUsd: redondear(consumo.costoUsd ?? 0),
    llamadas: consumo.llamadas ?? 0,
    porModelo: (sesion.porModelo ?? []).map(({ alias, consumo: c }) => ({
      alias: sanear(alias) ?? 'n/d',
      tokensIn: (c?.entrada ?? 0) + (c?.cacheCreacion ?? 0) + (c?.cacheLectura ?? 0),
      tokensOut: c?.salida ?? 0,
      costoUsd: redondear(c?.costoUsd ?? 0),
    })),
  }
}

/**
 * Archivo del registro: <maquina8>--<AAAA-MM>.jsonl, mes del INICIO de la
 * sesion (con fin y generadoEn como respaldo) para que una sesion nunca
 * cambie de archivo al crecer.
 */
export function nombreDeArchivoDeUsage(registro) {
  const maquina =
    corto(registro.maquina?.machineID) ?? corto(registro.maquina?.hostname) ?? 'local'
  const base = registro.inicio ?? registro.fin ?? registro.generadoEn
  return `${maquina}--${String(base).slice(0, 7)}.jsonl`
}

/** Todas las sesiones de la vista, de TODOS los proyectos: el registro es de la organizacion, no de un cwd. */
export function sesionesDeUsage(vista) {
  const sesiones = []
  for (const proyecto of vista?.proyectos ?? []) {
    for (const sesion of proyecto.sesiones ?? []) {
      // Sin carpeta de trabajo conocida, `nombre` no es un nombre: es el slug de
      // ~/.claude/projects (la ruta local codificada, "-Users-ana-clientes-...")
      // o el id de la sesion. El ADR 20260820 pide "solo el nombre, nunca la ruta
      // local": en ese caso el proyecto se publica como desconocido.
      sesiones.push({ ...sesion, proyecto: proyecto.ruta ? (proyecto.nombre ?? null) : null })
    }
  }
  return sesiones
}

export function createUsageDbPublisher({
  vaultPath,
  quien = null,
  registroPath = null,
  intervaloMs = INTERVALO_USAGE_MS,
  git = gitReal,
  hostname = null,
} = {}) {
  const host = hostname ?? leerHostname()

  let enPublicacion = false
  let ultimoIntentoMs = null
  let ultimaPublicacionMs = null
  let fallosSeguidos = 0
  let backoffHasta = null
  let secretoDetectado = false

  function estado() {
    return { ultimoIntentoMs, ultimaPublicacionMs, fallosSeguidos, backoffHasta, secretoDetectado }
  }

  function registrarFallo(now) {
    fallosSeguidos += 1
    if (fallosSeguidos >= 6) backoffHasta = now + BACKOFF_LARGO_MS
    else if (fallosSeguidos >= 3) backoffHasta = now + BACKOFF_MEDIO_MS
    else backoffHasta = null
  }

  /**
   * Un intento de publicacion. Nunca lanza; el publisher decide solo si le
   * toca (intervalo, backoff, cambio material). Mismo contrato que los otros
   * dos publishers: el llamador la dispara fire-and-forget en cada tick.
   * @returns {Promise<{publicado: boolean, motivo: string|null, lineas?: number}>}
   */
  async function publicar(vista, { ahora } = {}) {
    if (enPublicacion) return { publicado: false, motivo: 'en_curso' }
    if (!vaultPath) return { publicado: false, motivo: 'sin_vault' }

    const now = typeof ahora === 'number' ? ahora : Date.now()
    if (backoffHasta !== null && now < backoffHasta) return { publicado: false, motivo: 'backoff' }
    if (ultimoIntentoMs !== null && now - ultimoIntentoMs < intervaloMs) {
      return { publicado: false, motivo: 'intervalo' }
    }

    enPublicacion = true
    try {
      return await publicarRegistros(vista, now)
    } catch {
      registrarFallo(now)
      return { publicado: false, motivo: 'error' }
    } finally {
      enPublicacion = false
    }
  }

  async function publicarRegistros(vista, now) {
    ultimoIntentoMs = now

    const registro = leerRegistroLocal(registroPath)
    const machineID = vista?.cuenta?.machineID ?? null
    const pendientes = []
    secretoDetectado = false

    for (const sesion of sesionesDeUsage(vista)) {
      const obj = construirRegistroDeSesion(sesion, {
        cuenta: vista?.cuenta ?? null,
        quien,
        machineID,
        hostname: host,
        ahora: now,
      })
      if (!obj) continue

      const previa = registro.sesiones[obj.sessionId] ?? null
      // Cambio material: generadoEn no cuenta. Sin crecimiento real de la
      // sesion no se reescribe la linea ni se genera un commit.
      if (previa?.linea && igualesSinGeneradoEn(previa.linea, obj)) continue

      const linea = JSON.stringify(obj)
      if (contieneSecreto(linea)) {
        // No es fallo de red: sin backoff. La sesion queda sin publicar y el
        // panel puede mostrar el estado.
        secretoDetectado = true
        continue
      }
      pendientes.push({
        sessionId: obj.sessionId,
        linea,
        lineaPrevia: previa?.linea ?? null,
        archivo: nombreDeArchivoDeUsage(obj),
      })
    }

    if (pendientes.length === 0) {
      return { publicado: false, motivo: secretoDetectado ? 'secreto_detectado' : 'sin_cambios' }
    }

    const pull = await pullRebaseSeguro({ vaultPath, git })
    if (!pull.ok) {
      registrarFallo(now)
      return { publicado: false, motivo: 'pull_fallo' }
    }

    const carpeta = path.join(vaultPath, ...CARPETA_USAGE.split('/'))
    const porArchivo = new Map()
    for (const p of pendientes) {
      if (!porArchivo.has(p.archivo)) porArchivo.set(p.archivo, [])
      porArchivo.get(p.archivo).push(p)
    }

    try {
      // Escritura directa, sin temp+rename (EPERM bajo OneDrive, ver core/fsx.js).
      fs.mkdirSync(carpeta, { recursive: true })
      for (const [nombre, grupo] of porArchivo) {
        const archivo = path.join(carpeta, nombre)
        fs.writeFileSync(archivo, aplicarLineas(leerTexto(archivo), grupo), 'utf8')
      }
    } catch {
      registrarFallo(now)
      return { publicado: false, motivo: 'write_fallo' }
    }

    const push = await pushSeguro({
      vaultPath,
      mensaje: `monitor: usage ${host ?? 'local'}`,
      paths: [...porArchivo.keys()].map((n) => `${CARPETA_USAGE}/${n}`),
      git,
    })
    if (!push.ok) {
      // El archivo (y quiza el commit) quedo local: el proximo intento lo
      // empuja. El registro local NO se actualiza: la sesion sigue pendiente.
      registrarFallo(now)
      return { publicado: false, motivo: push.motivo }
    }

    for (const p of pendientes) {
      registro.sesiones[p.sessionId] = { linea: p.linea, publicadoEn: now }
    }
    escribirRegistroLocal(registroPath, registro, now)

    fallosSeguidos = 0
    backoffHasta = null
    ultimaPublicacionMs = now
    return { publicado: true, motivo: null, lineas: pendientes.length }
  }

  return { publicar, estado }
}

// --- helpers ---------------------------------------------------------------

// Una sesion que crecio actualiza SU linea en el lugar si sigue intacta; si
// alguien la edito o la movio, se agrega una nueva al final — nunca se toca
// una linea que no sea byte a byte la nuestra (mismo contrato que sessions.md).
export function aplicarLineas(contenido, pendientes) {
  // /\r?\n/: con un checkout en CRLF, partir por "\n" dejaba un "\r" al final de
  // cada linea y la linea previa no se encontraba nunca.
  let lineas = contenido === '' ? [] : contenido.split(/\r?\n/)
  for (const p of pendientes) {
    // Idempotente: si la linea nueva ya esta (un intento anterior la escribio y
    // fallo el push, o el monitor se cerro a mitad), no se agrega otra vez.
    if (lineas.includes(p.linea)) continue
    const idx = p.lineaPrevia ? lineas.indexOf(p.lineaPrevia) : -1
    if (idx >= 0) lineas[idx] = p.linea
    else {
      while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop()
      lineas.push(p.linea)
    }
  }
  // Un solo salto de linea al final: al reemplazar una linea, el vacio que deja
  // el split tras el ultimo "\n" se volvia a unir y el archivo ganaba una linea
  // en blanco en cada actualizacion de la sesion.
  while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop()
  return lineas.join('\n') + '\n'
}

function igualesSinGeneradoEn(lineaPrevia, obj) {
  try {
    const previo = JSON.parse(lineaPrevia)
    return JSON.stringify({ ...previo, generadoEn: null }) === JSON.stringify({ ...obj, generadoEn: null })
  } catch {
    return false
  }
}

// Campos de texto sin saltos de linea: una linea JSONL = una linea de archivo.
// (JSON.stringify ya escapa \n, pero la whitelist no confia en eso: el dato
// viaja a un repo compartido y se lee con split('\n').)
function sanear(valor) {
  if (typeof valor !== 'string') return null
  const plano = valor.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return plano === '' ? null : plano
}

function corto(id) {
  if (typeof id !== 'string' || id === '') return null
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase() || null
}

function iso(ts) {
  return typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts).toISOString() : null
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 10_000) / 10_000
}

function leerTexto(archivo) {
  try {
    return fs.readFileSync(archivo, 'utf8')
  } catch {
    return ''
  }
}

// Lectura tolerante del registro local: ausente, corrupto o con otra forma
// arranca vacio (mismo criterio que sesiones-publicadas.json).
function leerRegistroLocal(registroPath) {
  if (!registroPath) return { sesiones: {} }
  try {
    const data = JSON.parse(fs.readFileSync(registroPath, 'utf8'))
    if (!data || typeof data !== 'object' || typeof data.sesiones !== 'object' || data.sesiones == null) {
      return { sesiones: {} }
    }
    return { sesiones: data.sesiones }
  } catch {
    return { sesiones: {} }
  }
}

function escribirRegistroLocal(registroPath, registro, now) {
  if (!registroPath) return
  const sesiones = {}
  for (const [id, entrada] of Object.entries(registro.sesiones)) {
    if (typeof entrada?.publicadoEn === 'number' && now - entrada.publicadoEn > RETENCION_REGISTRO_MS) continue
    sesiones[id] = entrada
  }
  try {
    fs.mkdirSync(path.dirname(registroPath), { recursive: true })
    fs.writeFileSync(registroPath, JSON.stringify({ version: 1, sesiones }, null, 2) + '\n', 'utf8')
  } catch {
    // Sin registro persistido el publisher sigue: en el peor caso reintenta
    // una linea ya publicada y el reemplazo exacto la deja identica.
  }
}

function leerHostname() {
  try {
    return os.hostname()
  } catch {
    return null
  }
}
