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
  secretosEnContenido,
  evaluaContenido,
  evaluaVersionDelPaquete,
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

test('esArchivoDeSecreto: llaves privadas SSH y contenedores PKCS#12; la clave publica no', () => {
  for (const ruta of ['id_rsa', 'deploy/id_ed25519', '.ssh/id_ecdsa', 'id_dsa', 'certs/cliente.p12']) {
    assert.equal(esArchivoDeSecreto(ruta), true, ruta)
  }
  for (const ruta of ['id_rsa.pub', 'docs/id_rsa.md', 'mi_id_rsa', 'src/id_ed25519.test.js']) {
    assert.equal(esArchivoDeSecreto(ruta), false, ruta)
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

// El script lee GITHUB_BASE_REF y GITHUB_HEAD_REF, que Actions define en los
// eventos pull_request. Heredarlas hacia que el resultado dependiera del PR que
// disparaba el CI: en el PR de release (base main) estos repos temporales, que
// solo tienen dev, daban "[ERROR]" (exit 2) y el CI salia rojo en TODO release
// dev -> main. Cada test fija el contexto que necesita; del entorno no hereda el
// del evento.
const ENTORNO_SIN_EVENTO = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^GITHUB_(BASE|HEAD)_REF$/i.test(k))
)

function correrCheck(dir, args, env = ENTORNO_SIN_EVENTO) {
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

// Con la deteccion de renombres de git (activa por defecto), renombrar un
// archivo ya versionado a un nombre de credencial figuraba como R y no como A, y
// pasaba el filtro: `git mv` era una forma de subir un .env con el check en verde.
test('secretos: un archivo renombrado a un nombre de credencial se detecta igual que uno agregado', () => {
  const dir = repoConBase()
  git(dir, 'switch', '-q', 'dev')
  commitear(dir, { 'datos.txt': 'DB_PASSWORD=x\nAPI_TOKEN=y\nOTRA=1\nMAS=2\n' }, 'chore: datos')
  git(dir, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
  git(dir, 'switch', '-q', 'fix/M1-algo')
  git(dir, 'merge', '-q', '--ff-only', 'dev')

  git(dir, 'mv', 'datos.txt', '.env')
  git(dir, 'commit', '-q', '-m', 'chore: mover')
  assert.match(git(dir, 'diff', 'origin/dev..HEAD', '--name-status'), /^R100\tdatos\.txt\t\.env/, 'el fixture ya no produce un renombre puro')

  const arbol = correrCheck(dir, ['--grupo', 'secretos'])
  assert.equal(arbol.status, 1, arbol.stdout)
  assert.match(arbol.stdout, /\[FAIL\] sin-secretos: archivos sospechosos agregados: \.env/)
  const push = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear'])
  assert.equal(push.status, 1, push.stdout)
  assert.match(push.stdout, /\[FAIL\] sin-secretos: archivos sospechosos en commits sin pushear: \.env/)
})

test('pr-metadata sin gh disponible: [ERROR] y exit 2, no un FAIL de regla', () => {
  const dir = repoConBase()
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude sin gh '))
  const env = Object.fromEntries(Object.entries(ENTORNO_SIN_EVENTO).filter(([k]) => k.toUpperCase() !== 'PATH'))
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

// --- Credenciales en el CONTENIDO (informativo) ---------------------------------
// De mentira y armadas por partes: escritas enteras, este mismo archivo dispararia
// el aviso -- y la proteccion de push de GitHub.
const CLAVE_PRIVADA = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')
const CLAVE_AWS = 'AKIA' + 'IOSFODNN7' + 'EJEMPLO'
const TOKEN_GITHUB = 'gh' + 'p_' + 'a1B2c3D4'.repeat(5)

test('secretosEnContenido: solo lineas agregadas, con su archivo y su numero de linea', () => {
  const diff = [
    'diff --git a/src/config.js b/src/config.js',
    'index 111..222 100644',
    '--- a/src/config.js',
    '+++ b/src/config.js',
    '@@ -3,0 +4,2 @@',
    `+const aws = "${CLAVE_AWS}"`,
    '+const nada = 1',
    '@@ -10 +12 @@',
    `-const viejo = "${TOKEN_GITHUB}"`, // una linea QUITADA no cuenta
    `+const gh = "${TOKEN_GITHUB}"`,
    'diff --git a/borrado.pem b/borrado.pem',
    '--- a/borrado.pem',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    `-${CLAVE_PRIVADA}`,
    'diff --git a/docs/llave.txt b/docs/llave.txt',
    '--- /dev/null',
    '+++ b/docs/llave.txt',
    '@@ -0,0 +1,2 @@',
    `+${CLAVE_PRIVADA}`,
    '+MIIEvQIBADANBgkq',
  ].join('\n')
  assert.deepEqual(secretosEnContenido(diff), [
    { archivo: 'src/config.js', linea: 4, tipo: 'clave de acceso de AWS' },
    { archivo: 'src/config.js', linea: 12, tipo: 'token de GitHub' },
    { archivo: 'docs/llave.txt', linea: 1, tipo: 'clave privada' },
  ])
  assert.deepEqual(secretosEnContenido(''), [])
})

test('secretosEnContenido: reconoce los tokens con prefijo propio y no lo que solo se les parece', () => {
  const tipos = (linea) => secretosEnContenido(['+++ b/a.txt', '@@ -0,0 +1 @@', `+${linea}`].join('\n')).map((h) => h.tipo)
  assert.deepEqual(tipos('k = "' + 'sk-' + 'ant-' + 'api03-' + 'x'.repeat(30) + '"'), ['clave de API de Anthropic'])
  assert.deepEqual(tipos('SLACK=' + 'xox' + 'b-' + '1234567890-abcdefghijkl'), ['token de Slack'])
  assert.deepEqual(tipos('key: ' + 'AI' + 'za' + 'B'.repeat(35)), ['clave de API de Google'])
  assert.deepEqual(tipos('//registry/:_authToken=' + 'npm' + '_' + 'a'.repeat(36)), ['token de npm'])
  assert.deepEqual(tipos(['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ')), ['clave privada'])
  assert.deepEqual(tipos(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')), ['clave privada'])
  for (const inocente of [
    'AKIA' + 'CORTA123', // menos de 16 caracteres tras el prefijo
    'gh' + 'p_corto',
    'guarda tu PRIVATE KEY en un lugar seguro', // se habla de una clave, no hay ninguna
    ['-----BEGIN', 'PUBLIC', 'KEY-----'].join(' '),
    ['-----BEGIN', 'CERTIFICATE-----'].join(' '),
    'const sk = "sk-proyecto-interno"',
    'git push origin main',
  ]) {
    assert.deepEqual(tipos(inocente), [], inocente)
  }
})

test('evaluaContenido: sin hallazgos no dice nada; con hallazgos avisa sin bloquear', () => {
  assert.equal(evaluaContenido([]), null)
  const r = evaluaContenido([{ archivo: 'src/config.js', linea: 4, tipo: 'clave de acceso de AWS' }])
  assert.equal(r.cumple, null, 'no es un FAIL')
  assert.equal(r.aviso, true)
  assert.match(r.detalle, /clave de acceso de AWS en src\/config\.js:4/)
  assert.match(r.detalle, /no bloquea/)
  const muchos = evaluaContenido(Array.from({ length: 25 }, (_, i) => ({ archivo: 'a.txt', linea: i + 1, tipo: 'token de npm' })))
  assert.equal(muchos.detalle.split('token de npm').length - 1, 20, 'lista como mucho 20')
  assert.match(muchos.detalle, /y 5 mas/)
})

test('secretos: una credencial pegada en un archivo cualquiera se avisa, sin cambiar el resultado ni mostrarla', () => {
  const dir = repoConBase()
  commitear(dir, { 'src/config.js': `export const a = 1\nexport const clave = "${CLAVE_AWS}"\n`, 'docs/guia.md': 'texto\n' }, 'feat: config')

  const r = correrCheck(dir, ['--grupo', 'secretos'])
  assert.equal(r.status, 0, 'el aviso no cambia el codigo de salida')
  assert.match(r.stdout, /^\[OK  \] sin-secretos: /m)
  assert.match(r.stdout, /^\[AVISO\] sin-secretos-en-contenido: .*clave de acceso de AWS en src\/config\.js:2/m)
  assert.ok(!r.stdout.includes(CLAVE_AWS), 'el check imprimio la credencial')

  // Antes del push corre solo lo que puede denegarlo: el aviso va en el check del PR.
  const sinPushear = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear'])
  assert.equal(sinPushear.status, 0)
  assert.match(sinPushear.stdout, /^\[OK  \] sin-secretos: /m)
  assert.doesNotMatch(sinPushear.stdout, /sin-secretos-en-contenido/)

  // Un archivo de credenciales sigue siendo FAIL, con o sin aviso de contenido.
  commitear(dir, { '.env': 'X=1\n' }, 'feat: env')
  const conArchivo = correrCheck(dir, ['--grupo', 'secretos'])
  assert.equal(conArchivo.status, 1)
  assert.match(conArchivo.stdout, /^\[FAIL\] sin-secretos: /m)
})

test('secretos antes del push: el resultado que deniega no espera al chequeo de contenido', () => {
  const dir = repoConBase()
  commitear(dir, { '.env': 'X=1\n', 'src/config.js': `export const clave = "${CLAVE_AWS}"\n` }, 'feat: config')

  // Lo que corre el hook: el resultado que deniega el push sale solo.
  const antesDelPush = correrCheck(dir, ['--grupo', 'secretos', '--sin-pushear'])
  assert.equal(antesDelPush.status, 1)
  assert.match(antesDelPush.stdout, /^\[FAIL\] sin-secretos: .*\.env/m)
  assert.doesNotMatch(antesDelPush.stdout, /sin-secretos-en-contenido/)

  // En el check del PR van los dos: ahi no hay un push esperando la respuesta.
  const delPR = correrCheck(dir, ['--grupo', 'secretos'])
  assert.equal(delPR.status, 1)
  assert.match(delPR.stdout, /^\[FAIL\] sin-secretos: .*\.env/m)
  assert.match(delPR.stdout, /^\[AVISO\] sin-secretos-en-contenido: .*src\/config\.js:1/m)
})

test('secretos: revisar el contenido no ejecuta los filtros textconv que el repo tenga configurados', () => {
  const dir = repoConBase()
  const aparte = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude textconv '))
  const marca = path.join(aparte, 'corrio')
  const filtro = path.join(aparte, 'filtro.mjs')
  fs.writeFileSync(filtro, `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(marca)}, 'x')\nprocess.stdout.write(fs.readFileSync(process.argv[2]))\n`)
  const conBarras = (ruta) => ruta.replace(/\\/g, '/')
  git(dir, 'config', 'diff.filtro.textconv', `"${conBarras(process.execPath)}" "${conBarras(filtro)}"`)
  commitear(dir, { '.gitattributes': '*.dat diff=filtro\n', 'datos.dat': 'uno\ndos\n' }, 'feat: datos')

  // El filtro esta bien configurado: un `git log -p` cualquiera lo ejecuta.
  git(dir, 'log', '-p', '-1')
  assert.ok(fs.existsSync(marca), 'el filtro de prueba no corre ni con git log -p: este test no probaria nada')
  fs.rmSync(marca)

  for (const args of [['--grupo', 'secretos'], ['--grupo', 'secretos', '--sin-pushear']]) {
    assert.equal(correrCheck(dir, args).status, 0, args.join(' '))
    assert.ok(!fs.existsSync(marca), `el check ejecuto el filtro textconv (${args.join(' ')})`)
  }
})

test('secretos: sin nada que avisar, la salida es la de siempre (una linea)', () => {
  const dir = repoConBase()
  commitear(dir, { 'a.txt': 'hola\n', 'src/b.js': 'export const b = 2\n' }, 'feat: a')
  for (const args of [['--grupo', 'secretos'], ['--grupo', 'secretos', '--sin-pushear']]) {
    const r = correrCheck(dir, args)
    assert.equal(r.status, 0)
    assert.deepEqual(r.stdout.trim().split('\n').map((l) => l.slice(0, 20)), ['[OK  ] sin-secretos:'], args.join(' '))
  }
})

test('evaluaVersionDelPaquete: avisa si el release propone una version y package.json dice otra', () => {
  const cuerpo = (marcaSi, linea) => `## Requiere versión / release\n\n- [${marcaSi ? ' ' : 'x'}] No\n- [${marcaSi ? 'x' : ' '}] Sí\n\n${linea}\n\n## Otra\n\ntexto\n`
  const pr = { body: cuerpo(true, 'Versión sugerida: v3.19.0') }

  const aviso = evaluaVersionDelPaquete(pr, 'main', () => '3.18.1')
  assert.equal(aviso.aviso, true)
  assert.equal(aviso.cumple, null, 'no es un FAIL')
  assert.match(aviso.detalle, /propone v3\.19\.0 pero package\.json dice 3\.18\.1/)

  assert.equal(evaluaVersionDelPaquete(pr, 'main', () => '3.19.0'), null, 'coinciden')
  assert.equal(evaluaVersionDelPaquete(pr, 'dev', () => '3.18.1'), null, 'solo en el PR de release')
  assert.equal(evaluaVersionDelPaquete(pr, 'main', () => { throw new Error('sin package.json') }), null, 'un repo que no es de Node')
  assert.equal(evaluaVersionDelPaquete({ body: cuerpo(false, '') }, 'main', () => '3.18.1'), null, 'el release no requiere version')
  assert.equal(evaluaVersionDelPaquete({ body: cuerpo(true, 'sin proponer nada') }, 'main', () => '3.18.1'), null, 'de eso ya se queja version-semver')
  assert.equal(evaluaVersionDelPaquete(null, 'main', () => '3.18.1'), null)
})
