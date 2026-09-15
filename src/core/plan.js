import path from 'node:path'
import { hashContent, hashBytes, normalize } from './hash.js'
import { readIfExists, readBytesIfExists } from './fsx.js'
import { readTemplate, readTemplateBytes, readFragments } from './manifest.js'
import { render } from './render.js'
import { buildBlock, upsertBlock, extractBlock } from './block.js'
import { seedMerge, parseJson, stringifyJson } from './jsonmerge.js'
import { migrationsFor } from '../migrations/index.js'

// Veredictos. init, adopcion de un repo legacy y migracion de version son EL
// MISMO code path: lo unico que cambia es que encuentra en disco y en el lockfile.
export const CREATE = 'create' // no existe, no esta en el lockfile -> escribir
export const UPDATE = 'update' // intacto desde la ultima vez, el template cambio -> pisar (seguro)
export const NOOP = 'noop' // identico a lo deseado -> no tocar
export const CONFLICT = 'conflict' // el usuario lo edito Y el template cambio -> .new
export const FOREIGN = 'foreign' // existe pero nunca lo escribimos nosotros -> .new
export const RESTORE = 'restore' // lo escribimos y el usuario lo borro -> reescribir
export const LOCAL_EDIT = 'local-edit' // el usuario lo edito, el template no cambio -> dejarlo
export const OBSOLETE = 'obsolete' // estaba en el lockfile, ya no esta en el manifest -> ofrecer borrado

// Modos de trabajo del harness (SHS-M34): la superficie completa de equipo o la
// relajada de single coder. Fuente unica para resolver (commands/_shared.js),
// filtrar (computePlan) y verificar (core/verify.js).
export const MODOS = ['equipo', 'solo']

export function computePlan({ manifest, cwd, lock, vars, detected, force = false, skills, modo }) {
  const actions = []
  const skippedByStack = []
  const fromVersion = lock?.harnessVersion ?? '0.0.0'
  const seenDests = new Set()

  // Seleccion de skills. Sin parametro explicito: lo que dice el lockfile; sin
  // lockfile, todas las del catalogo (compatibilidad con repos pre-3.0 y tests).
  const selected = resolveSkillSet({ manifest, lock, skills })

  // Modo de trabajo (SHS-M34). Sin parametro explicito: el persistido en el
  // lockfile; sin nada, equipo — el harness completo, como siempre fue (los
  // call sites viejos y los tests que no pasan modo conservan su comportamiento).
  const modoActivo = modo ?? lock?.modo ?? 'equipo'

  const emitted = manifest.files.filter((entry) => {
    if (entry.when === 'empty-repo' && !detected.isEmpty) return false
    // "modos": ["equipo"|"solo", ...] — el entry pertenece solo a esa(s)
    // superficie(s); sin el campo, es comun a ambos modos. A diferencia de
    // stack, no se reporta nada: que el archivo no este ES el comportamiento
    // del modo, no un hueco a completar a mano. Lo que deja de emitirse en un
    // cambio de modo cae al barrido de OBSOLETE y se ofrece con --prune.
    if (entry.modos && !entry.modos.includes(modoActivo)) return false
    // "when": "stack:<id>" -- el entry asume un lenguaje/runtime concreto (ej.
    // tag-release.mjs necesita Node para correr). Si el repo no trae esa senal,
    // no se instala: instalarlo igual dejaria un script que nadie puede ejecutar.
    // Se recuerda en skippedByStack para que el CLI avise que hay una instruccion
    // (skill harness-upgrade) para generarlo a mano segun el stack real.
    if (entry.when?.startsWith('stack:')) {
      const stack = entry.when.slice('stack:'.length)
      if (!detected.stacks.includes(stack)) {
        skippedByStack.push({ dest: entry.dest, stack })
        return false
      }
    }
    // Skill no seleccionada: no se emite. Si estaba instalada de antes, cae al
    // barrido de OBSOLETE de abajo y se ofrece con --prune.
    if (entry.skill && !selected.has(entry.skill)) return false
    return true
  })

  // Dos skills distintas pueden declarar un entry merge-json sobre el mismo dest
  // (ej. jira-sync y azdo-sync agregando cada una su servidor a .mcp.json). Cada
  // planFile relee el disco por su cuenta y apply.js escribe una accion por
  // entry: si se planificaran por separado, la segunda pisaria el archivo entero
  // e ignoraria lo que agrego la primera (last-write-wins). Se agrupan por dest
  // ANTES de planificar y se funden sus seeds en una sola accion.
  const mergeJsonGroups = new Map()
  for (const entry of emitted) {
    if (entry.policy !== 'merge-json') continue
    const group = mergeJsonGroups.get(entry.dest) ?? []
    group.push(entry)
    mergeJsonGroups.set(entry.dest, group)
  }

  for (const entry of emitted) {
    const group = entry.policy === 'merge-json' ? mergeJsonGroups.get(entry.dest) : null
    // Solo la primera entrada del grupo planifica; las demas ya quedaron
    // fundidas como seedEntries.
    if (group && group.length > 1 && group[0] !== entry) continue
    seenDests.add(entry.dest)
    const seedEntries = group && group.length > 1 ? group : null
    actions.push(planFile({ entry, manifest, cwd, lock, vars, detected, fromVersion, force, seedEntries }))
  }

  // Archivos que emitimos en una version anterior y que este manifest ya no
  // declara. Nunca se borran solos: se ofrecen con --prune + doble confirmacion (P5).
  for (const dest of Object.keys(lock?.files ?? {})) {
    if (seenDests.has(dest)) continue
    if (readIfExists(path.join(cwd, ...dest.split('/'))) == null) continue
    actions.push({ dest, policy: 'managed', verdict: OBSOLETE, reasons: ['ya no forma parte del harness'] })
    seenDests.add(dest)
  }

  // Archivos que el harness declara muertos explicitamente. A diferencia de los
  // anteriores, estos se detectan aunque NO haya lockfile — es como se le avisa a
  // un repo que copio el Kit a mano que su .claudeignore no hace nada.
  for (const dead of manifest.obsolete ?? []) {
    if (seenDests.has(dead.dest)) continue
    if (readIfExists(path.join(cwd, ...dead.dest.split('/'))) == null) continue
    actions.push({ dest: dead.dest, policy: 'managed', verdict: OBSOLETE, reasons: [dead.reason] })
  }

  const dirs = (manifest.dirs ?? []).filter((d) => !(d.when === 'empty-repo' && !detected.isEmpty))

  return { actions, dirs, fromVersion, toVersion: manifest.harnessVersion, skills: [...selected].sort(), modo: modoActivo, skippedByStack }
}

// Las required del catalogo entran SIEMPRE, se pidan o no: es la garantia de
// que soutec-github no se puede desinstalar.
export function resolveSkillSet({ manifest, lock, skills }) {
  const catalog = manifest.skills ?? []
  const required = catalog.filter((s) => s.required).map((s) => s.id)
  const chosen = skills ?? lock?.skills ?? catalog.map((s) => s.id)
  return new Set([...required, ...chosen])
}

function planFile({ entry, manifest, cwd, lock, vars, detected, fromVersion, force, seedEntries }) {
  const abs = path.join(cwd, ...entry.dest.split('/'))
  if (entry.binary) return planBinaryFile({ entry, abs, lock, force })
  const raw = readIfExists(abs)

  // Un archivo vacio es equivalente a un archivo ausente: no hay nada del usuario que
  // perder, asi que se escribe en vez de dejarle un .new al lado para siempre. El caso
  // real: un repo recien creado en GitHub trae un README.md de 0 bytes.
  const onDisk = raw != null && normalize(raw) === '' ? null : raw

  const lockEntry = lock?.files?.[entry.dest]
  const reasons = []

  // 1. Migraciones: transforman lo que hay en disco ANTES de comparar. Asi el
  //    fix de las claves invalidas del Kit v0 aparece como un `update` normal.
  let baseline = onDisk
  if (onDisk != null) {
    for (const m of migrationsFor(entry.dest, fromVersion)) {
      const next = m.transform(baseline)
      if (!normalize(next ?? '').length) continue
      if (normalize(next) !== normalize(baseline)) {
        baseline = next
        reasons.push(`migracion ${m.id}: ${m.describe}`)
      }
    }
  }

  // 2. Contenido deseado. Para append-block y merge-json depende de lo que ya
  //    hay en disco, porque solo somos duenos de una parte del archivo.
  const desired = desiredContent({ entry, manifest, vars, detected, baseline, seedEntries })

  const action = { dest: entry.dest, policy: entry.policy, reasons, content: desired, writePath: entry.dest }

  // 3. Clasificacion. Es la tabla del plan, literal.
  if (onDisk == null) {
    action.verdict = lockEntry ? RESTORE : CREATE
    return action
  }

  const diskHash = hashContent(onDisk)
  const desiredHash = hashContent(desired)

  if (desiredHash === diskHash) {
    action.verdict = NOOP
    return action
  }

  // append-block y merge-json son aditivos por construccion: solo tocan la region
  // que el harness posee, asi que nunca pueden "pisar" al usuario. No hay conflicto
  // posible; si el contenido difiere, es que hay que actualizar nuestra region.
  if (entry.policy === 'append-block' || entry.policy === 'merge-json') {
    action.verdict = UPDATE
    if (entry.policy === 'append-block' && !extractBlock(onDisk)) {
      reasons.push('se agrega el bloque gestionado; tus lineas no se tocan')
    }
    return action
  }

  if (!lockEntry) {
    // Existe pero nunca lo escribimos nosotros: estructura hecha a mano, o un
    // CLAUDE.md que el dev ya tenia. NUNCA se pisa.
    action.verdict = FOREIGN
    action.writePath = `${entry.dest}.new`
    reasons.push('ya existia y no fue generado por el harness')
    return action
  }

  if (diskHash === lockEntry.hash) {
    // Intacto desde que lo escribimos: pisarlo no pierde nada del usuario.
    action.verdict = UPDATE
    return action
  }

  // El usuario lo edito.
  if (desiredHash === lockEntry.hash) {
    action.verdict = LOCAL_EDIT
    reasons.push('editado por ti; el template no cambio')
    return action
  }

  action.verdict = CONFLICT
  reasons.push('editado por ti Y el template cambio')
  if (!force) action.writePath = `${entry.dest}.new`
  return action
}

// La misma tabla de clasificacion que planFile, pero comparando bytes: sin
// migraciones, sin render y sin normalizacion de newlines (corromperia un PNG).
function planBinaryFile({ entry, abs, lock, force }) {
  const raw = readBytesIfExists(abs)
  const onDisk = raw != null && raw.length === 0 ? null : raw
  const desired = readTemplateBytes(entry.src)
  const lockEntry = lock?.files?.[entry.dest]
  const reasons = []
  const action = { dest: entry.dest, policy: entry.policy, reasons, content: desired, writePath: entry.dest, binary: true }

  if (onDisk == null) {
    action.verdict = lockEntry ? RESTORE : CREATE
    return action
  }

  const diskHash = hashBytes(onDisk)
  const desiredHash = hashBytes(desired)

  if (desiredHash === diskHash) {
    action.verdict = NOOP
    return action
  }

  if (!lockEntry) {
    action.verdict = FOREIGN
    action.writePath = `${entry.dest}.new`
    reasons.push('ya existia y no fue generado por el harness')
    return action
  }

  if (diskHash === lockEntry.hash) {
    action.verdict = UPDATE
    return action
  }

  if (desiredHash === lockEntry.hash) {
    action.verdict = LOCAL_EDIT
    reasons.push('editado por ti; el template no cambio')
    return action
  }

  action.verdict = CONFLICT
  reasons.push('editado por ti Y el template cambio')
  if (!force) action.writePath = `${entry.dest}.new`
  return action
}

function desiredContent({ entry, manifest, vars, detected, baseline, seedEntries }) {
  switch (entry.policy) {
    case 'append-block': {
      const lines = readFragments(entry.src, detected.stacks)
      const block = buildBlock(lines, manifest.harnessVersion)
      return upsertBlock(baseline, block)
    }
    case 'merge-json': {
      // Varios dueños (skills distintas) pueden aportar seed al mismo dest: se
      // funden en orden antes de fundirlos con lo que ya hay en disco.
      const seeds = (seedEntries ?? [entry]).map((e) => JSON.parse(render(readTemplate(e.src), vars)))
      const seed = seeds.reduce((acc, s) => seedMerge(acc, s), {})
      const existing = parseJson(baseline, entry.dest)
      return stringifyJson(seedMerge(existing, seed))
    }
    default: {
      const raw = readTemplate(entry.src)
      return entry.render ? render(raw, vars) : raw
    }
  }
}

export function summarize(actions) {
  const by = {}
  for (const a of actions) (by[a.verdict] ??= []).push(a)
  return by
}

// Acciones que efectivamente escriben algo en disco.
export function writeActions(actions) {
  return actions.filter((a) => [CREATE, UPDATE, RESTORE, CONFLICT, FOREIGN].includes(a.verdict))
}
