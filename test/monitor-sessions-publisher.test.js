import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createSessionsPublisher,
  construirLineaDeSesion,
  milestoneDeRama,
  prefijoDeProyecto,
  sesionesPublicables,
} from '../src/monitor/adapters/vault-sessions-publisher.js'

// Este archivo responde: "el publisher escribe en sessions.md exactamente la
// linea del protocolo, una vez por sesion, sin pisar lineas ajenas y sin
// secretos?". git va inyectado como fake; el Vault y el registro local son
// directorios temporales; timestamps fijos.

const AHORA = 1_754_800_000_000
const CWD = 'C:/repos/mi-proyecto'

function sesionEjemplo(extra = {}) {
  return {
    sessionId: 'abcd1234-5678-90ab-cdef-111122223333',
    titulo: 'cerrar T002 del monitor',
    rama: 'feature/SHS-M1-T002-sesiones-desde-monitor',
    cuentaAlias: 'dev',
    estado: 'terminado',
    ultimoTs: AHORA - 60_000,
    consumo: { entrada: 100_000, salida: 9_400, cacheCreacion: 30_000, cacheLectura: 12_000, llamadas: 12 },
    ...extra,
  }
}

function vistaEjemplo({ sesiones } = {}) {
  return {
    cuenta: { accountUuid: 'aaaa1111', alias: 'dev' },
    proyectos: [
      {
        ruta: 'c:\\repos\\mi-proyecto', // otra grafia del MISMO cwd, a proposito
        sesiones: sesiones ?? [sesionEjemplo()],
      },
      { ruta: 'C:/repos/otro-proyecto', sesiones: [sesionEjemplo({ sessionId: 'otro-proy' })] },
    ],
  }
}

function mkTmp(prefijo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo))
}

function mkPublisher({ vault = mkTmp('souclaude-vault-'), git = gitFake(), ...resto } = {}) {
  fs.mkdirSync(path.join(vault, 'Project-SHS'), { recursive: true })
  const registroPath = path.join(mkTmp('souclaude-reg-'), 'sesiones-publicadas.json')
  const pub = createSessionsPublisher({
    vaultPath: vault,
    proyecto: 'Project-SHS',
    cwdProyecto: CWD,
    quien: 'ignacio',
    hostname: 'PC01',
    registroPath,
    git,
    ...resto,
  })
  return { pub, vault, git, registroPath, archivo: path.join(vault, 'Project-SHS', 'sessions.md') }
}

function gitFake() {
  const llamadas = []
  const fn = async (args) => {
    llamadas.push(args.filter((a) => !a.startsWith('-C')).join(' '))
  }
  fn.llamadas = llamadas
  return fn
}

// ['-C', ruta, 'pull', '--rebase'] -> 'pull --rebase' (la ruta varia por test)
function comandos(git) {
  return git.llamadas.map((l) => l.split(' ').slice(1).join(' '))
}

test('linea: formato del protocolo, campo por campo', () => {
  const linea = construirLineaDeSesion(sesionEjemplo(), { quien: 'ignacio', maquina: 'PC01' })
  assert.equal(
    linea,
    '- 2025-08-10 · feature/SHS-M1-T002-sesiones-desde-monitor · SHS-M1 · @ignacio · PC01 · in 142k / out 9k · cerrar T002 del monitor'
  )
})

test('linea: sin quien cae al alias de la cuenta; sin rama, al sessionId corto', () => {
  const linea = construirLineaDeSesion(sesionEjemplo({ rama: null, titulo: null }), { maquina: 'PC01' })
  assert.equal(linea, '- 2025-08-10 · abcd1234 · n/d · @dev · PC01 · in 142k / out 9k · n/d')
})

test('linea: una sesion sin consumo no genera linea', () => {
  const sesion = sesionEjemplo({ consumo: { entrada: 0, salida: 0, cacheCreacion: 0, cacheLectura: 0 } })
  assert.equal(construirLineaDeSesion(sesion, { maquina: 'PC01' }), null)
})

test('linea: el titulo se sanea (separador de campos y saltos de linea)', () => {
  const sesion = sesionEjemplo({ titulo: 'linea · con\nsaltos' })
  const linea = construirLineaDeSesion(sesion, { quien: 'ignacio', maquina: 'PC01' })
  assert.ok(linea.endsWith('· linea con saltos'))
  assert.ok(!linea.includes('\n'))
})

test('milestoneDeRama: infiere <PREFIJO>-M<n> y devuelve null sin patron', () => {
  assert.equal(milestoneDeRama('feature/SHS-M1-T002-x'), 'SHS-M1')
  assert.equal(milestoneDeRama('fix/TNP-M12-bug'), 'TNP-M12')
  assert.equal(milestoneDeRama('docs/onboarding'), null)
  assert.equal(milestoneDeRama(null), null)
})

test('milestoneDeRama: la forma corta M<n> (norma actual) se resuelve con el prefijo del proyecto', () => {
  assert.equal(milestoneDeRama('feature/M31-rama-por-milestone', 'SHS'), 'SHS-M31')
  assert.equal(milestoneDeRama('fix/M7-chequeo', 'TNP'), 'TNP-M7')
  assert.equal(milestoneDeRama('feature/SHS-M1-x', 'TNP'), 'SHS-M1', 'la clave explicita de la rama manda')
  assert.equal(milestoneDeRama('feature/M31-rama', null), null, 'sin prefijo no se atribuye a un proyecto')
  assert.equal(milestoneDeRama('feature/m31-rama', 'SHS'), null, 'minusculas no es un ID')
  assert.equal(milestoneDeRama('feature/M31x-rama', 'SHS'), null)
  assert.equal(prefijoDeProyecto('Project-SHS'), 'SHS')
  assert.equal(prefijoDeProyecto('otra-cosa'), null)
})

test('linea: con proyecto Project-SHS, la rama feature/M31-... publica milestone SHS-M31', () => {
  const sesion = sesionEjemplo({ rama: 'feature/M31-rama-por-milestone' })
  const linea = construirLineaDeSesion(sesion, { quien: 'ignacio', maquina: 'PC01', prefijo: 'SHS' })
  assert.ok(linea.includes(' · feature/M31-rama-por-milestone · SHS-M31 · '), linea)
})

test('seleccion: sesiones vivas y terminadas del proyecto del cwd (grafias normalizadas), nunca de otro proyecto', () => {
  const vista = vistaEjemplo({
    sesiones: [sesionEjemplo(), sesionEjemplo({ sessionId: 'viva-0001', estado: 'corriendo' })],
  })
  const elegidas = sesionesPublicables(vista, CWD)
  assert.deepEqual(elegidas.map((s) => s.sessionId), ['abcd1234-5678-90ab-cdef-111122223333', 'viva-0001'])
})

test('publisher: una sesion viva publica y su linea se actualiza al crecer (recurrente)', async () => {
  const { pub, archivo } = mkPublisher()
  const viva = sesionEjemplo({ estado: 'corriendo' })
  await pub.publicar(vistaEjemplo({ sesiones: [viva] }), { ahora: AHORA })
  assert.ok(fs.readFileSync(archivo, 'utf8').includes('in 142k / out 9k'))

  const crecida = sesionEjemplo({
    estado: 'corriendo',
    consumo: { entrada: 180_000, salida: 15_000, cacheCreacion: 0, cacheLectura: 0 },
  })
  await pub.publicar(vistaEjemplo({ sesiones: [crecida] }), { ahora: AHORA + 6 * 60_000 })
  const lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n')
  assert.equal(lineas.length, 1)
  assert.ok(lineas[0].includes('in 180k / out 15k'))
})

test('publisher: agrega la linea, en el orden git correcto, y es idempotente', async () => {
  const { pub, git, archivo } = mkPublisher()

  const r = await pub.publicar(vistaEjemplo(), { ahora: AHORA })
  assert.deepEqual(r, { publicado: true, motivo: null, lineas: 1 })
  assert.deepEqual(comandos(git), [
    'pull --rebase',
    'add Project-SHS/sessions.md',
    'commit -m chore: sesiones de Project-SHS (monitor)',
    'pull --rebase',
    'push',
  ])
  const contenido = fs.readFileSync(archivo, 'utf8')
  assert.ok(contenido.includes('· SHS-M1 · @ignacio · PC01 ·'))

  // Misma vista, pasado el intervalo: sin cambios, sin git.
  const llamadas = git.llamadas.length
  const r2 = await pub.publicar(vistaEjemplo(), { ahora: AHORA + 6 * 60_000 })
  assert.deepEqual(r2, { publicado: false, motivo: 'sin_cambios' })
  assert.equal(git.llamadas.length, llamadas)
})

test('publisher: una sesion reanudada actualiza SU linea; una editada a mano no se pisa', async () => {
  const { pub, archivo } = mkPublisher()
  await pub.publicar(vistaEjemplo(), { ahora: AHORA })

  // La sesion crece: la linea (intacta) se reemplaza en el lugar.
  const crecida = sesionEjemplo({ consumo: { entrada: 200_000, salida: 20_000, cacheCreacion: 0, cacheLectura: 0 } })
  await pub.publicar(vistaEjemplo({ sesiones: [crecida] }), { ahora: AHORA + 6 * 60_000 })
  let lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n')
  assert.equal(lineas.length, 1)
  assert.ok(lineas[0].includes('in 200k / out 20k'))

  // Alguien edita la linea a mano: la proxima actualizacion NO la pisa, agrega.
  fs.writeFileSync(archivo, lineas[0].replace('cerrar T002 del monitor', 'T002 cerrada') + '\n', 'utf8')
  const masCrecida = sesionEjemplo({ consumo: { entrada: 300_000, salida: 30_000, cacheCreacion: 0, cacheLectura: 0 } })
  await pub.publicar(vistaEjemplo({ sesiones: [masCrecida] }), { ahora: AHORA + 12 * 60_000 })
  lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n')
  assert.equal(lineas.length, 2)
})

test('linea: un titulo con secreto degrada a n/d (la sesion se registra sin el secreto)', () => {
  const sesion = sesionEjemplo({ titulo: 'probando sk-ant-api03-abcdefghijklmnop' })
  const linea = construirLineaDeSesion(sesion, { quien: 'ignacio', maquina: 'PC01' })
  assert.ok(linea.endsWith('· n/d'))
  assert.ok(!linea.includes('sk-ant'))
})

test('linea: la rama se sanea — el separador de campos no puede falsificar la linea', () => {
  const sesion = sesionEjemplo({ rama: 'feature/x · SHS-M9 · @otro · PC99', titulo: null })
  const linea = construirLineaDeSesion(sesion, { quien: 'ignacio', maquina: 'PC01' })
  // Un solo · por separador real: 6 separadores = 7 campos.
  assert.equal(linea.split(' · ').length, 7)
  assert.ok(linea.includes('feature/x - SHS-M9 - @otro - PC99'))
})

test('publisher: una linea que aun asi contiene secreto no se publica y queda en estado()', async () => {
  const { pub, git } = mkPublisher()
  const vista = vistaEjemplo({
    sesiones: [sesionEjemplo({ rama: 'feature/sk-ant-api03-abcdefghijklmnop', titulo: null })],
  })
  const r = await pub.publicar(vista, { ahora: AHORA })
  assert.deepEqual(r, { publicado: false, motivo: 'secreto_detectado' })
  assert.equal(pub.estado().secretoDetectado, true)
  assert.equal(git.llamadas.length, 0)
})

test('publisher: respeta intervalo y acumula backoff ante fallos de pull', async () => {
  const git = async (args) => {
    if (args.includes('pull')) throw new Error('sin red')
  }
  const { pub } = mkPublisher({ git, intervaloMs: 0 })

  for (let i = 0; i < 3; i++) {
    const r = await pub.publicar(vistaEjemplo(), { ahora: AHORA + i * 1000 })
    assert.deepEqual(r, { publicado: false, motivo: 'pull_fallo' })
  }
  assert.equal(pub.estado().fallosSeguidos, 3)
  const r = await pub.publicar(vistaEjemplo(), { ahora: AHORA + 4000 })
  assert.equal(r.motivo, 'backoff')
})

test('publisher: sin vault o sin proyecto degrada sin tocar git', async () => {
  const git = gitFake()
  const sinVault = createSessionsPublisher({ proyecto: 'Project-SHS', cwdProyecto: CWD, git })
  assert.deepEqual(await sinVault.publicar(vistaEjemplo(), { ahora: AHORA }), { publicado: false, motivo: 'sin_vault' })

  const sinProyecto = createSessionsPublisher({ vaultPath: mkTmp('souclaude-vault-'), cwdProyecto: CWD, git })
  assert.deepEqual(await sinProyecto.publicar(vistaEjemplo(), { ahora: AHORA }), {
    publicado: false,
    motivo: 'sin_proyecto',
  })
  assert.equal(git.llamadas.length, 0)
})

test('publisher: el registro local sobrevive entre instancias (no re-publica)', async () => {
  const { pub, vault, registroPath } = mkPublisher()
  await pub.publicar(vistaEjemplo(), { ahora: AHORA })

  const git2 = gitFake()
  const pub2 = createSessionsPublisher({
    vaultPath: vault,
    proyecto: 'Project-SHS',
    cwdProyecto: CWD,
    quien: 'ignacio',
    hostname: 'PC01',
    registroPath,
    git: git2,
  })
  const r = await pub2.publicar(vistaEjemplo(), { ahora: AHORA + 10 * 60_000 })
  assert.deepEqual(r, { publicado: false, motivo: 'sin_cambios' })
  assert.equal(git2.llamadas.length, 0)
})
