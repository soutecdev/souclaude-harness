import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import './helpers.js'
import { protegeBranchMain } from '../src/core/github-protect.js'

// protegeBranchMain REESCRIBE la proteccion de `main` de un repo en GitHub. Estos
// tests fijan que le pide exactamente a GitHub, y que nunca escribe cuando no
// corresponde, sin hablar con GitHub: el proceso `gh` se reemplaza por uno
// simulado que responde segun el subcomando y registra cada llamada.
function ghSimulado({ sesion = true, repo = 'acme/app', rama = true, put = true } = {}) {
  const llamadas = []
  const correr = (args, cwd, input) => {
    llamadas.push({ args, cwd, input })
    const [programa, ...resto] = args
    assert.equal(programa, 'gh', 'solo se habla con gh')
    if (resto[0] === 'auth') {
      if (!sesion) throw new Error('You are not logged into any GitHub hosts')
      return ''
    }
    if (resto[0] === 'repo') {
      if (!repo) throw new Error('no git remotes found')
      return repo
    }
    if (resto[0] === 'api' && resto.includes('PUT')) {
      if (!put) throw new Error('HTTP 403: Resource not accessible by integration')
      return '{}'
    }
    if (resto[0] === 'api') {
      if (!rama) throw new Error('HTTP 404: Branch not found')
      return '{}'
    }
    throw new Error(`llamada inesperada a gh: ${resto.join(' ')}`)
  }
  const escrituras = () => llamadas.filter((l) => l.args.includes('PUT') || l.args.includes('POST') || l.args.includes('DELETE') || l.args.includes('PATCH'))
  return { correr, llamadas, escrituras }
}

test('proteccion de main: sin sesion de gh no se consulta ni se escribe nada', () => {
  const gh = ghSimulado({ sesion: false })
  assert.deepEqual(protegeBranchMain({ cwd: '/repo', correr: gh.correr }), { aplicado: false })
  assert.equal(gh.llamadas.length, 1, 'solo `gh auth status`')
  assert.deepEqual(gh.escrituras(), [])
})

test('proteccion de main: sin repo de GitHub resoluble no se escribe', () => {
  const gh = ghSimulado({ repo: null })
  assert.deepEqual(protegeBranchMain({ cwd: '/repo', correr: gh.correr }), { aplicado: false })
  assert.deepEqual(gh.escrituras(), [])
})

test('proteccion de main: si main todavia no existe en el remoto queda pendiente, sin escribir', () => {
  const gh = ghSimulado({ rama: false })
  assert.deepEqual(protegeBranchMain({ cwd: '/repo', correr: gh.correr }), { aplicado: false })
  assert.deepEqual(gh.escrituras(), [])
  assert.ok(gh.llamadas.some((l) => l.args.join(' ') === 'gh api repos/acme/app/branches/main'))
})

test('proteccion de main: un unico PUT, sobre main del repo detectado, con el contrato exacto', () => {
  const gh = ghSimulado()
  assert.deepEqual(protegeBranchMain({ cwd: '/ruta con espacios/repo', correr: gh.correr }), { aplicado: true })

  const escrituras = gh.escrituras()
  assert.equal(escrituras.length, 1, 'una sola escritura')
  const [{ args, cwd, input }] = escrituras
  assert.deepEqual(args, ['gh', 'api', '-X', 'PUT', 'repos/acme/app/branches/main/protection', '--input', '-'])
  assert.equal(cwd, '/ruta con espacios/repo')
  // El cuerpo viaja por stdin (no por argumentos) y es este, ni mas ni menos: PR
  // obligatorio sin aprobaciones forzadas, alcanza a los administradores, los dos
  // checks del harness en verde y al dia con la base, sin push forzado ni borrado.
  assert.deepEqual(JSON.parse(input), {
    required_status_checks: { strict: true, checks: [{ context: 'reglas-secretos' }, { context: 'reglas-pr-metadata' }] },
    enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: 0 },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  })
  // Nunca toca otra rama ni otro recurso del repo.
  for (const { args: a } of gh.llamadas) {
    const ruta = a.find((x) => x.startsWith('repos/'))
    if (ruta) assert.match(ruta, /^repos\/acme\/app\/branches\/main(\/protection)?$/, a.join(' '))
  }
})

test('proteccion de main: sin permiso de administrador avisa y no rompe el comando', () => {
  const gh = ghSimulado({ put: false })
  assert.deepEqual(protegeBranchMain({ cwd: '/repo', correr: gh.correr }), { aplicado: false })
  assert.equal(gh.escrituras().length, 1, 'se intento una vez, sin reintentos')
})

// El comentario de github-protect.js lo decia como tarea manual: "si alguno de
// estos jobs se renombra, esto se desincroniza". Un check requerido cuyo nombre
// no reporta ningun workflow deja TODOS los PR del repo sin poder mergearse.
test('proteccion de main: los checks requeridos son los jobs de los workflows que instala el harness', () => {
  const gh = ghSimulado()
  protegeBranchMain({ cwd: '/repo', correr: gh.correr })
  const requeridos = JSON.parse(gh.escrituras()[0].input).required_status_checks.checks.map((c) => c.context)

  for (const check of requeridos) {
    const ruta = fileURLToPath(new URL(`../templates/base/github/workflows/${check}.yml`, import.meta.url))
    assert.ok(fs.existsSync(ruta), `no hay workflow ${check}.yml en la plantilla`)
    const lineas = fs.readFileSync(ruta, 'utf8').split(/\r?\n/)
    const desdeJobs = lineas.slice(lineas.findIndex((l) => /^jobs:\s*$/.test(l)) + 1)
    const jobs = desdeJobs.filter((l) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l)).map((l) => l.trim().replace(/:$/, ''))
    assert.deepEqual(jobs, [check], `${check}.yml debe tener un unico job con ese id`)
    // Si el job declarara `name:`, GitHub reportaria ese nombre y no el id.
    assert.ok(!desdeJobs.some((l) => /^ {4}name:/.test(l)), `el job de ${check}.yml no debe declarar name:`)
    assert.ok(lineas.some((l) => /^ {2}pull_request:/.test(l)), `${check}.yml debe correr en pull_request`)
  }
})
