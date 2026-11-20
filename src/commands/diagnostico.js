import * as ui from '../ui.js'
import { loadManifest } from '../core/manifest.js'
import { diagnosticar } from '../core/diagnostico.js'

const TITULO = {
  'proyecto-desde-cero': 'Proyecto desde cero: carpeta vacia, sin repo',
  'carpeta-sin-git': 'Carpeta con archivos pero sin repo git',
  'repo-sin-remoto': 'Repo local sin remoto en GitHub',
  'repo-vacio': 'Repo nuevo, sin codigo todavia',
  'repo-con-codigo': 'Repo existente con codigo, sin harness',
  'estructura-previa': 'Repo con estructura Claude hecha a mano',
  'maquina-nueva': 'Repo con harness, falta conectar esta maquina al Vault',
  'harness-desactualizado': 'Repo con una version anterior del harness',
  'harness-al-dia': 'Repo con el harness al dia',
}

// Solo lectura: no escribe ni un byte, ni en el repo ni en el Vault. Exit 0 si
// se puede instalar, 1 si hay bloqueos que resolver antes.
export async function diagnostico(flags, cwd, { diagnosticar: correr = diagnosticar } = {}) {
  const d = correr(cwd, { manifest: loadManifest() })
  const code = d.bloqueos.length ? 1 : 0

  if (flags.json) {
    console.log(JSON.stringify(d, null, 2))
    return code
  }

  ui.intro('souclaude diagnostico')
  ui.log.info(`Caso: ${d.caso} — ${TITULO[d.caso]}`)
  ui.log.info(
    [
      `Maquina: Node ${d.maquina.node.version} · git ${d.maquina.git.version ?? 'NO'} · gh ${
        d.maquina.gh.instalado ? (d.maquina.gh.autenticado ? 'autenticado' : 'sin autenticar') : 'NO'
      }`,
      d.repo.esRepo
        ? `Repo: rama ${d.repo.rama ?? '(sin rama)'} · remoto ${d.repo.remoto ?? 'ninguno'}`
        : 'Repo: esta carpeta no es un repo git',
      d.harness.instalado
        ? `Harness: v${d.harness.version} instalado (modo ${d.harness.modo ?? 'sin definir'}) · disponible v${d.harness.disponible}`
        : `Harness: no instalado · disponible v${d.harness.disponible}`,
      d.vault.ruta
        ? `Vault: ${d.vault.ruta}${d.vault.configurado ? '' : ' (sin conectar)'} · proyecto ${d.vault.proyecto ?? 'sin declarar'}`
        : 'Vault: no esta en esta maquina',
    ].join('\n')
  )

  for (const b of d.bloqueos) ui.log.error(`BLOQUEO ${b.id}: ${b.mensaje}\n  -> ${b.solucion}`)
  for (const a of d.avisos) ui.log.warn(`${a.id}: ${a.mensaje}\n  -> ${a.solucion}`)
  if (d.pendientes.length) {
    ui.log.step(['Pendiente (el instalador no lo hace solo):', ...d.pendientes.map((p) => `  · ${p.mensaje}`)].join('\n'))
  }

  if (code) ui.outro('Resuelve los bloqueos antes de instalar.')
  else ui.outro(d.comando ? `Comando que corresponde: ${d.invocacion} ${d.comando}` : 'Nada que instalar: el harness esta al dia.')
  return code
}
