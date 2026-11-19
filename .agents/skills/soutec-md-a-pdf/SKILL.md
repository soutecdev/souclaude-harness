---
name: soutec-md-a-pdf
description: >-
  Convierte un archivo Markdown (.md) en un documento con la identidad
  corporativa de Soutec (formato 2026), exportable a PDF y a Word (.docx):
  portada con isotipo 3D a color y fecha, banner corrido azul, índice
  "Contenidos", secciones en franjas azules y subtítulos numerados
  automáticamente (1.1, 2.1.1), tablas de cabecera azul, contraportada azul con
  isotipo 3D blanco y pie "Página X de Y". Actívate SIEMPRE que el usuario
  quiera pasar un markdown a PDF o a Word con formato/estilo Soutec, o pida un
  informe, reporte, manual o procedimiento con la estética Soutec: "convierte
  este markdown a pdf", "pásame este .md a Word con formato Soutec", "hazme un
  documento Soutec desde este markdown", "dale formato Soutec a este md",
  "exporta a PDF y a doc con la marca Soutec", "necesito el informe en editable".
  Aplica aunque no diga "markdown" si pide un documento o informe con la
  estética Soutec, "un PDF como los de Soutec" o "el Word de Soutec". No lo uses
  para .pptx ni para documentos ajenos a Soutec.
---

# Soutec — Markdown a PDF y Word corporativos (formato 2026)

Genera, a partir de un mismo `.md`, un **PDF** y/o un **DOCX** con la identidad
visual de Soutec Group, replicando la plantilla corporativa 2026: portada con el
isotipo 3D a color sangrando por la izquierda, fecha arriba a la derecha y
título/subtítulo en gris negrita a la derecha; banner corrido azul en cada
página interior con el logo (del cliente o de Soutec) en la esquina superior
derecha; índice "Contenidos"; secciones en franjas azules numeradas; subtítulos
con numeración jerárquica automática (1.1, 2.1.1, 3.1.1.1); tablas con cabecera
azul; pie con copyright + "Página X de Y" en la misma fila; y contraportada azul
a sangre completa con el isotipo 3D blanco y la URL centrada.

## Qué formato elegir

- **PDF** — entregable final, cerrado, idéntico en cualquier máquina. Es el
  valor por defecto.
- **DOCX** — cuando el usuario pida un editable, "el Word", que "lo puedan
  modificar", o vaya a pasar el documento a otra persona para completarlo.
- **Ambos** — cuando lo pida explícitamente, o cuando entregue a un cliente y
  además quiera conservar el editable.

Si el usuario no dice nada, entrega el PDF y ofrece el Word en una línea; no
preguntes antes de generar.

## Uso rápido

```bash
# lanzador único (recomendado)
python3 <skill>/scripts/md_to_soutec.py ENTRADA.md --to pdf     # por defecto
python3 <skill>/scripts/md_to_soutec.py ENTRADA.md --to docx
python3 <skill>/scripts/md_to_soutec.py ENTRADA.md --to ambos   # genera los dos

# o cada motor por separado
python3 <skill>/scripts/md_to_pdf.py  ENTRADA.md [SALIDA.pdf]  [opciones]
python3 <skill>/scripts/md_to_docx.py ENTRADA.md [SALIDA.docx] [opciones]
```

Si no se pasa la salida, se genera junto al `.md` con el mismo nombre. Con
`--to ambos` se usa el nombre base y se producen `.pdf` y `.docx`.

## Arquitectura (no la rompas)

```
scripts/
  soutec_md.py     núcleo compartido: front-matter, parseo a bloques,
                   numeración jerárquica, paleta y marcado inline
  md_to_pdf.py     motor PDF   (ReportLab)
  md_to_docx.py    motor DOCX  (python-docx)
  md_to_soutec.py  lanzador: pdf | docx | ambos
```

Los dos motores consumen `soutec_md.py`, así que **el PDF y el Word del mismo
`.md` tienen exactamente la misma estructura, numeración y textos**. Si cambias
algo de contenido o numeración, hazlo en el núcleo; si cambias apariencia,
hazlo en el motor correspondiente. Nunca dupliques lógica de parseo.

- **PDF con ReportLab**: 100% Python, sin dependencias nativas (nada de
  Pango/Cairo/GTK ni Chrome). Usa fuentes internas (Helvetica/Courier), así que
  no depende de fuentes instaladas. La cromática (franjas anguladas, portada,
  contraportada) se dibuja con primitivas del canvas; el contenido fluye con
  Platypus y el índice lleva números de página reales vía multi-pass.
- **DOCX con python-docx**: no necesita Word instalado. Las franjas anguladas se
  generan como PNG al vuelo con Pillow y se anclan **detrás del texto**, de modo
  que los títulos siguen siendo texto real, editable y visible para el índice.
  Los encabezados usan los estilos `Heading 1..4` de Word, restilizados a la
  marca.

No cambies de motor (no uses WeasyPrint, pandoc/LaTeX, Chrome ni plantillas
.dotx): estos ya están medidos contra la plantilla oficial.

### El índice del Word es un campo

En el `.docx` el índice es un **campo TOC real**, no texto fijo: Word lo rellena
al abrir el archivo (el documento trae `updateFields`), o el usuario lo fuerza
con `Ctrl+E`, `F9` / clic derecho ▸ *Actualizar campos*. Ventaja: si edita el
texto, los números de página se recalculan solos. Hasta que se actualice
muestra una línea de instrucciones en su lugar — es lo esperado, no un error.
Lo mismo aplica al "Página X de Y" del pie, que usa los campos PAGE y NUMPAGES.

### Dependencias

Paquetes de Python puro, instalables con pip en cualquier SO:

```bash
pip install reportlab pillow markdown python-docx
```

(`reportlab` dibuja el PDF, `python-docx` escribe el Word, `pillow` maneja los
PNG de marca y genera las franjas, `markdown` parsea el `.md`.) En entornos
gestionados agrega `--break-system-packages -q`. Si el render falla, es por
falta de uno de estos paquetes — instálalo y reintenta; no cambies de motor.

## De dónde salen el título y el encabezado

Regla por defecto (sin configuración): **el primer `# H1` del `.md` es el título
del documento** (va en la portada) y se retira del cuerpo; los `# H1` siguientes
son las secciones en franjas azules numeradas (1, 2, 3…). Los `##`, `###` y
`####` reciben **numeración jerárquica automática** (1.1 / 1.1.1 / 1.1.1.1):
`##` sale azul y `###`/`####` en cyan; `##` y `###` entran al índice indentados.
Si un encabezado ya trae numeración manual ("1.2 Foo"), el prefijo se limpia
para no duplicarlo — no numeres a mano.

Esto significa que un `.md` normal, sin nada especial, ya sale bien: encabézalo
con un `# Título` y luego usa `#` para cada sección grande.

### Front-matter opcional (control fino)

Si el `.md` empieza con un bloque `---`, se leen estos campos (todos opcionales):

```markdown
---
title: Informe de Arquitectura         # título en portada; si está, TODOS los # son secciones
header: Informe de Arquitectura        # texto del banner corrido (default: el título)
subtitle: Plataforma Edge AI           # subtítulo en la portada
date: Julio 2026                       # fecha en portada (default: hoy en español)
author: Innovación y Desarrollo        # línea de autor/área en portada
client_logo: logo_cliente.png          # logo del cliente en la portada (ver abajo)
---
```

### Opciones de línea de comandos

Las mismas en los tres scripts; sobre-escriben el front-matter y los defaults:
`--title`, `--header`, `--subtitle`, `--date`, `--author`, `--url`,
`--client-logo`, `--no-cover`, `--no-toc`, `--no-backcover`. El lanzador
`md_to_soutec.py` añade `--to pdf | docx | ambos`.

Usa `--no-cover` / `--no-toc` para documentos cortos (una nota de una página) en
los que la portada y el índice sobran.

### Logo de cliente (portada y encabezado de todas las páginas)

La plantilla 2026 tiene un hueco "Inserte logo del cliente" en dos lugares: el
bloque de título de la portada (encima del título) y la esquina superior
derecha de todas las páginas interiores (índice y contenido). El script aplica
la misma lógica en ambos: **logo del cliente si se indicó; si no, el de
Soutec** (comportamiento por defecto, no preguntes).

- **Con logo del cliente**: pasa la imagen con `--client-logo ruta/al/logo.png`
  (o `client_logo:` en el front-matter, relativo al `.md`). El logo se dibuja a
  una **altura fija** y el ancho se adapta a su aspecto real, sin deformarlo,
  así cualquier logo queda a la misma altura. Preferible PNG con fondo
  transparente.
- **Si el usuario pide logo de cliente pero no adjunta la imagen**: pídesela
  antes de generar — sin la imagen el script se detiene con un mensaje de error.
  No inventes ni sustituyas un logo.
- **Si no se dice nada de logo**: se usa el logo de Soutec en ambos huecos, no
  preguntes.

Las alturas fijas viven en `scripts/md_to_pdf.py`: `CLIENT_LOGO_H` para la
portada (por defecto `2.2 * cm`) y `PAGE_LOGO_H` para el encabezado de página
(por defecto `1.05 * cm`); ajústalas ahí si un cliente necesita otro tamaño.

## Cómo debe venir escrito el `.md`

Si vas a **generar** el Markdown (o instruir a otro agente para que lo haga),
sigue `references/guia-autoria-md.md` — cubre front-matter, cuándo usar `#` vs
`##`, párrafos sin sangría manual, notas, tablas y un checklist final. Regla
de oro: Markdown limpio y estándar; el estilo lo pone el script.

## Convenciones de Markdown que el estilo aprovecha

Escribe Markdown normal; estos elementos ya tienen estilo Soutec:

- **Secciones**: `#` → franja azul numerada (la franja se auto-ajusta al largo
  del título; los títulos muy largos se parten en dos líneas, nunca se cortan).
  `##` → azul numerado (1.1). `###` y `####` → cyan numerados (1.1.1 /
  1.1.1.1). La numeración es automática — no la escribas en el `.md`. Ningún
  encabezado (`#`/`##`/`###`/`####`) queda huérfano al pie de página: si su
  contenido no cabe debajo, el encabezado salta con él a la página siguiente
  (`keepWithNext`).
- **Tablas**: sintaxis de tabla estándar → cabecera azul, filas cebra.
- **Código**: bloques ```` ``` ```` y `inline` con fondo gris azulado.
- **Listas**: viñetas con marcador azul; numeradas normales.
- **Negrita** para destacar (queda en color carbón, como en los ejemplos).

### Notas (blockquotes)

Un blockquote se renderiza como **nota en texto plano**, igual que en los informes
de referencia: sin caja, sin borde ni relleno de color. El rótulo en negrita
(`**Nota:**`, `**Advertencia:**`, etc.) queda inline al inicio de un párrafo
normal. Ambas sintaxis funcionan y producen el mismo resultado neutro:

```markdown
> **Nota:** información o contexto.

> [!NOTA] Título opcional
> Cuerpo del aviso (estilo admonición GitHub → el título sale en negrita).
```

No hay codificación de color por tipo: `[!ADVERTENCIA]`, `[!PELIGRO]`, etc. se
aceptan por compatibilidad, pero todas salen como texto plano con el rótulo en
negrita. Para destacar una palabra dentro de la nota, usa `**negrita**` normal.

## Identidad de marca (ya incorporada, no la reproduzcas a mano)

Los hex de la paleta viven en `scripts/soutec_md.py` y los consumen los dos
motores; la geometría y los estilos, en `md_to_pdf.py` y `md_to_docx.py`
(constantes en cm, idénticas en ambos). Los assets están en `assets/`:

- Colores de franjas, subtítulos H2 y cabeceras de tabla: azul `#00688F`.
  Sub-subtítulos H3/H4: cyan `#00A5BC`. Título de portada: gris `#595959`.
  Fondo de contraportada: azul `#156A8F`. Pie y fecha: gris `#7F7F7F`.
  Cuerpo: carbón. Acentos disponibles: verde `#47B45A`, amarillo `#F2D13F`,
  magenta `#C81E54`.
- `assets/soutec_logo.png` — lockup soutec a color (encabezado de páginas y
  hueco de logo en portada cuando no hay logo de cliente).
- `assets/soutec_isotipo_3d_color.png` — isotipo 3D a color de la portada
  (recortado a su contenido para que el sangrado por la izquierda sea
  predecible).
- `assets/soutec_isotipo_3d_white.png` — isotipo 3D blanco de la contraportada
  (escala de grises + alfa, recortado a su contenido).

Sangrías medidas contra la plantilla oficial, iguales en PDF y Word: H2 `0.81`,
H3 `1.75`, H4 `3.00`, primera línea del cuerpo `0.53`, marcador de lista `1.30`
y texto de lista `1.65` cm; índice `0.53 / 0.95 / 1.55` cm.

Si el usuario tiene versiones nuevas en alta resolución, puede reemplazar esos
PNG dentro del skill sin tocar el código — pero los dos isotipos 3D deben ir
**recortados a su contenido** (sin lienzo transparente alrededor), porque la
geometría de sangrado de portada y contraportada asume el bbox exacto.

### Tipografía en el DOCX

El PDF usa las fuentes internas de ReportLab (Helvetica/Courier) y por eso se ve
igual en cualquier máquina. El Word, en cambio, referencia fuentes por nombre:
por defecto `Calibri` (la de la plantilla corporativa de Word) y `Consolas` para
código, definidas en las constantes `FONT_BODY` y `FONT_MONO` de
`scripts/md_to_docx.py`. Si el equipo instala Quattrocento Sans —la familia que
pide el manual de marca para documentos— basta cambiar `FONT_BODY` ahí. No la
pongas por defecto: en una máquina sin esa fuente Word sustituye por una
cualquiera y el documento se descuadra.

## Después de generar

Entrega el archivo con `SendUserFile` (o `present_files` según el entorno). Si
generaste ambos formatos, entrega los dos. Si algo del layout no calza (una
tabla muy ancha, un salto de página feo), ajusta las constantes o funciones de
dibujo del motor correspondiente y vuelve a renderizar — no post-proceses el PDF
ni el DOCX a mano.

Al entregar un `.docx`, dile al usuario en una línea que el índice se rellena al
abrirlo en Word (o con `F9`), para que no lo tome por un error.
