import path from 'node:path'
import { hashContent, hashBytes, normalize } from './hash.js'
import { leerParaElPlan, esDestSeguro } from './fsx.js'
import { readTemplate, readTemplateBytes, readFragments } from './manifest.js'
import { render } from './render.js'
import { buildBlock, upsertBlock, extractBlock } from './block.js'
import { seedMerge, retirarSemilla, parseJson, stringifyJson } from './jsonmerge.js'
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
export const MIGRATE = 'migrate' // el usuario lo edito y una migracion aplica -> solo la migracion, en el lugar

// Modos de trabajo del harness (SHS-M34): la superficie completa de equipo o la
// relajada de single coder. Fuente unica para resolver (commands/_shared.js),
// filtrar (computePlan) y verificar (core/verify.js).
export const MODOS = ['equipo', 'solo']

export function computePlan({ manifest, cwd, lock, vars, detected, force = false, skills, modo }) {
  const actions = []
  const skippedByStack = []
  // Claves del lockfile que no son una ruta relativa dentro del repo: no se
  // planifica nada sobre ellas (ni leer, ni borrar) y el CLI lo avisa.
  const ignorados = []
  const fromVersion = lock?.harnessVersion ?? '0.0.0'
  const seenDests = new Set()

  // Modo de trabajo (SHS-M34). Sin parametro explicito: el persistido en el
  // lockfile; sin nada, equipo — el harness completo, como siempre fue (los
  // call sites viejos y los tests que no pasan modo conservan su comportamiento).
  const modoActivo = modo ?? lock?.modo ?? 'equipo'
  // Cambio de modo: el repo ya tenia el harness en otro modo (un lockfile sin
  // modo es anterior al modo solo: era equipo). Lo usan los entries merge-json
  // para retirar lo que sembro el modo anterior.
  const modoAnterior = lock && (lock.modo ?? 'equipo') !== modoActivo ? (lock.modo ?? 'equipo') : null

  // Seleccion de skills. Sin parametro explicito: lo que dice el lockfile; sin
  // lockfile, todas las del catalogo del modo (compatibilidad con repos pre-3.0
  // y tests).
  const selected = resolveSkillSet({ manifest, lock, skills, modo: modoActivo })

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
    // El manifest viaja con el CLI y es confiable, pero un dest fuera del repo es
    // un error de quien lo edito: se corta aca, antes de leer o escribir nada.
    if (!esDestSeguro(entry.dest)) {
      throw new Error(`manifest invalido: el entry "${entry.id}" tiene un dest fuera del repo (${entry.dest})`)
    }
    const group = entry.policy === 'merge-json' ? mergeJsonGroups.get(entry.dest) : null
    // Solo la primera entrada del grupo planifica; las demas ya quedaron
    // fundidas como seedEntries.
    if (group && group.length > 1 && group[0] !== entry) continue
    seenDests.add(entry.dest)
    const seedEntries = group && group.length > 1 ? group : null
    // Los entries del MISMO dest que pertenecian al modo anterior y no al actual
    // (settings.json de equipo cuando se pasa a solo, y viceversa).
    const retiredEntries =
      modoAnterior && entry.policy === 'merge-json'
        ? manifest.files.filter(
            (e) => e.policy === 'merge-json' && e.dest === entry.dest && e.modos?.includes(modoAnterior) && !e.modos.includes(modoActivo)
          )
        : []
    actions.push(
      ...[planFile({ entry, manifest, cwd, lock, vars, detected, fromVersion, force, seedEntries, retiredEntries, modoAnterior, modoActivo })].flat()
    )
  }

  // Archivos que emitimos en una version anterior y que este manifest ya no
  // declara. Si siguen intactos desde que el harness los escribio (hash de disco
  // == hash del lockfile), --prune los borra sin pedir confirmacion: es contenido
  // del harness, no del usuario. Si el hash no coincide, el usuario lo edito para
  // acomodarlo a su gusto y --prune exige la confirmacion escrita de siempre (P6).
  for (const dest of Object.keys(lock?.files ?? {})) {
    if (seenDests.has(dest)) continue
    if (!esDestSeguro(dest)) {
      ignorados.push({ dest, motivo: 'no es una ruta relativa dentro del repo' })
      continue
    }
    const abs = path.join(cwd, ...dest.split('/'))
    const lockEntry = lock.files[dest]
    const raw = leerParaElPlan(abs, dest, { binario: Boolean(lockEntry.binary) })
    if (raw == null) continue
    const diskHash = lockEntry.binary ? hashBytes(raw) : hashContent(raw)
    const edited = diskHash !== lockEntry.hash
    actions.push({
      dest,
      policy: 'managed',
      verdict: OBSOLETE,
      autoPrune: !edited,
      reasons: [edited ? 'ya no forma parte del harness; lo editaste, revisar antes de borrar' : 'ya no forma parte del harness; sin editar, se borra sin confirmar'],
    })
    seenDests.add(dest)
  }

  // Archivos que el harness declara muertos explicitamente. A diferencia de los
  // anteriores, estos se detectan aunque NO haya lockfile — es como se le avisa a
  // un repo que copio el Kit a mano que su .claudeignore no hace nada. Sin
  // lockfile no hay forma de saber si el usuario lo edito, asi que se tratan
  // como editados (exigen confirmacion) por seguridad.
  for (const dead of manifest.obsolete ?? []) {
    if (seenDests.has(dead.dest)) continue
    const abs = path.join(cwd, ...dead.dest.split('/'))
    const lockEntry = lock?.files?.[dead.dest]
    const enDisco = leerParaElPlan(abs, dead.dest, { binario: Boolean(lockEntry?.binary) })
    if (enDisco == null) continue
    const diskHash = lockEntry ? (lockEntry.binary ? hashBytes(enDisco) : hashContent(enDisco)) : null
    const autoPrune = lockEntry != null && diskHash === lockEntry.hash
    actions.push({ dest: dead.dest, policy: 'managed', verdict: OBSOLETE, autoPrune, reasons: [dead.reason] })
  }

  const dirs = (manifest.dirs ?? []).filter((d) => !(d.when === 'empty-repo' && !detected.isEmpty))

  return { actions, dirs, fromVersion, toVersion: manifest.harnessVersion, skills: [...selected].sort(), modo: modoActivo, skippedByStack, ignorados }
}

// Las required del catalogo del modo entran SIEMPRE, se pidan o no: es la
// garantia de que la skill de Git (soutec-github en equipo, soutec-github-solo
// en solo) no se puede desinstalar. El catalogo se filtra por modo con la misma
// semantica que los entries de files: una skill sin "modos" existe en ambos.
// Lo elegido (flag o lockfile) se intersecta con el catalogo del modo: al
// cambiar de modo, las skills del modo anterior salen del set y sus archivos
// caen al barrido de OBSOLETE.
export function resolveSkillSet({ manifest, lock, skills, modo = 'equipo' }) {
  const catalog = (manifest.skills ?? []).filter((s) => !s.modos || s.modos.includes(modo))
  const required = catalog.filter((s) => s.required).map((s) => s.id)
  const ids = new Set(catalog.map((s) => s.id))
  const chosen = (skills ?? lock?.skills ?? catalog.map((s) => s.id)).filter((id) => ids.has(id))
  return new Set([...required, ...chosen])
}

function planFile({ entry, manifest, cwd, lock, vars, detected, fromVersion, force, seedEntries, retiredEntries = [], modoAnterior = null, modoActivo = null }) {
  const abs = path.join(cwd, ...entry.dest.split('/'))
  if (entry.binary) return planBinaryFile({ entry, abs, lock, force })
  const raw = leerParaElPlan(abs, entry.dest)

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
  const cambioDeModo = retiredEntries.length ? { retiredEntries, modoAnterior, modoActivo, reasons } : null
  const desired = desiredContent({ entry, manifest, vars, detected, baseline, seedEntries, cambioDeModo })

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

  // append-block y merge-json solo tocan la region que el harness posee, asi que
  // nunca pueden "pisar" al usuario: agregan lo que falta y, en un cambio de modo,
  // retiran lo que el propio harness sembro para el modo anterior. No hay conflicto
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
    return conMigracion(action, baseline, onDisk)
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
    return conMigracion(action, baseline, onDisk)
  }

  action.verdict = CONFLICT
  reasons.push('editado por ti Y el template cambio')
  if (force) return action
  action.writePath = `${entry.dest}.new`
  return conMigracion(action, baseline, onDisk)
}

// Un archivo que el usuario edito nunca se pisa con el template; pero si una
// migracion cambia algo, ese cambio puntual SI se escribe en el lugar (SHS-M37):
// de otro modo quedaria solo en el .new, que nadie mira. El resto del archivo es
// el del usuario, byte a byte. local-edit no escribia nada: pasa a ser solo la
// migracion. conflict y foreign conservan su .new al lado. En los dos casos el
// lockfile conserva el hash previo: el archivo sigue siendo del usuario.
function conMigracion(action, baseline, onDisk) {
  if (normalize(baseline) === normalize(onDisk)) return action
  const esMigracion = (r) => r.startsWith('migracion ')
  const migracion = {
    dest: action.dest,
    policy: action.policy,
    verdict: MIGRATE,
    reasons: [...action.reasons.filter(esMigracion), 'el resto del archivo es tuyo y no se toca'],
    content: baseline,
    writePath: action.dest,
  }
  if (action.verdict === LOCAL_EDIT) return migracion
  action.reasons = action.reasons.filter((r) => !esMigracion(r))
  return [action, migracion]
}

// La misma tabla de clasificacion que planFile, pero comparando bytes: sin
// migraciones, sin render y sin normalizacion de newlines (corromperia un PNG).
function planBinaryFile({ entry, abs, lock, force }) {
  const raw = leerParaElPlan(abs, entry.dest, { binario: true })
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

function desiredContent({ entry, manifest, vars, detected, baseline, seedEntries, cambioDeModo = null }) {
  switch (entry.policy) {
    case 'append-block': {
      const lines = readFragments(entry.src, detected.stacks)
      const block = buildBlock(lines, manifest.harnessVersion)
      return upsertBlock(baseline, block)
    }
    case 'merge-json': {
      // Varios dueños (skills distintas) pueden aportar seed al mismo dest: se
      // funden en orden antes de fundirlos con lo que ya hay en disco.
      const semillaDe = (entries) => entries.map((e) => JSON.parse(render(readTemplate(e.src), vars))).reduce((acc, s) => seedMerge(acc, s), {})
      const seed = semillaDe(seedEntries ?? [entry])
      let existing = parseJson(baseline, entry.dest)
      if (cambioDeModo && existing != null) {
        const sinLoAnterior = retirarSemilla(existing, semillaDe(cambioDeModo.retiredEntries), seed)
        if (stringifyJson(sinLoAnterior) !== stringifyJson(existing)) {
          cambioDeModo.reasons.push(
            `cambio de modo ${cambioDeModo.modoAnterior} -> ${cambioDeModo.modoActivo}: se retiran los permisos y hooks que sembro el modo ${cambioDeModo.modoAnterior}; lo que agregaste o cambiaste queda`
          )
        }
        existing = sinLoAnterior
      }
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
  return actions.filter((a) => [CREATE, UPDATE, RESTORE, CONFLICT, FOREIGN, MIGRATE].includes(a.verdict))
}
