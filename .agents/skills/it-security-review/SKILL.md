---
name: it-security-review
version: 1.0.0
description: Ejecuta el /security-review nativo de Claude Code, remedia los hallazgos Critical/High y genera un PDF de evidencia para IT solo después de superar el gate final.
argument-hint: "[scope opcional: full | branch | diff | ruta-o-modulo]"
disable-model-invocation: true
effort: high
allowed-tools:
  - Skill(security-review)
  - Skill(soutec-md-a-pdf)
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - Bash(git status *)
  - Bash(git rev-parse *)
  - Bash(git branch *)
  - Bash(git diff *)
  - Bash(git log *)
---

# IT Security Review Workflow

Este workflow se inicia exclusivamente cuando un humano ejecuta:

```text
/it-security-review $ARGUMENTS
```

No reemplaces ni sobrescribas el comando nativo `/security-review`. Debes invocarlo mediante el `Skill` tool como parte de este proceso.

## Objetivo

Producir evidencia técnica compartible con IT de que:

1. se ejecutó el security review nativo de Claude Code;
2. todo hallazgo `Critical` o `High` fue corregido con un plan de remediación trazable;
3. se ejecutaron las pruebas aplicables;
4. se repitió el security review después de los cambios;
5. el reporte PDF solo fue generado después de superar el gate final.

El PDF no debe afirmar que la aplicación es “completamente segura” ni funcionar como certificación absoluta. Debe declarar con precisión que no se detectaron hallazgos `Critical` o `High` dentro del alcance y limitaciones de la revisión final.

## Alcance

Si `$ARGUMENTS` viene vacío, **antes de ejecutar nada** pregunta al humano qué alcance
usar, mostrando las opciones disponibles:

- `full` (repositorio completo);
- `branch` (rama actual frente a su upstream o base disponible);
- `diff` (cambios no confirmados y commits de la rama frente a su base);
- ruta, módulo o componente (foco limitado a ese elemento y sus dependencias de
  seguridad relevantes).

No asumas `full` en silencio. Si el humano no responde con un alcance concreto, o
confirma explícitamente que no tiene preferencia, entonces sí resuelve a `full`.

Si `$ARGUMENTS` no viene vacío, resuélvelo directo sin preguntar:

- `full`: repositorio completo;
- `branch`: rama actual frente a su upstream o base disponible;
- `diff`: cambios no confirmados y commits de la rama frente a su base;
- ruta, módulo o componente: foco principal limitado a ese elemento, incluyendo sus dependencias de seguridad relevantes.

Declara siempre exclusiones, supuestos y limitaciones.

## Directorio de evidencia

Crea un directorio nuevo por ejecución:

```text
artifacts/security/YYYY-MM-DD_HHMMSS/
```

No sobrescribas evidencia de ejecuciones anteriores.

Dentro del directorio conserva, como mínimo:

```text
00-run-metadata.md
01-initial-security-review.md
02-remediation-spec.md              # solo cuando aplique
03-remediation-summary.md           # solo cuando aplique
04-test-evidence.md
05-final-security-review.md
IT-Security-Review.md               # solo si el gate final pasa
IT-Security-Review.pdf              # solo si el gate final pasa
SECURITY-REVIEW-BLOCKED.md          # solo si el gate no pasa
```

`02-remediation-spec.md` es el plan de remediación de esta ejecución. Si el repositorio ya define otra convención para documentar planes, el archivo debe contener un enlace o referencia inequívoca a la ruta oficial.

## Fase 1 — Registrar metadata

Antes de revisar, registra sin modificar el repositorio:

- fecha y hora local y UTC;
- nombre del proyecto o repositorio;
- alcance resuelto;
- rama actual;
- commit HEAD;
- rama base o upstream cuando pueda determinarse;
- estado del working tree;
- archivos modificados relevantes;
- versión de Claude Code cuando esté disponible sin instalar nada;
- limitaciones conocidas del ambiente.

Nunca copies valores de secretos, tokens, contraseñas, llaves privadas ni connection strings. Redáctalos.

## Fase 2 — Security review inicial nativo

Invoca el skill nativo `security-review` mediante el Skill tool.

Pásale el alcance resuelto y solicita que:

- inspeccione vulnerabilidades y controles de seguridad;
- incluya severidad, evidencia, ubicación e impacto;
- separe hallazgos confirmados de dudas o gaps de cobertura;
- no aplique cambios durante esta primera revisión;
- entregue una salida suficientemente detallada para remediación y auditoría.

Guarda la salida completa, sin reinterpretarla, en:

```text
01-initial-security-review.md
```

Después crea una tabla normalizada de hallazgos con:

- ID;
- severidad;
- título;
- archivo o componente;
- estado inicial;
- evidencia;
- acción requerida.

Si la severidad de un hallazgo potencial no está clara, no lo rebajes por conveniencia. Trátalo como `Needs validation` y resuélvelo antes de declarar el gate como aprobado.

## Gate de remediación

### Bloqueantes

La existencia de cualquiera de los siguientes impide generar el PDF final:

- al menos un hallazgo `Critical` abierto;
- al menos un hallazgo `High` abierto;
- pruebas obligatorias fallidas;
- review final incompleto o no verificable;
- gap de cobertura que impida evaluar razonablemente un control crítico;
- secretos de producción expuestos que aún no hayan sido revocados o rotados;
- cambios de seguridad sin prueba de regresión o validación equivalente.

### No bloqueantes para crear el PDF, pero obligatorios en el reporte

- hallazgos `Medium` abiertos;
- hallazgos `Low`;
- observaciones `Informational`;
- riesgos aceptados explícitamente;
- limitaciones de cobertura que no impidan evaluar los controles críticos.

Un `Medium` abierto produce el estado `READY WITH CONDITIONS`, nunca una declaración limpia de aprobación.

## Fase 3 — Remediación de Critical/High

Si no existen hallazgos `Critical` o `High`, omite esta fase y continúa con pruebas y review final.

Si existen, remedia tú mismo, con este contrato:

1. Escribe primero un plan de remediación en `02-remediation-spec.md` que cubra cada hallazgo `Critical` y `High`: requisito verificable, cambio propuesto, prueba que lo valida y riesgo residual.
2. Implementa las correcciones; no te limites a redactar el plan.
3. Añade pruebas de regresión y controles negativos.
4. Ejecuta las pruebas aplicables y registra comandos y resultados.
5. No ocultes, suprimas ni rebajes hallazgos para superar el gate.
6. No edites el reporte original del security review.
7. Registra en `03-remediation-summary.md` archivos modificados, pruebas ejecutadas, resultados y riesgos residuales.

Para secretos expuestos, eliminar el valor del código no basta: hay que tratar revocación o rotación, limpieza segura, configuración correcta y prevención de recurrencia. Si la rotación requiere una acción humana o de IT no disponible, el gate permanece bloqueado.

## Fase 4 — Pruebas

Ejecuta las pruebas apropiadas para el stack y el alcance, siguiendo primero las instrucciones del repositorio.

Incluye cuando apliquen:

- pruebas unitarias;
- integración;
- autorización por rol o tenant;
- validación de entradas;
- regresiones específicas de los hallazgos;
- lint y type checking;
- build de producción;
- pruebas de infraestructura o configuración;
- escaneo de dependencias ya disponible en el proyecto.

No instales herramientas nuevas solo para decorar el reporte. Si una herramienta necesaria no está disponible, registra la limitación y determina si bloquea el gate.

Guarda en `04-test-evidence.md`:

- comando exacto;
- fecha;
- resultado;
- resumen de errores;
- archivos de log relevantes;
- qué hallazgo valida cada prueba de seguridad.

Cualquier prueba obligatoria fallida bloquea el PDF.

## Fase 5 — Security review final nativo

Después de la remediación y las pruebas, invoca nuevamente el skill nativo `security-review` con el mismo alcance.

Solicita explícitamente que:

- revise el estado actual del código, no el reporte anterior;
- verifique las rutas afectadas por los hallazgos iniciales;
- busque regresiones o vulnerabilidades introducidas por las correcciones;
- reporte severidad, evidencia y cobertura;
- no confunda una prueba existente con evidencia suficiente si el control sigue siendo evadible.

Guarda la salida completa en:

```text
05-final-security-review.md
```

## Ciclo de remediación

Si el review final mantiene o introduce hallazgos `Critical` o `High`:

1. no generes el PDF;
2. actualiza el plan de remediación e implementa la siguiente iteración;
3. vuelve a ejecutar pruebas;
4. vuelve a ejecutar el security review nativo.

Máximo: tres ciclos de remediación en una misma ejecución.

Si después de tres ciclos persisten bloqueantes, crea únicamente:

```text
SECURITY-REVIEW-BLOCKED.md
```

Debe incluir:

- estado `NOT READY FOR IT REVIEW`;
- bloqueantes pendientes;
- intentos realizados;
- pruebas fallidas o cobertura insuficiente;
- acción humana requerida;
- rutas de la evidencia generada.

No generes un PDF “preliminar”, “draft” o “con observaciones” mientras exista un `Critical` o `High`. Cambiarle el apellido al PDF no vuelve segura la aplicación.

## Fase 6 — Gate final

El gate pasa únicamente cuando:

- el review final no contiene `Critical` ni `High` abiertos;
- las pruebas obligatorias pasan;
- no existe un gap que impida verificar un control crítico;
- cualquier secreto expuesto fue revocado o rotado, no solo removido del código;
- existe trazabilidad entre hallazgos, cambios y pruebas.

Estado final:

- `READY FOR IT REVIEW`: cero `Critical`, `High` y `Medium` abiertos;
- `READY WITH CONDITIONS`: cero `Critical` y `High`, pero existen `Medium`, riesgos aceptados o limitaciones no críticas;
- `NOT READY FOR IT REVIEW`: cualquier condición bloqueante.

La aprobación final de producción sigue perteneciendo a IT.

## Fase 7 — Generar evidencia y PDF

Solo después de pasar el gate, compila la evidencia tú mismo: usa como fuentes la
metadata, el review inicial, el plan y resumen de remediación cuando existan, los
resultados de pruebas, el review final y el estado final calculado. La estructura del
informe es la de `report-template.md` (y el estándar `security-report-standard`, si
está instalado).

Escribe `IT-Security-Review.md` con el formato de autoría de la skill
`soutec-md-a-pdf` y genera el PDF invocando esa misma skill (motor `md_to_pdf.py`,
ReportLab). No uses un renderer embebido.

Debes generar:

```text
IT-Security-Review.md
IT-Security-Review.pdf
```

Verifica después:

- ambos archivos existen;
- el PDF comienza con la firma `%PDF-`;
- el PDF tiene tamaño mayor que cero;
- el reporte no contiene secretos sin redactar;
- el estado del PDF coincide con el gate;
- los hallazgos iniciales corregidos aparecen como remediados, no eliminados del historial;
- cualquier `Medium` pendiente aparece claramente en condiciones o riesgo residual.

## Respuesta final al humano

Si el gate pasa, devuelve:

```markdown
# IT Security Review Completed

- Status: READY FOR IT REVIEW | READY WITH CONDITIONS
- Scope: <alcance>
- Initial findings: <conteos>
- Remediated Critical/High: <conteos>
- Remaining Medium/Low: <conteos>
- Tests: PASSED
- Markdown report: <ruta>
- PDF report: <ruta>
- IT approval: PENDING
```

Si el gate no pasa, devuelve:

```markdown
# IT Security Review Blocked

- Status: NOT READY FOR IT REVIEW
- Scope: <alcance>
- Blocking findings: <conteos y IDs>
- Tests: PASSED | FAILED | INCOMPLETE
- Blocked report: <ruta>
- PDF report: NOT GENERATED
- Required action: <acción concreta>
```

Nunca presentes el resultado como certificación, pentest formal o garantía absoluta de seguridad.
