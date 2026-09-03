---
name: vault-milestones
description: Analiza el tablero de milestones del proyecto en el Vault (Project-<PREFIJO>/milestones.md) y guía su iteración - incluir milestones nuevos, dividir o re-secuenciar los existentes y cerrar los cumplidos. Actívate cuando el usuario pida analizar, revisar o auditar los milestones del proyecto, proponer o agregar un milestone nuevo, replantear el roadmap del Vault o preguntar "en qué milestone estamos / qué sigue".
---

# vault-milestones — análisis e iteración de milestones

Los milestones viven en el **Vault** (repo aparte, push directo a `main`), en
`Project-<PREFIJO>/milestones.md`. El protocolo completo está en
`progress/README.md` del repo del proyecto — esta skill no lo reemplaza: lo aplica
al trabajo específico de **pensar el tablero**, no solo moverlo.

**Trazabilidad obligatoria**: todo trabajo pertenece a un milestone. Al empezar
cualquier tarea, declara al usuario sobre qué milestone vas a trabajar; si el pedido
no corresponde a ninguno existente, da de alta el milestone en el Backlog (§3)
**antes** de empezar — y como toda alta, con el visto bueno del usuario sobre el
alcance de la tarjeta.

## 0. Sincronizar antes de opinar

1. Lee la ruta del Vault de `.claude/vault.local.json` (respaldo: `VAULT_PATH`).
   Si no hay ruta o no existe: dilo y trabaja en modo solo-análisis con lo que el
   usuario pegue — **nunca bloquees por el Vault**.
2. `git -C "<vault>" pull --rebase` (o `npx souclaude vault-sync`). Un análisis
   sobre un tablero desactualizado es peor que ninguno.
3. Lee `Project-<PREFIJO>/milestones.md`, `kanban.md`, `plans/` y `sessions.md`.
   El milestone dice el claim; el kanban y las sesiones dicen la verdad.

## 0-bis. Pedido "milestones pendientes" — reconciliar y responder corto

Cuando el usuario pida los **milestones pendientes** (o "qué falta", "qué sigue",
"qué hay abierto"), el flujo por defecto es:

1. **Reconciliar primero**: revisa cuáles ya están cerrados —tareas con PR
   mergeado o entregable a la vista— y muévelos a **Hecho** en `kanban.md` y
   `milestones.md`, con push al Vault en el momento (§4) y espejo en Jira. Cerrar
   lo terminado es parte del pedido, no un paso opcional. Respeta la regla dura:
   una tarjeta En curso de **otro dueño u otra máquina** no se cierra sin
   preguntar.
2. **Responder corto**: devuelve solo **Backlog (sin iniciar)** y **En curso**,
   una línea por milestone (`<ID>: descripción breve`). Nada de Hecho, tablas ni
   diagnóstico salvo que el usuario lo pida. Formato:

   ```
   Backlog (sin iniciar):
   <ID>: descripción

   En curso:
   <ID>: descripción
   ```

El análisis completo de §1 queda para cuando el usuario pida "analizar",
"auditar" o "revisar a fondo" el tablero.

## 1. Análisis — qué mirar

Reporta el estado en tres capas, de la foto al diagnóstico:

- **Foto**: qué hay en Backlog / En curso / Hecho, quién tiene qué y en qué
  máquina, y qué plan está activo por milestone En curso.
- **Consistencia** (el tablero miente cuando alguna de estas falla):
  - Milestone **En curso sin plan** anotado, o cuyo plan no existe en `plans/`.
  - Tarjetas malformadas: sin ID `<PREFIJO>-M<n>`, IDs duplicados, tarjeta de
    varias líneas (rompe el contrato una tarjeta = una línea).
  - **Deriva**: tareas del kanban o líneas de `sessions.md` que apuntan a un
    milestone que sigue en Backlog o ya está en Hecho.
  - Más de un milestone En curso con el **mismo dueño y máquina** (la unidad de
    anti-solapamiento pierde sentido).
- **Diagnóstico**: milestones estancados (En curso sin sesiones recientes en
  `sessions.md`), milestones demasiado grandes (acumulan planes fracasados
  P1, P2… o decenas de tareas), Backlog desordenado (sin secuencia clara de
  dependencias), y qué convendría hacer al respecto.

El análisis se **reporta, no se ejecuta**: no muevas tarjetas ni reescribas el
tablero como parte de analizar. Propón; el usuario decide.

## 2. Iterar milestones existentes

Cuando el usuario acepte cambios (o los pida directamente):

- **Dividir** un milestone grande: el original conserva su ID y se recorta el
  alcance en la tarjeta; lo que sale se convierte en milestones nuevos al final
  de la numeración (ver §3). No renumeres los existentes: los IDs ya están
  referenciados en planes, kanban y sesiones.
- **Re-secuenciar** el Backlog: reordenar líneas dentro de la columna es libre —
  el orden del Backlog es la propuesta de secuencia.
- **Cerrar**: un milestone pasa a Hecho solo si sus tareas en `kanban.md` están
  cerradas y el resultado está a la vista (PR mergeado, entregable publicado).
  Marca `[x]` y deja la tarjeta con su dueño final.
- **Cambio de plan** (P1 fracasó → P2): el plan viejo **no se borra** de
  `plans/`; se espeja el nuevo y la tarjeta del milestone pasa a apuntar a él.
- **Regla dura**: una tarjeta En curso con **otro dueño u otra máquina** no se
  toca, ni siquiera para "ordenar". Si el cambio la involucra: para y pregunta.

## 3. Incluir milestones nuevos

- **ID**: `<PREFIJO>-M<n>` con el `n` siguiente al **máximo existente en todo el
  tablero** (incluido Hecho). Los IDs nunca se reciclan ni se renumeran.
- **Tarjeta**: una línea en **Backlog**, `- [ ] <PREFIJO>-M<n> · <objetivo> ·
  @pendiente`. Sin máquina ni plan: eso se anota recién al tomarlo.
- **Alcance**: un milestone es un **resultado verificable** ("portal de clientes
  en producción"), no una actividad ("trabajar en el portal"). Si no se puede
  decir cuándo está terminado, todavía no es un milestone — es una idea; afínala
  con el usuario antes de escribirla.
- **Tamaño**: si al describirlo aparecen varios resultados independientes, son
  varios milestones. Mejor tres chicos verificables que uno épico eterno.
- Insértalo en el Backlog **en la posición que le toca por dependencias**, no
  automáticamente al final.

## 4. Escribir y pushear — en el momento

Todo cambio aceptado al tablero se commitea y pushea **al momento**, no en un
push final de sesión:

```bash
git -C "<vault>" add Project-<PREFIJO>
git -C "<vault>" commit -m "chore: alta de <PREFIJO>-M<n> en Backlog"
git -C "<vault>" pull --rebase && git -C "<vault>" push
```

(`npx souclaude vault-sync --push -m "<msg>"` hace el ciclo completo.)

- Commits del Vault: `chore:` para movimientos de tablero, `docs:` para planes.
- **Nunca `git push --force`.**
- En conflictos: una tarjeta = una línea; conserva **ambas** líneas y nunca
  borres la de otro.
- Si el `pull --rebase` falla dos veces: no insistas — anota
  `vault_skip · motivo` en `history.md` del repo y repórtalo.

## 5. La ficha del Observatorio en los releases

En el Vault también vive `Project-<PREFIJO>/OBSERVATORIO.md`, la ficha pública
del proyecto. **El hito del release se agrega siempre a su sección "Hitos" al
abrir el PR de release `dev` → `main`** (formato
`- YYYY-MM-DD · vX.Y.Z · resumen breve`), con push directo al Vault en el
momento, y se verifica/corrige al confirmarse el merge y el tag. La regla completa está en la skill `soutec-github` (sección "Ficha del
Observatorio") — si estás cerrando un milestone que termina en release, verifica
que el hito haya quedado registrado.
