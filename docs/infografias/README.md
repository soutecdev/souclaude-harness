# Infografías de la metodología SOUTEC

Set de infografías con la identidad Soutec (SHS-M7-T008): una **master** que explica
la metodología y su arquitectura, y **una por casuística de adopción** del playbook
(`docs/bootstrap-proyecto-plantillas-prompts.md`).

Cada archivo es HTML autocontenido (CSS inline, sin dependencias externas): se abre
directo en el navegador y se imprime/exporta a PDF desde ahí (tienen estilos de
impresión A4).

> **¿Regenerarlas desde cero?** [BRIEF-INFOGRAFIAS.md](BRIEF-INFOGRAFIAS.md) tiene el
> contenido completo de las siete y la identidad visual, listo para pegar en claude.ai.
> **Incluye cuatro correcciones** que los HTML de esta carpeta todavía no tienen.

| Infografía | Cuándo usarla |
|---|---|
| [00-metodologia-master.html](00-metodologia-master.html) | Presentar la metodología completa: las tres piezas, el Vault de tres niveles, la trazabilidad por milestone y el ciclo diario |
| [01-proyecto-nuevo.html](01-proyecto-nuevo.html) | Bootstrap de un proyecto desde cero (fases 0–6) |
| [02-repo-existente.html](02-repo-existente.html) | Un repo ya existente adopta el harness (rutas A/B: `init` vs `adopt`) |
| [03-integrante-nuevo.html](03-integrante-nuevo.html) | Se suma una persona a un proyecto ya adoptado |
| [04-maquina-nueva.html](04-maquina-nueva.html) | Dejar lista una máquina nueva (integrante nuevo o existente) |
| [05-actualizar-harness.html](05-actualizar-harness.html) | Actualizar el harness en un proyecto ya adoptado |
| [06-sin-jira.html](06-sin-jira.html) | Proyecto sin Jira o conector sin autorizar: degradación y catch-up |

Fuente de la letra chica: el playbook de bootstrap, `docs/onboarding-desarrollador.md`
y `progress/README.md`. Si esos documentos cambian, estas infografías se actualizan
con ellos.
