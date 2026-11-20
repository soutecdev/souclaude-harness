import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// La skill soutec-md-a-pdf es Python y no tenia ningun test: sus defectos
// (una lista anidada tumbaba el render, "2026 Roadmap" perdia el numero) solo
// aparecian al generar un documento real. Sus pruebas viven en
// test/python/test_soutec_md.py y usan solo la biblioteca estandar; este archivo
// las engancha a la suite. Sin Python en el PATH se omiten, no fallan.
const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const SCRIPTS = path.join(RAIZ, 'templates', 'base', 'claude', 'skills', 'soutec-md-a-pdf', 'scripts')

function python() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info >= (3, 8))'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim() === 'True') return cmd
  }
  return null
}
const PY = python()
const skip = PY ? false : 'no hay Python >= 3.8 en el PATH'

// -I: modo aislado (ignora variables PYTHON* y el site del usuario).
// -B: sin .pyc -- un __pycache__ dentro de templates/ seria un huerfano para `verify`.
test('skill soutec-md-a-pdf: logica propia del nucleo (bloques, listas, enlaces, numeracion, titulos)', { skip }, () => {
  const r = spawnSync(PY, ['-I', '-B', path.join(RAIZ, 'test', 'python', 'test_soutec_md.py')], { encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /Ran \d+ tests/)
})

test('skill soutec-md-a-pdf: si falta una dependencia lo dice con el paquete a instalar, sin traceback', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude pdf '))
  fs.writeFileSync(path.join(dir, 'entrada.md'), '# Titulo\n\nUn parrafo.\n\n- uno\n    - anidado\n')
  for (const formato of ['pdf', 'docx']) {
    const salida = path.join(dir, `salida.${formato}`)
    const r = spawnSync(PY, ['-I', '-B', path.join(SCRIPTS, 'md_to_soutec.py'), path.join(dir, 'entrada.md'), salida, '--to', formato], { cwd: dir, encoding: 'utf8' })
    assert.doesNotMatch(r.stderr, /Traceback/, `${formato}: el fallo salio como traceback crudo`)
    if (r.status === 0) {
      // Con las dependencias instaladas, genera el documento.
      assert.ok(fs.statSync(salida).size > 0)
    } else {
      assert.match(r.stderr, /Falta el paquete de Python '[\w-]+' \(módulo '\w+'\), necesario para generar (PDF|DOCX)/)
      assert.match(r.stderr, /python -m pip install [\w-]+/)
    }
  }
})

// En Windows la consola usa cp1252 y Python escribe ahi sus mensajes: quien los
// lee como UTF-8 (Claude Code, este test) recibia «m\ufffddulo», «tambi\ufffdn». Lo
// encontro el CI de Windows. PYTHONIOENCODING=cp1252 reproduce esa consola en
// cualquier sistema (por eso este caso no usa -I, que ignora las variables PYTHON*).
test('skill soutec-md-a-pdf: sus mensajes salen en UTF-8 aunque la consola use otra pagina de codigos', { skip }, () => {
  const r = spawnSync(PY, ['-B', '-s', path.join(SCRIPTS, 'md_to_soutec.py'), '--help'], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'cp1252', PYTHONUTF8: '0' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /también/, 'las tildes llegaron rotas: la salida no es UTF-8')
  assert.ok(!r.stdout.includes('\ufffd'), 'hay caracteres de reemplazo en la salida')
})

test('skill soutec-md-a-pdf: correr sus pruebas no deja __pycache__ dentro de templates/', { skip }, () => {
  assert.ok(!fs.existsSync(path.join(SCRIPTS, '__pycache__')))
})
