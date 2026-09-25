import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Helper de fixtures para el monitor de tokens. Sigue las decisiones de
// test/helpers.js: mismo estilo de tmpdir con espacio a proposito (replica
// las rutas OneDrive de SOUTEC bajo "Soutec Ignacio Alvarez") y sin limpieza
// automatica, porque helpers.js tampoco la hace.

// SHS-M37-T004: SOUCLAUDE_LOCAL_ACCOUNTS es config de la maquina REAL (otras
// carpetas CLAUDE_CONFIG_DIR, ej. ~/.claude2). El monitor las mezcla en el
// arbol y en CUENTAS incluso con --claude-home, asi que un fixture recibia las
// llamadas y la cuenta reales del dev (368 !== 2 en monitor-cmd, 3 !== 2 en el
// e2e multicuenta) y el resultado cambiaba con cada sesion viva. Esta variable
// se lee al llamar a monitor(), no al importarlo, por eso alcanza con limpiarla
// aca. Los tests que necesitan cuentas locales pasan sus homes explicitos a
// createLocalAccountsReader y no dependen del entorno.
delete process.env.SOUCLAUDE_LOCAL_ACCOUNTS

let contadorMsg = 0
let contadorReq = 0

// Crea un home falso de Claude Code con la estructura exacta que
// claude-home.js espera. Devuelve la ruta de la carpeta .claude (es lo que
// se le pasa como `override` a resolveClaudeHome).
//
// .claude.json va HERMANO de .claude, nunca dentro: resolveClaudeHome resuelve
// configFile como path.join(home, '..', '.claude.json') donde `home` es el
// override que se le pasa (la carpeta .claude que esta funcion devuelve).
export function mkClaudeHome({ proyectos = {}, sesiones = [], config = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'souclaude monitor test '))
  const claudeDir = path.join(base, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true })

  if (config !== null) {
    fs.writeFileSync(path.join(base, '.claude.json'), JSON.stringify(config, null, 2), 'utf8')
  }

  for (const [slug, archivos] of Object.entries(proyectos)) {
    const slugDir = path.join(claudeDir, 'projects', slug)
    for (const [relPath, valor] of Object.entries(archivos)) {
      const { lineas, meta } = normalizarArchivo(valor)
      const abs = path.join(slugDir, ...relPath.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, lineas.map((l) => `${l}\n`).join(''), 'utf8')

      // Al lado de cada agent-<id>.jsonl va su agent-<id>.meta.json, tal como
      // lo espera claude-home.js (readAgentMeta / metaPath en indexTranscripts).
      const nombre = path.basename(relPath)
      const match = /^agent-(.+)\.jsonl$/.exec(nombre)
      if (match) {
        const agentId = match[1]
        const metaPath = path.join(path.dirname(abs), `agent-${agentId}.meta.json`)
        const metaFinal = {
          agentType: 'general-purpose',
          description: 'Tarea de prueba',
          toolUseId: `toolu_${agentId}`,
          spawnDepth: 1,
          ...meta,
        }
        fs.writeFileSync(metaPath, JSON.stringify(metaFinal, null, 2), 'utf8')
      }
    }
  }

  const sessionsDir = path.join(claudeDir, 'sessions')
  if (sesiones.length > 0) fs.mkdirSync(sessionsDir, { recursive: true })
  sesiones.forEach((sesion, i) => {
    const pid = sesion.pid ?? 90000 + i
    const full = {
      version: '2.1.220',
      kind: 'interactive',
      entrypoint: 'claude-vscode',
      ...sesion,
      pid,
    }
    fs.writeFileSync(path.join(sessionsDir, `${pid}.json`), JSON.stringify(full, null, 2), 'utf8')
  })

  return claudeDir
}

// El valor de cada archivo en `proyectos` puede ser un array de lineas
// (caso comun) o un objeto { lineas, meta } cuando hace falta pisar el
// .meta.json generado automaticamente para un subagente.
function normalizarArchivo(valor) {
  if (Array.isArray(valor)) return { lineas: valor, meta: null }
  return { lineas: valor.lineas ?? [], meta: valor.meta ?? null }
}

function tsAIso(ts) {
  if (ts === undefined || ts === null) return new Date().toISOString()
  if (typeof ts === 'number') return new Date(ts).toISOString()
  return ts
}

// Fabrica una linea type:"assistant" con la forma real del transcript de
// Claude Code (ver eventos.js: aEventoDeUso lee obj.message.usage, obj.message.id,
// obj.requestId, obj.timestamp, obj.sessionId, obj.agentId, obj.attributionAgent,
// obj.cwd, obj.gitBranch, obj.message.model, obj.effort, obj.isSidechain).
//
// Llamar dos veces con el mismo `id` produce dos lineas con el mismo
// message.id y el mismo usage (nada aleatorio se mete en el medio): es lo
// que hace Claude Code de verdad y lo que necesita el test de deduplicacion.
export function lineaAssistant(opts = {}) {
  const {
    id,
    requestId,
    ts,
    sessionId = 'sess-test',
    agentId = null,
    attributionAgent,
    cwd = 'C:\\Users\\test\\proyecto',
    gitBranch = 'main',
    modelo = 'claude-opus-5',
    effort = 'medium',
    entrada = 100,
    salida = 50,
    cacheCreacion = 0,
    cacheLectura = 0,
    cache1h = 0,
    cache5m = 0,
    esSidechain = false,
    apiError = false,
  } = opts

  const msgId = id ?? `msg_${String(++contadorMsg).padStart(6, '0')}`
  const reqId = requestId ?? `req_${String(++contadorReq).padStart(6, '0')}`

  const obj = {
    type: 'assistant',
    timestamp: tsAIso(ts),
    sessionId,
    cwd,
    gitBranch,
    requestId: reqId,
    effort,
    isSidechain: esSidechain === true,
    version: '2.1.220',
    userType: 'external',
    message: {
      id: msgId,
      model: modelo,
      role: 'assistant',
    },
  }

  if (agentId) {
    obj.agentId = agentId
    // attributionAgent puede venir vacio en Claude Code real (ver comentario
    // en eventos.js sobre el fallback con `||`); por default no forzamos uno.
    obj.attributionAgent = attributionAgent ?? ''
  }

  if (apiError) {
    obj.isApiErrorMessage = true
  } else {
    obj.message.usage = {
      input_tokens: entrada,
      output_tokens: salida,
      cache_creation_input_tokens: cacheCreacion,
      cache_read_input_tokens: cacheLectura,
      cache_creation: {
        ephemeral_1h_input_tokens: cache1h,
        ephemeral_5m_input_tokens: cache5m,
      },
      service_tier: 'standard',
    }
  }

  return JSON.stringify(obj)
}

// Fabrica una linea type:"ai-title" (ver aTitulo en eventos.js).
export function lineaTitulo({ sessionId = 'sess-test', titulo = 'Titulo de prueba' } = {}) {
  return JSON.stringify({ type: 'ai-title', sessionId, aiTitle: titulo })
}

// Fabrica una linea type:"user" con toolUseResult de cierre de subagente
// (ver aCierre en eventos.js).
export function lineaCierre({
  agentId,
  agentType = 'general-purpose',
  resolvedModel = 'claude-opus-5',
  totalTokens = 1000,
  totalDurationMs = 5000,
  totalToolUseCount = 3,
  toolStats = null,
} = {}) {
  return JSON.stringify({
    type: 'user',
    toolUseResult: {
      agentId,
      agentType,
      resolvedModel,
      totalTokens,
      totalDurationMs,
      totalToolUseCount,
      toolStats,
    },
  })
}

// Agrega lineas completas a un jsonl ya creado (o lo crea si hace falta).
export function appendLineas(homeDir, relJsonl, lineas) {
  const abs = path.join(homeDir, ...relJsonl.split('/'))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.appendFileSync(abs, lineas.map((l) => `${l}\n`).join(''), 'utf8')
  return abs
}

// Escribe texto SIN el \n final: simula a Claude Code a mitad de escritura
// de una linea, para el test de la linea partida.
export function escribirParcial(homeDir, relJsonl, texto) {
  const abs = path.join(homeDir, ...relJsonl.split('/'))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.appendFileSync(abs, texto, 'utf8')
  return abs
}
