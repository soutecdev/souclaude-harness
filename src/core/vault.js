import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import * as ui from '../ui.js'
import { exists, readIfExists, writeFileLF, toPosix } from './fsx.js'
import { pushSeguro, gitReal } from './vault-sync.js'
import { SEMILLAS_PROYECTO, renderSemilla } from './vault-seeds.js'

const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url))

// URL de vault-setup.md en GitHub, derivada de package.json.repository.url en vez de
// hardcodeada: docs/vault-guide.md declara que no se distribuye a repos consumidores
// (es singleton por organizacion), asi que el runbook solo existe aca. Apuntar a una
// ruta local (`docs/vault-setup.md`) desde el mensaje de un repo consumidor apunta a
// un archivo que nunca llega.
export function harnessDocsUrl(rel) {
  const { repository } = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  const base = repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
  return `${base}/blob/main/${rel}`
}

// La config del Vault es de MAQUINA, no de proyecto: la ruta local difiere en
// cada equipo. Por eso no va al lockfile (.claude/harness.json se commitea) ni
// al .env (los agentes lo tienen denegado por permissions.deny en
// .claude/settings.json: "Read(./.env)"). Va a un archivo propio, gitignorado y
// legible por los agentes.
export const VAULT_CONFIG = '.claude/vault.local.json'

const configPath = (cwd) => path.join(cwd, ...VAULT_CONFIG.split('/'))

export function readVaultConfig(cwd) {
  const raw = readIfExists(configPath(cwd))
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.path) return parsed
    } catch {
      // Un JSON corrupto no rompe la instalacion: se trata como "no configurado".
    }
  }
  // Respaldo: la variable de entorno, para quien la exporta a mano o en un runner.
  return process.env.VAULT_PATH ? { path: toPosix(process.env.VAULT_PATH), repo: null } : null
}

export function writeVaultConfig(cwd, { path: vaultPath, repo, project, quien } = {}) {
  // Los campos que el usuario pudo haber puesto a mano (project, quien) se
  // preservan al reescribir: un upgrade no puede borrar en silencio la
  // identidad del contribuyente ni la carpeta Project-* declarada.
  const previo = leerConfigDeArchivo(cwd)
  const contenido = {
    _comentario: 'Config local del Vault. NO se commitea: la ruta es de esta maquina.',
    path: toPosix(vaultPath),
    repo: repo ?? previo?.repo ?? null,
  }
  const proyecto = project ?? previo?.project ?? null
  if (proyecto) contenido.project = proyecto
  const autor = quien ?? previo?.quien ?? null
  if (autor) contenido.quien = autor
  writeFileLF(configPath(cwd), JSON.stringify(contenido, null, 2))
}

// Solo el archivo, sin el respaldo VAULT_PATH: para preservar campos al
// reescribir no debe inventarse una config a partir del entorno.
function leerConfigDeArchivo(cwd) {
  const raw = readIfExists(configPath(cwd))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Un Vault de verdad tiene 00-System/ (id-registry, metodologia, plantillas).
// Es la senal mas barata para distinguirlo de una carpeta cualquiera.
export function looksLikeVault(abs) {
  return exists(path.join(abs, '00-System'))
}

const PREFIJO_PROYECTO = 'Project-'

// Forma valida de una carpeta de proyecto. Sin separadores de ruta ni puntos
// sueltos: el valor se usa como segmento de path contra la raiz del Vault.
const NOMBRE_PROYECTO = /^Project-[A-Za-z0-9_-]+$/

// Las carpetas Project-* que existen hoy en el Vault, ordenadas: el orden de
// readdir depende del sistema de archivos y no puede ser lo que decida cual
// queda como default de una pregunta.
export function carpetasProyecto(vaultPath) {
  try {
    return fs
      .readdirSync(vaultPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith(PREFIJO_PROYECTO))
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
}

// El registro de prefijos del Vault: la fuente unica que dice que prefijo le
// corresponde a cada proyecto de la organizacion (vault-guide §3). Un prefijo
// se agrega solo por una fila nueva -- a mano o desde el flujo interactivo del
// CLI (agregarPrefijoAlRegistro) -- nunca se edita ni se reutiliza una ajena.
const REGISTRO = '00-System/id-registry.md'

// Filas { prefijo, proyecto } de la tabla markdown del registro. Tolerante: un
// registro ausente, ilegible o con otro formato devuelve [] y el llamador sigue
// por los otros caminos -- nunca es un error duro.
export function leerRegistroDePrefijos(vaultPath) {
  let contenido
  try {
    contenido = fs.readFileSync(path.join(vaultPath, ...REGISTRO.split('/')), 'utf8')
  } catch {
    return []
  }

  const filas = []
  for (const linea of contenido.split('\n')) {
    if (!linea.trim().startsWith('|')) continue
    const celdas = linea.split('|').slice(1, -1).map((c) => c.trim())
    if (celdas.length < 2) continue
    const [prefijo, proyecto] = celdas
    // Encabezado y fila de guiones de la tabla.
    if (!prefijo || !proyecto || /^-+$/.test(prefijo) || prefijo.toLowerCase() === 'prefijo') continue
    filas.push({ prefijo, proyecto })
  }
  return filas
}

// Forma valida de un prefijo: 2 a 6 letras mayusculas, el mismo alfabeto que ya
// usan los prefijos existentes (RAM, REA, SHS, OBS...). No numeros ni simbolos:
// el prefijo termina como segmento de ID (SHS-M18) en milestones, ramas y commits.
const PREFIJO_VALIDO = /^[A-Z]{2,6}$/

// Agrega una fila nueva al registro y la pushea -- unica escritura permitida
// sobre id-registry.md (vault-guide §3: solo se agregan filas). No valida
// duplicados: eso lo hace el llamador contra leerRegistroDePrefijos, que ya
// tiene el registro fresco en memoria.
async function agregarPrefijoAlRegistro(vaultPath, { prefijo, proyecto, dueño }, { git = gitReal } = {}) {
  const abs = path.join(vaultPath, ...REGISTRO.split('/'))
  const actual = fs.readFileSync(abs, 'utf8')
  const fecha = new Date().toISOString().slice(0, 10)
  const fila = `| ${prefijo}     | ${proyecto} | ${dueño} | ${fecha}    | activo |\n`
  const conFila = actual.endsWith('\n') ? actual + fila : actual + '\n' + fila
  writeFileLF(abs, conFila)

  return pushSeguro({
    vaultPath,
    mensaje: `chore: alta del prefijo ${prefijo} en el registro`,
    paths: [REGISTRO],
    git,
  })
}

// Nombres con los que este repo puede figurar en el registro, de la senal mas
// confiable a la menos: el "name" de package.json, el repo del remoto git y la
// carpeta. Se comparan EXACTO (solo case-insensitive): una coincidencia
// aproximada seria otra forma de adivinar, que es lo que se esta corrigiendo.
function identidadDelRepo(cwd) {
  const nombres = []
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))
    if (typeof pkg?.name === 'string') nombres.push(pkg.name)
  } catch {
    // Sin package.json o ilegible: quedan las otras dos senales.
  }
  const remoto = nombreDelRemoto(cwd)
  if (remoto) nombres.push(remoto)
  nombres.push(path.basename(cwd))
  return nombres.map((n) => String(n).trim().toLowerCase()).filter(Boolean)
}

function nombreDelRemoto(cwd) {
  try {
    const url = git(['-C', cwd, 'remote', 'get-url', 'origin']).trim()
    return url.replace(/\.git$/, '').split(/[/:]/).pop() || null
  } catch {
    return null
  }
}

// Que proyecto del Vault es este repo, segun el registro. Devuelve la carpeta
// solo si el registro apunta a UNA sola y esa carpeta existe. `esperada` viaja
// aparte para poder distinguir "el registro no me conoce" de "me conoce y su
// carpeta todavia no esta en el Vault": son dos situaciones distintas.
function resolverPorRegistro(cwd, vaultPath, carpetas) {
  const nombres = new Set(identidadDelRepo(cwd))
  const esperadas = [
    ...new Set(
      leerRegistroDePrefijos(vaultPath)
        .filter((f) => nombres.has(f.proyecto.toLowerCase()))
        .map((f) => `${PREFIJO_PROYECTO}${f.prefijo}`)
        .filter((c) => NOMBRE_PROYECTO.test(c))
    ),
  ]
  if (esperadas.length !== 1) return { carpeta: null, esperada: null }

  const esperada = esperadas[0]
  return { carpeta: carpetas.includes(esperada) ? esperada : null, esperada }
}

// Carpeta Project-<PREFIJO> del proyecto: la declarada en vault.local.json
// ("project") o, si el Vault tiene una sola, esa. Mismo criterio que el hook
// declarar-milestone.mjs del template (que no puede importar de src/).
//
// El segundo camino es un RESPALDO para las instalaciones anteriores a
// asegurarProyecto(), que nunca llegaron a escribir "project": acierta mientras
// el Vault tenga un solo proyecto y devuelve null -- en silencio y en todas las
// maquinas a la vez -- en cuanto aparece el segundo. Lo retira T003, una vez que
// la migracion de upgrade haya completado los vault.local.json viejos.
export function carpetaProyecto(vaultPath, config) {
  if (config?.project) return config.project
  const carpetas = carpetasProyecto(vaultPath)
  return carpetas.length === 1 ? carpetas[0] : null
}

// Clonar el Vault -- otro repo git, con la memoria de TODOS los proyectos de la
// organizacion -- adentro del repo que se esta instalando es el peor desenlace
// posible de un prompt mal tipeado. path.relative() en vez de startsWith(): un
// chequeo por prefijo de string confunde /repo con /repo-otro.
export function isInsideCwd(cwd, target) {
  const rel = path.relative(path.resolve(cwd), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// execFile con args en array: nunca pasa por el shell, asi que las rutas con
// espacios (todo OneDrive) dejan de ser un problema. Mismo criterio que gitUserName.
function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts })
}

// Duplica commands/_shared.js#gitUserName en vez de importarla: _shared.js ya
// importa de este modulo (ensureVault), y el import inverso crearia un ciclo.
function gitUserNameLocal(cwd) {
  try {
    return git(['config', 'user.name'], { cwd }).trim() || null
  } catch {
    return null
  }
}

export function vaultRemote(abs) {
  try {
    return git(['-C', abs, 'remote', 'get-url', 'origin']).trim() || null
  } catch {
    return null
  }
}

// Lanza si el clone falla (sin red, sin credenciales, destino ocupado). El
// llamador degrada a warning: el Vault nunca bloquea la instalacion.
export function cloneVault(repo, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  git(['clone', repo, dest], { stdio: 'inherit' })
  return dest
}

function manualHint(repo) {
  ui.log.warn(
    [
      'El repo quedo sin Vault conectado. Para conectarlo despues:',
      `    git clone ${repo} <ruta>`,
      '    npx souclaude upgrade --vault-path <ruta>',
      `Detalle en ${harnessDocsUrl('docs/vault-setup.md')}`,
    ].join('\n')
  )
}

// Paso interactivo del instalador. NUNCA lanza: cualquier fallo se degrada a
// warning y el comando sigue devolviendo 0. El Vault es la vista multi-proyecto,
// no una dependencia dura para tener el harness instalado.
// prompts (default: el modulo real de UI) se puede inyectar en tests para
// ejercer el camino interactivo sin una TTY real ni mockear el modulo entero.
export async function ensureVault({ cwd, flags = {}, manifest, lock, yes, prompts = ui, git = gitReal }) {
  const abs = await conectarVault({ cwd, flags, manifest, lock, yes, prompts })
  if (!abs) return null
  // El contrato de arriba ("nunca lanza") tiene que valer tambien para los pasos
  // que completan la identidad del repo: son datos de conveniencia, no un
  // requisito para tener el harness instalado.
  try {
    await asegurarProyecto(cwd, abs, { flags, yes, prompts, git })
    await asegurarQuien(cwd, { yes, prompts })
  } catch (err) {
    ui.log.warn(`No se pudo completar la config del Vault: ${err.message}`)
  }
  return abs
}

// El "project" de vault.local.json es la carpeta Project-<PREFIJO> a la que
// pertenece este repo. Sin el, carpetaProyecto() lo ADIVINA a partir de cuantas
// carpetas hay en el Vault -- y esa cuenta no la controla este repo: el Vault
// existe justamente para juntar todos los proyectos de la organizacion. Por eso
// se persiste SIEMPRE, incluso cuando hoy la respuesta es obvia: una respuesta
// declarada no depende de como quede el Vault manana.
//
// Prioridad, la misma que resolveSkills: --vault-project explicito > lo ya
// declarado en la config (sticky, como quien) > el registro de prefijos del
// Vault (que ademas puede SEMBRAR la carpeta si todavia no existe) > una sola
// carpeta > preguntar.
// No bloqueante en ningun caso: lo que no se puede resolver termina en un
// warning, nunca en un fallo de la instalacion.
async function asegurarProyecto(cwd, vaultPath, { flags = {}, yes, prompts, git = gitReal }) {
  const config = leerConfigDeArchivo(cwd)
  const carpetas = carpetasProyecto(vaultPath)
  const disponibles = () => `Carpetas disponibles: ${carpetas.join(', ')}.`

  const pedido = typeof flags['vault-project'] === 'string' ? flags['vault-project'].trim() : ''
  if (pedido) {
    // Un Vault sin carpetas todavia (recien clonado, o antes de que T002 siembre
    // la del proyecto) no da contra que contrastar el nombre, asi que al menos
    // la FORMA tiene que ser la de una carpeta de proyecto: "project" termina
    // como segmento de ruta en el monitor, y un "../algo" se saldria del Vault.
    if (!NOMBRE_PROYECTO.test(pedido)) {
      ui.log.warn(`--vault-project: "${pedido}" no es un nombre de carpeta de proyecto (${PREFIJO_PROYECTO}<PREFIJO>). No se declaro proyecto.`)
      return null
    }
    // Un typo persistido es exactamente el bug que este paso viene a cerrar.
    if (carpetas.length && !carpetas.includes(pedido)) {
      ui.log.warn(`--vault-project: "${pedido}" no existe en el Vault. ${disponibles()} No se declaro proyecto.`)
      return null
    }
    return persistirProyecto(cwd, vaultPath, pedido)
  }

  const declarado = typeof config?.project === 'string' ? config.project.trim() : ''
  if (declarado) {
    // Un puntero que quedo apuntando a una carpeta que ya no esta es el mismo
    // fallo silencioso, con otra causa: se avisa, pero no se pisa lo declarado
    // -- corregirlo es una decision del usuario, con --vault-project.
    if (carpetas.length && !carpetas.includes(declarado)) {
      ui.log.warn(`${VAULT_CONFIG} declara "${declarado}", que no existe en el Vault. ${disponibles()}`)
    } else if (carpetas.includes(declarado)) {
      await completarProyectoDeclarado(vaultPath, declarado, { git })
    }
    return declarado
  }

  // El registro de prefijos manda sobre cualquier heuristica de conteo: es la
  // fuente unica de que proyecto es cada repo. Resuelve sin preguntar, asi que
  // tambien completa un `upgrade --yes` sobre una instalacion vieja, que es lo
  // unico que quedaba sin cubrir.
  //
  // Se consulta ANTES del corte por "el Vault no tiene carpetas": un Vault
  // recien clonado que todavia no tiene NINGUNA es justamente el caso que hay
  // que poder sembrar, y cortar antes lo dejaba sin salida.
  const { carpeta: porRegistro, esperada } = resolverPorRegistro(cwd, vaultPath, carpetas)
  if (porRegistro) {
    await completarProyectoDeclarado(vaultPath, porRegistro, { git })
    return persistirProyecto(cwd, vaultPath, porRegistro)
  }

  if (esperada) {
    // El registro sabe cual es su proyecto y su carpeta no esta en el Vault.
    // Es el UNICO caso en que sembrarla no inventa nada: el prefijo ya figura
    // en el registro y apunta a este repo. Caer al "hay una sola, debe ser
    // esa" aca declararia el proyecto de OTRO.
    const sembrada = await sembrarProyecto(vaultPath, esperada, { flags, yes, prompts, git })
    return sembrada ? persistirProyecto(cwd, vaultPath, esperada) : null
  }

  if (!carpetas.length) {
    ui.log.warn(`El Vault todavia no tiene una carpeta ${PREFIJO_PROYECTO}<PREFIJO> para este repo: ${VAULT_CONFIG} queda sin "project".`)
    return null
  }

  // Una sola carpeta se ESCRIBE igual. Es el caso que hoy "funciona" por el
  // respaldo de carpetaProyecto() y el que deja de funcionar sin avisar.
  if (carpetas.length === 1) return persistirProyecto(cwd, vaultPath, carpetas[0])

  // Solo `yes`, sin repetir ui.isCI(): vaultStep ya lo pliega ahi
  // (_shared.js), y volver a mirarlo aca haria el camino interactivo
  // intesteable, que es como termino asegurarQuien. Mismo criterio que
  // conectarVault.
  if (yes) {
    ui.log.warn(`El Vault tiene ${carpetas.length} proyectos y ninguno declarado. ${disponibles()} Pasa --vault-project <${PREFIJO_PROYECTO}XXX>.`)
    return null
  }

  const CREAR_NUEVO = '__crear_nuevo__'
  const elegido = await prompts.select({
    message: 'A que proyecto del Vault pertenece este repo?',
    options: [
      ...carpetas.map((c) => ({ value: c, label: c })),
      { value: CREAR_NUEVO, label: '+ Crear proyecto nuevo...' },
    ],
    initialValue: sugerirProyecto(cwd, carpetas),
  })

  if (elegido === CREAR_NUEVO) {
    const creado = await crearProyectoNuevo(cwd, vaultPath, carpetas, { prompts, git })
    return creado ? persistirProyecto(cwd, vaultPath, creado) : null
  }

  const nombre = String(elegido ?? '').trim()
  return nombre ? persistirProyecto(cwd, vaultPath, nombre) : null
}

// Alta de un prefijo nuevo desde el flujo interactivo: pide prefijo, nombre y
// dueño, agrega la fila al registro (unica escritura permitida sobre
// id-registry.md) y siembra la carpeta en el mismo paso. Solo interactivo: el
// camino desatendido sigue resolviendo por --vault-project o por el registro
// ya existente, nunca inventa un prefijo en silencio.
async function crearProyectoNuevo(cwd, vaultPath, carpetasExistentes, { prompts, git = gitReal }) {
  const registrados = new Set(leerRegistroDePrefijos(vaultPath).map((f) => f.prefijo.toUpperCase()))

  const prefijoIngresado = await prompts.text({
    message: 'Prefijo del proyecto nuevo (2 a 6 letras mayusculas, ej. RAM)',
  })
  const prefijo = String(prefijoIngresado ?? '').trim().toUpperCase()
  if (!PREFIJO_VALIDO.test(prefijo)) {
    ui.log.warn(`Alta de proyecto cancelada: "${prefijoIngresado ?? ''}" no son 2 a 6 letras (A-Z).`)
    return null
  }
  if (registrados.has(prefijo)) {
    ui.log.warn(`Alta de proyecto cancelada: el prefijo ${prefijo} ya esta registrado.`)
    return null
  }
  if (carpetasExistentes.includes(`${PREFIJO_PROYECTO}${prefijo}`)) {
    ui.log.warn(`Alta de proyecto cancelada: ya existe ${PREFIJO_PROYECTO}${prefijo} en el Vault.`)
    return null
  }

  const nombreIngresado = await prompts.text({
    message: `Nombre del proyecto (para ${REGISTRO})`,
  })
  const nombreProyecto = String(nombreIngresado ?? '').trim()
  if (!nombreProyecto) {
    ui.log.warn('Alta de proyecto cancelada: falta el nombre del proyecto.')
    return null
  }

  const dueñoSugerido = gitUserNameLocal(cwd)
  const dueñoIngresado = await prompts.text({
    message: `Dueño del proyecto (para ${REGISTRO}, ej. @usuario)`,
    initialValue: dueñoSugerido ? `@${dueñoSugerido}` : '',
  })
  const dueño = String(dueñoIngresado ?? '').trim() || '[dueño]'

  const carpeta = `${PREFIJO_PROYECTO}${prefijo}`
  const registro = await agregarPrefijoAlRegistro(vaultPath, { prefijo, proyecto: nombreProyecto, dueño }, { git })
  if (registro.ok) {
    ui.log.success(`Prefijo ${prefijo} agregado a ${REGISTRO} (${nombreProyecto} · ${dueño}).`)
  } else {
    // La fila ya quedo escrita en el clon local (agregarPrefijoAlRegistro
    // escribe antes de pushear): igual que sembrarProyecto, un push que falla
    // degrada a warning y sigue -- el proximo push del Vault la empuja.
    ui.log.warn(`Prefijo ${prefijo} agregado en el clon local pero no se pudo publicar (${registro.motivo}). Pushea el Vault a mano.`)
  }

  const sembrada = await sembrarProyecto(vaultPath, carpeta, { flags: { 'vault-seed': true }, yes: true, prompts, git })
  return sembrada
}

// Alta de la carpeta del proyecto en el Vault. Solo se llama cuando el registro
// de prefijos YA asocia este repo a `carpeta` -- la fila la agrega quien llama
// (a mano, o crearProyectoNuevo en el mismo paso), nunca esta funcion.
//
// Esto ESCRIBE en el repo compartido de la organizacion, asi que no pasa nunca
// sin una decision explicita: interactivo, una confirmacion; desatendido, solo
// con --vault-seed. Un `init --yes` de CI no siembra -- correria en cada
// corrida. Nunca lanza: devuelve la carpeta sembrada o null.
// Escribe en `carpeta` los archivos de SEMILLAS_PROYECTO que todavia falten,
// sin pisar lo que ya haya -- una carpeta a medio sembrar (un push que quedo
// por la mitad) o una carpeta ya conectada a la que una version anterior del
// harness no le escribio un archivo que SEMILLAS_PROYECTO agrego despues
// (ej. OBSERVATORIO.md, progress/history.md, SHS-M18). Solo escribe en disco:
// pushear es responsabilidad de quien llama, con su propio mensaje de commit.
function escribirSemillasFaltantes(vaultPath, carpeta) {
  const raiz = path.join(vaultPath, carpeta)
  const escritos = []
  for (const [rel, contenido] of Object.entries(SEMILLAS_PROYECTO)) {
    const abs = path.join(raiz, ...rel.split('/'))
    if (exists(abs)) continue
    writeFileLF(abs, renderSemilla(contenido, carpeta))
    escritos.push(rel)
  }
  return escritos
}

// Backfill de una carpeta YA declarada en vault.local.json: asegurarProyecto
// nunca vuelve a llamar sembrarProyecto para un proyecto ya conocido, asi que
// sin esto un archivo base agregado a SEMILLAS_PROYECTO despues de que la
// carpeta se sembro (por una version vieja del harness) queda huerfano para
// siempre -- ningun `upgrade` posterior lo completa. Se llama en cada
// upgrade/init sobre un proyecto declarado; es idempotente: no hay nada que
// escribir despues del primer backfill exitoso. Nunca lanza: cualquier fallo
// de push degrada a warning, igual que sembrarProyecto.
async function completarProyectoDeclarado(vaultPath, carpeta, { git = gitReal } = {}) {
  const escritos = escribirSemillasFaltantes(vaultPath, carpeta)
  if (!escritos.length) return

  const push = await pushSeguro({
    vaultPath,
    mensaje: `chore: completa archivos base de ${carpeta} en el Vault`,
    paths: [carpeta],
    git,
  })

  if (push.ok) {
    ui.log.success(`${carpeta}: se completaron archivos base que faltaban en el Vault (${escritos.join(', ')}).`)
  } else {
    ui.log.warn(
      `${carpeta}: se completaron archivos base en el clon local del Vault pero no se pudo publicar (${push.motivo}). Pushea el Vault a mano.`
    )
  }
}

async function sembrarProyecto(vaultPath, carpeta, { flags = {}, yes, prompts, git = gitReal }) {
  if (yes) {
    if (!flags['vault-seed']) {
      ui.log.warn(
        `${REGISTRO} asocia este repo a ${carpeta}, que todavia no existe en el Vault. Pasa --vault-seed para crearla; ${VAULT_CONFIG} queda sin "project".`
      )
      return null
    }
  } else {
    const acepta = await prompts.confirm({
      message: `${carpeta}/ no existe en el Vault. Crearla y pushearla?`,
      initialValue: true,
    })
    if (!acepta) {
      ui.log.warn(`${carpeta} no se creo: ${VAULT_CONFIG} queda sin "project".`)
      return null
    }
  }

  const escritos = escribirSemillasFaltantes(vaultPath, carpeta)

  if (!escritos.length) {
    ui.log.warn(`${carpeta} ya tenia sus archivos base: no se sembro nada.`)
    return carpeta
  }

  const push = await pushSeguro({
    vaultPath,
    mensaje: `chore: alta de ${carpeta} en el Vault`,
    paths: [carpeta],
    git,
  })

  if (push.ok) {
    ui.log.success(`${carpeta} sembrada en el Vault y pusheada (${escritos.join(', ')}).`)
  } else {
    // Los archivos ya estan en el clon local: el proximo push del Vault los
    // empuja. Avisar es obligatorio -- el tablero todavia no lo ve nadie mas.
    ui.log.warn(`${carpeta} se creo en el clon local del Vault pero no se pudo publicar (${push.motivo}). Pushea el Vault a mano.`)
  }
  return carpeta
}

// Default de la pregunta: la carpeta cuyo prefijo coincide con el nombre del
// repo (un repo "shs" sugiere Project-SHS). Sin coincidencia devuelve undefined
// y la lista se muestra tal cual: adivinar un default a partir de nada es
// justamente lo que se esta corrigiendo.
function sugerirProyecto(cwd, carpetas) {
  const base = path.basename(cwd).toLowerCase()
  return carpetas.find((c) => c.slice(PREFIJO_PROYECTO.length).toLowerCase() === base)
}

function persistirProyecto(cwd, vaultPath, project) {
  // Sin repo explicito: writeVaultConfig preserva el que finish() acaba de
  // escribir, igual que preserva quien.
  writeVaultConfig(cwd, { path: vaultPath, project })
  ui.log.success(`Proyecto del Vault declarado: ${project} (${VAULT_CONFIG})`)
  return project
}

// El "quien" de vault.local.json es el eje CONTRIBUYENTE del registro de
// consumo (ADR 20260820): sin el, el monitor degrada al alias de la cuenta.
// Se pregunta UNA vez (solo interactivo, solo si falta) y queda persistido;
// con --yes o en CI se omite en silencio — nunca es bloqueante.
async function asegurarQuien(cwd, { yes, prompts }) {
  if (yes || ui.isCI()) return
  // Solo el archivo real: si la config viene del respaldo VAULT_PATH (env),
  // preguntar aqui persistiria esa ruta en un archivo que el usuario no creo.
  const config = leerConfigDeArchivo(cwd)
  if (!config?.path || (typeof config.quien === 'string' && config.quien.trim() !== '')) return

  const respuesta = await prompts.text({
    message: 'Alias del contribuyente para el registro de consumo del Vault (campo "quien"; vacio para omitir)',
    initialValue: '',
  })
  const quien = String(respuesta ?? '').trim()
  if (!quien) return
  writeVaultConfig(cwd, { path: config.path, repo: config.repo ?? null, quien })
  ui.log.success(`Contribuyente registrado: "${quien}" (${VAULT_CONFIG})`)
}

async function conectarVault({ cwd, flags = {}, manifest, lock, yes, prompts = ui }) {
  if (flags.vault === false) {
    ui.log.info('--no-vault: no se toca la conexion con el Vault.')
    return null
  }

  const repo = flags['vault-repo'] ?? lock?.vars?.VAULT_REPO ?? manifest?.vault?.repo ?? null
  const configured = flags['vault-path'] ?? readVaultConfig(cwd)?.path ?? null

  if (configured) {
    const abs = path.resolve(cwd, configured)
    if (exists(abs)) {
      if (!looksLikeVault(abs)) {
        ui.log.warn(`${configured} no tiene 00-System/: no parece un Vault. Se usa igual.`)
      }
      return finish(cwd, abs, repo)
    }
    ui.log.warn(`La ruta configurada del Vault ya no existe: ${configured}`)
  }

  const destino = path.join(path.dirname(cwd), 'soubunker-vault')

  // Autodeteccion: si el sibling de siempre ya esta clonado y parece un Vault,
  // conectar directo. Ahorra las preguntas en el caso mas comun -- alguien que ya
  // clono el Vault junto a OTRO repo de la organizacion en esta misma maquina.
  if (exists(destino) && looksLikeVault(destino)) {
    return finish(cwd, destino, repo)
  }

  // Con --yes o en CI no se clona salvo pedido explicito (--vault-clone): git
  // clone es red y disco, y en CI correria en cada corrida.
  if (yes) {
    if (flags['vault-clone'] && repo) {
      return clonarSinPreguntar(cwd, repo, flags['vault-path'] ?? destino)
    }
    ui.log.warn('Modo no interactivo: el Vault no se conecto (usa --vault-path o --vault-clone).')
    if (repo) manualHint(repo)
    return null
  }

  if (!repo) {
    ui.log.warn('No hay URL del Vault en el manifest. Pasa --vault-repo para clonarlo.')
    return null
  }

  return clonarInteractivo(cwd, repo, destino, prompts)
}

// Camino feliz: UNA pregunta (antes eran dos: "tenes el Vault?" -> "donde lo
// clono?") -- confirmar el destino sugerido, que el propio CLI calcula y que
// por construccion nunca cae dentro de cwd. Quien lo rechaza recien ahi tipea
// una ruta -- y es ahi, no antes, donde isInsideCwd importa: reintenta -- nunca
// clona -- mientras la ruta tipeada caiga dentro del repo del proyecto.
async function clonarInteractivo(cwd, repo, destinoSugerido, prompts) {
  const acepta = await prompts.confirm({ message: `Clonar ${repo} en ${destinoSugerido}?`, initialValue: true })
  let abs = path.resolve(cwd, destinoSugerido)

  if (!acepta) {
    const ruta = await prompts.text({ message: 'Donde clonar el Vault? (vacio para cancelar)', initialValue: '' })
    if (!String(ruta).trim()) {
      manualHint(repo)
      return null
    }
    abs = path.resolve(cwd, String(ruta).trim())
    while (isInsideCwd(cwd, abs)) {
      ui.log.warn(`${toPosix(abs)} queda dentro de este repo: el Vault no puede clonarse ahi.`)
      const otra = await prompts.text({
        message: 'Donde clono el Vault? (tiene que quedar fuera de este repo)',
        initialValue: destinoSugerido,
      })
      abs = path.resolve(cwd, String(otra).trim())
    }
  }

  return clonar(cwd, repo, abs)
}

// Camino no interactivo (--vault-clone --yes): sin nadie a quien reprEguntarle,
// una ruta dentro del repo aborta el paso entero en vez de reintentar.
function clonarSinPreguntar(cwd, repo, destino) {
  const abs = path.resolve(cwd, destino)
  if (isInsideCwd(cwd, abs)) {
    ui.log.warn(`${toPosix(abs)} queda dentro de este repo: el Vault no se clono. Pasa --vault-path con una ruta afuera.`)
    manualHint(repo)
    return Promise.resolve(null)
  }
  return clonar(cwd, repo, abs)
}

async function clonar(cwd, repo, abs) {
  try {
    cloneVault(repo, abs)
    ui.log.success(`Vault clonado en ${abs}`)
    return finish(cwd, abs, repo)
  } catch (err) {
    ui.log.warn(`No se pudo clonar el Vault: ${err.message.trim().split('\n').pop()}`)
    manualHint(repo)
    return null
  }
}

function finish(cwd, abs, repo) {
  const remoto = vaultRemote(abs)
  writeVaultConfig(cwd, { path: abs, repo: remoto ?? repo })

  if (repo && remoto && remoto.replace(/\.git$/, '') !== repo.replace(/\.git$/, '')) {
    ui.log.warn(`El remoto del Vault (${remoto}) no es el canonico (${repo}).`)
  }

  const gitignore = readIfExists(path.join(cwd, '.gitignore')) ?? ''
  if (!gitignore.includes(VAULT_CONFIG)) {
    ui.log.warn(`Agrega ${VAULT_CONFIG} a tu .gitignore: la ruta es de esta maquina y no debe viajar.`)
  }

  ui.log.success(`Vault conectado: ${toPosix(abs)} (${VAULT_CONFIG})`)
  return abs
}
