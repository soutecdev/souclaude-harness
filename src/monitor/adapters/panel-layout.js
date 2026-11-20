import pc from 'picocolors'
import {
  RESTO,
  anchoVisual,
  barra,
  columnas,
  fmtDinero,
  fmtDuracion,
  fmtDuracionMin,
  fmtRelativo,
  fmtTokens,
  rellenarDerecha,
  rellenarIzquierda,
  sanearCelda,
  severidad,
  sparkline,
  truncar,
} from '../domain/formato.js'
import { charsFor } from './caps.js'

// Layout del panel del monitor. Este modulo NO escribe a stdout ni emite ANSI de
// cursor: devuelve un array de strings y otro modulo lo pinta. Esa separacion es
// lo que hace testeable el panel.
//
// Contrato duro: cada linea mide EXACTAMENTE `cols` de ancho visual (medido con
// anchoVisual, que ignora ANSI) y el array nunca supera `rows` entradas.
//
// Regla de oro del color: se trunca y se rellena sobre texto PLANO y se colorea al
// final, sobre segmentos que ya tienen su ancho fijo. picocolors inyecta escapes que
// String.length cuenta y la terminal no dibuja; colorear antes de truncar rompe el
// layout y deja escapes abiertos. Con { color: false } no sale ni un \x1b.

/**
 * @typedef {object} VistaMonitor
 * Todos los campos son opcionales: el panel degrada en vez de romperse.
 * @property {number} [ahora]           epoch ms del instante de render
 * @property {number} [actualizadoEn]   epoch ms del ultimo refresco de datos
 * @property {Array<{etiqueta?:string, modelo?:string, porcentaje:number, reset?:string,
 *                   reseteaEn?:number|null}>} [limites]
 * @property {{corriendo?:number, terminados?:number,
 *            filas?:Array<{nombre?:string, proyecto?:string, modelo?:string, tokens?:number,
 *                          duracionMs?:number, tools?:number, sesionId?:string,
 *                          sesionTitulo?:string, estado?:string, finEn?:number|null}>}} [agentes]
 * @property {{etiquetaVentana?:string, unidad?:string, serie?:number[], picoValor?:number,
 *             picoEtiqueta?:string, totalTokens?:number, costoUsd?:number}} [consumo]
 * @property {{entrada?:number, salida?:number, cacheCreacion?:number, cacheLectura?:number}} [desglose]
 * @property {Array<{nombre?:string, tokens?:number, costoUsd?:number}>} [modelos]
 * @property {{total?:number, vivas?:number,
 *            filas?:Array<{id?:string, titulo?:string, proyecto?:string, rama?:string,
 *                          modelo?:string, tokens?:number, costoUsd?:number,
 *                          ultimaActividad?:number}>}} [sesiones]
 * @property {{total?:number, totalTokens?:number,
 *            filas?:Array<{nombre?:string, sesiones?:number, tokens?:number, costoUsd?:number}>,
 *            otros?:{cantidad?:number, sesiones?:number, tokens?:number, costoUsd?:number}}} [proyectos]
 * @property {{sesiones?:number, proyectos?:number, agentes?:number}} [recortes]
 *           Lo que el dominio ya dejo fuera aguas arriba. El panel lo suma a lo que
 *           recorta por altura para decir la verdad en la linea "y N mas".
 * @property {Array<{etiqueta?:string, porcentaje?:number|null, reseteaEn?:number|null,
 *                   alineada?:boolean, tokensIn?:number, tokensOut?:number,
 *                   costoUsd?:number, sesiones?:number}>} [ventanas]
 *           Consumo propio del registro del Vault dentro de cada ventana de rate
 *           limit (SHS-M3-T005). Vacio = sin datos: la seccion se omite.
 * @property {{filas?:Array<{quien?:string, cuenta?:string, maquina?:string, proyecto?:string,
 *                           rama?:string, tokens?:number, costoUsd?:number,
 *                           frescuraMs?:number|null}>}|null} [equipo]
 *           Sesiones activas del equipo segun el Vault (SHS-M3-T005). null = sin
 *           Vault configurado (seccion omitida); filas vacias = nadie activo (se pinta).
 * @property {string[]} [avisos]
 * @property {string[]} [historico]
 *           Filas ya formateadas de gasto extra archivado (SHS-H3-T105, panel-presenter.js
 *           ya arma el texto exacto: "Extra ago-2026  $21.36/$20.00  alcanzado 06-08").
 *           Se pintan al pie, atenuadas, fuera de `limites` -- por eso nunca disparan
 *           UMBRAL_ALARMA ni el titulo `LIMITE N%`.
 */

// El formateador se crea SIEMPRE con color: quien decide si una celda se tiñe es
// el parametro `color` de renderPanel (ver tenir()), no la deteccion que
// picocolors hace una sola vez al importarse (TTY, CI, win32, FORCE_COLOR). Con
// el `pc` global, `color: true` no emitia ni un escape cuando el proceso no
// tenia TTY -- macOS/Linux con la salida por tuberia, o un agente corriendo la
// suite -- y el panel dependia del entorno en vez de sus parametros. En
// produccion nada cambia: `caps.color` sigue saliendo de pc.isColorSupported.
const tinta = pc.createColors(true)

const PALETA = {
  red: tinta.red,
  yellow: tinta.yellow,
  green: tinta.green,
  cyan: tinta.cyan,
  dim: tinta.dim,
  bold: tinta.bold,
  gray: tinta.gray,
}

const UMBRAL_ALARMA = 85
const FILAS_MINIMAS = 12
const COLS_MINIMAS = 60
const COLS_ANCHO = 100

const PIE = ['tokens medidos', 'costo estimado', 'estado heuristico']

// Los tokens son dato duro; el dinero es derivado de una tabla local. Cuando
// hay llamadas de un modelo sin precio conocido, el costo mostrado es un piso,
// no el total, y el pie tiene que decirlo: un $0.00 junto a millones de tokens
// se lee como "gratis" en vez de como "no lo sabemos".
function pieDe(vista) {
  const sinPrecio = vista?.sinPrecio ?? 0
  if (!sinPrecio) return PIE
  return [...PIE, `${sinPrecio} llamadas sin precio`]
}

// --- primitivas de ancho exacto ---

function tenir(texto, tinte, color) {
  if (!color || !tinte) return texto
  const fn = PALETA[tinte]
  return typeof fn === 'function' ? fn(texto) : texto
}

function tinteDeNivel(nivel) {
  if (nivel === 'critico' || nivel === 'alto') return 'red'
  if (nivel === 'aviso') return 'yellow'
  return 'green'
}

/**
 * Fila de celdas de ancho visual total exacto `anchoTotal`, con un separador de una
 * celda entre columnas (mismo contrato que `columnas()` del dominio) y color por celda.
 * Cada celda: { texto, ancho|RESTO, alinear: 'i'|'d', tinte }. El color se aplica DESPUES
 * de truncar y rellenar, asi que nunca altera el ancho.
 */
function fila(celdas, anchoTotal, ctx) {
  const visibles = celdas.filter(Boolean)
  if (anchoTotal <= 0) return ''
  if (visibles.length === 0) return ' '.repeat(anchoTotal)

  const separadores = visibles.length - 1
  const disponible = Math.max(0, anchoTotal - separadores)
  const iResto = visibles.findIndex((c) => c.ancho === RESTO)
  const fijos = visibles.reduce(
    (acc, c, i) => acc + (i === iResto ? 0 : Math.max(0, c.ancho || 0)),
    0
  )

  const anchos = visibles.map((c, i) =>
    i === iResto ? Math.max(0, disponible - fijos) : Math.max(0, c.ancho || 0)
  )

  // Si los anchos fijos exceden el disponible, se recorta desde la ultima columna.
  let suma = anchos.reduce((a, b) => a + b, 0)
  for (let i = anchos.length - 1; i >= 0 && suma > disponible; i--) {
    const recorte = Math.min(anchos[i], suma - disponible)
    anchos[i] -= recorte
    suma -= recorte
  }

  const partes = visibles.map((c, i) => {
    const w = anchos[i]
    if (w === 0) return ''
    const plano = truncar(String(c.texto ?? ''), w, { elipsis: ctx.elipsis })
    const encajado = c.alinear === 'd' ? rellenarIzquierda(plano, w) : rellenarDerecha(plano, w)
    return tenir(encajado, c.tinte, ctx.color)
  })

  let salida = partes.join(' ')
  const w = anchoVisual(salida)
  if (w < anchoTotal) salida += ' '.repeat(anchoTotal - w)
  return salida
}

/** Ajusta a ancho exacto rellenando con el glifo `relleno` (texto plano, sin ANSI). */
function ajustar(texto, ancho, relleno = ' ') {
  const w = anchoVisual(texto)
  if (w === ancho) return texto
  if (w < ancho) return texto + relleno.repeat(ancho - w)
  const cortado = truncar(texto, ancho, { elipsis: '' })
  return rellenarDerecha(cortado, ancho)
}

/** Linea de contenido dentro de la caja: borde + margen + interior + margen + borde. */
function lineaCaja(ctx, celdas, tinteBorde) {
  const v = tenir(ctx.chars.frame.v, tinteBorde, ctx.color)
  return `${v} ${fila(celdas, ctx.interior, ctx)} ${v}`
}

function lineaVacia(ctx, tinteBorde) {
  const v = tenir(ctx.chars.frame.v, tinteBorde, ctx.color)
  return `${v}${' '.repeat(Math.max(0, ctx.cols - 2))}${v}`
}

/** Linea plana (sin caja) de ancho exacto. */
function lineaPlana(ctx, texto, tinte) {
  const plano = rellenarDerecha(truncar(String(texto ?? ''), ctx.cols, { elipsis: ctx.elipsis }), ctx.cols)
  return tenir(plano, tinte, ctx.color)
}

/**
 * Borde horizontal con titulo a la izquierda y texto opcional a la derecha:
 * `┌─ TITULO ─────────── extra ─┐`. Se tine la linea completa (el color no cambia el ancho).
 */
function regla(ctx, izq, der, titulo, extra, tinte) {
  const h = ctx.chars.frame.h
  const interno = Math.max(0, ctx.cols - 2)

  const t = titulo ? truncar(sanearCelda(titulo), Math.max(0, interno - 6), { elipsis: ctx.elipsis }) : ''
  const prefijo = h + (t ? ` ${t} ` : '')

  let ex = ''
  if (extra) {
    const hueco = interno - anchoVisual(prefijo) - 5
    if (hueco >= 6) ex = truncar(sanearCelda(extra), hueco, { elipsis: ctx.elipsis })
  }
  const sufijo = ex ? ` ${ex} ${h}` : ''

  const relleno = Math.max(0, interno - anchoVisual(prefijo) - anchoVisual(sufijo))
  const cuerpo = ajustar(prefijo + h.repeat(relleno) + sufijo, interno, h)
  return tenir(izq + cuerpo + der, tinte, ctx.color)
}

/**
 * Igual que regla(), pero con un tercer texto CENTRADO en el tramo de relleno
 * entre el titulo (izquierda) y el extra (derecha): usada en la barra
 * superior del panel para poner "CUENTAS" a la izquierda y "souclaude
 * monitor" centrado en la misma linea (ver renderFull).
 */
function reglaConCentro(ctx, izq, der, titulo, centro, extra, tinte) {
  const h = ctx.chars.frame.h
  const interno = Math.max(0, ctx.cols - 2)

  const t = titulo ? truncar(sanearCelda(titulo), Math.max(0, interno - 6), { elipsis: ctx.elipsis }) : ''
  const prefijo = h + (t ? ` ${t} ` : '')

  let ex = ''
  if (extra) {
    const hueco = interno - anchoVisual(prefijo) - 5
    if (hueco >= 6) ex = truncar(sanearCelda(extra), hueco, { elipsis: ctx.elipsis })
  }
  const sufijo = ex ? ` ${ex} ${h}` : ''

  const huecoTotal = Math.max(0, interno - anchoVisual(prefijo) - anchoVisual(sufijo))

  const c = centro ? truncar(sanearCelda(centro), Math.max(0, huecoTotal - 2), { elipsis: ctx.elipsis }) : ''
  const bloqueCentro = c ? ` ${c} ` : ''
  const anchoCentro = anchoVisual(bloqueCentro)

  // El centro solo entra si deja al menos 1 caracter de linea a cada lado; si
  // no hay hueco (terminal muy angosta), se degrada a la regla sin centro.
  if (anchoCentro + 2 > huecoTotal) {
    const cuerpo = ajustar(prefijo + h.repeat(huecoTotal) + sufijo, interno, h)
    return tenir(izq + cuerpo + der, tinte, ctx.color)
  }

  const izqRelleno = Math.floor((huecoTotal - anchoCentro) / 2)
  const derRelleno = huecoTotal - anchoCentro - izqRelleno
  const cuerpo = ajustar(prefijo + h.repeat(izqRelleno) + bloqueCentro + h.repeat(derRelleno) + sufijo, interno, h)
  return tenir(izq + cuerpo + der, tinte, ctx.color)
}

// --- helpers de datos ---

function num(v) {
  return Number.isFinite(v) ? v : 0
}

function texto(v, alterno = '') {
  const s = sanearCelda(typeof v === 'string' ? v : '')
  return s || alterno
}

function pctTexto(p) {
  if (!Number.isFinite(p)) return '-'
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`
  return `${Math.round(p)}%`
}

function limitesOrdenados(vista) {
  const lista = Array.isArray(vista?.limites) ? vista.limites : []
  // El peor caso siempre arriba: severidad descendente, no por tipo de ventana.
  return lista
    .filter((l) => l && Number.isFinite(l.porcentaje))
    .slice()
    .sort((a, b) => b.porcentaje - a.porcentaje)
}

// Filas del header de barras: con una sola cuenta, identico a limitesOrdenados
// (solo la cuenta local). Con SOUCLAUDE_LOCAL_ACCOUNTS o Vault activos, un
// bloque de filas por cada cuenta con datos, con el alias antepuesto a la
// etiqueta ("dev 5h", "dev_claude 5h") para no confundir a que cuenta
// pertenece cada barra. El titulo del panel y la alarma (limiteEnAlarma)
// siguen mirando SOLO limitesOrdenados/la cuenta local: no tiene sentido que
// el titulo grite LIMITE por el consumo de otra cuenta.
function limitesParaHeader(vista) {
  const porCuenta = Array.isArray(vista?.limitesPorCuenta) ? vista.limitesPorCuenta : []
  if (porCuenta.length <= 1) return limitesOrdenados(vista)

  const filas = []
  for (const bloque of porCuenta) {
    for (const l of bloque.filas) {
      filas.push({ ...l, etiqueta: `${bloque.alias} ${l.etiqueta}` })
    }
  }
  return filas
}

function textoReset(ctx, limite) {
  const partes = []
  if (limite.reset) partes.push(texto(limite.reset))
  if (Number.isFinite(limite.reseteaEn)) partes.push(fmtRelativo(limite.reseteaEn, ctx.ahora))
  return partes.join('  ')
}

function agentesOrdenados(vista) {
  const orden = { corriendo: 0, en_duda: 1, terminado: 2 }
  const filas = Array.isArray(vista?.agentes?.filas) ? vista.agentes.filas : []
  return filas
    .filter(Boolean)
    .slice()
    .sort((a, b) => (orden[a.estado] ?? 3) - (orden[b.estado] ?? 3) || num(b.tokens) - num(a.tokens))
}

function glifoEstado(ctx, estado) {
  const s = ctx.chars.status
  if (estado === 'corriendo') return { glifo: s.running, tinte: 'green' }
  if (estado === 'en_duda') return { glifo: s.unsure, tinte: 'yellow' }
  return { glifo: s.done, tinte: 'dim' }
}

// --- header de limites ---

function lineasLimites(ctx, limites, { multiCuenta = false } = {}) {
  const interior = ctx.interior
  // Con multiples cuentas la etiqueta lleva el alias antepuesto ("dev_claude
  // Ventana 5h"): el cap normal (18) trunca eso a "dev_claude Vent...", asi
  // que el techo sube para dejar entrar alias + "Ventana Nh" completos.
  const topeEtiqueta = multiCuenta ? 28 : 18
  const proporcion = multiCuenta ? 0.28 : 0.2
  const anchoEtiqueta = Math.max(9, Math.min(topeEtiqueta, Math.floor(interior * proporcion)))
  const anchoBarra = Math.max(6, Math.min(32, Math.floor(interior * 0.34)))
  const fijos = anchoEtiqueta + anchoBarra + 4 + 2
  const anchoResto = Math.max(0, interior - fijos - 4)

  return limites.map((l) => {
    const sev = severidad(l.porcentaje)
    const tinte = tinteDeNivel(sev.nivel)
    const b = barra(l.porcentaje, anchoBarra, {
      lleno: ctx.chars.bar.full,
      vacio: ctx.chars.bar.empty,
    })
    const celdas = [
      { texto: texto(l.etiqueta, texto(l.modelo, 'limite')), ancho: anchoEtiqueta },
      { texto: b, ancho: anchoBarra, tinte },
      { texto: pctTexto(l.porcentaje), ancho: 4, alinear: 'd', tinte },
      { texto: sev.marca, ancho: 2, tinte },
    ]
    if (anchoResto > 0) celdas.push({ texto: textoReset(ctx, l), ancho: RESTO, tinte: 'dim' })
    return lineaCaja(ctx, celdas, ctx.tinteMarco)
  })
}

// --- historico (SHS-H3-T105) ---

// Fuera de `limites`, ninguna fila entra al calculo de severidad (limiteEnAlarma)
// ni al titulo (tituloPanel): un extra ya archivado no es informacion accionable.
function lineasHistorico(ctx, historico) {
  const lista = Array.isArray(historico) ? historico.filter((h) => typeof h === 'string' && h !== '') : []
  if (lista.length === 0) return []

  const lineas = [regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, 'HISTORICO', '', ctx.tinteMarco)]
  for (const linea of lista) {
    lineas.push(lineaCaja(ctx, [{ texto: linea, ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco))
  }
  return lineas
}

function limiteEnAlarma(limites) {
  const peor = limites[0]
  if (!peor || peor.porcentaje < UMBRAL_ALARMA) return null
  return peor
}

function tituloPanel(limites, cuenta) {
  // El alias identifica la cuenta local cuando el equipo maneja mas de una.
  const base = cuenta?.alias ? `souclaude monitor · ${cuenta.alias}` : 'souclaude monitor'
  const alarma = limiteEnAlarma(limites)
  if (!alarma) return base
  const quien = texto(alarma.modelo, texto(alarma.etiqueta, ''))
  return `${base}  LIMITE ${pctTexto(alarma.porcentaje)}${quien ? ` ${quien}` : ''}`
}

// --- secciones ---

function seccionAhora(ctx, vista) {
  const agentes = agentesOrdenados(vista)
  const corriendo = agentes.filter((a) => a.estado === 'corriendo' || a.estado === 'en_duda')
  const terminados = agentes.length - corriendo.length
  const sep = ctx.chars.separator

  const titulo = 'AHORA'
  const extra = [
    `${corriendo.length} corriendo`,
    terminados > 0 ? `${terminados} recien terminado${terminados === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(` ${sep} `)

  const anchos = anchosAgentes(ctx.interior)

  function cabecera() {
    return lineaCaja(
      ctx,
      [
        { texto: '', ancho: 1 },
        { texto: 'AGENTE', ancho: anchos.nombre, tinte: 'dim' },
        anchos.proyecto ? { texto: 'PROYECTO', ancho: anchos.proyecto, tinte: 'dim' } : null,
        anchos.modelo ? { texto: 'MODELO', ancho: anchos.modelo, tinte: 'dim' } : null,
        { texto: 'TOKENS', ancho: anchos.tokens, alinear: 'd', tinte: 'dim' },
        { texto: 'DUR', ancho: anchos.dur, alinear: 'd', tinte: 'dim' },
        anchos.tools ? { texto: 'TOOLS', ancho: anchos.tools, alinear: 'd', tinte: 'dim' } : null,
        { texto: 'SESION', ancho: RESTO, tinte: 'dim' },
      ],
      ctx.tinteMarco
    )
  }

  function filaAgente(a) {
    const est = glifoEstado(ctx, a.estado)
    const terminado = a.estado === 'terminado'
    const detalle = terminado && Number.isFinite(a.finEn)
      ? `(fin ${fmtRelativo(a.finEn, ctx.ahora)})`
      : texto(a.sesionTitulo)
    const sesion = `${texto(a.sesionId)} ${detalle}`.trim()
    return lineaCaja(
      ctx,
      [
        { texto: est.glifo, ancho: 1, tinte: est.tinte },
        { texto: texto(a.nombre, '?'), ancho: anchos.nombre, tinte: terminado ? 'dim' : null },
        anchos.proyecto ? { texto: texto(a.proyecto), ancho: anchos.proyecto, tinte: 'dim' } : null,
        anchos.modelo ? { texto: texto(a.modelo), ancho: anchos.modelo } : null,
        { texto: fmtTokens(num(a.tokens)), ancho: anchos.tokens, alinear: 'd' },
        { texto: fmtDuracion(num(a.duracionMs)), ancho: anchos.dur, alinear: 'd' },
        anchos.tools
          ? { texto: String(num(a.tools)), ancho: anchos.tools, alinear: 'd', tinte: 'dim' }
          : null,
        { texto: sesion, ancho: RESTO, tinte: 'dim' },
      ],
      ctx.tinteMarco
    )
  }

  function colapsada() {
    const tokens = agentes.reduce((acc, a) => acc + num(a.tokens), 0)
    const proyectos = new Set(agentes.map((a) => texto(a.proyecto)).filter(Boolean)).size
    const t = `${ctx.chars.status.running} ${corriendo.length} agentes corriendo ${sep} ${fmtTokens(tokens)} tokens ${sep} ${proyectos} proyectos`
    return lineaCaja(ctx, [{ texto: t, ancho: RESTO }], ctx.tinteMarco)
  }

  return {
    id: 'ahora',
    min: 2,
    max: agentes.length > 0 ? 2 + agentes.length : 2,
    // Tamanos utiles discretos: o la linea colapsada, o al menos todos los corriendo.
    // Un tamano intermedio recortaria agentes vivos, que es justo lo que no se hace.
    siguiente(n) {
      return n <= 2 ? Math.max(3, 2 + corriendo.length) : n + 1
    },
    build(n) {
      const lineas = [regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, titulo, extra, ctx.tinteMarco)]
      if (agentes.length === 0) {
        lineas.push(lineaCaja(ctx, [{ texto: 'sin agentes activos', ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco))
        return lineas
      }
      const huecos = n - 2 // descuenta regla + cabecera
      // Los agentes corriendo no se recortan nunca: si no entran todos, se colapsa.
      if (huecos < corriendo.length || huecos < 1) {
        lineas.push(colapsada())
        return lineas
      }
      lineas.push(cabecera())
      // Los terminados caen primero.
      const visibles = [...corriendo, ...agentes.filter((a) => a.estado === 'terminado')].slice(0, huecos)
      for (const a of visibles) lineas.push(filaAgente(a))
      return lineas
    },
  }
}

function anchosAgentes(interior) {
  if (interior >= 90) {
    return { nombre: 12, proyecto: 12, modelo: 8, tokens: 8, dur: 6, tools: 5 }
  }
  if (interior >= 72) {
    return { nombre: 12, proyecto: 11, modelo: 7, tokens: 8, dur: 6, tools: 0 }
  }
  return { nombre: 11, proyecto: 0, modelo: 0, tokens: 7, dur: 6, tools: 0 }
}

function seccionConsumo(ctx, vista) {
  const c = vista?.consumo ?? {}
  const serie = Array.isArray(c.serie) ? c.serie.map(num) : []
  const sep = ctx.chars.separator
  const titulo = 'CONSUMO'
  const extra = texto(c.etiquetaVentana, 'ultimas 24 h')

  return {
    id: 'consumo',
    min: 2,
    max: 2, // indivisible: entra entera o se cae
    build() {
      const etiqueta = texto(c.unidad, 'tokens/h')
      const sufijo = [
        Number.isFinite(c.picoValor)
          ? `pico ${fmtTokens(c.picoValor)}${c.picoEtiqueta ? ` a las ${texto(c.picoEtiqueta)}` : ''}`
          : null,
        Number.isFinite(c.totalTokens) ? `total ${fmtTokens(c.totalTokens)}` : null,
        Number.isFinite(c.costoUsd) ? fmtDinero(c.costoUsd) : null,
      ]
        .filter(Boolean)
        .join(`   `)

      const anchoEtiqueta = anchoVisual(etiqueta)
      const hueco = Math.max(0, ctx.interior - anchoEtiqueta - 2)
      // El sparkline no se rellena con vacio: ocupa exactamente los valores que muestra
      // y el resto del ancho queda para el sufijo (pico/total/costo).
      const paraSufijo = Math.max(0, Math.min(anchoVisual(sufijo), hueco - 8))
      const anchoSpark = Math.max(0, Math.min(serie.length, hueco - paraSufijo))
      const recorte = anchoSpark > 0 ? serie.slice(-anchoSpark) : []
      const spark = sparkline(recorte, { glifos: ctx.chars.sparkline })

      return [
        regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, titulo, extra, ctx.tinteMarco),
        lineaCaja(
          ctx,
          [
            { texto: etiqueta, ancho: anchoEtiqueta, tinte: 'dim' },
            { texto: spark, ancho: anchoSpark, tinte: 'cyan' },
            { texto: sufijo, ancho: RESTO, tinte: 'dim' },
          ],
          ctx.tinteMarco
        ),
      ]
    },
  }
}

// Ancho minimo de columna para que dos cuentas quepan lado a lado con barras
// legibles (alias + costo + un par de filas de limite con barra visible). Por
// debajo de esto, se apilan verticalmente.
const ANCHO_MIN_COLUMNA_CUENTA = 34

// Seccion CUENTAS: el titulo "CUENTAS" y el grafico de barras (antes header
// aparte) viven ahora en la barra superior del panel (ver renderFull); esta
// seccion arranca directo con el contenido. Cada cuenta arma su propio bloque
// de FILAS DE CELDAS (cabecera con alias/costo + una fila por limite con
// datos: Ventana 7d/5h, Fable solo en la local, Extra si aplica), sin bordes
// propios -- los bordes de caja los pone UNA SOLA VEZ este build() por linea
// de pantalla. Nunca lineaCaja() anidado: fila() trunca con
// str.replace(REGEX_ANSI,'') antes de colorear, asi que colorear una caja y
// despues reinyectarla como celda de OTRA fila() le borraria el color (ver
// mismo problema ya resuelto en seccionDesglose, dosColumnas). Con
// exactamente 2 cuentas y espacio suficiente, los dos bloques se arman a
// mitad de ancho y sus celdas se concatenan en la misma fila, SIN separador
// visible entre ambas mitades. Con 1, 3+ cuentas o poco ancho, cada bloque
// usa el interior completo y se apilan verticalmente.
function seccionCuentas(ctx, vista) {
  const resumenes = Array.isArray(vista?.cuentas?.filas) ? vista.cuentas.filas : []
  const porAlias = new Map(
    (Array.isArray(vista?.limitesPorCuenta) ? vista.limitesPorCuenta : []).map((b) => [b.alias, b.filas])
  )

  const anchoMitad = Math.floor(ctx.interior / 2)
  const ladoALado = resumenes.length === 2 && anchoMitad >= ANCHO_MIN_COLUMNA_CUENTA

  const filasDeCeldas = ladoALado
    ? combinarLadoALado(ctx, resumenes, porAlias, anchoMitad)
    : resumenes.flatMap((f) => bloqueDeCuenta(ctx, f, porAlias.get(f.alias) ?? [], ctx.interior, true))

  return {
    id: 'cuentas',
    min: Math.min(1, filasDeCeldas.length),
    max: Math.max(1, filasDeCeldas.length),
    build(n) {
      if (filasDeCeldas.length === 0) {
        return [lineaCaja(ctx, [{ texto: 'sin cuentas', ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco)]
      }
      return filasDeCeldas.slice(0, n).map((celdas) => lineaCaja(ctx, celdas, ctx.tinteMarco))
    },
  }
}

// Arma las FILAS DE CELDAS (no strings, no lineaCaja) de una cuenta: cabecera
// (alias + costo, sin maquina/frescura -- con SOUCLAUDE_LOCAL_ACCOUNTS esos
// datos son ruido: misma maquina, "ahora" siempre) + una fila por limite con
// datos, cada una sumando exactamente `ancho` (mas separadores de fila()).
//
// `soloRest` distingue los dos casos de uso: cuando el bloque ocupa una
// columna COMPLETA (apilado, `soloRest: true`) la ultima celda es RESTO y
// fila() le da todo el sobrante real. Cuando el bloque comparte fila con
// otro (lado a lado, `soloRest: false`) NO puede usar RESTO -- fila() solo
// resuelve la PRIMERA celda RESTO que encuentra en toda la fila combinada, y
// la segunda mitad quedaria con ancho 0 (ver comentario en fila()) -- asi
// que cada celda de relleno recibe un ancho NUMERICO fijo, calculado contra
// el `ancho` de esa mitad.
function bloqueDeCuenta(ctx, f, filasLimite, ancho, soloRest = false) {
  const apagado = f.vieja ? 'dim' : null
  // El offset de textoReset en celdasLimiteDeCuenta (etiqueta + barra + 5 + 2,
  // mas separadores entre celdas) para que "en uso" quede alineado justo
  // arriba de "en 3d 12h" en vez de pegado al alias. Sin margen inicial: el
  // alias y "Ventana 7d" arrancan las dos en la misma columna 0.
  const anchoEtiqueta = Math.max(9, Math.min(16, Math.floor(ancho * 0.22)))
  const anchoBarra = Math.max(4, Math.min(28, Math.floor(ancho * 0.32)))
  const offsetReset = anchoEtiqueta + anchoBarra + 5 + 2 + 3
  const anchoRellenoCabecera = Math.max(0, offsetReset - (16 + 1 + 20 + 1))
  const anchoFinCabecera = soloRest ? RESTO : Math.max(0, ancho - offsetReset)

  const cabecera = [
    { texto: texto(f.alias, '?'), ancho: 16, tinte: apagado ?? (f.esLocal ? 'bold' : null) },
    { texto: f.hayActividad ? 'en uso' : '', ancho: 20, alinear: 'd', tinte: apagado ?? 'cyan' },
    { texto: '', ancho: anchoRellenoCabecera },
    { texto: f.costoUsd != null ? fmtDinero(f.costoUsd) : '', ancho: anchoFinCabecera, alinear: 'i', tinte: apagado },
  ]

  const filas = filasLimite.map((l) => celdasLimiteDeCuenta(ctx, l, apagado, ancho, soloRest))
  return [cabecera, ...filas]
}

// Celdas de una fila de limite (Ventana 7d/5h, Fable, Extra) dentro del
// bloque de una cuenta, con barra proporcional al ANCHO recibido (interior
// completo o mitad, segun si la cuenta comparte fila con otra). El texto de
// reset (`textoReset`) recibe ancho FIJO cuando `soloRest` es false, por la
// misma razon que la celda de relleno de la cabecera (ver bloqueDeCuenta).
// Sin margen inicial: la etiqueta arranca en la columna 0, alineada con el
// alias de la cabecera (a la izquierda, sin indentacion).
function celdasLimiteDeCuenta(ctx, l, apagadoForzado, ancho, soloRest) {
  const sev = severidad(l.porcentaje)
  const tinte = apagadoForzado ?? tinteDeNivel(sev.nivel)
  const anchoEtiqueta = Math.max(9, Math.min(16, Math.floor(ancho * 0.22)))
  const anchoBarra = Math.max(4, Math.min(28, Math.floor(ancho * 0.32)))
  const b = barra(l.porcentaje, anchoBarra, { lleno: ctx.chars.bar.full, vacio: ctx.chars.bar.empty })
  const anchoFijos = anchoEtiqueta + anchoBarra + 5 + 2 + 3 // 3 separadores entre 4 celdas + la de reset
  const anchoReset = soloRest ? RESTO : Math.max(0, ancho - anchoFijos)

  return [
    { texto: texto(l.etiqueta, texto(l.modelo, 'limite')), ancho: anchoEtiqueta, tinte: apagadoForzado ?? 'dim' },
    { texto: b, ancho: anchoBarra, tinte },
    { texto: pctTexto(l.porcentaje), ancho: 5, alinear: 'd', tinte },
    { texto: sev.marca, ancho: 2, tinte },
    { texto: textoReset(ctx, l), ancho: anchoReset, tinte: 'dim' },
  ]
}

// Arma los bloques de las 2 cuentas a mitad de ancho cada uno (celdas puras,
// con anchos NUMERICOS fijos -- ver bloqueDeCuenta/celdasLimiteDeCuenta,
// soloRest: false) y concatena las celdas de izquierda + derecha en una
// unica fila que build() convierte a linea con UN lineaCaja. Sin separador
// visible entre las dos mitades: cada bloque ya suma exactamente anchoMitad
// en celdas fijas. Si un bloque tiene menos filas que el otro, el lado corto
// se completa con una celda vacia del mismo ancho (no se repiten datos de la
// cuenta mas chica ni se desalinea la fila).
function combinarLadoALado(ctx, resumenes, porAlias, anchoMitad) {
  const bloques = resumenes.map((f) => bloqueDeCuenta(ctx, f, porAlias.get(f.alias) ?? [], anchoMitad, false))
  const alto = Math.max(...bloques.map((b) => b.length), 0)
  const vacia = [{ texto: '', ancho: anchoMitad }]

  const filas = []
  for (let i = 0; i < alto; i++) {
    const izq = bloques[0]?.[i] ?? vacia
    const der = bloques[1]?.[i] ?? vacia
    filas.push([...izq, ...der])
  }
  return filas
}

// Mismos umbrales que el header (85/95), pero sin marca: aca el color alcanza.
function tinteDePct(p) {
  if (!Number.isFinite(p)) return 'dim'
  return tinteDeNivel(severidad(p).nivel)
}

function seccionDesglose(ctx, vista) {
  const d = vista?.desglose ?? {}
  const tokens = [
    { nombre: 'cache_read', valor: num(d.cacheLectura), propia: true },
    { nombre: 'cache_creation', valor: num(d.cacheCreacion) },
    { nombre: 'input', valor: num(d.entrada) },
    { nombre: 'output', valor: num(d.salida) },
  ]
  const totalTokens = tokens.reduce((a, t) => a + t.valor, 0)
  // Escala doble: cache_read suele ser 10-50x el resto. Normalizar los cuatro contra
  // el mismo maximo dejaria las otras tres barras invisibles. cache_read ocupa la barra
  // entera con el glifo `lleno`; los otros tres se normalizan contra su propio maximo
  // y se pintan con el glifo `medio` — glifo distinto = escala distinta, y el titulo lo declara.
  const maxResto = Math.max(...tokens.filter((t) => !t.propia).map((t) => t.valor), 0)

  const modelos = (Array.isArray(vista?.modelos) ? vista.modelos : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => num(b.tokens) - num(a.tokens))
  const totalModelos = modelos.reduce((a, m) => a + num(m.costoUsd), 0)

  const dosColumnas = ctx.interior >= 96 && modelos.length > 0
  const nModelos = Math.min(4, modelos.length)

  function filaToken(t, anchoBarra, anchoNombre, anchoValor) {
    const pct = totalTokens > 0 ? (t.valor / totalTokens) * 100 : 0
    const b = t.propia
      ? ctx.chars.bar.full.repeat(anchoBarra)
      : barra(maxResto > 0 ? (t.valor / maxResto) * 100 : 0, anchoBarra, {
          lleno: ctx.chars.bar.half,
          vacio: ctx.chars.bar.empty,
        })
    return [
      { texto: t.nombre, ancho: anchoNombre },
      { texto: fmtTokens(t.valor), ancho: anchoValor, alinear: 'd' },
      { texto: b, ancho: anchoBarra, tinte: t.propia ? 'cyan' : null },
      { texto: pctTexto(pct), ancho: 4, alinear: 'd', tinte: 'dim' },
    ]
  }

  // El % de la columna de modelos es share de COSTO (la columna vecina es $),
  // no de tokens: mezclarlos haria que la barra contradiga el numero de al lado.
  function filaModelo(m, anchoBarra, anchoNombre) {
    const pct = totalModelos > 0 ? (num(m.costoUsd) / totalModelos) * 100 : 0
    return [
      { texto: texto(m.nombre, '?'), ancho: anchoNombre },
      { texto: fmtTokens(num(m.tokens)), ancho: 6, alinear: 'd' },
      { texto: fmtDinero(num(m.costoUsd)), ancho: 7, alinear: 'd' },
      {
        texto: barra(pct, anchoBarra, { lleno: ctx.chars.bar.full, vacio: ctx.chars.bar.empty }),
        ancho: anchoBarra,
      },
      { texto: pctTexto(pct), ancho: 4, alinear: 'd', tinte: 'dim' },
    ]
  }

  const maxLineas = dosColumnas ? 1 + 4 : 1 + 4 + nModelos

  return {
    id: 'desglose',
    min: 5,
    max: maxLineas,
    build(n) {
      const lineas = [
        regla(
          ctx,
          ctx.chars.frame.ml,
          ctx.chars.frame.mr,
          'DESGLOSE',
          '(cache_read en escala propia)',
          ctx.tinteMarco
        ),
      ]
      const huecos = n - 1

      if (dosColumnas) {
        // Una sola fila con las celdas de ambas mitades: anidar filas obligaria a
        // truncar texto ya coloreado, y truncar() devuelve el texto sin ANSI.
        const vacias = [
          { texto: '', ancho: 7 },
          { texto: '', ancho: 6 },
          { texto: '', ancho: 7 },
          { texto: '', ancho: 12 },
          { texto: '', ancho: 4 },
        ]
        for (let i = 0; i < Math.min(4, huecos); i++) {
          const m = modelos[i]
          lineas.push(
            lineaCaja(
              ctx,
              [
                ...filaToken(tokens[i], 18, 15, 7),
                { texto: '', ancho: 2 },
                ...(m ? filaModelo(m, 12, 7) : vacias),
                { texto: '', ancho: RESTO },
              ],
              ctx.tinteMarco
            )
          )
        }
        return lineas
      }

      // Apilado: primero los cuatro tipos de token, despues los modelos si sobra sitio.
      const anchoBarra = Math.max(6, Math.min(18, ctx.interior - 34))
      let usados = 0
      for (let i = 0; i < 4 && usados < huecos; i++, usados++) {
        lineas.push(lineaCaja(ctx, [...filaToken(tokens[i], anchoBarra, 15, 7), { texto: '', ancho: RESTO }], ctx.tinteMarco))
      }
      for (let i = 0; i < nModelos && usados < huecos; i++, usados++) {
        lineas.push(
          lineaCaja(ctx, [...filaModelo(modelos[i], anchoBarra, 8), { texto: '', ancho: RESTO }], ctx.tinteMarco)
        )
      }
      return lineas
    },
  }
}

function seccionSesiones(ctx, vista) {
  const s = vista?.sesiones ?? {}
  const filas = Array.isArray(s.filas) ? s.filas.filter(Boolean) : []
  const total = Number.isFinite(s.total) ? s.total : filas.length
  const vivas = Number.isFinite(s.vivas) ? s.vivas : null
  const sep = ctx.chars.separator
  const recortadas = num(vista?.recortes?.sesiones)

  // La columna CUENTA siempre se muestra (aunque todas las sesiones sean de
  // la misma cuenta): identifica de quien es cada fila sin depender de que
  // haya SOUCLAUDE_LOCAL_ACCOUNTS configurado.
  const anchos = anchosSesiones(ctx.interior, true)

  function cabecera() {
    return lineaCaja(
      ctx,
      [
        { texto: 'ID', ancho: anchos.id, tinte: 'dim' },
        { texto: 'TITULO', ancho: RESTO, tinte: 'dim' },
        anchos.cuenta ? { texto: 'CUENTA', ancho: anchos.cuenta, tinte: 'dim' } : null,
        anchos.proyecto ? { texto: 'PROYECTO', ancho: anchos.proyecto, tinte: 'dim' } : null,
        anchos.rama ? { texto: 'RAMA', ancho: anchos.rama, tinte: 'dim' } : null,
        anchos.modelo ? { texto: 'MOD', ancho: anchos.modelo, tinte: 'dim' } : null,
        { texto: 'TOKENS', ancho: anchos.tokens, alinear: 'd', tinte: 'dim' },
        anchos.costo ? { texto: 'COSTO', ancho: anchos.costo, alinear: 'd', tinte: 'dim' } : null,
        { texto: 'DUR', ancho: anchos.dur, alinear: 'd', tinte: 'dim' },
      ],
      ctx.tinteMarco
    )
  }

  function filaSesion(x) {
    const dur = Number.isFinite(x.duracionMs) ? fmtDuracionMin(x.duracionMs) : '-'
    return lineaCaja(
      ctx,
      [
        { texto: texto(x.id), ancho: anchos.id, tinte: 'cyan' },
        { texto: texto(x.titulo, '(sin titulo)'), ancho: RESTO },
        anchos.cuenta ? { texto: texto(x.cuenta, '?'), ancho: anchos.cuenta, tinte: 'dim' } : null,
        anchos.proyecto ? { texto: texto(x.proyecto), ancho: anchos.proyecto, tinte: 'dim' } : null,
        anchos.rama ? { texto: texto(x.rama), ancho: anchos.rama, tinte: 'dim' } : null,
        anchos.modelo ? { texto: texto(x.modelo), ancho: anchos.modelo } : null,
        { texto: fmtTokens(num(x.tokens)), ancho: anchos.tokens, alinear: 'd' },
        anchos.costo
          ? { texto: fmtDinero(num(x.costoUsd)), ancho: anchos.costo, alinear: 'd' }
          : null,
        { texto: dur, ancho: anchos.dur, alinear: 'd', tinte: 'dim' },
      ],
      ctx.tinteMarco
    )
  }

  const extra = [
    `${total} totales`,
    vivas !== null ? `${vivas} vivas` : null,
  ]
    .filter(Boolean)
    .join(` ${sep} `)

  return {
    id: 'sesiones',
    min: 3,
    max: 2 + filas.length + (recortadas > 0 ? 1 : 0),
    build(n) {
      const lineas = [regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, 'SESIONES', extra, ctx.tinteMarco)]
      const huecos = Math.max(0, n - 2)
      if (huecos === 0 || filas.length === 0) {
        lineas.push(lineaCaja(ctx, [{ texto: 'sin sesiones', ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco))
        return lineas
      }
      lineas.push(cabecera())

      // La linea "y N mas" existe siempre que quede algo fuera: si el usuario no sabe
      // que hay sesiones ocultas, el panel le esta mintiendo sobre su consumo.
      let mostrar = Math.min(filas.length, huecos)
      let ocultas = filas.length - mostrar + recortadas
      if (ocultas > 0 && mostrar === huecos && mostrar > 1) {
        mostrar -= 1
        ocultas = filas.length - mostrar + recortadas
      }
      for (const x of filas.slice(0, mostrar)) lineas.push(filaSesion(x))
      if (ocultas > 0 && lineas.length < n + 1) {
        lineas.push(
          lineaCaja(
            ctx,
            [
              { texto: '', ancho: 4 },
              { texto: `${ctx.chars.ellipsis} y ${ocultas} ${ocultas === 1 ? 'sesion' : 'sesiones'} mas`, ancho: RESTO, tinte: 'dim' },
            ],
            ctx.tinteMarco
          )
        )
      }
      return lineas
    },
  }
}

// PROYECTO y RAMA son las columnas mas utiles para distinguir sesiones y las
// que mas sufren truncadas; en terminales anchas (pantalla completa) se les
// da todo el espacio que sobra en vez de dejarlo sin usar en TITULO. ACT se
// reemplazo por DUR (cuanto lleva corriendo la sesion, ver
// panel-presenter.js::duracionDeSesion): interesa mas que "hace cuanto
// escribio por ultima vez".
function anchosSesiones(interior, conCuenta) {
  const cuenta = conCuenta ? 9 : 0
  // En pantalla ancha sobra espacio: CUENTA crece a 12 para que alias como
  // "dev_claude" (10) no se corten en "dev_cl...".
  if (interior >= 140) return { id: 4, cuenta: conCuenta ? 12 : 0, proyecto: 22, rama: 26, modelo: 6, tokens: 7, costo: 6, dur: 6 }
  if (interior >= 110) return { id: 4, cuenta, proyecto: 16, rama: 20, modelo: 6, tokens: 7, costo: 6, dur: 6 }
  if (interior >= 92) return { id: 4, cuenta, proyecto: 11, rama: 15, modelo: 6, tokens: 7, costo: 6, dur: 6 }
  if (interior >= 72) return { id: 4, cuenta, proyecto: 11, rama: 0, modelo: 6, tokens: 7, costo: 6, dur: 6 }
  return { id: 4, cuenta: conCuenta ? 7 : 0, proyecto: 0, rama: 0, modelo: 0, tokens: 7, costo: 0, dur: 6 }
}

function seccionProyectos(ctx, vista) {
  const p = vista?.proyectos ?? {}
  const filas = Array.isArray(p.filas) ? p.filas.filter(Boolean) : []
  const otrosVista = p.otros ?? null
  const recortados = num(vista?.recortes?.proyectos) || num(otrosVista?.cantidad)
  const total = Number.isFinite(p.total) ? p.total : filas.length + recortados
  const totalTokens =
    Number.isFinite(p.totalTokens) && p.totalTokens > 0
      ? p.totalTokens
      : filas.reduce((a, x) => a + num(x.tokens), 0) + num(otrosVista?.tokens)

  const anchoNombre = ctx.interior >= 90 ? 17 : 14
  const anchoBarra = Math.max(6, Math.min(26, ctx.interior - anchoNombre - 32))

  function filaProyecto(x, tinte) {
    const pct = totalTokens > 0 ? (num(x.tokens) / totalTokens) * 100 : 0
    return lineaCaja(
      ctx,
      [
        { texto: texto(x.nombre, '?'), ancho: anchoNombre, tinte },
        { texto: `${num(x.sesiones)} ses`, ancho: 7, alinear: 'd', tinte: 'dim' },
        { texto: fmtTokens(num(x.tokens)), ancho: 8, alinear: 'd' },
        { texto: fmtDinero(num(x.costoUsd)), ancho: 7, alinear: 'd' },
        { texto: pctTexto(pct), ancho: 4, alinear: 'd', tinte: 'dim' },
        {
          texto: barra(pct, anchoBarra, { lleno: ctx.chars.bar.full, vacio: ctx.chars.bar.empty }),
          ancho: anchoBarra,
        },
        { texto: '', ancho: RESTO },
      ],
      ctx.tinteMarco
    )
  }

  return {
    id: 'proyectos',
    min: 3,
    max: 1 + filas.length + (recortados > 0 ? 1 : 0),
    build(n) {
      const huecos = Math.max(1, n - 1)
      let mostrar = Math.min(filas.length, huecos)
      let sobrantes = filas.slice(mostrar)
      // Los que no entran se agregan en una fila real `otros (N)`: asi los porcentajes
      // siguen sumando 100 y el consumo oculto no desaparece del panel.
      const hayOtros = sobrantes.length > 0 || recortados > 0
      if (hayOtros && mostrar === huecos && mostrar > 1) {
        mostrar -= 1
        sobrantes = filas.slice(mostrar)
      }

      const extra = recortados > 0 || sobrantes.length > 0 ? `top ${mostrar} de ${total}` : `${total} en total`
      const lineas = [regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, 'PROYECTOS', extra, ctx.tinteMarco)]

      if (filas.length === 0) {
        lineas.push(lineaCaja(ctx, [{ texto: 'sin proyectos', ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco))
        return lineas
      }

      for (const x of filas.slice(0, mostrar)) lineas.push(filaProyecto(x))

      if (hayOtros && lineas.length < n + 1) {
        const cantidad = sobrantes.length + recortados
        const agregado = {
          nombre: `otros (${cantidad})`,
          sesiones: sobrantes.reduce((a, x) => a + num(x.sesiones), 0) + num(otrosVista?.sesiones),
          tokens: sobrantes.reduce((a, x) => a + num(x.tokens), 0) + num(otrosVista?.tokens),
          costoUsd: sobrantes.reduce((a, x) => a + num(x.costoUsd), 0) + num(otrosVista?.costoUsd),
        }
        lineas.push(filaProyecto(agregado, 'dim'))
      }
      return lineas
    },
  }
}

// Sesiones activas del EQUIPO segun el registro del Vault (SHS-M3-T005): quien
// esta consumiendo ahora en cualquier maquina, no solo en esta. La seccion se
// pinta aun sin filas ("nadie activo" es informacion); si no hay Vault
// configurado, renderFull la omite entera (vista.equipo null).
function seccionEquipo(ctx, vista) {
  const filas = Array.isArray(vista?.equipo?.filas) ? vista.equipo.filas.filter(Boolean) : []
  const ancha = ctx.interior >= 92

  function filaEquipo(f) {
    const hace = Number.isFinite(f.frescuraMs) ? fmtRelativo(ctx.ahora - f.frescuraMs, ctx.ahora) : '-'
    return lineaCaja(
      ctx,
      [
        { texto: texto(f.quien, texto(f.cuenta, '?')), ancho: 10, tinte: 'cyan' },
        ancha ? { texto: texto(f.maquina), ancho: 12, tinte: 'dim' } : null,
        { texto: texto(f.proyecto), ancho: RESTO },
        ancha ? { texto: texto(f.rama), ancho: 20, tinte: 'dim' } : null,
        { texto: fmtTokens(num(f.tokens)), ancho: 7, alinear: 'd' },
        { texto: hace, ancho: 8, alinear: 'd', tinte: 'dim' },
      ],
      ctx.tinteMarco
    )
  }

  return {
    id: 'equipo',
    min: 2,
    max: 1 + Math.max(1, filas.length),
    build(n) {
      const lineas = [
        regla(ctx, ctx.chars.frame.ml, ctx.chars.frame.mr, 'EQUIPO', `${filas.length} activas en el Vault`, ctx.tinteMarco),
      ]
      const huecos = Math.max(0, n - 1)
      if (filas.length === 0) {
        if (huecos > 0) {
          lineas.push(lineaCaja(ctx, [{ texto: 'sin sesiones activas del equipo', ancho: RESTO, tinte: 'dim' }], ctx.tinteMarco))
        }
        return lineas
      }
      for (const f of filas.slice(0, huecos)) lineas.push(filaEquipo(f))
      return lineas
    },
  }
}

// --- presupuesto de altura ---

/**
 * Reparte las filas disponibles ANTES de dibujar. Orden de corte, de abajo hacia
 * arriba: DESGLOSE cae primero, luego PROYECTOS, EQUIPO, VENTANAS, CONSUMO
 * (indivisible), SESIONES, CUENTAS y por ultimo AHORA. El header de limites
 * nunca entra en la negociacion.
 */
function repartirAltura(secciones, disponible) {
  const prioridad = ['ahora', 'cuentas', 'sesiones', 'consumo', 'ventanas', 'equipo', 'proyectos', 'desglose']
  const porId = new Map(secciones.map((s) => [s.id, s]))
  const asignado = new Map()
  let libre = disponible

  for (const id of prioridad) {
    const s = porId.get(id)
    if (!s) continue
    const costo = Math.min(s.min, s.max) + 1 // +1 por la linea en blanco de separacion
    if (costo <= libre) {
      asignado.set(id, Math.min(s.min, s.max))
      libre -= costo
    }
  }

  // El sobrante se reparte de a una linea por vuelta, para que ninguna seccion se
  // quede en el minimo mientras otra se queda con todo el aire.
  const crecibles = ['ahora', 'cuentas', 'sesiones', 'ventanas', 'equipo', 'proyectos', 'desglose']
  let progreso = true
  while (libre > 0 && progreso) {
    progreso = false
    for (const id of crecibles) {
      if (libre === 0) break
      const s = porId.get(id)
      if (!s || !asignado.has(id) || asignado.get(id) >= s.max) continue
      const actual = asignado.get(id)
      const objetivo = Math.min(s.max, s.siguiente ? s.siguiente(actual) : actual + 1)
      const delta = objetivo - actual
      if (delta <= 0 || delta > libre) continue
      asignado.set(id, objetivo)
      libre -= delta
      progreso = true
    }
  }

  return asignado
}

// --- modos ---

function renderFull(ctx, vista) {
  const limites = limitesOrdenados(ctx.vista)
  const chars = ctx.chars
  const alarma = limiteEnAlarma(limites)
  ctx.tinteMarco = alarma ? 'red' : 'dim'

  // "actualizado hace Xm" vive en el PIE (abajo a la derecha), no en el
  // header: la barra superior solo necesita "[q] salir".
  const actualizado = `actualizado ${fmtRelativo(num(vista.actualizadoEn) || ctx.ahora, ctx.ahora)}`

  // El header de barras y la linea de titulo "CUENTAS" se fusionaron con la
  // barra superior del panel: con cuentas, la barra dice "CUENTAS" a la
  // izquierda y "souclaude monitor" centrado (sin alias -- ese ya vive en la
  // propia fila de cada cuenta); sin cuentas, se degrada a la barra normal
  // con el titulo de siempre.
  const hayCuentas = (vista?.cuentas?.filas?.length ?? 0) > 0
  const barraSuperior = hayCuentas
    ? reglaConCentro(ctx, chars.frame.tl, chars.frame.tr, 'CUENTAS', tituloPanel(limites, null), '[q] salir', ctx.tinteMarco)
    : regla(ctx, chars.frame.tl, chars.frame.tr, tituloPanel(limites, vista.cuenta), '[q] salir', ctx.tinteMarco)

  const cabeza = [barraSuperior, lineaVacia(ctx, ctx.tinteMarco)]
  const pie = regla(ctx, chars.frame.bl, chars.frame.br, pieDe(vista).join(` ${chars.separator} `), actualizado, ctx.tinteMarco)
  const historico = lineasHistorico(ctx, vista.historico)

  const disponible = ctx.rows - cabeza.length - 1 - historico.length
  const secciones = [
    ...(hayCuentas ? [seccionCuentas(ctx, vista)] : []),
    seccionAhora(ctx, vista),
    seccionConsumo(ctx, vista),
    seccionDesglose(ctx, vista),
    seccionSesiones(ctx, vista),
    // EQUIPO se pinta aun sin filas — "nadie activo" es informacion — pero
    // nunca sin Vault configurado (equipo null).
    ...(vista?.equipo ? [seccionEquipo(ctx, vista)] : []),
    seccionProyectos(ctx, vista),
  ]
  const asignado = disponible > 0 ? repartirAltura(secciones, disponible) : new Map()

  const cuerpo = []
  const incluidas = secciones.filter((s) => asignado.has(s.id))
  incluidas.forEach((s, i) => {
    const lineas = s.build(asignado.get(s.id)).slice(0, asignado.get(s.id))
    cuerpo.push(...lineas)
    cuerpo.push(lineaVacia(ctx, ctx.tinteMarco))
  })

  // Con CUENTAS, se omite la linea en blanco de `cabeza` (entre la barra
  // superior y el contenido): CUENTAS queda pegada a su propia barra. El
  // separador entre CUENTAS y la siguiente seccion (AHORA) ya lo pone el
  // forEach de arriba, asi que no hace falta reponerlo aca. El presupuesto de
  // `disponible` (y por lo tanto el reparto de repartirAltura) sigue
  // calculado con `cabeza.length` == 2: solo se recorta la SALIDA final, no
  // el numero de filas que las secciones creen tener disponibles.
  if (hayCuentas) {
    return [cabeza[0], ...cuerpo, ...historico, pie]
  }
  return [...cabeza, ...cuerpo, ...historico, pie]
}

function renderAgents(ctx, vista) {
  const limites = limitesOrdenados(vista)
  const chars = ctx.chars
  ctx.tinteMarco = limiteEnAlarma(limites) ? 'red' : 'dim'

  const cabeza = [
    regla(ctx, chars.frame.tl, chars.frame.tr, tituloPanel(limites, vista.cuenta), '[q] salir', ctx.tinteMarco),
    lineaVacia(ctx, ctx.tinteMarco),
    ...lineasLimites(ctx, limitesParaHeader(vista), { multiCuenta: (vista?.limitesPorCuenta?.length ?? 0) > 1 }),
    lineaVacia(ctx, ctx.tinteMarco),
  ]
  const pie = regla(ctx, chars.frame.bl, chars.frame.br, pieDe(vista).join(` ${chars.separator} `), '', ctx.tinteMarco)
  // Mismo tratamiento que renderFull: el historico se descuenta del presupuesto
  // de altura para no desplazar el pie fuera del contrato de `rows` (ver
  // spec.md:69, "sin desaparecer" -- tambien vale en modo agents).
  const historico = lineasHistorico(ctx, vista.historico)

  const seccion = seccionAhora(ctx, vista)
  const disponible = Math.max(0, ctx.rows - cabeza.length - 1 - historico.length)
  const n = Math.max(seccion.min, Math.min(seccion.max, disponible))
  const cuerpo = disponible >= seccion.min ? seccion.build(n).slice(0, disponible) : []

  return [...cabeza, ...cuerpo, ...historico, pie]
}

function renderCompact(ctx, vista, avisos) {
  const limites = limitesOrdenados(vista)
  const sep = ctx.chars.separator
  const lineas = []

  const resumen = limites
    .map((l) => {
      const sev = severidad(l.porcentaje)
      const nombre = texto(l.etiqueta, texto(l.modelo, 'limite'))
      return `${nombre} ${pctTexto(l.porcentaje)}${sev.marca ? ` ${sev.marca}` : ''}`
    })
    .join(` ${sep} `)
  lineas.push(lineaPlana(ctx, resumen || 'sin datos de limites', limiteEnAlarma(limites) ? 'red' : null))

  const filas = Array.isArray(vista?.sesiones?.filas) ? vista.sesiones.filas.filter(Boolean) : []
  for (const x of filas) {
    const t = fila(
      [
        { texto: texto(x.id), ancho: 4, tinte: 'cyan' },
        { texto: texto(x.titulo, '(sin titulo)'), ancho: RESTO },
        { texto: texto(x.modelo), ancho: 6 },
        { texto: fmtTokens(num(x.tokens)), ancho: 7, alinear: 'd' },
        { texto: fmtDinero(num(x.costoUsd)), ancho: 7, alinear: 'd' },
      ],
      ctx.cols,
      ctx
    )
    lineas.push(t)
  }

  const c = vista?.consumo ?? {}
  const total = [
    `total ${fmtTokens(num(c.totalTokens))}`,
    fmtDinero(num(c.costoUsd)),
    `${num(vista?.sesiones?.total)} sesiones`,
    `${num(vista?.sesiones?.vivas)} vivas`,
  ].join(` ${sep} `)
  lineas.push(lineaPlana(ctx, total, 'dim'))
  lineas.push(lineaPlana(ctx, pieDe(vista).join(` ${sep} `), 'dim'))

  for (const a of avisos) lineas.push(lineaPlana(ctx, a, 'yellow'))

  // El extra historico no puede desaparecer solo porque el modo sea compact
  // (spec.md:69): una linea condensada al pie, coherente con el resto de este
  // modo (una linea por dato, sin caja).
  const historico = Array.isArray(vista?.historico) ? vista.historico.filter((h) => typeof h === 'string' && h !== '') : []
  for (const h of historico) lineas.push(lineaPlana(ctx, h, 'dim'))

  // Con poca altura se conservan la primera linea (limites) y las ultimas (totales, historico y avisos).
  if (lineas.length > ctx.rows) {
    const cola = 2 + avisos.length + historico.length
    const cabeza = Math.max(1, ctx.rows - cola)
    return [...lineas.slice(0, cabeza), ...lineas.slice(lineas.length - Math.min(cola, ctx.rows - cabeza))]
  }
  return lineas
}

function renderAngosto(ctx, vista) {
  const limites = limitesOrdenados(vista)
  const sep = ctx.chars.separator
  const c = vista?.consumo ?? {}

  const lineas = []
  for (const l of limites.slice(0, 3)) {
    const sev = severidad(l.porcentaje)
    const nombre = texto(l.etiqueta, texto(l.modelo, 'limite'))
    lineas.push(
      lineaPlana(ctx, `${nombre} ${pctTexto(l.porcentaje)} ${sev.marca}`.trim(), tinteDeNivel(sev.nivel))
    )
  }
  while (lineas.length < 3) lineas.push(lineaPlana(ctx, '', null))
  lineas.push(
    lineaPlana(ctx, `total ${fmtTokens(num(c.totalTokens))} ${sep} ${fmtDinero(num(c.costoUsd))}`, 'dim')
  )

  // El extra historico tampoco desaparece aca (spec.md:69): una sola linea
  // condensada, igual que el resto de este modo (una linea por dato).
  const historico = Array.isArray(vista?.historico) ? vista.historico.filter((h) => typeof h === 'string' && h !== '') : []
  if (historico.length > 0) lineas.push(lineaPlana(ctx, historico[0], 'dim'))

  lineas.push(lineaPlana(ctx, `terminal muy angosta (${COLS_MINIMAS} col minimo)`, 'yellow'))

  return lineas.slice(0, ctx.rows)
}

// --- entrada publica ---

/**
 * Renderiza el panel completo como lineas de texto.
 * @param {VistaMonitor} vista
 * @param {{cols?:number, rows?:number, caps?:object, color?:boolean,
 *          modo?:'full'|'compact'|'agents'}} [opciones]
 * @returns {string[]} una entrada por linea; cada una mide exactamente `cols`.
 */
export function renderPanel(vista, opciones = {}) {
  const cols = Math.max(1, Math.floor(opciones.cols ?? 80))
  const rows = Math.max(1, Math.floor(opciones.rows ?? 24))
  const caps = opciones.caps ?? {}
  const chars = charsFor(caps)
  const color = (opciones.color ?? true) !== false && caps.color !== false
  const modo = opciones.modo ?? 'full'
  const v = vista ?? {}
  const ahora = Number.isFinite(v.ahora) ? v.ahora : Number.isFinite(v.actualizadoEn) ? v.actualizadoEn : 0

  const ctx = {
    cols,
    rows,
    interior: Math.max(0, cols - 4),
    caps,
    chars,
    color,
    elipsis: chars.ellipsis,
    ahora,
    vista: v,
    tinteMarco: 'dim',
  }

  const avisos = Array.isArray(v.avisos) ? v.avisos.map((a) => texto(a)).filter(Boolean) : []

  let lineas
  if (cols < COLS_MINIMAS) {
    lineas = renderAngosto(ctx, v)
  } else if (modo === 'compact') {
    lineas = renderCompact(ctx, v, avisos)
  } else if (rows < FILAS_MINIMAS) {
    // El header de limites nunca negocia espacio: si no hay altura, se cae a compacto.
    lineas = renderCompact(ctx, v, [
      ...avisos,
      `terminal de ${rows} lineas: vista compacta (necesita ${FILAS_MINIMAS}+)`,
    ])
  } else if (modo === 'agents') {
    lineas = renderAgents(ctx, v)
  } else {
    lineas = renderFull(ctx, v)
  }

  // Red de seguridad del contrato: ninguna linea puede desviarse del ancho ni el
  // array superar `rows`. Si una sola linea se pasa por un caracter, la caja entera
  // se desalinea, asi que se paga el costo de verificar.
  const salida = lineas.slice(0, rows).map((linea) => {
    const w = anchoVisual(linea)
    if (w === cols) return linea
    if (w < cols) return linea + ' '.repeat(cols - w)
    return linea
  })
  return salida
}

// Reexportado para que el renderer TTY componga filas con el mismo contrato de ancho.
export { columnas }
