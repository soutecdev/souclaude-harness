// Hook SessionStart del harness en modo solo (managed): traza por worklog.
//
// En modo solo no hay milestones que declarar: la trazabilidad es una linea
// por bloque de trabajo en Project-<PREFIJO>/worklog.md del Vault, pusheada al
// momento de empezar el bloque. Este hook inyecta la regla y las ultimas
// lineas del worklog para retomar contexto. No valida ni bloquea: la sesion
// nunca se corta por el Vault — exit 0 siempre.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REGLA = [
  '[harness] Modo solo: la trazabilidad vive en Project-<PREFIJO>/worklog.md del Vault.',
  'Al empezar cada bloque de trabajo agrega al final una linea con fecha y objetivo',
  '("- 2026-09-15 · migrando auth a OAuth") y pushea en el momento',
  '(souclaude vault-sync --push -m "docs: worklog" --paths Project-<PREFIJO>).',
  'Si el objetivo cambia, otra linea.',
]

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'))
  } catch {
    return null
  }
}

// Carpeta Project-<PREFIJO> del proyecto: la declarada en vault.local.json
// ("project") o, si hay una sola en el Vault, esa. Mismo criterio que el hook
// declarar-milestone.mjs del modo equipo.
function carpetaProyecto(vaultPath, config) {
  if (config?.project) return config.project
  try {
    const carpetas = fs
      .readdirSync(vaultPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('Project-'))
      .map((d) => d.name)
    return carpetas.length === 1 ? carpetas[0] : null
  } catch {
    return null
  }
}

// Refresco best-effort contra el remoto, con timeout corto y sin prompts de
// credenciales. Si no hay red o remoto, se lee el estado local y ya.
const REFRESCO_TIMEOUT_MS = 5000

function gitRefresco(args) {
  try {
    execFileSync('git', args, {
      stdio: 'ignore',
      timeout: REFRESCO_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return true
  } catch {
    return false
  }
}

// Ultimas lineas de traza del worklog (las viñetas "- ..."), para retomar el
// contexto del trabajo anterior. null = el archivo no existe.
const ULTIMAS = 5

function ultimasLineasWorklog(rutaMd) {
  let contenido
  try {
    contenido = fs.readFileSync(rutaMd, 'utf8')
  } catch {
    return null
  }
  const lineas = contenido
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
  return lineas.slice(-ULTIMAS)
}

// --- Aviso de version nueva del harness (SHS-M43) ---------------------------
//
// El canal de "hay version nueva" deja de ser un mensaje privado: este hook
// compara la version instalada (harnessVersion del lockfile .claude/harness.json)
// contra el ultimo tag vX.Y.Z del repo del harness y lo anuncia al inicio de la
// sesion. La consulta es un git ls-remote de solo lectura con cache por maquina
// (TTL 24 h; ante fallo, backoff de 1 h y se usa lo ultimo conocido): cuesta una
// consulta por dia, no una por sesion. Nunca interrumpe: sin red, sin
// credenciales, sin lockfile o en el repo del propio generador (su lockfile
// dogfood corre atras del manifest a proposito), silencio y listo. Mismo bloque
// que el hook declarar-milestone.mjs del modo equipo.
const VERSION_TTL_MS = 24 * 60 * 60 * 1000
const VERSION_BACKOFF_MS = 60 * 60 * 1000
const HARNESS_REMOTO =
  process.env.SOUCLAUDE_HARNESS_REMOTO ?? 'https://github.com/soutecdev/souclaude-harness.git'

function compararSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// Ultimo tag vX.Y.Z por major ({ "3": "3.16.2", ... }). Los tags moviles de
// major (v1, v3) no son versiones y quedan afuera.
function ultimaPorMajor(tags) {
  const porMajor = {}
  for (const tag of tags) {
    const m = tag.match(/^v(\d+\.\d+\.\d+)$/)
    if (!m) continue
    const major = m[1].split('.')[0]
    if (!porMajor[major] || compararSemver(m[1], porMajor[major]) > 0) porMajor[major] = m[1]
  }
  return porMajor
}

function tagsDelRemoto() {
  const salida = execFileSync('git', ['ls-remote', '--tags', '--refs', HARNESS_REMOTO], {
    encoding: 'utf8',
    timeout: REFRESCO_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return salida
    .split('\n')
    .map((linea) => linea.split('\t')[1]?.replace(/^refs\/tags\//, ''))
    .filter(Boolean)
}

// Cache por maquina, junto al resto del estado de souclaude. El home se
// resuelve como en src/core/vault.js (os.homedir(), nunca $HOME;
// SOUCLAUDE_CLAUDE_HOME lo redirige en tests).
function rutaCacheVersion() {
  const home = process.env.SOUCLAUDE_CLAUDE_HOME ?? path.join(os.homedir(), '.claude')
  return path.join(home, 'souclaude', 'version-check.json')
}

function escribirCacheVersion(ruta, datos) {
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
    fs.writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n')
  } catch {
    // La cache es mejor-esfuerzo: sin ella solo se consulta mas seguido.
  }
}

function ultimaConocidaPorMajor(ahoraMs) {
  const ruta = rutaCacheVersion()
  const cache = leerJson(ruta) ?? {}
  const fresca = cache.consultadoEn != null && ahoraMs - Date.parse(cache.consultadoEn) < VERSION_TTL_MS
  if (fresca && cache.ultimaPorMajor) return cache.ultimaPorMajor
  const enBackoff = cache.falloEn != null && ahoraMs - Date.parse(cache.falloEn) < VERSION_BACKOFF_MS
  if (enBackoff) return cache.ultimaPorMajor ?? null
  try {
    const porMajor = ultimaPorMajor(tagsDelRemoto())
    escribirCacheVersion(ruta, { consultadoEn: new Date(ahoraMs).toISOString(), ultimaPorMajor: porMajor })
    return porMajor
  } catch {
    escribirCacheVersion(ruta, { ...cache, falloEn: new Date(ahoraMs).toISOString() })
    return cache.ultimaPorMajor ?? null
  }
}

function avisoVersionNueva(root) {
  try {
    // El repo del propio generador no se avisa a si mismo.
    if (fs.existsSync(path.join(root, 'templates', 'harness.manifest.json'))) return []
    const lock = leerJson(path.join(root, '.claude', 'harness.json'))
    const instalada =
      typeof lock?.harnessVersion === 'string' && /^\d+\.\d+\.\d+$/.test(lock.harnessVersion)
        ? lock.harnessVersion
        : null
    if (!instalada || instalada === '0.0.0') return []
    const porMajor = ultimaConocidaPorMajor(Date.now())
    if (!porMajor) return []
    const lineas = []
    const major = instalada.split('.')[0]
    const ultima = porMajor[major]
    if (ultima && compararSemver(ultima, instalada) > 0) {
      lineas.push(`Version nueva del harness: v${ultima} (instalada: v${instalada}).`)
      lineas.push('Avisale al usuario una sola vez y ofrecele actualizar con la skill harness-upgrade; luego sigue con lo que pidio.')
    }
    const majorsNuevas = Object.keys(porMajor)
      .map(Number)
      .filter((m) => m > Number(major))
    if (majorsNuevas.length) {
      const mayor = String(Math.max(...majorsNuevas))
      lineas.push(
        `Major nueva del harness: v${porMajor[mayor]} (instalada: v${instalada}). La migracion de major es manual: mencionasela al usuario (README del harness, "Versionado y publicacion").`
      )
    }
    return lineas
  } catch {
    // El aviso jamas rompe una sesion.
    return []
  }
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const salida = [...REGLA]
  salida.push(...avisoVersionNueva(root))

  const config = leerJson(path.join(root, '.claude', 'vault.local.json'))
  const vaultPath = config?.path ?? process.env.VAULT_PATH ?? null

  if (!vaultPath || !fs.existsSync(vaultPath)) {
    salida.push('Vault no configurado en esta maquina: no hay worklog que leer — pide el contexto al usuario.')
    console.log(salida.join('\n'))
    return
  }

  // El Vault se actualiza antes de leerlo (pull solo fast-forward: si el clon
  // local divergio, no se toca nada y se lee tal cual esta).
  const vaultAlDia = gitRefresco(['-C', vaultPath, 'pull', '--ff-only', '--quiet'])

  const proyecto = carpetaProyecto(vaultPath, config)
  if (!proyecto) {
    salida.push('No se pudo determinar la carpeta Project-<PREFIJO> del Vault: pregunta al usuario cual es.')
    console.log(salida.join('\n'))
    return
  }

  const lineas = ultimasLineasWorklog(path.join(vaultPath, proyecto, 'worklog.md'))
  if (lineas == null) {
    salida.push(
      `${proyecto}/worklog.md no existe todavia: crealo con la linea del primer bloque (npx souclaude upgrade tambien lo siembra).`
    )
  } else {
    salida.push(
      vaultAlDia
        ? `Ultimas lineas de ${proyecto}/worklog.md (recien sincronizado con el remoto):`
        : `Ultimas lineas de ${proyecto}/worklog.md (no se pudo sincronizar con el remoto — puede estar desactualizado):`
    )
    if (lineas.length === 0) salida.push('  (vacio: este es el primer bloque de trabajo)')
    for (const l of lineas) salida.push(`  ${l}`)
  }

  console.log(salida.join('\n'))
}

try {
  main()
} catch {
  // Este hook jamas rompe una sesion: ante cualquier fallo, solo la regla.
  console.log(REGLA.join('\n'))
}
