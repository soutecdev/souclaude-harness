# Origen de esta skill

`cloudflare-security-audit` es una copia de la skill `security-audit` de Cloudflare,
distribuida por el harness de SOUTEC como skill opcional.

| | |
|---|---|
| Repositorio de origen | https://github.com/cloudflare/security-audit-skill |
| Ruta de origen | `skills/security-audit/` |
| Commit copiado | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14) |
| Licencia | MIT — Copyright (c) 2025-2026 Cloudflare, Inc. (ver `LICENSE`) |

SOUTEC no es autora de esta skill ni está afiliada a Cloudflare.

## Diferencias respecto al origen

Los archivos son los del origen, sin cambios, con estas excepciones:

- **Encabezado de `SKILL.md`**: el nombre pasa de `security-audit` a
  `cloudflare-security-audit` (para que el origen quede a la vista), la descripción
  está en español y se agrega `disable-model-invocation: true`. Con eso la skill
  **solo corre cuando el usuario la invoca** con `/cloudflare-security-audit`: no se
  activa sola ante un pedido genérico de seguridad ni compite con
  `it-security-review` o con el `/security-review` nativo de Claude Code. El cuerpo
  de `SKILL.md` no se tocó.
- **No se distribuyen** `validate-findings.test.cjs` ni
  `validate-coverage-ledger.test.cjs`: son los tests de los validadores y no hacen
  falta para usar la skill.
- **Se agregan** `LICENSE` (el aviso MIT del origen) y este archivo.

## Limitaciones conocidas

- **La auditoría completa no cierra en Windows nativo.** Los dos validadores
  (`validate-findings.cjs` y `validate-coverage-ledger.cjs`) exigen `O_NOFOLLOW` y
  `O_NONBLOCK`, que Node no expone en Windows, y terminan con «OS no-follow and
  nonblocking input protection is unavailable» ante cualquier archivo. Es un
  comportamiento del origen (falla cerrado, a propósito) y no se parchea aquí. La
  auditoría completa necesita Linux, macOS o WSL; el modo guía (preguntas y
  revisiones puntuales) no usa los validadores y funciona igual en Windows. **No
  se rodea el validador**: si no puede correr, se dice.
- **La auditoría completa escribe fuera del repo**, por defecto en
  `~/security-audit-skill/<repo>/run-<N>`. Ahí quedan los hallazgos, sin control
  de versiones: es decisión del origen para que no se commiteen por accidente.
- **Ejecutar código del repo auditado exige un sandbox del sistema operativo.**
  Sin él, la skill no ejecuta nada y deja el hallazgo como `needs_validation`.

## Cómo actualizarla

Se actualiza en el generador (`souclaude-harness`), no en cada repo: se vuelven a
copiar los archivos de `skills/security-audit/` del origen, se reaplica el
encabezado de `SKILL.md` y se anota aquí el commit nuevo. Los repos la reciben con
`npx github:soutecdev/souclaude-harness#v3 upgrade`.
