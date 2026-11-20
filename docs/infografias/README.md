# Infografías de la metodología SOUTEC

Set de infografías con la identidad Soutec (SHS-M7-T008): una **master** que explica
la metodología y su arquitectura — desde SHS-M16-P2 vive en
[docs/metodologia](../metodologia/02-infografia-metodologia.html), con sello de
versión generado — y **una por casuística de adopción** del playbook
(`docs/bootstrap-proyecto-plantillas-prompts.md`).

Cada archivo es HTML autocontenido (CSS inline, sin dependencias externas): se abre
directo en el navegador y se imprime/exporta a PDF desde ahí (tienen estilos de
impresión A4).

| Infografía | Cuándo usarla |
|---|---|
| [02-infografia-metodologia.html](../metodologia/02-infografia-metodologia.html) (en `docs/metodologia/`) | Presentar la metodología completa: las tres piezas, el Vault de tres niveles, la trazabilidad por milestone y el ciclo diario |
| [01-proyecto-nuevo.html](01-proyecto-nuevo.html) | Bootstrap de un proyecto desde cero (fases 0–6) |
| [02-repo-existente.html](02-repo-existente.html) | Un repo ya existente adopta el harness (rutas A/B: `init` vs `adopt`) |
| [03-integrante-nuevo.html](03-integrante-nuevo.html) | Se suma una persona a un proyecto ya adoptado |
| [04-maquina-nueva.html](04-maquina-nueva.html) | Dejar lista una máquina nueva (integrante nuevo o existente) |
| [05-actualizar-harness.html](05-actualizar-harness.html) | Actualizar el harness en un proyecto ya adoptado |
| [06-sin-jira.html](06-sin-jira.html) | Proyecto sin Jira o conector sin autorizar: degradación y catch-up |
| [07-harness-multiherramienta.html](07-harness-multiherramienta.html) | El harness en Claude Code, Codex y Antigravity (SHS-M48), lámina 1 de 2: qué lee cada herramienta, qué pasa al actualizar y qué protegen los hooks |
| [08-harness-multiherramienta-prueba.html](08-harness-multiherramienta-prueba.html) | Lámina 2 de 2: cómo probar el harness en Codex y Antigravity y cómo reportar el resultado |

Fuente de la letra chica: el playbook de bootstrap, `docs/onboarding-desarrollador.md`
y `progress/README.md`. Si esos documentos cambian, estas infografías se actualizan
con ellos.

Las láminas 07 y 08 siguen el formato de la skill `soutec-infografias` (lámina vertical de
700 px, fichas con pestaña y arco, tipografías y logotipo de marca incrustados): se
comparten como PNG en el chat del equipo.
