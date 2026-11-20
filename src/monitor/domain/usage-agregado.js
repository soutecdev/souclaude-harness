// Agregacion PURA del registro de consumo por sesion del Vault
// (00-System/monitor/usage/*.jsonl, ADR 20260820). Recibe registros v1 ya
// parseados (adapters/vault-usage-reader.js) y responde la pregunta del
// milestone SHS-M2: cuanto consumio cada cuenta, contribuyente, proyecto y
// sesion en un periodo. SHS-M3 monta sus vistas encima: el agregado conserva
// el desglose 4-way y porModelo, agrupa ademas por milestone y por dia (serie
// diaria) y acepta filtros de proyecto, quien y cuenta.
//
// Convencion de la casa: tokensIn = entrada + cacheCreacion + cacheLectura.

/**
 * Deduplica, filtra y agrega registros v1.
 * @param {object[]} registros registros v1 (posiblemente con duplicados por sessionId)
 * @param {{desde?: number|null, hasta?: number|null, proyecto?: string|null, quien?: string|null, cuenta?: string|null}} [opciones]
 *   desde/hasta: limites en ms epoch sobre el fin de la sesion.
 *   proyecto/quien/cuenta: filtros exactos sin distinguir mayusculas; cuenta
 *   matchea alias o uuid.
 * @returns {{totales: object, porCuenta: object[], porQuien: object[], porProyecto: object[], porMaquina: object[], porMilestone: object[], porDia: object[], porModelo: object[], sesiones: object[]}}
 */
import { sanearCelda } from './formato.js'

export function agregarUsage(registros, { desde = null, hasta = null, proyecto = null, quien = null, cuenta = null } = {}) {
  const sesiones = deduplicar(registros)
    .filter((r) => enPeriodo(r, desde, hasta))
    .map(materializar)
    .filter((s) => pasaFiltros(s, { proyecto, quien, cuenta }))
    .sort((a, b) => b.tokensIn - a.tokensIn)

  return {
    totales: totalesDe(sesiones),
    porCuenta: agrupar(sesiones, (s) => s.cuentaAlias ?? s.cuentaUuid ?? 'n/d'),
    porQuien: agrupar(sesiones, (s) => s.quien ?? 'n/d'),
    porProyecto: agrupar(sesiones, (s) => s.proyecto ?? 'n/d'),
    porMaquina: agrupar(sesiones, (s) => s.maquina ?? 'n/d'),
    porMilestone: agrupar(sesiones, (s) => s.milestone ?? 'n/d'),
    porDia: serieDiaria(sesiones),
    porModelo: agruparPorModelo(sesiones),
    sesiones,
  }
}

// Una sesion reeditada (linea previa editada a mano + linea nueva del
// publisher) puede aparecer mas de una vez: gana el generadoEn mas nuevo, y a
// igual fecha el de mas tokens (el registro solo crece).
function deduplicar(registros) {
  const porSesion = new Map()
  for (const r of registros ?? []) {
    if (typeof r?.sessionId !== 'string' || r.sessionId === '') continue
    const previo = porSesion.get(r.sessionId)
    if (!previo || esMasNuevo(r, previo)) porSesion.set(r.sessionId, r)
  }
  return [...porSesion.values()]
}

function esMasNuevo(a, b) {
  const ta = Date.parse(a.generadoEn ?? '') || 0
  const tb = Date.parse(b.generadoEn ?? '') || 0
  if (ta !== tb) return ta > tb
  return tokensDe(a) > tokensDe(b)
}

// El registro es COMPARTIDO: lo escriben otras maquinas y cualquiera con acceso
// al Vault puede editarlo. Al entrar al dominio, un numero es un numero (un
// "12" sumado como texto daba el total "012007") y un texto no trae caracteres
// de control (--usage lo imprime tal cual en la terminal de quien consulta).
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const txt = (v) => (typeof v === 'string' ? sanearCelda(v) || null : null)

function tokensDe(r) {
  const t = r?.tokens ?? {}
  return num(t.entrada) + num(t.cacheCreacion) + num(t.cacheLectura) + num(t.salida)
}

function enPeriodo(r, desde, hasta) {
  const ts = Date.parse(r.fin ?? r.inicio ?? r.generadoEn ?? '')
  if (!Number.isFinite(ts)) return desde == null && hasta == null
  if (desde != null && ts < desde) return false
  if (hasta != null && ts > hasta) return false
  return true
}

function materializar(r) {
  const t = r.tokens ?? {}
  const desglose = {
    entrada: num(t.entrada),
    salida: num(t.salida),
    cacheCreacion: num(t.cacheCreacion),
    cacheLectura: num(t.cacheLectura),
  }
  return {
    sessionId: r.sessionId,
    fecha: typeof r.fin === 'string' ? txt(r.fin.slice(0, 10)) : null,
    inicio: txt(r.inicio),
    fin: txt(r.fin),
    generadoEn: txt(r.generadoEn),
    proyecto: txt(r.proyecto),
    rama: txt(r.rama),
    milestone: txt(r.milestone),
    quien: txt(r.quien),
    cuentaUuid: txt(r.cuenta?.uuid),
    cuentaAlias: txt(r.cuenta?.alias),
    maquina: txt(r.maquina?.hostname) ?? txt(r.maquina?.machineID),
    tokensIn: desglose.entrada + desglose.cacheCreacion + desglose.cacheLectura,
    tokensOut: desglose.salida,
    desglose,
    porModelo: modelosDe(r),
    costoUsd: num(r.costoUsd),
    llamadas: num(r.llamadas),
  }
}

function modelosDe(r) {
  if (!Array.isArray(r.porModelo)) return []
  return r.porModelo
    .filter((m) => typeof m?.alias === 'string' && m.alias !== '')
    .map((m) => ({
      alias: txt(m.alias) ?? 'n/d',
      tokensIn: num(m.tokensIn),
      tokensOut: num(m.tokensOut),
      costoUsd: num(m.costoUsd),
    }))
}

function pasaFiltros(s, { proyecto, quien, cuenta }) {
  if (proyecto != null && !mismoTexto(s.proyecto, proyecto)) return false
  if (quien != null && !mismoTexto(s.quien, quien)) return false
  if (cuenta != null && !mismoTexto(s.cuentaAlias, cuenta) && !mismoTexto(s.cuentaUuid, cuenta)) return false
  return true
}

function mismoTexto(a, b) {
  return typeof a === 'string' && a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

function agrupar(sesiones, claveDe) {
  const grupos = new Map()
  for (const s of sesiones) {
    const clave = claveDe(s)
    let g = grupos.get(clave)
    if (!g) {
      g = { clave, tokensIn: 0, tokensOut: 0, desglose: desgloseVacio(), costoUsd: 0, llamadas: 0, sesiones: 0 }
      grupos.set(clave, g)
    }
    g.tokensIn += s.tokensIn
    g.tokensOut += s.tokensOut
    sumarDesglose(g.desglose, s.desglose)
    g.costoUsd += s.costoUsd
    g.llamadas += s.llamadas
    g.sesiones += 1
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, costoUsd: redondear(g.costoUsd) }))
    .sort((a, b) => b.tokensIn - a.tokensIn)
}

// La serie diaria es la base del pico de consumo: cronologica ascendente, con
// las sesiones sin fecha de fin al final bajo 'n/d'.
function serieDiaria(sesiones) {
  return agrupar(sesiones, (s) => s.fecha ?? 'n/d').sort((a, b) => {
    if (a.clave === 'n/d') return 1
    if (b.clave === 'n/d') return -1
    return a.clave < b.clave ? -1 : 1
  })
}

// El registro trae porModelo por sesion; aca 'sesiones' cuenta en cuantas
// sesiones aparecio el modelo (no hay llamadas por modelo en el esquema v1).
function agruparPorModelo(sesiones) {
  const grupos = new Map()
  for (const s of sesiones) {
    for (const m of s.porModelo) {
      let g = grupos.get(m.alias)
      if (!g) {
        g = { clave: m.alias, tokensIn: 0, tokensOut: 0, costoUsd: 0, sesiones: 0 }
        grupos.set(m.alias, g)
      }
      g.tokensIn += m.tokensIn
      g.tokensOut += m.tokensOut
      g.costoUsd += m.costoUsd
      g.sesiones += 1
    }
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, costoUsd: redondear(g.costoUsd) }))
    .sort((a, b) => b.tokensIn - a.tokensIn)
}

function totalesDe(sesiones) {
  const t = { tokensIn: 0, tokensOut: 0, desglose: desgloseVacio(), costoUsd: 0, llamadas: 0, sesiones: sesiones.length }
  for (const s of sesiones) {
    t.tokensIn += s.tokensIn
    t.tokensOut += s.tokensOut
    sumarDesglose(t.desglose, s.desglose)
    t.costoUsd += s.costoUsd
    t.llamadas += s.llamadas
  }
  t.costoUsd = redondear(t.costoUsd)
  return t
}

function desgloseVacio() {
  return { entrada: 0, salida: 0, cacheCreacion: 0, cacheLectura: 0 }
}

function sumarDesglose(destino, fuente) {
  destino.entrada += fuente.entrada
  destino.salida += fuente.salida
  destino.cacheCreacion += fuente.cacheCreacion
  destino.cacheLectura += fuente.cacheLectura
}

function redondear(n) {
  return Math.round(n * 10_000) / 10_000
}
