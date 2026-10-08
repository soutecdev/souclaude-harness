# docs/metodologia — la carpeta publicable de la metodología

Esta carpeta es **la documentación del harness para compartir**: lo que una persona
ajena al repo necesita para entender la metodología SOUTEC, verla de un vistazo e
instalar el harness. Son tres artefactos:

| Artefacto | Qué es |
|---|---|
| [01-guia-metodologia.md](01-guia-metodologia.md) | La guía: qué instala el harness y cómo se trabaja con él |
| [02-infografia-metodologia.html](02-infografia-metodologia.html) | La infografía master: la metodología en una página, imprimible A4 |
| [03-prompt-instalacion.md](03-prompt-instalacion.md) | El prompt listo para pegar en Claude Code e instalar el harness |

<!-- souclaude:gen version -->
Documenta el **harness souclaude v3.18.0**. El sello lo regenera `node scripts/gen-docs-metodologia.mjs` y siempre coincide con la versión de `package.json`.
<!-- /souclaude:gen version -->

## Cómo se mantiene fresca

Las secciones entre marcadores `souclaude:gen` se **regeneran** desde las fuentes de
verdad (`package.json` y `templates/harness.manifest.json`):

```bash
node scripts/gen-docs-metodologia.mjs          # regenera
node scripts/gen-docs-metodologia.mjs --check  # verifica sin escribir
```

Nadie tiene que acordarse: `souclaude verify`, la suite de tests y el hook
`reglas-pr` (antes de cada `git push`) **fallan si la carpeta quedó desactualizada**
respecto de lo que el instalador realmente hace. La prosa fuera de los marcadores se
revisa en cada release `dev` → `main`.

## Cómo se difunde

A mano, cuando haga falta: copia la carpeta tal cual (los tres archivos son
autocontenidos) o exporta los `.md` a PDF/Word con la skill `soutec-md-a-pdf`.
La subida automática a SharePoint quedó descartada a propósito (SHS-M16-P2);
si algún día se retoma, es SHS-M8.
