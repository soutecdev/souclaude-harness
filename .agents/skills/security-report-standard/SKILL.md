---
name: security-report-standard
description: Estándar interno para convertir un security review, remediaciones SDD y evidencia de pruebas en un informe técnico de seguridad para revisión de IT.
user-invocable: false
---

# Security Report Standard

## Propósito

Crear un informe auditable, legible y compartible con IT sin exagerar el nivel de assurance alcanzado.

## Regla de lenguaje

Nunca uses afirmaciones absolutas como:

- “la aplicación es segura”;
- “no tiene vulnerabilidades”;
- “está certificada”;
- “garantiza seguridad”.

Usa formulaciones verificables:

> En la revisión final no se identificaron hallazgos Critical o High dentro del alcance y las limitaciones declaradas.

> El proyecto está listo para ser evaluado por IT, que conserva la decisión final de aprobación para producción.

## Estados permitidos

### READY FOR IT REVIEW

Requiere:

- cero Critical abiertos;
- cero High abiertos;
- cero Medium abiertos;
- pruebas obligatorias aprobadas;
- cobertura suficiente de controles críticos.

### READY WITH CONDITIONS

Requiere:

- cero Critical abiertos;
- cero High abiertos;
- uno o más Medium, riesgos aceptados o limitaciones no críticas claramente declaradas;
- pruebas obligatorias aprobadas.

### NOT READY FOR IT REVIEW

Aplica cuando exista cualquier bloqueante. En este estado no se genera el PDF final.

## Secciones obligatorias del informe

1. Portada y estado.
2. Resumen ejecutivo.
3. Identificación del proyecto y versión revisada.
4. Alcance, exclusiones, supuestos y limitaciones.
5. Metodología y herramientas utilizadas.
6. Arquitectura o superficie de ataque resumida.
7. Resumen de hallazgos iniciales por severidad.
8. Detalle de Critical y High iniciales.
9. Spec SDD y trazabilidad de remediación.
10. Archivos o componentes modificados.
11. Evidencia de pruebas.
12. Resultado del security review final.
13. Hallazgos Medium y Low pendientes.
14. Riesgo residual y condiciones para producción.
15. Recomendación para IT.
16. Anexos y rutas de evidencia.

## Trazabilidad mínima

Cada hallazgo inicial Critical o High debe mostrar:

- ID estable;
- descripción;
- evidencia inicial;
- activo afectado;
- impacto;
- requisito del spec relacionado;
- cambio implementado;
- prueba de regresión;
- resultado de revisión final;
- estado `REMEDIATED` o `OPEN`.

No elimines del informe un hallazgo porque fue corregido. El historial de corrección es precisamente parte de la evidencia que IT necesita.

## Contenido mínimo de metadata

- proyecto;
- repositorio;
- rama;
- commit inicial;
- commit final o working tree final;
- fecha y hora;
- alcance;
- responsable de ejecución;
- versión de Claude Code cuando esté disponible;
- método de revisión: `/security-review` nativo;
- número de ciclos de remediación.

## Evidencia de pruebas

Para cada comando:

- comando exacto;
- propósito;
- fecha;
- resultado;
- relación con hallazgos;
- logs o salida resumida;
- limitaciones.

No marques `PASSED` si hubo skips relevantes no justificados, pruebas interrumpidas o suites no ejecutadas por falta de ambiente.

## Severidad

Mantén la severidad original del review inicial en el historial. Si una validación posterior cambia la clasificación, registra:

- severidad inicial;
- severidad confirmada;
- evidencia del cambio;
- quién o qué proceso la validó.

## Datos sensibles

Redacta:

- secretos;
- tokens;
- contraseñas;
- llaves;
- connection strings;
- cookies de sesión;
- datos personales no necesarios;
- rutas internas sensibles cuando no aporten evidencia.

No pegues payloads ofensivos completos cuando una descripción controlada y la ubicación del defecto sean suficientes.

## Declaración de cierre recomendada

Para `READY FOR IT REVIEW`:

> La revisión final automatizada no identificó hallazgos Critical, High o Medium dentro del alcance declarado. Las pruebas obligatorias registradas finalizaron satisfactoriamente. El resultado habilita la revisión y decisión final de IT; no sustituye un pentest formal, validaciones de infraestructura en producción ni la aprobación corporativa de despliegue.

Para `READY WITH CONDITIONS`:

> La revisión final automatizada no identificó hallazgos Critical o High dentro del alcance declarado. Persisten las condiciones y riesgos residuales descritos en este informe, que deben ser evaluados explícitamente por IT antes del despliegue. El resultado no sustituye un pentest formal ni la aprobación corporativa de producción.
