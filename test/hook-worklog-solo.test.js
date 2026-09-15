import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mkRepo, write } from './helpers.js'

// Integracion real del hook SessionStart del modo solo: se ejecuta el script
// tal cual lo corre el harness (node + CLAUDE_PROJECT_DIR), contra un Vault en
// tmp. Mismo criterio que hook-declarar-milestone.test.js.
const HOOK = fileURLToPath(new URL('../templates/base/claude/hooks/worklog-solo.mjs', import.meta.url))

function correrHook(root) {
  return execFileSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  })
}

function vaultCon({ worklog } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude vault solo '))
  fs.mkdirSync(path.join(vault, 'Project-SHS'), { recursive: true })
  if (worklog != null) write(vault, 'Project-SHS/worklog.md', worklog)
  return vault
}

function proyectoCon(vault) {
  const dir = mkRepo()
  write(dir, '.claude/vault.local.json', JSON.stringify({ path: vault, project: 'Project-SHS' }))
  return dir
}

test('hook solo sin Vault configurado: regla + aviso, exit 0', () => {
  const salida = correrHook(mkRepo())
  assert.match(salida, /Modo solo: la trazabilidad vive en/)
  assert.match(salida, /Vault no configurado/)
})

test('hook solo con worklog: muestra las ultimas lineas de traza', () => {
  const worklog = [
    '# Worklog de Project-SHS — traza del modo solo',
    '',
    '- 2026-09-10 · armando el scraper de precios',
    '- 2026-09-14 · migrando auth a OAuth',
    '',
  ].join('\n')
  const salida = correrHook(proyectoCon(vaultCon({ worklog })))
  assert.match(salida, /Ultimas lineas de Project-SHS\/worklog\.md/)
  assert.match(salida, /2026-09-14 · migrando auth a OAuth/)
  assert.match(salida, /vault-sync --push/)
})

test('hook solo sin worklog.md: pide crearlo con la primera linea', () => {
  const salida = correrHook(proyectoCon(vaultCon()))
  assert.match(salida, /worklog\.md no existe todavia/)
})

test('hook solo con worklog vacio (solo cabecera): lo dice en vez de listar nada', () => {
  const worklog = '# Worklog de Project-SHS — traza del modo solo\n\nFormato: `- <AAAA-MM-DD> · <en qué se trabaja>`\n'
  const salida = correrHook(proyectoCon(vaultCon({ worklog })))
  assert.match(salida, /vacio: este es el primer bloque/)
})
