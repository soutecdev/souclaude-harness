// Merge "seed": el harness solo AGREGA claves que faltan. Nunca pisa un valor
// que el usuario ya escribio, nunca borra.
//
// Por que no un deep-merge que gane: si un dev cambia "model" a "sonnet" porque
// asi trabaja, un upgrade no tiene derecho a devolverselo a "opusplan" (P8).
// Para remover o renombrar claves (ej: las 4 claves invalidas del Kit v0) existen
// las migraciones en src/migrations/ — eso es un acto explicito y versionado,
// no un efecto secundario silencioso del merge. El otro acto explicito es el
// cambio de modo (`upgrade --solo` / `--equipo`): ver retirarSemilla, abajo.
export function seedMerge(existing, seed) {
  if (!isPlainObject(existing)) return structuredClone(seed)
  const out = structuredClone(existing)
  for (const [key, value] of Object.entries(seed)) {
    if (!(key in out)) {
      out[key] = structuredClone(value)
    } else if (isPlainObject(out[key]) && isPlainObject(value)) {
      out[key] = seedMerge(out[key], value)
    } else if (Array.isArray(out[key]) && Array.isArray(value)) {
      // Union preservando el orden del usuario primero.
      const seen = new Set(out[key].map(claveDeElemento))
      for (const v of value) {
        if (!seen.has(claveDeElemento(v))) out[key].push(v)
      }
    }
    // Escalar ya presente -> se respeta el del usuario.
  }
  return out
}

// Inversa acotada de seedMerge, para el CAMBIO DE MODO. El ADR del modo solo
// (20260915) dice que la superficie solo deja settings.json permisivo y reemplaza
// el hook de sesion; como el merge solo agrega, tras `upgrade --solo` quedaban el
// deny de `gh pr merge` (que le gana al allow nuevo), los ask del push forzado,
// el PostToolUse de los checks de PR y el SessionStart de declarar-milestone --
// apuntando a un archivo que --prune acababa de borrar.
//
// De los ARRAYS del archivo quita los elementos que sembro `anterior` y que
// `nuevo` ya no trae, reconocidos igual que en el merge (un grupo de hooks, por a
// que tool aplica y que ejecuta). No toca escalares ni claves, ni nada que el
// usuario haya agregado o reescrito: eso no coincide con el seed y se queda.
export function retirarSemilla(existing, anterior, nuevo) {
  if (!isPlainObject(existing) || !isPlainObject(anterior)) return existing
  const out = structuredClone(existing)
  for (const [key, valorAnterior] of Object.entries(anterior)) {
    if (!(key in out)) continue
    const valorNuevo = isPlainObject(nuevo) ? nuevo[key] : undefined
    if (isPlainObject(out[key]) && isPlainObject(valorAnterior)) {
      out[key] = retirarSemilla(out[key], valorAnterior, valorNuevo)
    } else if (Array.isArray(out[key]) && Array.isArray(valorAnterior)) {
      const siguen = new Set((Array.isArray(valorNuevo) ? valorNuevo : []).map(claveDeElemento))
      const seRetiran = new Set(valorAnterior.map(claveDeElemento).filter((clave) => !siguen.has(clave)))
      const antes = out[key].length
      out[key] = out[key].filter((v) => !seRetiran.has(claveDeElemento(v)))
      // Un array que quedo vacio por el retiro y que el modo nuevo no declara no
      // deja la clave colgando (`"ask": []`, `"PostToolUse": []`).
      if (out[key].length === 0 && antes > 0 && !Array.isArray(valorNuevo)) delete out[key]
    }
  }
  return out
}

// Como se reconoce que un elemento del seed "ya esta" en el array del usuario.
// Para casi todo, por igualdad exacta. Para un grupo de hooks de Claude Code
// ({ matcher, hooks: [{ type, command, if, timeout }] }), por su identidad: a que
// tool aplica y que ejecuta. Lo demas (timeout...) son ajustes: con la igualdad
// exacta, que el usuario cambiara el timeout de un hook del harness hacia que el
// proximo upgrade agregara OTRA copia del grupo, y el hook corria dos veces (en
// reglas-pr, dos comentarios por PR).
function claveDeElemento(v) {
  if (isPlainObject(v) && Array.isArray(v.hooks) && v.hooks.length > 0 && v.hooks.every(isPlainObject)) {
    const ejecuta = v.hooks.map((h) => [h.type ?? null, h.command ?? h.url ?? h.prompt ?? null, h.if ?? null])
    return JSON.stringify(['grupo-de-hooks', v.matcher ?? null, ejecuta])
  }
  return JSON.stringify(v)
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

// El BOM inicial (lo escriben Windows PowerShell 5.1 con -Encoding UTF8 y varios
// editores de Windows) es un JSON invalido para JSON.parse: un settings.json
// guardado asi abortaba el upgrade entero con un "Unexpected token" ilegible.
export function sinBom(content) {
  return typeof content === 'string' && content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

export function parseJson(content, dest) {
  if (content == null) return null
  try {
    return JSON.parse(sinBom(content))
  } catch (err) {
    throw new Error(`${dest} no es JSON valido: ${err.message}`)
  }
}

export function stringifyJson(obj) {
  return JSON.stringify(obj, null, 2)
}
