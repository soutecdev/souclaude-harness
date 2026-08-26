import path from 'node:path'
import * as ui from '../ui.js'
import { parsearDuracion } from '../monitor/domain/ventanas.js'
import { buildView } from '../monitor/application/build-view.js'
import { resolveClaudeHome } from '../monitor/adapters/claude-home.js'
import { createSnapshotSource } from '../monitor/adapters/snapshot-source.js'
import { createLimitsReader } from '../monitor/adapters/usage-limits-reader.js'
import { createUsageFetcher } from '../monitor/adapters/usage-fetcher.js'
import { createUsageHistory } from '../monitor/adapters/usage-history.js'
import { detectCaps } from '../monitor/adapters/caps.js'
import { createTtyRenderer } from '../monitor/adapters/tty-renderer.js'
import { renderPanel } from '../monitor/adapters/panel-layout.js'
import { presentar } from '../monitor/adapters/panel-presenter.js'
import { renderJson, renderPlain } from '../monitor/adapters/plain-renderer.js'
import { construirLinea, emitirLinea } from '../monitor/adapters/router-log-writer.js'
import { createVaultPublisher } from '../monitor/adapters/vault-monitor-publisher.js'
import { createSessionsPublisher } from '../monitor/adapters/vault-sessions-publisher.js'
import { createUsageDbPublisher } from '../monitor/adapters/vault-usage-db.js'
import { leerRegistrosDeUsage, createVaultUsageReader } from '../monitor/adapters/vault-usage-reader.js'
import { agregarUsage } from '../monitor/domain/usage-agregado.js'
import { consumoPorVentana } from '../monitor/domain/ventanas-limite.js'
import { sesionesActivas, picoDiario } from '../monitor/domain/actividad-equipo.js'
import { createVaultAccountsReader, gitAsync } from '../monitor/adapters/vault-accounts-reader.js'
import { pullRebaseSeguro } from '../core/vault-sync.js'
import {
  createLocalAccountsReader,
  createCombinedAccountsReader,
  parseLocalAccountsEnv,
  pathsDeConfigDir,
} from '../monitor/adapters/local-accounts-reader.js'
import { readVaultConfig, carpetaProyecto } from '../core/vault.js'

// El caché de limites de ~/.claude.json solo se reescribe cuando el humano corre
// /usage, asi que sin esto el panel muestra un dato de 20-50 minutos. El fetcher
// le pega al mismo endpoint que usa Claude Code, con un TTL de 5 minutos.
//
// Cuando NO se toca la red, y por que:
//   --no-refresh    el usuario lo pidio explicitamente
//   CI              un runner no debe salir a internet ni leer credenciales
//   --claude-home   apunta a un fixture: no hay credenciales que leer, y ademas
//                   ningun test puede depender de la red
// En esos casos se lee solo el cache de .claude.json, como antes.
function sinRefrescoDeRed(flags) {
  return flags['no-refresh'] === true || flags.refresh === false || ui.isCI() || Boolean(flags['claude-home'])
}

// Una sola instancia por corrida (o `undefined` si no se toca la red): la
// comparten `crearLimitsReader` (para refrescar los limites) y
// `createSnapshotSource` (SHS-H3-T106, para reportar su propio `estado()` como
// aviso). Antes cada uno tenia su propio fetcher (o directamente no lo tenia,
// en el caso de snapshot-source), asi que el aviso de "limites sin refrescar"
// nunca podia aparecer en el panel real, solo en el test con un fake.
function crearUsageFetcher(flags) {
  if (sinRefrescoDeRed(flags)) return undefined
  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  return createUsageFetcher({ paths })
}

function crearLimitsReader(usageFetcher) {
  if (!usageFetcher) return undefined
  return createLimitsReader({ fetcher: usageFetcher })
}

// Persistencia del historico del gasto extra (ver adapters/usage-history.js y
// docs/decisions/20260810-monitor-persiste-historico-de-gasto-extra.md): la API
// nunca informa cuando se detecto el limite alcanzado, asi que el monitor lleva
// su propio registro. `--seed-extra-detectado-en <ISO>` solo importa la primera
// vez (sin usage-history.json todavia); en cualquier corrida posterior el
// adaptador lo ignora.
function crearUsageHistory(flags) {
  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  return createUsageHistory({ paths, seedDetectadoEn: flags['seed-extra-detectado-en'] })
}

// Registra el gasto extra recien leido en el historico persistido. Nunca lanza:
// un fallo de disco no puede tumbar un tick del panel (ver usage-history.js).
// El error (de disco o de logica) no se traga en silencio: se empuja al mismo
// canal de avisos que usa snapshot-source.js (ver snapshot-source.js:137),
// para que un fallo real siga siendo visible en el panel en vez de desaparecer.
function registrarHistorico(usageHistory, vista, ahora) {
  try {
    usageHistory.registrar(vista?.limites?.gastoExtra ?? null, ahora)
  } catch (err) {
    vista?.avisos?.push({ file: 'usage-history', reason: err.code ?? err.message })
  }
}

// `souclaude monitor`: panel de consumo de tokens. Tres modos excluyentes:
//   --json                              -> modelo de dominio crudo y sale
//   --once | sin TTY | CI               -> un snapshot en texto plano y sale
//   resto                               -> panel en vivo sobre la TTY
//
// SIN TTY NO SE TOCA NADA DE LA TERMINAL: ni alternate buffer, ni setRawMode, ni
// cursor. `souclaude monitor | cat` no puede colgarse esperando teclas ni ensuciar
// la salida con escapes.
//
// --emit-router es un cuarto modo, ortogonal a los tres de arriba: no dibuja
// panel, es estrictamente de lectura salvo por la UNICA escritura de todo el
// comando (progress/model-router.jsonl). Ver ../monitor/adapters/router-log-writer.js.

const INTERVALO_DEFAULT = 2000
const INTERVALO_MINIMO = 250
const TOP_DEFAULT = 10
const VENTANA_DEFAULT = '24h'
const COLS_SNAPSHOT = 100

// Umbrales de salida: pensados para usarse desde un hook.
const UMBRAL_CRITICO = 95
const UMBRAL_AVISO = 85

// En raw mode Ctrl+C no genera SIGINT: llega como este byte dentro del stream.
const KEY_CTRL_C = '\u0003'

const ORDENES = new Set(['tokens', 'costo', 'reciente'])

export async function monitor(flags = {}, cwd = process.cwd()) {
  if (flags['emit-router']) return await emitRouter(flags, cwd)
  if (flags.usage) return await usageQuery(flags, cwd)

  const ventana = flags.since ?? VENTANA_DEFAULT
  if (parsearDuracion(ventana) === null) {
    // Un throw aca dejaria un stack trace donde el usuario necesita una instruccion.
    ui.log.error(`Ventana invalida: "${ventana}". Usa 30m, 1h, 6h, 24h, 7d o all.`)
    return 2
  }

  const opciones = {
    ventana,
    orden: ORDENES.has(flags.sort) ? flags.sort : 'tokens',
    top: enteroPositivo(flags.top, TOP_DEFAULT),
    filtros: filtrosDe(flags, cwd),
  }

  const enVivo = !flags.json && !flags.once && process.stdout.isTTY === true && !ui.isCI()

  // El publisher solo existe en vivo (--publish); el lector de cuentas del
  // Vault sirve en todos los modos (--json lo expone gratis), pero su pull
  // remoto solo corre en vivo y solo si el publisher no lo hace ya.
  const publisher = enVivo ? crearPublisher(flags, cwd) : null
  const sesionesPublisher = enVivo ? crearPublisherDeSesiones(flags, cwd) : null
  const usagePublisher = enVivo ? crearPublisherDeUsage(flags, cwd) : null
  const accountsReader = crearAccountsReader(cwd, { conPull: enVivo && !publisher })
  // Lector del registro de consumo del Vault para las vistas del panel
  // (SHS-M3-T005): ventanas de limite con consumo propio y equipo activo.
  // Como accountsReader, sirve en todos los modos (--json lo expone gratis) y
  // sin Vault configurado queda en null — el panel omite las secciones.
  const usageReader = crearUsageDbReader(cwd)

  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  const usageHistory = crearUsageHistory(flags)
  // SHS-H3-T106: mismo fetcher para refrescar limites y para reportar su
  // propio estado() como aviso -- ver crearUsageFetcher.
  const usageFetcher = crearUsageFetcher(flags)
  // SHS-H3-T105: el mismo usageHistory que registrarHistorico() usa para
  // ESCRIBIR (tras cada buildView) se compone aca tambien hacia adentro, para
  // que collect() pueda LEER lo persistido y domain/arbol.js sepa si el extra
  // vigente ya paso a historico.
  const source = createSnapshotSource({
    paths,
    limitsReader: crearLimitsReader(usageFetcher),
    usageHistory,
    usageFetcher,
    accountsReader,
    usageReader,
    cuentasLocales: crearCuentasLocales(),
  })
  const clock = { now: () => Date.now() }

  const caps = detectCaps({ overrides: flags.ascii ? { unicode: false } : {} })
  const modo = flags.compact ? 'compact' : flags.agents ? 'agents' : 'full'

  if (flags.json) {
    const vista = await buildView({ source, clock, opciones })
    registrarHistorico(usageHistory, vista, clock.now())
    console.log(renderJson(vista))
    return codigoDeSalida(vista)
  }

  if (!enVivo) {
    const vista = await buildView({ source, clock, opciones })
    registrarHistorico(usageHistory, vista, clock.now())
    const cols = process.stdout.isTTY === true ? caps.cols : COLS_SNAPSHOT
    process.stdout.write(renderPlain(vista, { cols, caps, modo, top: opciones.top }) + '\n')
    return codigoDeSalida(vista)
  }

  return await enVivoLoop({ source, clock, opciones, caps, modo, flags, usageHistory, publisher, sesionesPublisher, usagePublisher })
}

// Publicacion de snapshots agregados de esta cuenta al Vault (ADR
// 20260810-monitor-snapshots-en-vault), solo en vivo. Con Vault configurado
// publica POR DEFECTO: tener vault.local.json ya expresa querer la vista
// compartida, y un opt-in olvidable dejaba la seccion CUENTAS de las demas
// maquinas vacia. --no-publish la apaga por corrida. Sin Vault configurado
// solo se avisa si el usuario pidio --publish explicito (para no ensuciar
// cada corrida local-only): el Vault jamas es dependencia dura de nada.
export function crearPublisher(flags, cwd) {
  if (flags.publish === false) return null
  const config = readVaultConfig(cwd)
  if (!config?.path) {
    if (flags.publish === true) {
      ui.log.warn('--publish sin Vault configurado (.claude/vault.local.json o VAULT_PATH): el monitor sigue local-only.')
    }
    return null
  }
  return createVaultPublisher({ vaultPath: config.path })
}

// Publicacion de la linea por sesion en Project-<PREFIJO>/sessions.md (ADR
// 20260817-milestones-planes-y-sesiones-en-vault): cada sesion con consumo de
// este proyecto deja su linea y la va actualizando mientras crece, sin
// depender de la disciplina del agente.
// Mismas condiciones de encendido que crearPublisher (solo en vivo, --no-publish
// la apaga); ademas necesita saber cual es la carpeta Project-* del Vault —
// sin eso no hay sessions.md que escribir y se degrada en silencio.
export function crearPublisherDeSesiones(flags, cwd) {
  if (flags.publish === false) return null
  const config = readVaultConfig(cwd)
  if (!config?.path) return null
  // SHS-M21-T002: con la config de MAQUINA (CLI global fuera de un repo) no se
  // publica sessions.md — la linea de sesion pertenece a un Project-<PREFIJO>
  // y sin repo bajo los pies carpetaProyecto() solo podria adivinarlo. El
  // snapshot de cuenta y el registro de usage (de organizacion) si publican.
  if (config.origen === 'maquina') return null
  const proyecto = carpetaProyecto(config.path, config)
  if (!proyecto) {
    if (flags.publish === true) {
      ui.log.warn('No se pudo determinar la carpeta Project-<PREFIJO> del Vault: las lineas de sessions.md no se publican (declara "project" en .claude/vault.local.json).')
    }
    return null
  }
  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  return createSessionsPublisher({
    vaultPath: config.path,
    proyecto,
    cwdProyecto: cwd,
    quien: typeof config.quien === 'string' && config.quien !== '' ? config.quien : null,
    registroPath: path.join(paths.home, 'souclaude', 'sesiones-publicadas.json'),
  })
}

// Publicacion del registro estructurado de consumo por sesion — la "base de
// datos del monitor" — en 00-System/monitor/usage/ (ADR
// 20260820-registro-de-consumo-por-sesion-en-vault). Cubre TODOS los
// proyectos de la maquina (el registro es de la organizacion, no de un cwd),
// por eso no necesita carpeta Project-*. Mismas condiciones de encendido que
// crearPublisher: solo en vivo, por defecto con Vault configurado,
// --no-publish la apaga.
export function crearPublisherDeUsage(flags, cwd) {
  if (flags.publish === false) return null
  const config = readVaultConfig(cwd)
  if (!config?.path) return null
  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  return createUsageDbPublisher({
    vaultPath: config.path,
    quien: typeof config.quien === 'string' && config.quien !== '' ? config.quien : null,
    registroPath: path.join(paths.home, 'souclaude', 'usage-publicado.json'),
  })
}

// Lector de los snapshots que publico el resto del equipo (Vault) combinado
// con las cuentas locales adicionales (SOUCLAUDE_LOCAL_ACCOUNTS, ej. las
// carpetas ~/.claude1 y ~/.claude2 de claude1/claude2 en el perfil de
// PowerShell). Sin Vault ni cuentas locales, null: la seccion CUENTAS muestra
// solo la cuenta local principal.
function crearAccountsReader(cwd, { conPull }) {
  const config = readVaultConfig(cwd)
  const vaultReader = config?.path
    ? createVaultAccountsReader({ vaultPath: config.path, git: conPull ? gitAsync : null })
    : null

  const homesLocales = parseLocalAccountsEnv(process.env.SOUCLAUDE_LOCAL_ACCOUNTS)
  const localReader = homesLocales.length > 0 ? createLocalAccountsReader({ homes: homesLocales }) : null

  if (vaultReader && localReader) return createCombinedAccountsReader([vaultReader, localReader])
  return vaultReader ?? localReader
}

// Lector cacheado del registro de consumo del Vault (SHS-M3-T005). No hace
// pull propio: la frescura remota ya la traen el publisher o accountsReader
// en vivo; aca solo se lee el working tree.
function crearUsageDbReader(cwd) {
  const config = readVaultConfig(cwd)
  if (!config?.path) return null
  return createVaultUsageReader({ vaultPath: config.path })
}

// {paths} de cada cuenta local (SOUCLAUDE_LOCAL_ACCOUNTS) para que
// createSnapshotSource mezcle sus SESIONES/PROYECTOS en el mismo arbol,
// etiquetadas con su propia identidad de cuenta. Complementa crearAccountsReader
// (que solo aporta el AGREGADO de la fila CUENTAS): las mismas carpetas
// alimentan las dos rutas por separado, cada una con el detalle que necesita.
function crearCuentasLocales() {
  const homesLocales = parseLocalAccountsEnv(process.env.SOUCLAUDE_LOCAL_ACCOUNTS)
  return homesLocales.map((homeOverride) => ({ paths: pathsDeConfigDir(homeOverride) }))
}

// --- panel en vivo ---

async function enVivoLoop({ source, clock, opciones, caps, modo, flags, usageHistory, publisher = null, sesionesPublisher = null, usagePublisher = null }) {
  const intervalo = Math.max(INTERVALO_MINIMO, enteroPositivo(flags.interval, INTERVALO_DEFAULT))
  const renderer = createTtyRenderer()

  let vista = null
  let errorDelTick = null
  let enTick = false
  let timer = null
  let salida = 0

  function pintar() {
    if (!vista && !errorDelTick) return
    const { cols, rows } = renderer.size()
    const modelo = conAvisoDeError(vista, errorDelTick)
    const conPublicacion = conAvisoDePublicacion(
      conAvisoDePublicacion(
        conAvisoDePublicacion(modelo, publisher, clock.now(), 'Vault'),
        sesionesPublisher,
        clock.now(),
        'sessions.md'
      ),
      usagePublisher,
      clock.now(),
      'usage'
    )
    const proyeccion = presentar(conPublicacion, { ahora: modelo.generadoEn, top: opciones.top })
    renderer.paint(renderPanel(proyeccion, { cols, rows, caps, color: caps.color !== false, modo }))
  }

  async function tick() {
    // Un tick que tarda mas que el intervalo no puede pisarse con el siguiente: el
    // tailer mantiene offsets por archivo y dos lecturas en paralelo los corrompen.
    if (enTick || renderer.isPaused()) return
    enTick = true
    try {
      vista = await buildView({ source, clock, opciones })
      registrarHistorico(usageHistory, vista, clock.now())
      errorDelTick = null
    } catch (err) {
      // Un error en un tick no mata el bucle: se anota como aviso y se sigue con la
      // ultima vista buena. Perder el panel entero por un archivo ilegible seria peor.
      errorDelTick = err
    } finally {
      enTick = false
    }
    // Fire-and-forget: el publisher decide solo si le toca (intervalo, backoff,
    // cambio material) y jamas puede demorar ni tumbar el render.
    if (publisher && vista) {
      publisher.publicar(vista, { ahora: clock.now() }).catch(() => {})
    }
    if (sesionesPublisher && vista) {
      sesionesPublisher.publicar(vista, { ahora: clock.now() }).catch(() => {})
    }
    if (usagePublisher && vista) {
      usagePublisher.publicar(vista, { ahora: clock.now() }).catch(() => {})
    }
    pintar()
  }

  try {
    await new Promise((resolve) => {
      renderer.onKey((key) => {
        if (key === KEY_CTRL_C) {
          salida = 130
          resolve()
          return
        }
        if (key === 'q') {
          salida = vista ? codigoDeSalida(vista) : 0
          resolve()
          return
        }
        // 'p' ya alterno el pausado dentro del renderer: repintar deja el frame quieto.
      })
      renderer.onResize(() => pintar())
      renderer.start()

      // Primer tick inmediato: esperar el intervalo dejaria la pantalla vacia.
      tick()
      timer = setInterval(tick, intervalo)
      timer.unref?.()
    })
    return salida
  } finally {
    // Pase lo que pase — tecla, error de buildView, excepcion inesperada — la
    // terminal vuelve con cursor y sin alternate buffer. Es el peor modo de fallo
    // posible de esta herramienta y por eso va en un finally, no al final del try.
    if (timer) clearInterval(timer)
    renderer.stop()
  }
}

// --- emit-router: el puente de estimado a medido ---
//
// Es la UNICA escritura de todo el comando; todo lo demas (buildView, la
// resolucion del tramo) es lectura. No dibuja panel: imprime que escribio (o
// por que no) y sale. 0 si escribio o si la idempotencia la rechazo (no es un
// error correr el comando dos veces); 2 si faltan argumentos obligatorios o
// si construirLinea no pudo armar la linea (motivo faltante, tramo ambiguo o
// inexistente, etc).
async function emitRouter(flags, cwd) {
  if (typeof flags.hito !== 'string' || flags.hito === '') {
    ui.log.error('Falta --hito: obligatorio para emitir telemetria del router (ver SKILL ccem-model-router).')
    return 2
  }

  // Default 'all' (no 24h): este modo busca un lanzamiento puntual que ya
  // paso, no el estado reciente del panel. Si el usuario pasa --since, se
  // respeta igual.
  const ventana = flags.since ?? 'all'
  if (parsearDuracion(ventana) === null) {
    ui.log.error(`Ventana invalida: "${ventana}". Usa 30m, 1h, 6h, 24h, 7d o all.`)
    return 2
  }

  const paths = resolveClaudeHome({ override: flags['claude-home'] })
  // --emit-router no dibuja panel ni consume `avisos`: solo necesita que los
  // limites sigan refrescandose igual que antes, no reportar estado().
  const source = createSnapshotSource({ paths, limitsReader: crearLimitsReader(crearUsageFetcher(flags)) })
  const clock = { now: () => Date.now() }

  // top: null (sin recorte). Este modo busca UN agente o sesion puntual en
  // todo el arbol; el recorte de presentacion (pensado para el panel en vivo)
  // podria dejarlo justo afuera de las primeras N filas.
  const opciones = { ventana, orden: 'tokens', top: null, filtros: {} }

  let vista
  try {
    vista = await buildView({ source, clock, opciones })
  } catch (err) {
    ui.log.error(`No se pudo leer la telemetria de Claude Code: ${err.message}`)
    return 2
  }

  let linea
  try {
    linea = construirLinea(vista, {
      hito: flags.hito,
      task: typeof flags.task === 'string' && flags.task !== '' ? flags.task : null,
      agente: typeof flags.agente === 'string' && flags.agente !== '' ? flags.agente : null,
      resultado: flags.resultado,
      rework: enteroNoNegativo(flags.rework, 0),
      motivo: typeof flags.motivo === 'string' && flags.motivo !== '' ? flags.motivo : null,
      clase: typeof flags.clase === 'string' && flags.clase !== '' ? flags.clase : null,
      sessionId: typeof flags.session === 'string' && flags.session !== '' ? flags.session : undefined,
      ahora: clock.now(),
    })
  } catch (err) {
    ui.log.error(err.message)
    return 2
  }

  const rutaJsonl = path.join(cwd, 'progress', 'model-router.jsonl')
  const { escrita, motivo } = await emitirLinea(rutaJsonl, linea, { force: flags.force === true })

  if (!escrita) {
    ui.log.warn(motivo)
    return 0
  }

  ui.log.success(`Linea de telemetria medida escrita en ${rutaJsonl}`)
  ui.log.success(JSON.stringify(linea))
  return 0
}

// --- usage: la consulta a la base de datos del monitor en el Vault ---
//
// Lee 00-System/monitor/usage/*.jsonl (lo que publican TODAS las maquinas del
// equipo) y responde el consumo por cuenta, contribuyente, proyecto y sesion
// (SHS-M2), mas las vistas de SHS-M3: consumo propio dentro de las ventanas
// de rate limit (5h/7d/Fable), sesiones activas del equipo, pico diario y
// drill-down via filtros --project/--quien/--cuenta. Solo lectura del Vault:
// el unico efecto es un pull --rebase de frescura (best effort, se omite en
// CI). Default de ventana 'all', no 24h: una consulta al registro historico
// busca el acumulado, no el estado del panel. Exit: 0 ok, 3 sin Vault
// configurado (mismo codigo que vault-sync).
async function usageQuery(flags, cwd) {
  const config = readVaultConfig(cwd)
  if (!config?.path) {
    ui.log.error('No hay Vault configurado (.claude/vault.local.json o VAULT_PATH): no hay registro de consumo que consultar.')
    return 3
  }

  const ventana = flags.since ?? 'all'
  const duracion = parsearDuracion(ventana)
  if (duracion === null) {
    ui.log.error(`Ventana invalida: "${ventana}". Usa 30m, 1h, 6h, 24h, 7d o all.`)
    return 2
  }

  // Frescura best effort: ver los registros que las otras maquinas ya
  // pushearon. Un fallo (sin red) no bloquea: se consulta el working tree.
  if (!ui.isCI()) await pullRebaseSeguro({ vaultPath: config.path, git: gitAsync })

  const { registros, warnings } = leerRegistrosDeUsage(config.path)
  const ahora = Date.now()
  const desde = Number.isFinite(duracion) ? ahora - duracion : null
  const filtros = filtrosDeUsage(flags, cwd)
  const agregado = agregarUsage(registros, { ...filtros, desde })

  // Las ventanas de rate limit necesitan los limites de la cuenta local: se
  // leen del cache de ~/.claude.json (mas el fetcher si hay red permitida),
  // best effort — sin limites la consulta al registro vale igual.
  const limites = await leerLimitesParaUsage(flags, ahora)
  const ventanasLimite = consumoPorVentana(registros, limites, ahora, filtros)
  const activas = sesionesActivas(agregado.sesiones, ahora)
  const pico = picoDiario(agregado.porDia)

  if (flags.json) {
    console.log(JSON.stringify({ ventana, filtros, ...agregado, ventanasLimite, activas, pico, warnings }, null, 2))
    return 0
  }

  for (const w of warnings) ui.log.warn(`${w.file}: ${w.reason}`)
  imprimirUsage(agregado, ventana, {
    filtros,
    ventanasLimite,
    activas,
    pico,
    ahora,
    top: enteroPositivo(flags.top, TOP_DEFAULT),
  })
  return 0
}

// Filtros del drill-down. `--project .` significa "este proyecto": el nombre
// de la carpeta del repo, que es lo que publica el registro (nunca la ruta).
function filtrosDeUsage(flags, cwd) {
  const filtros = {}
  if (typeof flags.project === 'string' && flags.project !== '') {
    filtros.proyecto = flags.project === '.' ? path.basename(cwd) : flags.project
  }
  if (typeof flags.quien === 'string' && flags.quien !== '') filtros.quien = flags.quien
  if (typeof flags.cuenta === 'string' && flags.cuenta !== '') filtros.cuenta = flags.cuenta
  return filtros
}

// Lector de limites para --usage: el mismo cache (+fetcher opcional) que usa
// el panel, pero best effort — cualquier fallo devuelve null y la consulta
// sigue sin la seccion de ventanas.
async function leerLimitesParaUsage(flags, ahora) {
  try {
    const paths = resolveClaudeHome({ override: flags['claude-home'] })
    const reader = createLimitsReader({ fetcher: crearUsageFetcher(flags) })
    const res = await reader.read(paths.configFile, { ahora })
    return res.limits
  } catch {
    return null
  }
}

function imprimirUsage(agregado, ventana, extras = {}) {
  const { filtros = {}, ventanasLimite = [], activas = [], pico = null, top = TOP_DEFAULT } = extras
  const t = agregado.totales
  const filtroTxt = Object.entries(filtros)
    .map(([k, v]) => ` · ${k}=${v}`)
    .join('')
  console.log(`CONSUMO (${ventana}${filtroTxt}) · ${t.sesiones} sesion${t.sesiones === 1 ? '' : 'es'} · in ${enK(t.tokensIn)} / out ${enK(t.tokensOut)} · $${t.costoUsd} · ${t.llamadas} llamadas`)
  if (t.desglose) {
    const d = t.desglose
    console.log(`  desglose · entrada ${enK(d.entrada)} · cache creacion ${enK(d.cacheCreacion)} · cache lectura ${enK(d.cacheLectura)} · salida ${enK(d.salida)}`)
  }

  if (ventanasLimite.length > 0) {
    console.log('\nVENTANAS DE LIMITE')
    for (const v of ventanasLimite) {
      const pct = v.porcentaje !== null ? `${Math.round(v.porcentaje)}% del limite` : 'sin %'
      const resetea = v.reseteaEn !== null && v.alineada ? ` · resetea ${horaLocal(v.reseteaEn)}` : ''
      const aviso = v.alineada ? '' : ' · (rodante: sin reset de la API)'
      console.log(`  ${v.etiqueta} · ${pct} · in ${enK(v.consumo.tokensIn)} / out ${enK(v.consumo.tokensOut)} · $${v.consumo.costoUsd} · ${v.sesiones} sesion${v.sesiones === 1 ? '' : 'es'}${resetea}${aviso}`)
    }
  }

  if (activas.length > 0) {
    console.log('\nACTIVAS AHORA')
    for (const s of activas) {
      console.log(`  ${s.quien ?? s.cuentaAlias ?? 'n/d'} @ ${s.maquina ?? 'n/d'} · ${s.proyecto ?? 'n/d'} · in ${enK(s.tokensIn)} / out ${enK(s.tokensOut)} · hace ${minutos(s.frescuraMs)}`)
    }
  }

  if (pico) {
    console.log(`\nPICO · ${pico.fecha} · ${enK(pico.tokens)} tokens · $${pico.costoUsd} · ${pico.sesiones} sesion${pico.sesiones === 1 ? '' : 'es'}`)
  }

  seccionUsage('POR QUIEN', agregado.porQuien)
  seccionUsage('POR CUENTA', agregado.porCuenta)
  seccionUsage('POR PROYECTO', agregado.porProyecto)
  seccionUsage('POR MAQUINA', agregado.porMaquina)
  seccionUsage('POR MILESTONE', agregado.porMilestone)
  seccionUsage('POR MODELO', agregado.porModelo)

  if (agregado.sesiones.length > 0) {
    const visibles = agregado.sesiones.slice(0, top)
    console.log(`\nSESIONES (top ${visibles.length} de ${agregado.sesiones.length})`)
    for (const s of visibles) {
      console.log(`  ${s.fecha ?? 'n/d'} · ${s.proyecto ?? 'n/d'} · ${s.quien ?? 'n/d'} @ ${s.maquina ?? 'n/d'} · in ${enK(s.tokensIn)} / out ${enK(s.tokensOut)} · $${s.costoUsd}`)
    }
  }
}

function horaLocal(epochMs) {
  const d = new Date(epochMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function minutos(ms) {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '<1m' : `${m}m`
}

function seccionUsage(titulo, grupos) {
  if (grupos.length === 0) return
  console.log(`\n${titulo}`)
  for (const g of grupos) {
    console.log(`  ${g.clave} · in ${enK(g.tokensIn)} / out ${enK(g.tokensOut)} · $${g.costoUsd} · ${g.sesiones} sesion${g.sesiones === 1 ? '' : 'es'}`)
  }
}

function enK(n) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// --- helpers ---

function filtrosDe(flags, cwd) {
  const filtros = {}
  if (typeof flags.project === 'string' && flags.project !== '') {
    filtros.proyecto = flags.project === '.' ? cwd : flags.project
  }
  if (typeof flags.session === 'string' && flags.session !== '') {
    filtros.sesion = flags.session
  }
  return filtros
}

// parseArgs entrega strings: la conversion y la validacion son del comando.
function enteroPositivo(valor, porDefecto) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return porDefecto
  return Math.floor(n)
}

// Igual que enteroPositivo pero acepta 0 (rework: 0 devoluciones es el caso normal).
function enteroNoNegativo(valor, porDefecto) {
  if (valor === undefined) return porDefecto
  const n = Number(valor)
  if (!Number.isFinite(n) || n < 0) return porDefecto
  return Math.floor(n)
}

// Sirve desde un hook: 0 bajo 85 %, 1 entre 85 y 94 %, 2 en 95 % o mas. Sin datos
// de limites es 0 — no saber no es lo mismo que estar mal.
function codigoDeSalida(vista) {
  const filas = presentar(vista, { ahora: vista?.generadoEn }).limites
  if (filas.length === 0) return 0
  const peor = filas[0].porcentaje
  if (peor >= UMBRAL_CRITICO) return 2
  if (peor >= UMBRAL_AVISO) return 1
  return 0
}

// Traduce el estado de un publisher a un aviso visible, sin mutar el modelo. Un
// secreto detectado o una racha de fallos que dejo el dato viejo son cosas
// que el humano tiene que ver; una publicacion al dia no necesita anunciarse.
// `etiqueta` distingue el snapshot agregado ('Vault') de la linea por sesion
// ('sessions.md'): comparten forma de estado() pero fallan por separado.
function conAvisoDePublicacion(vista, publisher, ahora, etiqueta = 'Vault') {
  if (!publisher || !vista) return vista
  const e = publisher.estado()

  let aviso = null
  if (e.secretoDetectado) {
    aviso = `publicacion a ${etiqueta} ABORTADA: el contenido tenia un posible secreto`
  } else if (e.fallosSeguidos > 0 && e.ultimaPublicacionMs != null) {
    const min = Math.round((ahora - e.ultimaPublicacionMs) / 60_000)
    aviso = `${etiqueta}: sin publicar hace ${min}m (${e.fallosSeguidos} fallo${e.fallosSeguidos === 1 ? '' : 's'})`
  } else if (e.fallosSeguidos >= 3) {
    aviso = `${etiqueta}: todavia sin publicar (${e.fallosSeguidos} fallos)`
  }

  if (!aviso) return vista
  return { ...vista, avisos: [...(vista.avisos ?? []), { file: 'vault', reason: aviso }] }
}

// Agrega el error del ultimo tick a los avisos de la vista, sin mutar el modelo de
// dominio. Si todavia no hubo ninguna vista buena, arma la minima para que el panel
// tenga algo que pintar en vez de una pantalla en negro.
function conAvisoDeError(vista, err) {
  if (!err) return vista
  const aviso = { file: 'monitor', reason: err.message ?? String(err) }
  if (!vista) return { generadoEn: Date.now(), avisos: [aviso] }
  return { ...vista, avisos: [...(vista.avisos ?? []), aviso] }
}
