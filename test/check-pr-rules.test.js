import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  evaluaRama,
  evaluaCommits,
  evaluaSeccionesCompletas,
  evaluaVersion,
  esArchivoDeSecreto,
  evaluaSecretos,
  rutasDeSalidaZ,
  contextoDelCheck,
  esperaMergeable,
  ultimoTagDe,
  describeError,
} from '../scripts/check-pr-rules.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/check-pr-rules.mjs', import.meta.url))

// La norma de la skill soutec-github admite DOS formas de rama, y las dos son
// contrato: tipo/descripcion-corta a secas, o tipo/ID-descripcion-corta donde
// el ID en mayusculas es milestone del Vault (una rama por milestone) o tracker
// externo. Las ramas por tarea (-T<nnn>) ya no son la norma, pero siguen
// validando para no romper ramas abiertas antes del cambio.

test('evaluaRama: acepta la forma simple tipo/descripcion-corta', () => {
  const validas = [
    'feature/captura-lead',
    'fix/error-integracion-odoo',
    'hotfix/correccion-produccion',
    'docs/onboarding-auth-gh',
    'chore/actualizar-dependencias',
    'refactor/mejorar-estructura-api',
    'experiment/prueba-modelo-rag',
  ]
  for (const rama of validas) {
    assert.equal(evaluaRama(rama).cumple, true, rama)
  }
})

test('evaluaRama: acepta puntos en el slug (bump de version)', () => {
  const validas = ['chore/bump-3.6.0', 'feature/SHS-M15-T001-bump-3.5.0']
  for (const rama of validas) {
    assert.equal(evaluaRama(rama).cumple, true, rama)
  }
})

test('evaluaRama: acepta el prefijo de ID en sus tres variantes', () => {
  const validas = [
    'feature/M7-playbook-adopcion', // milestone del Vault (la norma)
    'fix/M10-chequeo-gh',
    
    'feature/M31-rama-por-milestone',
    'feature/CSC-M1-alta-de-milestones', // con clave de proyecto, sigue validando
    'feature/SHS-M7-T006-playbook-adopcion', // rama por tarea legada, sigue validando
    'fix/SHS-M7-T007-check-pr-reglas',
    'feature/REA-123-captura-lead', // tracker externo
  ]
  for (const rama of validas) {
    assert.equal(evaluaRama(rama).cumple, true, rama)
  }
})

test('evaluaRama: rechaza lo que ninguna de las dos formas permite', () => {
  const invalidas = [
    'feature/Mayusculas-en-el-slug', // el slug sigue siendo minusculas
    'feature/SHS-M7-T006', // ID sin slug descriptivo
    'feature/M7', // milestone sin slug descriptivo
    'cambios/algo', // tipo inexistente
    'feature/prueba', // slug prohibido
    'feature/final-final',
    'main',
    'feature/', // sin slug
  ]
  for (const rama of invalidas) {
    assert.equal(evaluaRama(rama).cumple, false, rama)
  }
})

// El release dev -> main es un PR sobre la rama "dev" en si: nunca va a
// cumplir tipo/descripcion-corta porque no es una rama de trabajo. La
// excepcion exige AMBAS senales (rama "dev" Y base "main"): "dev" contra
// cualquier otra base sigue siendo invalida, y no hay otro nombre de rama
// que la excepcion perdone.
test('evaluaRama: "dev" contra base "main" es la excepcion del release', () => {
  assert.equal(evaluaRama('dev', 'main').cumple, true)
})

test('evaluaRama: "dev" sin base de release sigue siendo invalida', () => {
  assert.equal(evaluaRama('dev').cumple, false)
  assert.equal(evaluaRama('dev', 'dev').cumple, false)
  assert.equal(evaluaRama('dev', null).cumple, false)
})

// Ninguna rama de trabajo mergea directo a main, ni siquiera hotfix/*: los
// hotfixes tambien pasan por dev (CLAUDE.md, regla dura).
test('evaluaRama: contra base "main", ninguna rama de trabajo pasa, ni hotfix/*', () => {
  const invalidas = ['feature/captura-lead', 'fix/error-integracion-odoo', 'chore/bump-3.6.0', 'hotfix/correccion-produccion']
  for (const rama of invalidas) {
    assert.equal(evaluaRama(rama, 'main').cumple, false, rama)
  }
})

// El harness distribuye el check y su workflow a los repos consumidores via el
// manifest. La fuente sigue siendo scripts/ y .github/workflows/ de este repo:
// si alguien toca una copia y no la otra, los consumidores quedan con una
// version distinta de la que este repo aplica sobre si mismo (SHS-M17).
test('las copias distribuidas en templates/base son identicas a las fuentes', () => {
  const espejos = [
    ['scripts/check-pr-rules.mjs', 'templates/base/scripts/check-pr-rules.mjs'],
    ['.github/workflows/reglas-rama-commits.yml', 'templates/base/github/workflows/reglas-rama-commits.yml'],
    ['.github/workflows/reglas-secretos.yml', 'templates/base/github/workflows/reglas-secretos.yml'],
    ['.github/workflows/reglas-pr-metadata.yml', 'templates/base/github/workflows/reglas-pr-metadata.yml'],
    // SHS-M39: el agente corre tag-release.mjs a mano mientras Actions esta en pausa.
    ['scripts/tag-release.mjs', 'templates/base/scripts/tag-release.mjs'],
    ['.github/workflows/tag-release.yml', 'templates/base/github/workflows/tag-release.yml'],
    // El hook que corre estos checks en la sesion del agente (SHS-M39).
    ['.claude/hooks/reglas-pr.mjs', 'templates/base/claude/hooks/reglas-pr.mjs'],
  ]
  for (const [fuente, copia] of espejos) {
    assert.equal(readFileSync(copia, 'utf8'), readFileSync(fuente, 'utf8'), `${copia} difiere de ${fuente}`)
  }
})

// El español usa tildes y enie en palabras corrientes (icono, nio): la
// descripcion del commit no puede rechazarlas solo por ir primeras.
test('evaluaCommits: acepta tildes y ñ al inicio de la descripcion', () => {
  const commits = [
    { hash: '1111111aaaa', subject: 'fix: ícono roto en el boton de exportar' },
    { hash: '2222222bbbb', subject: 'feat: ñoquis de los viernes en el catering' },
    { hash: '3333333cccc', subject: 'docs: úsese esta plantilla para el ADR' },
  ]
  const resultados = evaluaCommits(commits)
  for (const r of resultados) {
    assert.equal(r.cumple, true, r.detalle)
  }
})

test('evaluaCommits: el tipo "revert" ya esta soportado, en minuscula y mayuscula inicial', () => {
  const commits = [
    { hash: '4444444dddd', subject: 'revert: deshacer el bump de version 3.12.0' },
    { hash: '5555555eeee', subject: 'Revert: deshacer el bump de version 3.12.0' },
  ]
  for (const r of evaluaCommits(commits)) {
    assert.equal(r.cumple, true, r.detalle)
  }
})

test('evaluaSeccionesCompletas: la plantilla sin rellenar NO pasa', () => {
  const plantilla = readFileSync('.github/pull_request_template.md', 'utf8')
  const r = evaluaSeccionesCompletas({ body: plantilla })
  assert.equal(r.cumple, false)
  assert.match(r.detalle, /Descripción del cambio/)
})

test('evaluaSeccionesCompletas: secciones con contenido real pasan', () => {
  const body = [
    '## Descripción del cambio',
    'Se corrige la regex de ramas del check.',
    '',
    '## Evidencia',
    'npm test en verde, regex probada contra las ramas historicas.',
    '',
    '## Impacto / Riesgos',
    'Solo CI de este repo.',
  ].join('\n')
  assert.equal(evaluaSeccionesCompletas({ body }).cumple, true)
})

test('evaluaSeccionesCompletas: "N/A" o vacia sigue fallando', () => {
  const body = [
    '## Descripción del cambio',
    'N/A',
    '',
    '## Evidencia',
    '',
    '## Impacto / Riesgos',
    'Ninguno relevante.',
  ].join('\n')
  const r = evaluaSeccionesCompletas({ body })
  assert.equal(r.cumple, false)
})

test('evaluaVersion: exige exactamente una casilla marcada', () => {
  const conNo = '## Requiere versión / release\n- [x] No\n- [ ] Sí\nVersión sugerida: vX.Y.Z'
  const cruda = '## Requiere versión / release\n- [ ] No\n- [ ] Sí\nVersión sugerida: vX.Y.Z'
  assert.equal(evaluaVersion({ body: conNo }, 'dev').cumple, true)
  assert.equal(evaluaVersion({ body: cruda }, 'dev').cumple, false)
})

// SHS-M39: con Actions en pausa, el grupo secretos lo corre un hook que
// DENIEGA el push. Un falso positivo ya no es un check en rojo que un revisor
// ignora: frena el trabajo. .env.example es la plantilla sin valores que la
// skill pide commitear (y que el harness siembra).
test('esArchivoDeSecreto: .env.example y sus variantes no son secretos', () => {
  for (const ruta of ['.env.example', 'app/.env.sample', '.env.template', 'config/.env.dist']) {
    assert.equal(esArchivoDeSecreto(ruta), false, ruta)
  }
})

test('esArchivoDeSecreto: los .env reales y las credenciales si lo son', () => {
  const secretos = [
    '.env',
    '.env.local',
    '.env.staging',
    'config/.env',
    'configuración/.env',
    'certs/servidor.pem',
    'llave.key',
    'firma.pfx',
    'credentials.json',
    'infra/secrets.json',
  ]
  for (const ruta of secretos) {
    assert.equal(esArchivoDeSecreto(ruta), true, ruta)
  }
})

test('evaluaSecretos: el detalle dice donde se buscaron', () => {
  const r = evaluaSecretos(['a.txt', '.env.staging'], 'en commits sin pushear')
  assert.equal(r.cumple, false)
  assert.match(r.detalle, /en commits sin pushear: \.env\.staging/)
  assert.equal(evaluaSecretos(['a.txt']).cumple, true)
})

test('rutasDeSalidaZ: separa por NUL y descarta vacios y saltos de linea sueltos', () => {
  assert.deepEqual(rutasDeSalidaZ('a.txt\0configuración/.env\0\n\0b/c.json\0'), ['a.txt', 'configuración/.env', 'b/c.json'])
  assert.deepEqual(rutasDeSalidaZ(''), [])
})

test('contextoDelCheck: con PR, base y rama salen del PR', () => {
  const pr = { baseRefName: 'main', headRefName: 'dev' }
  assert.deepEqual(contextoDelCheck({ pr, envBase: 'dev', ramaLocal: 'fix/M1-otra' }), { base: 'main', rama: 'dev' })
})

test('contextoDelCheck: sin PR usa el entorno o dev, y la rama local', () => {
  assert.deepEqual(contextoDelCheck({ envBase: 'main', ramaLocal: 'dev' }), { base: 'main', rama: 'dev' })
  // Actions define GITHUB_BASE_REF vacio fuera de pull_request.
  assert.deepEqual(contextoDelCheck({ envBase: '', ramaLocal: 'fix/M1-algo' }), { base: 'dev', rama: 'fix/M1-algo' })
  assert.deepEqual(contextoDelCheck({ ramaLocal: 'fix/M1-algo' }), { base: 'dev', rama: 'fix/M1-algo' })
})

test('esperaMergeable: relee mientras GitHub no calculo el estado', () => {
  const respuestas = ['UNKNOWN', 'MERGEABLE']
  const esperas = []
  const pr = esperaMergeable({ mergeable: 'UNKNOWN', body: 'x' }, () => respuestas.shift(), (ms) => esperas.push(ms), { esperaMs: 5 })
  assert.equal(pr.mergeable, 'MERGEABLE')
  assert.equal(pr.body, 'x', 'no pierde el resto de los datos del PR')
  assert.deepEqual(esperas, [5, 5])
})

test('esperaMergeable: se rinde tras los intentos y queda en UNKNOWN (skip, no FAIL)', () => {
  let lecturas = 0
  const pr = esperaMergeable({ mergeable: 'UNKNOWN' }, () => (lecturas++, 'UNKNOWN'), () => {}, { intentos: 3 })
  assert.equal(pr.mergeable, 'UNKNOWN')
  assert.equal(lecturas, 3)
})

test('esperaMergeable: si la relectura falla o ya hay estado, no insiste', () => {
  const fallida = esperaMergeable({ mergeable: 'UNKNOWN' }, () => { throw new Error('red') }, () => {})
  assert.equal(fallida.mergeable, 'UNKNOWN')
  let lecturas = 0
  esperaMergeable({ mergeable: 'CONFLICTING' }, () => (lecturas++, 'MERGEABLE'), () => {})
  assert.equal(lecturas, 0)
})

test('ultimoTagDe: el mayor semver, ignorando el tag movil y los ajenos', () => {
  assert.equal(ultimoTagDe(['v3', 'v3.9.2', 'v3.15.2', 'v3.10.0', 'latest']), 'v3.15.2')
  assert.equal(ultimoTagDe(['v1']), null)
  assert.equal(ultimoTagDe([]), null)
})

test('describeError: gh ausente y errores de git se describen en una linea', () => {
  assert.match(describeError({ code: 'ENOENT', path: 'gh' }), /no se encontro "gh" en el PATH/)
  assert.equal(describeError({ stderr: 'fatal: bad revision\nmas detalle', message: 'Command failed' }), 'fatal: bad revision')
})

// --- Integracion: el script real contra repos git en tmp (con espacios en la
// ruta, como los de OneDrive), sin red. origin/* se simula con update-ref.

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=test@test', '-c', 'user.name=test', '-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function repoConBase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude check '))
  git(dir, 'init', '-q', '-b', 'dev')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: raiz')
  git(dir, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
  git(dir, 'switch', '-q', '-c', 'fix/M1-algo')
  return dir
}

function commitear(dir, archivos, mensaje) {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = path.join(dir, ruta)
    if (contenido == null) {
      fs.rmSync(destino)
    } else {
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, contenido)
    }
  }
  git(dir, 'add', '-A', '--force')
  git(dir, 'commit', '-q', '-m', mensaje)
}

function correrCheck(dir, args, env = process.env) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? '' }
  }
}

test('secretos --sin-pushear: detecta el secreto agregado y borrado en commits locales', () => {
  const dir = repoConBase()
  commitear(dir, { 'configuración/.env': 'TOKEN=1\n', 'a.txt': 'a\n' }, 'feat: uno')
  commitear(dir, { 'configuración/.env': null }, 'fix: dos')

  // El diff de arboles no lo ve (el archivo ya no esta en la cabeza)...
  assert.equal(correrCheck(dir, ['--grupo', 'secretos']).status, 0)
  // ...pero el push subiria el commit que lo contiene.
  const r = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear'])
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /\[FAIL\] sin-secretos: archivos sospechosos en commits sin pushear: configuración\/\.env/)
})

test('secretos --sin-pushear: lo ya pusheado no se vuelve a revisar', () => {
  const dir = repoConBase()
  commitear(dir, { '.env.staging': 'X=1\n' }, 'feat: uno')
  git(dir, 'update-ref', 'refs/remotes/origin/fix/M1-algo', 'HEAD')
  commitear(dir, { 'b.txt': 'b\n' }, 'feat: dos')
  const r = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear'])
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /\[OK  \] sin-secretos/)
})

test('secretos: una ruta con tildes se detecta y .env.example no', () => {
  const dir = repoConBase()
  commitear(dir, { '.env.example': 'TOKEN=\n' }, 'feat: plantilla de entorno')
  assert.equal(correrCheck(dir, ['--grupo', 'secretos']).status, 0)

  commitear(dir, { 'datos/configuración/credentials.json': '{}\n' }, 'feat: config')
  const r = correrCheck(dir, ['--grupo', 'secretos'])
  assert.equal(r.status, 1, r.stdout)
  assert.match(r.stdout, /datos\/configuración\/credentials\.json/)
})

test('pr-metadata sin gh disponible: [ERROR] y exit 2, no un FAIL de regla', () => {
  const dir = repoConBase()
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude sin gh '))
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'))
  env.PATH = vacio
  const r = correrCheck(dir, ['--grupo', 'pr-metadata', '--pr', '1'], env)
  assert.equal(r.status, 2, r.stdout)
  assert.match(r.stdout, /^\[ERROR\] pr-metadata: no se pudo verificar: no se encontro "gh"/)
})

test('uso incorrecto: [ERROR] y exit 2', () => {
  const r = correrCheck(repoConBase(), ['--grupo', 'inventado'])
  assert.equal(r.status, 2)
  assert.match(r.stdout, /^\[ERROR\] uso: --grupo debe ser uno de/)
})

// --cabeza termina en git log: nada que git pueda leer como opcion
// (--output=<archivo> escribiria un archivo), salvo --branches/--tags.
test('--cabeza rechaza opciones de git, salvo --branches y --tags', () => {
  const dir = repoConBase()
  const r = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear', '--cabeza=--output=pwned.txt'])
  assert.equal(r.status, 2)
  assert.ok(!fs.existsSync(path.join(dir, 'pwned.txt')))
  commitear(dir, { '.env.local': 'X=1\n' }, 'feat: x')
  assert.equal(correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear', '--cabeza=--branches']).status, 1)
})
