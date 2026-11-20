// Adaptador de pintado en vivo sobre una TTY. NO calcula layout: recibe el
// array de lineas ya medido por panel-layout.js y se limita a ponerlo en
// pantalla sin parpadeo y a devolver la terminal intacta pase lo que pase.
//
// Tres invariantes que sostienen este archivo:
// 1. En raw mode Ctrl+C NO genera SIGINT: llega como el byte \u0003 dentro del
//    stream de datos. Si no se intercepta a mano, el usuario queda sin cursor
//    y sin echo y tiene que abrir otra terminal.
// 2. restore() es idempotente y esta enganchada a exit/SIGINT/SIGTERM/
//    uncaughtException ademas de stop(). Salir por cualquier camino restaura.
// 3. Nunca \x1b[2J dentro del loop de repintado: ese borrado es el flash. Solo
//    se usa tras un resize, donde el contenido viejo quedo con otro ancho.

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'
const CURSOR_HIDE = '\x1b[?25l'
const CURSOR_SHOW = '\x1b[?25h'
const HOME = '\x1b[H'
const ERASE_LINE_END = '\x1b[K'
const ERASE_BELOW = '\x1b[0J'
const ERASE_ALL = '\x1b[2J'

// Arrastrar el borde de una ventana dispara decenas de eventos 'resize'.
const RESIZE_DEBOUNCE_MS = 120

const KEY_CTRL_C = '\u0003'

// En raw mode se pierde el post-procesado de salida (ONLCR), asi que un \n
// solo baja una fila sin volver a la columna 1. Siempre \r\n.
const EOL = '\r\n'

const PROCESS_EVENTS = ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException']

// Que tecla trae lo que llego por stdin. Si el loop estaba ocupado, un chunk
// puede traer la misma tecla varias veces: comparar el chunk entero contra una
// sola tecla hacia que pulsar Ctrl+C dos veces -- justo lo que uno hace cuando
// el panel no responde -- no saliera.
export function accionDeTecla(chunk) {
  const key = typeof chunk === 'string' ? chunk : String(chunk)
  if (key.includes(KEY_CTRL_C)) return 'interrumpir'
  if (/^q+$/.test(key)) return 'salir'
  if (/^p+$/.test(key)) return 'pausa'
  return null
}

export function createTtyRenderer({ stdout = process.stdout, stdin = process.stdin } = {}) {
  const tty = stdout.isTTY === true
  const canRaw = tty && typeof stdin?.setRawMode === 'function'

  let started = false
  let restored = false
  let paused = false

  // Frame anterior, para emitir solo las filas que cambiaron. null = repintado
  // completo en el proximo paint().
  let prevLines = null
  let prevCols = null
  let prevRows = null

  let resizeTimer = null
  let keyCallback = null
  let resizeCallback = null

  function write(text) {
    if (text) stdout.write(text)
  }

  function size() {
    return { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 }
  }

  function restore() {
    if (restored) return
    restored = true
    if (canRaw) {
      try {
        stdin.setRawMode(false)
      } catch {}
    }
    try {
      stdin?.pause?.()
    } catch {}
    if (tty) stdout.write(CURSOR_SHOW + ALT_OFF)
  }

  function onData(chunk) {
    const key = typeof chunk === 'string' ? chunk : String(chunk)
    const accion = accionDeTecla(key)

    // Ctrl+C primero y sin condiciones: si el comando no registro callback,
    // igual salimos con la terminal sana en vez de colgarnos.
    if (accion === 'interrumpir') {
      stop()
      if (keyCallback) keyCallback(KEY_CTRL_C)
      else process.exit(130)
      return
    }

    if (accion === 'salir') {
      stop()
      if (keyCallback) keyCallback('q')
      else process.exit(0)
      return
    }

    if (accion === 'pausa') {
      paused = !paused
    }

    if (keyCallback) keyCallback(accion === 'pausa' ? 'p' : key)
  }

  function fireResize() {
    resizeTimer = null
    // Los deltas del frame anterior ya no aplican con otro ancho.
    prevLines = null
    prevCols = null
    prevRows = null
    // Unico lugar donde el borrado total es correcto: lo que quedo en pantalla
    // fue medido para el ancho viejo.
    if (tty) write(ERASE_ALL + HOME)
    if (resizeCallback) resizeCallback(size())
  }

  function onResizeEvent() {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fireResize, RESIZE_DEBOUNCE_MS)
    resizeTimer?.unref?.()
  }

  function onExit() {
    restore()
  }

  function onSignal() {
    restore()
    process.exit(130)
  }

  function onFatal(err) {
    restore()
    console.error(err)
    process.exit(1)
  }

  const processHandlers = {
    exit: onExit,
    SIGINT: onSignal,
    SIGTERM: onSignal,
    uncaughtException: onFatal,
  }

  function start() {
    if (started) return
    started = true
    restored = false

    if (tty) write(ALT_ON + CURSOR_HIDE)

    if (canRaw) {
      try {
        stdin.setRawMode(true)
      } catch {}
    }
    if (typeof stdin?.on === 'function') {
      stdin.resume?.()
      stdin.setEncoding?.('utf8')
      stdin.on('data', onData)
    }
    if (typeof stdout.on === 'function') stdout.on('resize', onResizeEvent)

    for (const evt of PROCESS_EVENTS) process.on(evt, processHandlers[evt])
  }

  function stop() {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
    // removeListener y no removeAllListeners: el proceso puede tener otros
    // consumidores de stdin, y dejar el listener pegado impide que salga nunca.
    if (started) {
      stdin?.removeListener?.('data', onData)
      stdout.removeListener?.('resize', onResizeEvent)
      for (const evt of PROCESS_EVENTS) process.removeListener(evt, processHandlers[evt])
    }
    started = false
    prevLines = null
    prevCols = null
    prevRows = null
    restore()
  }

  function paintFull(lines) {
    let out = HOME
    for (let i = 0; i < lines.length; i++) {
      out += lines[i] + ERASE_LINE_END
      if (i < lines.length - 1) out += EOL
    }
    // Limpia el sobrante del frame anterior si este trae menos filas.
    return out + ERASE_BELOW
  }

  function paintDiff(lines) {
    let out = ''
    const max = Math.max(lines.length, prevLines.length)
    for (let i = 0; i < max; i++) {
      if (i >= lines.length) break
      if (lines[i] === prevLines[i]) continue
      out += `\x1b[${i + 1};1H` + lines[i] + ERASE_LINE_END
    }
    if (lines.length < prevLines.length) {
      out += `\x1b[${lines.length + 1};1H` + ERASE_BELOW
    }
    return out
  }

  function paint(lines) {
    const rows = Array.isArray(lines) ? lines : [String(lines)]

    if (!tty) {
      // Sin TTY no hay cursor que mover ni frame anterior que reusar.
      write(rows.join('\n') + '\n')
      return
    }

    const { cols, rows: termRows } = size()
    const sizeChanged = cols !== prevCols || termRows !== prevRows
    // Cae a repintado completo cuando cambio el tamano o no hay frame previo.
    const out = prevLines && !sizeChanged ? paintDiff(rows) : paintFull(rows)

    prevLines = rows.slice()
    prevCols = cols
    prevRows = termRows

    // Un unico write por frame: escribir linea por linea es la segunda causa
    // de tearing, despues del clear.
    write(out)
  }

  return {
    start,
    stop,
    paint,
    size,
    onKey(fn) {
      keyCallback = typeof fn === 'function' ? fn : null
    },
    onResize(fn) {
      resizeCallback = typeof fn === 'function' ? fn : null
    },
    isPaused() {
      return paused
    },
  }
}
