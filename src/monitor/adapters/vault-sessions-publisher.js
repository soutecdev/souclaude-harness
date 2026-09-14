import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { contieneSecreto } from './usage-fetcher.js'
import { pullRebaseSeguro, pushSeguro, gitReal } from '../../core/vault-sync.js'

// Publica en el Vault la linea de sessions.md de cada sesion con consumo de
// este proyecto — recurrente: la linea aparece en cuanto la sesion consumio
// algo y se actualiza en el lugar mientras crece, asi el registro no depende
// de la disciplina del agente ni de esperar el cierre. Autorizado por el ADR
// docs/decisions/20260817-milestones-planes-y-sesiones-en-vault.md: una linea
// AGREGADA por sesion y por proyecto en Project-<PREFIJO>/sessions.md.
// La telemetria cruda (model-router.jsonl, eventos por llamada) sigue
// prohibida en el Vault (ADR 20260810).
//
// REGLAS QUE NO SE NEGOCIAN (las mismas del snapshot publisher):
// - La linea se construye campo por campo (whitelist), jamas volcando un nodo
//   del arbol: un campo nuevo aguas arriba no puede colarse solo al Vault.
// - contieneSecreto() sobre cada linea como ultimo filtro: si dispara, esa
//   sesion no se publica y queda registrado en estado().
// - sessions.md es append-only y compartido: una sesion = una linea. Solo se
//   reemplaza una linea si es EXACTAMENTE la que este publisher escribio antes
//   (la sesion se reanudo y crecio); una linea de otro no se toca nunca.
// - Nada de aca puede bloquear ni tumbar el render: publicar() nunca lanza,
//   el llamador la dispara fire-and-forget.
// - Idempotencia por sessionId en un registro LOCAL
//   (~/.claude/souclaude/sesiones-publicadas.json), nunca re-parseando el
//   Vault: correr el monitor dos veces no duplica lineas.

export const INTERVALO_SESIONES_MS = 5 * 60_000
export const ARCHIVO_SESIONES = 'sessions.md'

const BACKOFF_MEDIO_MS = 15 * 60_000
const BACKOFF_LARGO_MS = 60 * 60_000

// Entradas del registro local mas viejas que esto se podan al escribir: muy
// por encima de la ventana maxima del monitor (7d), asi que una sesion podada
// jamas puede reaparecer como candidata y duplicarse.
const RETENCION_REGISTRO_MS = 45 * 24 * 60 * 60_000

const LARGO_MAX_RESULTADO = 80

/**
 * Milestone `<PREFIJO>-M<n>` inferido del nombre de la rama, o null.
 *
 * La norma (skill soutec-github) es `tipo/M<n>-slug`, SIN la clave del
 * proyecto: el repo ya pertenece a un solo proyecto del Vault, asi que la clave
 * la aporta `prefijo` (carpeta Project-<PREFIJO> declarada en vault.local.json).
 * Las ramas viejas `tipo/<PREFIJO>-M<n>-...` siguen resolviendo sin prefijo.
 * Sin prefijo, una rama corta `M<n>` no se puede atribuir a un proyecto: null.
 */
export function milestoneDeRama(rama, prefijo = null) {
  if (typeof rama !== 'string') return null
  const largo = rama.match(/([A-Z][A-Z0-9]*-M\d+)/)
  if (largo) return largo[1]
  if (typeof prefijo !== 'string' || prefijo === '') return null
  const corto = rama.match(/(?:^|[/-])M(\d+)(?=-|$)/)
  return corto ? `${prefijo}-M${corto[1]}` : null
}

/** `SHS` a partir de la carpeta `Project-SHS`; null si no tiene esa forma. */
export function prefijoDeProyecto(proyecto) {
  if (typeof proyecto !== 'string') return null
  const m = proyecto.match(/^Project-([A-Z][A-Z0-9]*)$/)
  return m ? m[1] : null
}

/**
 * La linea de sessions.md de una sesion, campo por campo (whitelist). Formato
 * del protocolo (progress/README.md):
 *   - fecha · rama-o-sesion · milestone · @quien · maquina · in Xk / out Yk · resultado
 * null si la sesion no consumio nada: una linea de puro cero no registra trabajo.
 */
export function construirLineaDeSesion(sesion, { quien, maquina, prefijo = null } = {}) {
  const consumo = sesion?.consumo ?? null
  if (!consumo) return null
  const tokensIn = (consumo.entrada ?? 0) + (consumo.cacheCreacion ?? 0) + (consumo.cacheLectura ?? 0)
  const tokensOut = consumo.salida ?? 0
  if (tokensIn + tokensOut === 0) return null

  const fecha = new Date(sesion.ultimoTs ?? Date.now()).toISOString().slice(0, 10)
  const rama = sanearCampo(sesion.rama) ?? (sesion.sessionId ? sesion.sessionId.slice(0, 8) : 'n/d')
  const milestone = milestoneDeRama(rama, prefijo) ?? 'n/d'
  const autor = sanearCampo(quien) ?? sanearCampo(sesion.cuentaAlias) ?? 'n/d'
  const resultado = sanearResultado(sesion.titulo)

  return (
    `- ${fecha} · ${rama} · ${milestone} · @${autor} · ${sanearCampo(maquina) ?? 'n/d'} · ` +
    `in ${enK(tokensIn)} / out ${enK(tokensOut)} · ${resultado}`
  )
}

// TODO campo interpolado se sanea, no solo el titulo: un nombre de rama puede
// contener legalmente el separador de campos (·) y falsificaria milestone,
// @quien y tokens de la linea — el registro compartido de consumo es un dato
// de auditoria, no decorativo (hallazgo del security review del PR).
function sanearCampo(valor) {
  if (typeof valor !== 'string') return null
  const plano = valor.replace(/[·\r\n]+/g, '-').replace(/\s+/g, ' ').trim()
  return plano === '' ? null : plano
}

// El titulo de la sesion como resultado provisorio: es lo unico en prosa que
// el monitor conoce. El separador de campos (·) y los saltos de linea se
// sanean porque romperian el contrato "una linea = una linea de archivo".
// El filtro de secretos corre sobre el titulo CRUDO ademas del de la linea
// final: truncar primero podria dejar un fragmento que ya no matchea ningun
// patron y se colaria al Vault.
function sanearResultado(titulo) {
  if (typeof titulo !== 'string' || titulo.trim() === '') return 'n/d'
  if (contieneSecreto(titulo)) return 'n/d'
  const plano = titulo.replace(/[·\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (plano === '') return 'n/d'
  return plano.length > LARGO_MAX_RESULTADO ? plano.slice(0, LARGO_MAX_RESULTADO - 1) + '…' : plano
}

function enK(n) {
  if (n < 1000) return String(n)
  return `${Math.round(n / 1000)}k`
}

// Mismo criterio de clave que domain/arbol.js (normalizarClaveDeRuta): dos
// grafias del mismo cwd no pueden hacer que el publisher ignore el proyecto.
function claveDeRuta(ruta) {
  if (typeof ruta !== 'string' || ruta === '') return null
  return ruta.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Sesiones de la vista que pertenecen a ESTE proyecto (cwd del monitor),
 * vivas o terminadas: la publicacion es recurrente y la linea de una sesion
 * viva se actualiza en cada crecimiento (el redondeo a "k" de los tokens
 * throttlea solo los reemplazos). Las de otros proyectos de la maquina no son
 * de este sessions.md. Las sin consumo las descarta construirLineaDeSesion.
 */
export function sesionesPublicables(vista, cwdProyecto) {
  const clave = claveDeRuta(cwdProyecto)
  if (!clave) return []
  const sesiones = []
  for (const proyecto of vista?.proyectos ?? []) {
    if (claveDeRuta(proyecto.ruta) !== clave) continue
    for (const sesion of proyecto.sesiones ?? []) sesiones.push(sesion)
  }
  return sesiones
}

export function createSessionsPublisher({
  vaultPath,
  proyecto,
  cwdProyecto,
  quien = null,
  registroPath = null,
  intervaloMs = INTERVALO_SESIONES_MS,
  git = gitReal,
  hostname = null,
} = {}) {
  const host = hostname ?? leerHostname()
  // La rama de la norma es `tipo/M<n>-slug`, sin clave de proyecto: la clave
  // sale de la carpeta Project-<PREFIJO> a la que este publisher escribe.
  const prefijo = prefijoDeProyecto(proyecto)

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
   * toca (intervalo, backoff, sesiones nuevas). Mismo contrato que el
   * snapshot publisher: el llamador puede invocarla en cada tick.
   * @returns {Promise<{publicado: boolean, motivo: string|null, lineas?: number}>}
   */
  async function publicar(vista, { ahora } = {}) {
    if (enPublicacion) return { publicado: false, motivo: 'en_curso' }
    if (!vaultPath) return { publicado: false, motivo: 'sin_vault' }
    if (!proyecto) return { publicado: false, motivo: 'sin_proyecto' }

    const now = typeof ahora === 'number' ? ahora : Date.now()
    if (backoffHasta !== null && now < backoffHasta) return { publicado: false, motivo: 'backoff' }
    if (ultimoIntentoMs !== null && now - ultimoIntentoMs < intervaloMs) {
      return { publicado: false, motivo: 'intervalo' }
    }

    enPublicacion = true
    try {
      return await publicarSesiones(vista, now)
    } catch {
      registrarFallo(now)
      return { publicado: false, motivo: 'error' }
    } finally {
      enPublicacion = false
    }
  }

  async function publicarSesiones(vista, now) {
    ultimoIntentoMs = now

    const registro = leerRegistro(registroPath)
    const pendientes = []
    secretoDetectado = false

    for (const sesion of sesionesPublicables(vista, cwdProyecto)) {
      const linea = construirLineaDeSesion(sesion, { quien, maquina: host, prefijo })
      if (!linea) continue

      const previa = registro.sesiones[sesion.sessionId] ?? null
      if (previa?.linea === linea) continue // ya publicada tal cual

      if (contieneSecreto(linea)) {
        // No es fallo de red: sin backoff. La sesion queda sin publicar y el
        // panel puede mostrar el estado.
        secretoDetectado = true
        continue
      }
      pendientes.push({ sessionId: sesion.sessionId, linea, lineaPrevia: previa?.linea ?? null })
    }

    if (pendientes.length === 0) {
      return { publicado: false, motivo: secretoDetectado ? 'secreto_detectado' : 'sin_cambios' }
    }

    // pull --rebase ANTES de leer y escribir: la linea se agrega sobre el
    // sessions.md mas fresco posible (pushSeguro vuelve a rebasar al final).
    const pull = await pullRebaseSeguro({ vaultPath, git })
    if (!pull.ok) {
      registrarFallo(now)
      return { publicado: false, motivo: 'pull_fallo' }
    }

    const archivo = path.join(vaultPath, proyecto, ARCHIVO_SESIONES)
    try {
      // Escritura directa, sin temp+rename (EPERM bajo OneDrive, ver core/fsx.js).
      fs.mkdirSync(path.dirname(archivo), { recursive: true })
      fs.writeFileSync(archivo, aplicarLineas(leerTexto(archivo), pendientes), 'utf8')
    } catch {
      registrarFallo(now)
      return { publicado: false, motivo: 'write_fallo' }
    }

    const push = await pushSeguro({
      vaultPath,
      mensaje: `chore: sesiones de ${proyecto} (monitor)`,
      paths: [`${proyecto}/${ARCHIVO_SESIONES}`],
      git,
    })
    if (!push.ok) {
      // El archivo (y quiza el commit) quedo local: el proximo intento lo
      // empuja. El registro NO se actualiza: la sesion sigue pendiente.
      registrarFallo(now)
      return { publicado: false, motivo: push.motivo }
    }

    for (const p of pendientes) {
      registro.sesiones[p.sessionId] = { linea: p.linea, publicadoEn: now }
    }
    escribirRegistro(registroPath, registro, now)

    fallosSeguidos = 0
    backoffHasta = null
    ultimaPublicacionMs = now
    return { publicado: true, motivo: null, lineas: pendientes.length }
  }

  return { publicar, estado }
}

// --- helpers ---------------------------------------------------------------

// Una sesion reanudada (crecio despues de publicada) actualiza SU linea en el
// lugar si sigue intacta; si alguien la edito o la movio, se agrega una nueva
// al final — nunca se toca una linea que no sea byte a byte la nuestra.
function aplicarLineas(contenido, pendientes) {
  let lineas = contenido === '' ? [] : contenido.split('\n')
  for (const p of pendientes) {
    const idx = p.lineaPrevia ? lineas.indexOf(p.lineaPrevia) : -1
    if (idx >= 0) lineas[idx] = p.linea
    else {
      // Append al final real del archivo, sin dejar lineas vacias colgando.
      while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop()
      lineas.push(p.linea)
    }
  }
  return lineas.join('\n') + '\n'
}

function leerTexto(archivo) {
  try {
    return fs.readFileSync(archivo, 'utf8')
  } catch {
    return ''
  }
}

// Lectura tolerante del registro local: ausente, corrupto o con otra forma
// arranca vacio. Perder el registro solo puede duplicar una linea vieja, y el
// reemplazo exacto por lineaPrevia lo mitiga; jamas tumba un tick.
function leerRegistro(registroPath) {
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

function escribirRegistro(registroPath, registro, now) {
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
