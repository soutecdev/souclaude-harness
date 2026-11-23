import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { exists, listEntries } from './fsx.js'
import { detect } from './detect.js'
import { readLockfile } from './lockfile.js'
import {
  readVaultConfig,
  looksLikeVault,
  carpetasProyecto,
  leerRegistroDePrefijos,
  resolverPorRegistro,
  comandoNpx,
  enOneDrive,
  rutasDelVault,
  quienPorDefecto,
} from './vault.js'

// SHS-M53: el diagnostico es la foto de solo lectura que le permite al agente
// (o a una persona) saber EN QUE CASO de instalacion esta parado antes de tocar
// nada. Dos mitades a proposito: recolectar() habla con el disco, git y gh;
// clasificar() es pura y decide el caso -- asi cada casuistica se testea con un
// objeto de hechos, sin montar un repo por cada una.

// Version minima de Node. Duplicada en bin/cli.mjs (que no puede importar nada
// antes de comprobarla) y en package.json#engines: un test las mantiene iguales.
export const NODE_MINIMO = [22, 4]

export function nodeCumple(version) {
  const [mayor, menor] = String(version).replace(/^v/, '').split('.').map(Number)
  return mayor > NODE_MINIMO[0] || (mayor === NODE_MINIMO[0] && menor >= NODE_MINIMO[1])
}

// Estructura Claude hecha a mano: lo que hace que la autodeteccion del CLI
// elija `adopt` en vez de `init` (ver autoDetect en cli.js, que importa esto).
export const ESTRUCTURA_PREVIA = ['CLAUDE.md', '.claude', 'docs/constitution.md', 'specs/_templates']

export const CASOS = [
  'proyecto-desde-cero',
  'carpeta-sin-git',
  'repo-sin-remoto',
  'repo-vacio',
  'repo-con-codigo',
  'estructura-previa',
  'maquina-nueva',
  'harness-desactualizado',
  'harness-al-dia',
]

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    ...opts,
    // Nunca abrir un prompt de credenciales: el diagnostico es desatendido.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env ?? {}) },
  }).trim()
}

function intenta(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}

// Las rutas se comparan resueltas: en Windows el temporal puede venir en forma
// corta (IALVAR~1) y git devuelve la larga con barras normales.
function mismaRuta(a, b) {
  const real = (p) => intenta(() => fs.realpathSync.native(p)) ?? path.resolve(p)
  const [ra, rb] = [real(a), real(b)]
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

// owner/repo de una URL de GitHub (https o ssh). null si el remoto es otro host.
export function slugDeGitHub(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? ''))
  return m ? `${m[1]}/${m[2]}` : null
}

// Una URL de remoto puede llevar credenciales embebidas
// (https://usuario:token@host/...). El diagnostico se imprime, lo lee un agente
// y termina en transcripciones, PRs y tickets: la URL sale siempre sin ellas.
export function sinCredenciales(url) {
  return url ? String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, '$1') : url
}

function leerMaquina(correr) {
  const git = intenta(() => correr('git', ['--version']))
  const gh = intenta(() => correr('gh', ['--version']))
  return {
    node: { version: process.versions.node, minimo: NODE_MINIMO.join('.'), ok: nodeCumple(process.versions.node) },
    git: { instalado: git !== null, version: git?.replace(/^git version\s*/, '') ?? null },
    gh: {
      instalado: gh !== null,
      autenticado: gh !== null && intenta(() => correr('gh', ['auth', 'status'])) !== null,
    },
  }
}

function leerRepo(cwd, correr) {
  const g = (...args) => intenta(() => correr('git', ['-C', cwd, ...args]))
  const raiz = g('rev-parse', '--show-toplevel')
  if (!raiz) return { esRepo: false }

  const remoto = sinCredenciales(g('remote', 'get-url', 'origin') || null)
  // Las ramas del remoto se preguntan al remoto (ls-remote), no a las refs
  // locales: un clon sin fetch reciente diria que `dev` no existe. Sin red o sin
  // credenciales queda en null -- "no se pudo saber", que no es lo mismo que no.
  let ramasRemotas = null
  if (remoto) {
    const salida = g('ls-remote', '--heads', 'origin')
    if (salida !== null) {
      const cabezas = salida.split('\n').map((l) => l.split('\t')[1]).filter(Boolean)
      ramasRemotas = { main: cabezas.includes('refs/heads/main'), dev: cabezas.includes('refs/heads/dev') }
    }
  }
  const local = (rama) => g('rev-parse', '--verify', '--quiet', `refs/heads/${rama}`) !== null

  return {
    esRepo: true,
    raiz,
    enRaiz: mismaRuta(raiz, cwd),
    rama: g('symbolic-ref', '--short', 'HEAD'),
    tieneCommits: g('rev-parse', '--verify', '--quiet', 'HEAD') !== null,
    arbolLimpio: g('status', '--porcelain') === '',
    remoto,
    github: slugDeGitHub(remoto),
    ramasLocales: { main: local('main'), dev: local('dev') },
    ramasRemotas,
  }
}

function leerHarness(cwd, manifest) {
  let lock = null
  let lockCorrupto = false
  try {
    lock = readLockfile(cwd)
  } catch {
    lockCorrupto = true
  }
  return {
    instalado: lock !== null,
    version: lock?.harnessVersion ?? null,
    disponible: manifest.harnessVersion,
    modo: lock?.modo ?? null,
    skills: lock?.skills ?? null,
    lockCorrupto,
    estructuraPrevia: ESTRUCTURA_PREVIA.filter((p) => exists(path.join(cwd, ...p.split('/')))),
  }
}

function leerVault(cwd) {
  const config = readVaultConfig(cwd)
  const { destino, detectado } = rutasDelVault(cwd)
  const base = {
    configurado: false,
    // Clon del Vault que ya esta en uno de los lugares de siempre (junto al
    // repo o en ~/repos): `init` lo conecta solo.
    hermano: detectado ? detectado.replace(/\\/g, '/') : null,
    // Donde lo clona `--vault-clone` si no esta: nadie tiene que elegir la ruta.
    destino: destino.replace(/\\/g, '/'),
  }
  // Sin config, el hermano de siempre es el Vault que `init` conectaria solo:
  // se lee igual para poder decir si el proyecto ya esta dado de alta.
  const ruta = config?.path ? path.resolve(cwd, config.path) : base.hermano
  if (!ruta) return base

  const existe = exists(ruta)
  const carpetas = existe ? carpetasProyecto(ruta) : []
  const proyecto = typeof config?.project === 'string' ? config.project : null
  return {
    ...base,
    configurado: Boolean(config?.path),
    origen: config?.origen ?? null,
    ruta: ruta.replace(/\\/g, '/'),
    existe,
    pareceVault: existe && looksLikeVault(ruta),
    proyecto,
    proyectoExiste: proyecto ? carpetas.includes(proyecto) : false,
    quien: config?.quien ?? null,
    // Alias que el instalador registra solo si falta (SHS-M54).
    quienPorDefecto: quienPorDefecto(cwd)?.quien ?? null,
    proyectos: carpetas,
    prefijosRegistrados: existe ? leerRegistroDePrefijos(ruta).map((f) => f.prefijo) : [],
    // Carpeta que el registro de prefijos le asigna a este repo (exista o no).
    segunRegistro: existe ? resolverPorRegistro(cwd, ruta, carpetas).esperada : null,
  }
}

export function recolectar(cwd, { correr = sh, manifest }) {
  const entradas = listEntries(cwd)
  const detectado = detect(cwd)
  return {
    maquina: leerMaquina(correr),
    carpeta: {
      ruta: cwd.replace(/\\/g, '/'),
      vacia: entradas.length === 0,
      soloAndamiaje: detectado.isEmpty,
      enOneDrive: enOneDrive(cwd),
      stack: detectado.stackLabel,
      nombre: detectado.projectName,
    },
    repo: leerRepo(cwd, correr),
    harness: leerHarness(cwd, manifest),
    vault: leerVault(cwd),
  }
}

// De los hechos al veredicto. Pura: no toca disco ni procesos.
//   caso       en cual de las casuisticas de instalacion esta la carpeta
//   comando    que comando del CLI corresponde (null: todavia ninguno)
//   bloqueos   impiden instalar: se resuelven ANTES de correr nada
//   avisos     no impiden instalar, pero dejan la metodologia incompleta
//   pendientes pasos previos o posteriores que el instalador no hace solo
export function clasificar(h) {
  const { maquina, carpeta, repo, harness, vault } = h
  const bloqueos = []
  const avisos = []
  const pendientes = []
  const bloqueo = (id, mensaje, solucion) => bloqueos.push({ id, mensaje, solucion })
  const aviso = (id, mensaje, solucion) => avisos.push({ id, mensaje, solucion })
  const pendiente = (id, mensaje) => pendientes.push({ id, mensaje })

  if (!maquina.node.ok) {
    bloqueo('node', `Node ${maquina.node.version} es anterior al minimo (${maquina.node.minimo}).`, 'Instala Node 22.4 o superior y reabre la terminal.')
  }
  if (!maquina.git.instalado) {
    bloqueo('git', 'git no esta instalado o no esta en el PATH.', 'Instala git y reabre la terminal.')
  }
  if (!maquina.gh.instalado) {
    aviso('gh', 'GitHub CLI (gh) no esta instalado: sin el no se crean repos, PRs ni la proteccion de main.', 'Instala gh (https://cli.github.com), reabre la terminal y corre `gh auth login`.')
  } else if (!maquina.gh.autenticado) {
    aviso('gh-auth', 'GitHub CLI (gh) no esta autenticado.', 'Corre `gh auth login` y elige GitHub.com, HTTPS y login por navegador.')
  }
  if (carpeta.enOneDrive) {
    aviso('onedrive', 'La carpeta esta dentro de OneDrive: la sincronizacion puede corromper .git y crear copias en conflicto.', 'Mueve el repo a una ruta fuera de OneDrive (por ejemplo C:/repos) antes de instalar, si puedes.')
  }
  if (harness.lockCorrupto) {
    bloqueo('lockfile-corrupto', '.claude/harness.json existe pero no se puede leer.', 'Restaura el archivo desde git (`git checkout -- .claude/harness.json`); no lo edites a mano.')
  }
  if (repo.esRepo && !repo.enRaiz) {
    bloqueo('subdirectorio', `Esta carpeta es un subdirectorio del repo ${repo.raiz}: el harness se instala en la raiz.`, `Abre la sesion en ${repo.raiz} y repite el diagnostico.`)
  }

  let caso
  let comando = null
  if (!repo.esRepo) {
    caso = carpeta.vacia ? 'proyecto-desde-cero' : 'carpeta-sin-git'
    comando = harness.estructuraPrevia.length ? 'adopt' : 'init'
    pendiente('git-init', 'Inicializar el repo: `git init -b main`.')
    pendiente('crear-repo-github', 'Crear el repo en GitHub con `gh repo create` (solo con la confirmacion explicita del usuario) y conectarlo como origin.')
    // Sin repo no hay nada que consultar, pero el camino completo se conoce de
    // antemano: se lista entero para que quien lo siga no se quede a mitad.
    pendiente('primer-commit', 'Hacer el commit inicial en main: sin el no puede nacer dev.')
    pendiente('pushear-main', 'Pushear main a origin.')
    pendiente('crear-dev', 'Crear la rama dev desde main y pushearla (solo en modo equipo).')
  } else if (harness.instalado) {
    comando = 'upgrade'
    // La config de maquina (o el hermano) dice que el Vault esta en este equipo,
    // pero el vault.local.json de ESTE repo todavia no existe: es la primera vez
    // que se abre aca, y `upgrade` es quien lo conecta.
    if (!vault.configurado || vault.origen !== 'repo') caso = 'maquina-nueva'
    else caso = harness.version === harness.disponible ? 'harness-al-dia' : 'harness-desactualizado'
    if (caso === 'harness-al-dia') comando = null
  } else if (harness.estructuraPrevia.length) {
    caso = 'estructura-previa'
    comando = 'adopt'
  } else {
    comando = 'init'
    if (!repo.remoto) caso = 'repo-sin-remoto'
    else caso = carpeta.soloAndamiaje ? 'repo-vacio' : 'repo-con-codigo'
  }

  if (repo.esRepo) {
    if (!repo.remoto) {
      pendiente('crear-repo-github', 'El repo no tiene remoto origin: crear el repo en GitHub con `gh repo create` (solo con la confirmacion explicita del usuario) o conectar uno existente.')
    } else if (!repo.github) {
      aviso('remoto-no-github', `El remoto (${repo.remoto}) no es de GitHub: la proteccion de main y los PR por gh no aplican.`, 'Confirma con el usuario si el repo debe vivir en GitHub.')
    }
    if (!repo.tieneCommits) pendiente('primer-commit', 'El repo no tiene commits: hace falta un commit inicial en main antes de crear dev.')
    // En modo solo no hay rama dev: el flujo del modo es directo a main.
    if (harness.modo !== 'solo') {
      if (repo.ramasRemotas === null && repo.remoto) {
        aviso('remoto-inaccesible', 'No se pudo consultar el remoto (sin red, sin credenciales o sin permiso).', 'Verifica `gh auth status` y que tengas acceso al repo.')
      }
      const hayDev = repo.ramasRemotas?.dev || repo.ramasLocales.dev
      if (!hayDev) pendiente('crear-dev', 'No existe la rama dev: crearla desde main y pushearla (en modo equipo todo PR apunta a dev).')
      else if (repo.ramasRemotas && !repo.ramasRemotas.dev) pendiente('pushear-dev', 'La rama dev existe solo en local: pushearla a origin.')
      if (repo.ramasRemotas && !repo.ramasRemotas.main) {
        pendiente('pushear-main', 'main todavia no existe en el remoto: sin ella la proteccion de main queda pendiente (se aplica con `upgrade` cuando exista).')
      }
    }
    if (!repo.arbolLimpio && !harness.instalado) {
      aviso('arbol-sucio', 'Hay cambios sin commitear: se mezclarian con los archivos del harness.', 'Commitea o guarda (`git stash`) los cambios antes de instalar.')
    }
  }

  if (!vault.configurado && !vault.hermano) {
    pendiente('conectar-vault', `El Vault no esta en esta maquina: \`--vault-clone\` lo clona solo en ${vault.destino ?? 'su ruta por defecto'} (fuera del repo y de OneDrive).`)
  } else if (vault.ruta && !vault.existe) {
    aviso('vault-ruta', `La ruta configurada del Vault ya no existe: ${vault.ruta}.`, 'Vuelve a clonarlo o corrige la ruta con `--vault-path`.')
  } else if (vault.ruta && !vault.pareceVault) {
    aviso('vault-invalido', `${vault.ruta} no tiene 00-System/: no parece el Vault.`, 'Indica la ruta correcta con `--vault-path`.')
  } else if (vault.ruta) {
    if (vault.proyecto && !vault.proyectoExiste) {
      aviso('vault-proyecto', `vault.local.json declara ${vault.proyecto}, que no existe en el Vault.`, `Corrige con \`--vault-project\`. Carpetas: ${vault.proyectos.join(', ') || 'ninguna'}.`)
    } else if (!vault.proyecto) {
      if (vault.segunRegistro) {
        pendiente('declarar-proyecto', `El registro del Vault asocia este repo a ${vault.segunRegistro}: se declara solo${vault.proyectos.includes(vault.segunRegistro) ? '' : ' (pasar `--vault-seed` para crear la carpeta)'}.`)
      } else {
        pendiente('alta-prefijo', 'Este repo no figura en el registro del Vault: elegir con el usuario un proyecto existente (`--vault-project`) o dar de alta uno nuevo con `--vault-prefix <XXX>` (el nombre y el dueño se deducen).')
      }
    }
    if (!vault.quien && !vault.quienPorDefecto) pendiente('quien', 'Falta el alias del contribuyente y no se pudo deducir de git: `--vault-quien <alias>`.')
  }

  return { caso, comando, bloqueos, avisos, pendientes }
}

export function diagnosticar(cwd, opciones) {
  const hechos = recolectar(cwd, opciones)
  // El catalogo de skills viaja en el diagnostico: quien instala por flags
  // (--skills) necesita los ids y a que modo pertenece cada una.
  const catalogoSkills = (opciones.manifest.skills ?? []).map((s) => ({
    id: s.id,
    descripcion: s.label ?? s.id,
    obligatoria: Boolean(s.required),
    modos: s.modos ?? ['equipo', 'solo'],
  }))
  return { ...clasificar(hechos), invocacion: comandoNpx(), ...hechos, catalogoSkills }
}
