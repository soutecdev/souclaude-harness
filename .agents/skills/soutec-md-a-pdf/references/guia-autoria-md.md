# Guía de autoría del `.md` para los documentos corporativos Soutec

Instrucciones para que un agente (o persona) escriba un Markdown que los scripts
de la skill rendericen correctamente con la identidad Soutec, **tanto en PDF
como en Word (.docx)**. El mismo `.md` produce ambos formatos con idéntica
estructura y numeración, así que no hay que escribirlo distinto según el
destino. Escribe Markdown **limpio y estándar**: el estilo (sangrías,
justificado, colores, franjas) lo aplica el script. No metas formato manual.

## 1. Front-matter (placeholders del documento)

Opcional pero recomendado. Va al inicio del archivo, entre `---`. Controla la
portada, el banner corrido y la contraportada:

```markdown
---
title: Revisión de Seguridad — souclaude-harness   # título en portada
header: Revisión de Seguridad – IT                 # texto del banner corrido (default: el título)
subtitle: souclaude-harness                        # subtítulo en portada
date: 21 de julio de 2026                          # default: fecha de hoy en español
author: Innovación y Desarrollo                    # línea de autor/área en portada
client_logo: logo_cliente.png                      # logo del cliente en portada (opcional)
url: www.soutec-group.com                          # URL de la contraportada
---
```

Reglas:
- Si NO pones `title`, se usa el primer `#` (H1) del cuerpo como título.
- Cualquier campo se puede sobre-escribir por CLI (`--title`, `--subtitle`, etc.).
- No inventes otros campos: solo estos se leen.

## 2. Estructura de secciones (lo más importante)

El nivel de encabezado define el estilo (formato 2026):

- `#` (H1) → **franja azul numerada** que sangra al borde izquierdo (1, 2, 3…).
  Úsalo para las secciones principales del documento.
- `##` (H2) → subtítulo azul en negrita, numerado automáticamente (1.1, 1.2…).
- `###` (H3) → sub-subtítulo cyan, numerado (1.1.1…).
- `####` (H4) → rótulo cyan menor, numerado (1.1.1.1…).

**No numeres los encabezados a mano**: la numeración jerárquica es automática.
Si un encabezado llega con prefijo numérico ("2.1 Diagramas"), el script lo
limpia para no duplicarlo, pero lo correcto es escribir solo "Diagramas".

Regla clave del título: **el primer `#` del documento se usa como título de la
portada y se retira del cuerpo** (a menos que definas `title` en el front-matter,
en cuyo caso todos los `#` son secciones).

Consecuencia práctica: si quieres que tus secciones principales salgan con la
franja azul numerada, **numéralas con `#`**, no con `##`. Ejemplo correcto:

```markdown
---
title: Revisión de Seguridad
---

# Resumen para IT
Texto...

# Alcance y metodología
Texto...

## Sub-tema del alcance
Texto...
```

Aquí "Resumen para IT" y "Alcance y metodología" salen como franjas azules 1 y
2; el sub-tema como subtítulo azul numerado 2.1. El índice se genera solo, con
números de página.

## 3. Párrafos

Escríbelos normal, en líneas corridas. **No** agregues sangría manual, espacios
al inicio, ni saltos de línea forzados dentro de un párrafo: el script pone la
sangría de primera línea y justifica automáticamente. Separa párrafos con una
línea en blanco.

## 4. Notas (blockquotes)

Un blockquote sale como **nota en texto plano** (sin caja ni color), como en los
informes de referencia: el rótulo en negrita queda inline al inicio de un párrafo
normal. Dos sintaxis válidas, mismo resultado:

```markdown
> **Nota:** información o contexto.

> [!NOTA] Título opcional
> Cuerpo del aviso (el título sale en negrita).
```

No hay color por tipo: `[!ADVERTENCIA]`, `[!PELIGRO]`, etc. se aceptan por
compatibilidad pero todas se renderizan igual, en texto plano. Para resaltar
dentro de la nota usa `**negrita**`.

## 5. Tablas

Markdown estándar (cabecera azul y filas cebra automáticas):

```markdown
| Campo | Valor |
|---|---|
| Proyecto | souclaude-harness |
| Estado | Listo para revisión |
```

Recomendación: mantén las tablas en **≤ 6–7 columnas** y celdas cortas. El script
reparte el ancho de forma proporcional, pero muchas columnas con texto largo se
ven apretadas. Si necesitas más, parte la información en dos tablas o usa una
lista de campos.

## 6. Código

Bloques con triple backtick (fondo gris con barra profunda) e inline con
backtick simple (`código`):

    ```text
    Estado: DONE
    Commit: 50f07ea
    ```

## 7. Listas

Viñetas con `-` (marcador azul) o numeradas con `1.`. Evita anidar más de un
nivel; el render aplana listas muy profundas.

## 8. Inline

`**negrita**` (queda en color carbón), `*cursiva*`, `` `código` ``,
`[enlace](https://…)`. Evita HTML crudo dentro del Markdown.

## 9. Qué formato pedir al generar

El mismo `.md` sirve para los dos. Con el lanzador:

```bash
python3 scripts/md_to_soutec.py informe.md --to pdf     # entregable cerrado
python3 scripts/md_to_soutec.py informe.md --to docx    # editable en Word
python3 scripts/md_to_soutec.py informe.md --to ambos
```

En el `.docx` el índice es un campo de Word: se rellena al abrir el archivo o
con `F9`. No lo consideres un error del documento.

## Checklist para el agente generador

1. ¿Front-matter con `title` (y `subtitle`/`date`/`author`/`client_logo` si aplican)?
2. ¿Secciones principales con `#` para que salgan como franjas numeradas?
3. ¿Párrafos en prosa, sin sangría ni espacios manuales?
4. ¿Notas con `[!TIPO]` o `**Palabra:**` (salen como texto plano con el rótulo en negrita)?
5. ¿Tablas de ≤ 6–7 columnas con celdas concisas?
6. ¿Sin HTML crudo ni listas anidadas profundas?
