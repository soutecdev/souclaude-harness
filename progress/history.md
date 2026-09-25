# Historial del proyecto — append-only

Una línea por task o sesión cerrada, **siempre al final**. No edites líneas existentes.
Al resolver un conflicto de merge: conserva ambas líneas y ordena por fecha.

Formato: `- <fecha> · <ID> · <agente o persona> · <resultado> · <referencia>`

<!-- Ejemplo:
- 2026-07-27 · TNP-H1-T003 · implementer · done · progress/TNP-H1-tienda/impl_summary.md
- 2026-07-27 · TNP-H1-T003 · reviewer · APPROVED · progress/TNP-H1-tienda/review.md
-->
- 2026-08-10 · SHS-H3 · orchestrator · vault_skip · sin vault.local.json ni VAULT_PATH en esta maquina
- 2026-08-10 · SHS-H3-extra-historico · spec-author · spec_ready · specs/SHS-H3-extra-historico/spec.md
- 2026-08-10 · SHS-H3-extra-historico · spec-author · plan_ready · specs/SHS-H3-extra-historico/plan.md
- 2026-08-10 · SHS-H3-extra-historico · spec-author · tasks_ready · specs/SHS-H3-extra-historico/tasks.md
- 2026-08-10 · SHS-H3-extra-historico · reviewer · CHANGES_REQUESTED · progress/SHS-H3-extra-historico/review.md
- 2026-08-10 · SHS-H3-extra-historico · reviewer · vault_skip · sin .claude/vault.local.json en esta maquina
- 2026-08-10 · SHS-H3-T101 · implementer · done · commit 29b0c65
- 2026-08-10 · SHS-H3-T102 · implementer · done · commit 1f51e7d
- 2026-08-10 · SHS-H3-T103 · implementer · done · commit 5cc0a12
- 2026-08-10 · SHS-H3-T104 · implementer · done · commits fa6f36a, a31b9d1
- 2026-08-10 · SHS-H3-T105 · implementer · done · commits 6566af2, e2afccf
- 2026-08-10 · SHS-H3-T106 · implementer · done · commits 7477633, aac0282
- 2026-08-10 · SHS-H3-T107 · implementer · done · commit 22d8884
- 2026-08-10 · SHS-H3-extra-historico · implementer · rework_done · progress/SHS-H3-extra-historico/impl_summary.md (4 hallazgos bloqueantes de review.md corregidos en 3f8ef3b, 40652ee, d96fc32, 40074bd; npm test 325/325; sin segunda ronda de review registrada en disco)
- 2026-08-10 · SHS-H3-extra-historico · spec-author · vault_skip · sin .claude/vault.local.json ni VAULT_PATH en esta maquina
- 2026-08-11 · SHS-H3-extra-historico · reviewer · APPROVED · progress/SHS-H3-extra-historico/review.md (segundo dictamen: 4 hallazgos corregidos, npm test 325/325)
- 2026-08-11 · SHS-H3-extra-historico · reviewer · vault_skip · sin .claude/vault.local.json en esta maquina
- 2026-08-11 · vault-sync · implementer · impl_done · comando vault-sync + helper seguro (391/391 tests)
- 2026-08-11 · vault-sync · reviewer · changes_requested · docs-only (B1 spec vs plan, B2 tasks sin marcar) -> corregido
- 2026-08-11 · vault-sync · reviewer · APPROVED · progress/vault-sync/review.md (ronda 2, docs-only corregido)
- 2026-08-17 · vault-milestones-y-sesiones · claude · done · rama feature/vault-milestones-y-sesiones (PR a dev pendiente de abrir)
- 2026-09-22 · SHS-M38-T001/T002/T003 · claude · done · rama docs/M38-observatorio-proxima-version (commits b795281, 4cb15dc), PR a dev pendiente de abrir
