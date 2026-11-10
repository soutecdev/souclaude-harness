import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Integracion real del aviso de "release mergeado sin cerrar" (SHS-M44) en el
// hook SessionStart de equipo: se ejecuta tal cual lo corre el harness contra
// un origin bare real, un consumidor clonado y un Vault temporal. gh se
// simula con SOUCLAUDE_GH_RELEASES (lista de tags que ya tienen release) y la
// cache por maquina se redirige con SOUCLAUDE_CLAUDE_HOME.
const HOOK = fileURLToPath(new URL('../templates/base/claude/hooks/declarar-milestone.mjs', import.meta.url))
const DIA_MS = 24 * 60 * 60 * 1000

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function tmp(prefijo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `souclaude ${prefijo} `))
}

// Origin bare + consumidor clonado. `edadDias` envejece el commit de release.
function escenario({ version = '3.18.0', tag = true, edadDias = 0, hito = null } = {}) {
  const origin = tmp('origin')
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  const trabajo = tmp('trabajo')
  execFileSync('git', ['clone', '-q', origin, trabajo], { stdio: 'ignore' })
  git(trabajo, 'checkout', '-q', '-b', 'main')
  fs.writeFileSync(path.join(trabajo, 'package.json'), JSON.stringify({ name: 'acme', version }))
  const fecha = new Date(Date.now() - edadDias * DIA_MS).toISOString()
  git(trabajo, 'add', '-A')
  execFileSync('git', ['-C', trabajo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'Merge pull request #107 from acme/dev'], {
    env: { ...process.env, GIT_AUTHOR_DATE: fecha, GIT_COMMITTER_DATE: fecha },
    stdio: 'ignore',
  })
  git(trabajo, 'push', '-q', 'origin', 'main')
  if (tag) {
    execFileSync('git', ['-C', trabajo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'tag', '-a', `v${version}`, '-m', `Release v${version}`], {
      env: { ...process.env, GIT_COMMITTER_DATE: fecha },
      stdio: 'ignore',
    })
    git(trabajo, 'push', '-q', 'origin', `v${version}`)
  }
  const consumidor = tmp('consumidor')
  execFileSync('git', ['clone', '-q', origin, consumidor], { stdio: 'ignore' })

  // Vault temporal solo si se pide un estado de la ficha (hito: true | false).
  if (hito !== null) {
    const vault = tmp('vault')
    fs.mkdirSync(path.join(vault, 'Project-TST'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Project-TST', 'milestones.md'), '---\nkanban-plugin: board\n---\n\n## Backlog\n\n## En curso\n\n## Hecho\n')
    fs.writeFileSync(path.join(vault, 'Project-TST', 'kanban.md'), '---\nkanban-plugin: board\n---\n\n## Backlog\n\n## En curso\n\n## En review\n\n## Hecho\n')
    const lineaHito = hito ? `- 2026-11-10 · v${version} - Release automático · Una frase corta.\n` : ''
    fs.writeFileSync(path.join(vault, 'Project-TST', 'OBSERVATORIO.md'), `# Ficha\n\n## Hitos\n${lineaHito}\n## Próxima versión\n- \n`)
    fs.mkdirSync(path.join(consumidor, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(consumidor, '.claude', 'vault.local.json'), JSON.stringify({ path: vault, project: 'Project-TST' }))
  }
  return consumidor
}

function correr(root, { releases, home }) {
  return execFileSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      SOUCLAUDE_GH_RELEASES: releases,
      SOUCLAUDE_CLAUDE_HOME: home,
      SOUCLAUDE_HARNESS_REMOTO: root, // sin red: el aviso de version no interviene
    },
  })
}

test('cierre de release: main con version nueva y sin tag -> avisa que falta el tag y cita el PR', () => {
  const root = escenario({ tag: false })
  const salida = correr(root, { releases: 'ninguno', home: tmp('home') })
  assert.match(salida, /Release v3\.18\.0 mergeado a main sin cerrar \(falta: tag, GitHub Release\)/)
  assert.match(salida, /subagente de cierre de release/)
  assert.match(salida, /PR de release #107/)
})

test('cierre de release: con tag pero sin GitHub Release ni hito, avisa las dos faltas', () => {
  const root = escenario({ hito: false })
  const salida = correr(root, { releases: 'ninguno', home: tmp('home') })
  assert.match(salida, /falta: GitHub Release, hito en la ficha del Observatorio/)
})

test('cierre de release: release y hito presentes -> silencio y queda en la caché', () => {
  const root = escenario({ hito: true })
  const home = tmp('home')
  const salida = correr(root, { releases: 'v3.18.0', home })
  assert.doesNotMatch(salida, /sin cerrar/)
  const cache = JSON.parse(fs.readFileSync(path.join(home, 'souclaude', 'cierre-release.json'), 'utf8'))
  assert.deepEqual(cache.cerrados, ['v3.18.0'])
})

test('cierre de release: un release de hace más de 14 días ya no se avisa', () => {
  const root = escenario({ edadDias: 20, hito: false })
  const salida = correr(root, { releases: 'ninguno', home: tmp('home') })
  assert.doesNotMatch(salida, /sin cerrar/)
})

test('cierre de release: sin Vault configurado igual avisa tag/release faltantes', () => {
  const root = escenario({ tag: true })
  const salida = correr(root, { releases: 'ninguno', home: tmp('home') })
  assert.match(salida, /Vault no configurado/)
  assert.match(salida, /falta: GitHub Release\)/)
})

test('cierre de release: gh ausente o sin sesión no inventa faltas (silencio)', () => {
  const root = escenario({ hito: true })
  // Sin SOUCLAUDE_GH_RELEASES y con un PATH sin gh: releaseDeGithubExiste devuelve null.
  const salida = execFileSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, SOUCLAUDE_GH_RELEASES: undefined, PATH: path.dirname(process.execPath), CLAUDE_PROJECT_DIR: root, SOUCLAUDE_CLAUDE_HOME: tmp('home'), SOUCLAUDE_HARNESS_REMOTO: root },
  })
  assert.doesNotMatch(salida, /sin cerrar/)
})
