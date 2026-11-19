import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TEMPLATES_DIR = fileURLToPath(new URL('../../templates/', import.meta.url))

export function loadManifest() {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, 'harness.manifest.json'), 'utf8')
  return conSkillsParaAgentes(JSON.parse(raw))
}

// Carpetas de skills (SHS-M48). Claude Code lee `.claude/skills/`; Codex y
// Antigravity leen `.agents/skills/`, la carpeta del estandar Agent Skills.
// El harness instala siempre para las tres herramientas, sin preguntar cual
// se usa: un mismo repo puede trabajarse con mas de una.
export const SKILLS_CLAUDE = '.claude/skills/'
export const SKILLS_AGENTES = '.agents/skills/'
const SUFIJO_AGENTES = '--agents'

// Cada entry de skill del manifest se declara UNA vez, con su dest bajo
// `.claude/skills/`; aca se deriva su gemelo bajo `.agents/skills/` (mismo
// src, misma policy, misma skill, mismos modos). Se deriva al cargar, y no
// escribiendo cada entry dos veces en el JSON, para que agregar una skill siga
// siendo un solo alta y las dos carpetas no puedan quedar desparejas. Los
// merge-json de una skill (ej. `.mcp.json`) no viven bajo `.claude/skills/` y
// no se duplican.
export function conSkillsParaAgentes(manifest) {
  const gemelos = []
  for (const entry of manifest.files ?? []) {
    if (!entry.skill || !entry.dest.startsWith(SKILLS_CLAUDE)) continue
    gemelos.push({
      ...entry,
      id: `${entry.id}${SUFIJO_AGENTES}`,
      dest: `${SKILLS_AGENTES}${entry.dest.slice(SKILLS_CLAUDE.length)}`,
    })
  }
  return { ...manifest, files: [...(manifest.files ?? []), ...gemelos] }
}

// `src` en el manifest siempre es una ruta POSIX relativa a templates/.
export function readTemplate(src) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, ...src.split('/')), 'utf8')
}

// Para entries con binary:true (assets de skills): Buffer, sin decodificar.
export function readTemplateBytes(src) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, ...src.split('/')))
}

// Los dotfiles se guardan en templates/ SIN el punto inicial (gitignore, no
// .gitignore). Dos razones: npm elimina los .gitignore de los tarballs
// publicados, y un .gitignore vivo dentro de templates/ aplicaria sus reglas
// al propio repo del generador. El nombre real vive en `dest`.
export function readFragments(dir, stacks) {
  const abs = path.join(TEMPLATES_DIR, ...dir.split('/'))
  const parts = []
  const wanted = ['base', ...stacks]
  for (const name of wanted) {
    const file = path.join(abs, `${name}.txt`)
    if (fs.existsSync(file)) {
      parts.push(fs.readFileSync(file, 'utf8').trim())
    }
  }
  return parts
    .filter(Boolean)
    .join('\n\n')
    .split('\n')
}
