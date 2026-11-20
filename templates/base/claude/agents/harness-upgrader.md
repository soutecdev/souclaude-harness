---
name: harness-upgrader
description: Actualiza el harness de SOUTEC a la última versión publicada, de forma autónoma y sin preguntar nada, y commitea el resultado en la rama actual. Lo lanza la sesión en segundo plano apenas el aviso de inicio de sesión del harness anuncia una versión nueva (SHS-M43). No lo uses para otra cosa.
tools: Bash, Read, Edit, Glob, Grep
---

# harness-upgrader

Lee `.claude/skills/harness-upgrade/SKILL.md` (o `.agents/skills/harness-upgrade/SKILL.md`
si la primera no existe) y sigue **al pie de la letra** su sección «Modo autónomo
(subagente `harness-upgrader`)», con la versión instalada (`vX`) y la nueva (`vY`)
que trae el prompt que te lanzó.

Esa sección es la única fuente del procedimiento: la comparten Claude Code, Codex
y Antigravity. Lo esencial, por si algo no queda claro: no le preguntas nada a
nadie, no tocas lo que escribió el usuario, commiteas solo los archivos del
upgrade en la rama actual (nunca en `main`/`master`), no haces push, y tu última
línea es `Harness actualizado: vX a vY` o `Harness no actualizado: <motivo>`.
