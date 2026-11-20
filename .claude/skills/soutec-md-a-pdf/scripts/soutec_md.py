#!/usr/bin/env python3
"""
Soutec — núcleo compartido de los generadores de documentos corporativos.

Contiene todo lo que NO depende del formato de salida:
  * lectura del front-matter y del título,
  * parseo del Markdown a una lista de bloques neutros,
  * numeración jerárquica automática (1, 1.1, 1.1.1, 1.1.1.1),
  * conversión del marcado inline a los dos destinos (ReportLab y runs de Word).

Lo importan `md_to_pdf.py` y `md_to_docx.py`, de modo que ambos formatos
comparten exactamente la misma estructura, numeración y limpieza de texto.
No agregues aquí nada específico de un formato.
"""
import datetime
import html as html_mod
import os
import re
import sys
from html.parser import HTMLParser

import markdown

# ---------- Paleta oficial Soutec (formato 2026) ----------
# Hex crudo: cada renderizador lo convierte a su propio tipo de color.
CYAN       = "#00A5BC"   # sub-subtítulos H3/H4, acento de marca
BLUE       = "#00688F"   # franjas, H2, cabeceras de tabla
DEEP       = "#004F64"   # superficies profundas
CARBON     = "#3D4543"   # texto fuerte
BODY_TXT   = "#2C3331"   # cuerpo
GREY       = "#6B7472"   # texto secundario
FOOT_GREY  = "#7F7F7F"   # pie de página y fecha de portada
COVER_GREY = "#595959"   # título y subtítulo de la portada
BACK_BLUE  = "#156A8F"   # fondo de la contraportada
RULE       = "#D8DDE0"
ZEBRA      = "#F3F7F8"
CODEBG     = "#F1F4F5"
GREEN      = "#47B45A"
YELLOW     = "#F2D13F"
MAGENTA    = "#C81E54"

MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def today_es():
    t = datetime.date.today()
    return f"{t.day} de {MESES_ES[t.month - 1]} de {t.year}"


# ============================================================
#  Front-matter y título
# ============================================================
def parse_front_matter(text):
    meta = {}
    m = re.match(r"^\ufeff?---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not m:
        return meta, text
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        val = val.strip()
        # Como en YAML: en un valor sin comillas, " #" abre un comentario. Sin
        # esto, el propio ejemplo del SKILL (`client_logo: logo.png   # logo del
        # cliente`) dejaba el comentario dentro del valor.
        if val[:1] not in ('"', "'"):
            val = re.sub(r"\s+#.*$", "", val)
        meta[key.strip().lower()] = val.strip().strip('"').strip("'")
    return meta, text[m.end():]


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes", "si", "sí", "on")


def extract_title(body, meta):
    """El primer `# H1` es el título del documento y se retira del cuerpo,
    salvo que el front-matter traiga `title` (entonces todos los `#` son
    secciones)."""
    if meta.get("title"):
        return meta["title"], body
    # Un archivo guardado desde Windows puede empezar con BOM: con él delante,
    # el primer "# Título" no se reconocía.
    body = body.lstrip(chr(0xFEFF))
    lines = body.splitlines()
    en_codigo = False
    for i, line in enumerate(lines):
        # Un "# comentario" dentro de un bloque de código no es el título.
        if re.match(r"^\s*(```|~~~)", line):
            en_codigo = not en_codigo
            continue
        if en_codigo:
            continue
        m = re.match(r"^#\s+(.*\S)\s*$", line)
        if m:
            title = m.group(1).strip()
            del lines[i]
            return title, "\n".join(lines)
    return "Documento", body


# ============================================================
#  Parser de bloques (HTML de markdown -> lista de bloques neutros)
# ============================================================
BLOCK = {"h1", "h2", "h3", "h4", "p", "ul", "ol", "li",
         "table", "thead", "tbody", "tr", "th", "td", "pre", "blockquote", "hr"}

# Único marcado inline que llega a los renderizadores (además de <a> y <br/>).
# El Markdown puede traer HTML crudo: lo que no esté acá (img, font, script...)
# se descarta como etiqueta -- su texto sigue saliendo -- en vez de pasar tal
# cual a ReportLab, cuyo Paragraph interpreta esas etiquetas.
INLINE = {"b", "strong", "i", "em", "code", "sub", "sup"}


def salida_utf8():
    """Fuerza UTF-8 en stdout y stderr.

    La salida de la skill la lee Claude Code (como UTF-8) y terminales con otra
    página de códigos -- cp1252 en Windows --: sin esto las tildes de los
    mensajes llegaban rotas («módulo» se leía «m?dulo»)."""
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def texto_de_imagen(atributos):
    """Lo que queda en el documento en lugar de una imagen del cuerpo. Los motores
    no incrustan imágenes: antes desaparecían sin dejar rastro; ahora queda dicho
    que ahí había una, con su texto alternativo o el nombre del archivo."""
    alt = (atributos.get("alt") or "").strip()
    nombre = os.path.basename((atributos.get("src") or "").split("?")[0].rstrip("/"))
    return html_mod.escape(f"[Imagen: {alt or nombre or 'sin descripción'}]")


class BlockBuilder(HTMLParser):
    """Convierte el HTML que produce `markdown` en bloques neutros.

    El marcado inline se conserva como HTML (`<b>`, `<i>`, `<code>`, `<a>`);
    cada renderizador lo traduce con `inline_to_rl` o `inline_runs`.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.buf = None          # buffer inline activo (lista de str)
        self.cap = None          # 'p','h2','h3','h4','h1'
        self.in_pre = False
        self.pre_buf = []
        self.list = None         # dict {'t':'ul'/'ol','items':[]}
        self.list_depth = 0      # 1 = lista de primer nivel; >1 = anidada
        self.in_li = False
        self.a_abiertos = []     # por cada <a> abierto: ¿se emitió como enlace?
        self.table = None        # dict {'head':[], 'rows':[]}
        self.row = None
        self.in_head = False
        self.in_cell = False
        self.in_quote = False
        self.quote_paras = []

    def _txt(self):
        return "".join(self.buf) if self.buf else ""

    def _cerrar_item(self):
        """Agrega el ítem en curso a la lista, si tiene texto. Los sub-ítems de
        una lista anidada llevan un guion por nivel: la lista se aplana, pero la
        jerarquía se sigue leyendo."""
        texto = self._txt().strip()
        if self.list is not None and texto:
            self.list["items"].append("– " * max(self.list_depth - 1, 0) + texto)
        self.buf = None

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag not in BLOCK:
            if self.buf is not None:
                if tag == "a":
                    # Solo son enlaces los destinos web y de correo, con el href
                    # escapado. Un destino relativo o un ancla (`docs/guia.md`,
                    # `#detalle`) no existe dentro del PDF y abortaba el render:
                    # su texto se conserva, sin enlace.
                    href = (d.get("href") or "").strip()
                    enlazable = bool(re.match(r"(?i)^(https?://|mailto:)", href))
                    self.a_abiertos.append(enlazable)
                    if enlazable:
                        self.buf.append(f'<a href="{html_mod.escape(href, quote=True)}">')
                elif tag == "br":
                    self.buf.append("<br/>")
                elif tag == "img":
                    self.buf.append(texto_de_imagen(d))
                elif tag in INLINE:
                    self.buf.append(f"<{tag}>")
            return
        if tag in ("h1", "h2", "h3", "h4"):
            self.cap = tag
            self.buf = []
        elif tag == "p":
            if self.in_quote:
                self.buf = []
            elif self.in_li or self.in_cell:
                if self.buf is None:
                    self.buf = []
            else:
                self.cap = "p"
                self.buf = []
        elif tag in ("ul", "ol"):
            if self.list is None:
                self.list = {"t": tag, "items": []}
            elif self.in_li:
                # Lista anidada: el ítem padre se cierra acá y sus sub-ítems
                # siguen en la MISMA lista. Antes la interna pisaba a la externa
                # y, al cerrar el ítem padre, el render moría con un TypeError.
                self._cerrar_item()
            self.list_depth += 1
        elif tag == "li":
            self.in_li = True
            self.buf = []
        elif tag == "table":
            self.table = {"head": [], "rows": []}
        elif tag == "thead":
            self.in_head = True
        elif tag == "tbody":
            self.in_head = False
        elif tag == "tr":
            self.row = []
        elif tag in ("th", "td"):
            self.in_cell = True
            self.buf = []
        elif tag == "pre":
            self.in_pre = True
            self.pre_buf = []
        elif tag == "blockquote":
            self.in_quote = True
            self.quote_paras = []
        elif tag == "hr":
            self.blocks.append({"t": "hr"})

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self.buf is not None:
            self.buf.append("<br/>")
        elif tag == "img" and self.buf is not None:
            self.buf.append(texto_de_imagen(dict(attrs)))
        elif tag == "hr":
            self.blocks.append({"t": "hr"})

    def handle_endtag(self, tag):
        if tag not in BLOCK:
            if self.buf is not None:
                if tag == "a":
                    if self.a_abiertos and self.a_abiertos.pop():
                        self.buf.append("</a>")
                elif tag in INLINE:
                    self.buf.append(f"</{tag}>")
            return
        if tag in ("h1", "h2", "h3", "h4"):
            text = self._txt().strip()
            if tag == "h1":
                self.blocks.append({"t": "section", "title": text})
            else:
                self.blocks.append({"t": "h", "level": int(tag[1]), "text": text})
            self.buf = None
            self.cap = None
        elif tag == "p":
            if self.in_quote:
                self.quote_paras.append(self._txt().strip())
                self.buf = None
            elif self.in_li or self.in_cell:
                pass  # el texto sigue en el buffer de la celda/li
            elif self.cap == "p":
                self.blocks.append({"t": "p", "text": self._txt().strip()})
                self.buf = None
                self.cap = None
        elif tag == "li":
            self._cerrar_item()
            self.in_li = False
        elif tag in ("ul", "ol"):
            self.list_depth = max(self.list_depth - 1, 0)
            if self.list_depth == 0:
                if self.list:
                    self.blocks.append({"t": "list", "ordered": self.list["t"] == "ol",
                                        "items": self.list["items"]})
                self.list = None
            else:
                self.in_li = True  # se vuelve al ítem padre, que sigue abierto
        elif tag in ("th", "td"):
            self.row.append(self._txt().strip())
            self.in_cell = False
            self.buf = None
        elif tag == "tr":
            if self.in_head:
                self.table["head"] = self.row
            else:
                self.table["rows"].append(self.row)
            self.row = None
        elif tag == "table":
            self.blocks.append({"t": "table", **self.table})
            self.table = None
        elif tag == "pre":
            self.blocks.append({"t": "code", "text": "".join(self.pre_buf).rstrip("\n")})
            self.in_pre = False
        elif tag == "blockquote":
            for para in self.quote_paras:
                self.blocks.append({"t": "callout", "text": parse_callout(para)})
            self.in_quote = False

    def handle_data(self, data):
        if self.in_pre:
            self.pre_buf.append(data)
        elif self.buf is not None:
            self.buf.append(html_mod.escape(data))


# Etiquetas de admonición estilo GitHub: `> [!NOTA] Título opcional`.
# Todas se renderizan igual (nota en texto plano con el rótulo en negrita); el
# diccionario solo normaliza el rótulo que se muestra.
ADMON = {
    "nota": "Nota", "note": "Nota", "info": "Info", "tip": "Tip",
    "conforme": "Conforme", "exito": "Éxito", "éxito": "Éxito", "ok": "OK",
    "success": "Éxito", "listo": "Listo",
    "importante": "Importante", "important": "Importante",
    "advertencia": "Advertencia", "warning": "Advertencia",
    "precaucion": "Precaución", "precaución": "Precaución", "caution": "Precaución",
    "atencion": "Atención", "atención": "Atención",
    "peligro": "Peligro", "danger": "Peligro", "error": "Error",
    "critico": "Crítico", "crítico": "Crítico",
}


def parse_callout(raw):
    """Normaliza un párrafo de blockquote a nota en texto plano: el rótulo
    (`[!NOTA]` o `**Nota:**`) queda en negrita al inicio del párrafo."""
    m = re.match(r"\s*\[!\s*([A-Za-zÀ-ÿ]+)\s*\][ \t]*(.*)", raw, re.DOTALL)
    if m:
        label = ADMON.get(m.group(1).lower(), m.group(1).capitalize())
        first, _, body = m.group(2).partition("\n")
        first, body = first.strip(), body.strip()
        title = first or label
        return f"<b>{title}</b>: {body}" if body else f"<b>{title}</b>"
    return raw


def md_to_blocks(body):
    """Markdown -> bloques neutros, ya numerados."""
    html = markdown.Markdown(extensions=[
        "tables", "fenced_code", "sane_lists", "attr_list", "md_in_html",
    ]).convert(body)
    bb = BlockBuilder()
    bb.feed(html)
    return number_blocks(bb.blocks)


# ============================================================
#  Numeración jerárquica automática
# ============================================================
def strip_manual_number(text, esperado=None):
    """Quita una numeración manual al inicio del encabezado ("1.2 Foo", "3)
    Bar", "4. Baz") para no duplicarla con la numeración automática. Respeta
    las etiquetas inline (<b>, <i>) que pudieran ir delante.

    Un número suelto seguido de espacio ("2026 Roadmap", "3 razones para
    migrar") NO es una numeración y antes se borraba del título. Solo se quita
    si coincide con el número que el encabezado va a recibir (`esperado`), que
    es el caso "1 Introducción".
    """
    limpio = re.sub(r"^((?:<[^>]+>\s*)*)(?:\d+(?:\.\d+)+[.)]?|\d+[.)])\s+", r"\1", text)
    if limpio != text or esperado is None:
        return limpio
    m = re.match(r"^((?:<[^>]+>\s*)*)(\d+)\s+(?=\S)", text)
    if m and int(m.group(2)) == esperado:
        return m.group(1) + text[m.end():]
    return text


def number_blocks(blocks):
    """Anota cada `section`/`h` con su número jerárquico en la clave `num`.

    `#` -> "1"; `##` -> "1.1"; `###` -> "1.1.1"; `####` -> "1.1.1.1".
    Un nivel solo se numera si existe su padre (un `###` suelto, sin `##`
    previo dentro de la sección, va sin número). Además limpia cualquier
    numeración escrita a mano en el `.md`.
    """
    sec = h2 = h3 = h4 = 0
    for b in blocks:
        if b["t"] == "section":
            sec += 1
            h2 = h3 = h4 = 0
            b["title"] = strip_manual_number(b["title"], sec)
            b["num"] = str(sec)
        elif b["t"] == "h":
            lvl = b["level"]
            if lvl == 2 and sec:
                h2 += 1
                h3 = h4 = 0
                b["num"] = f"{sec}.{h2}"
            elif lvl == 3 and sec and h2:
                h3 += 1
                h4 = 0
                b["num"] = f"{sec}.{h2}.{h3}"
            elif lvl == 4 and sec and h2 and h3:
                h4 += 1
                b["num"] = f"{sec}.{h2}.{h3}.{h4}"
            else:
                b["num"] = ""
            propio = {2: h2, 3: h3, 4: h4}.get(lvl) if b["num"] else None
            b["text"] = strip_manual_number(b["text"], propio)
    return blocks


def plain(text):
    """Texto sin etiquetas inline (para banners, marcadores y títulos PDF).

    También deshace las entidades: el texto de los bloques viene escapado para
    el marcado de párrafo, y estos destinos lo dibujan literal -- un título
    «Q&A "piloto"» salía como «Q&amp;A &quot;piloto&quot;»."""
    return html_mod.unescape(re.sub(r"<[^>]+>", "", text))


def toc_markup(text):
    """Texto literal -> marcado de una entrada del índice del PDF.

    ReportLab interpreta el texto de cada entrada como marcado de párrafo. Sin
    escapar, un título «Precio < 10 & cantidad > 5» perdía lo que quedaba entre
    los signos, y lo que pareciera una etiqueta se reinyectaba como tal."""
    return html_mod.escape(text)


# ============================================================
#  Marcado inline -> destinos
# ============================================================
def inline_to_rl(s):
    """HTML inline -> marcado de párrafo de ReportLab."""
    s = s.replace("<strong>", "<b>").replace("</strong>", "</b>")
    s = s.replace("<em>", "<i>").replace("</em>", "</i>")
    s = re.sub(r"<code>(.*?)</code>",
               r'<font face="Courier" color="%s">\1</font>' % DEEP, s, flags=re.DOTALL)
    s = re.sub(r'<a href="([^"]*)">(.*?)</a>',
               r'<font color="%s"><a href="\1">\2</a></font>' % BLUE, s, flags=re.DOTALL)
    s = re.sub(r"</?(span|sub|sup)[^>]*>", "", s)
    return s.strip()


class _RunParser(HTMLParser):
    """HTML inline -> lista de runs para Word."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.runs = []
        self.b = self.i = self.code = 0
        self.href = None

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "strong"):
            self.b += 1
        elif tag in ("i", "em"):
            self.i += 1
        elif tag == "code":
            self.code += 1
        elif tag == "a":
            self.href = dict(attrs).get("href", "")
        elif tag == "br":
            self.runs.append({"text": "\n", "bold": False, "italic": False,
                              "code": False, "href": None})

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in ("b", "strong"):
            self.b = max(0, self.b - 1)
        elif tag in ("i", "em"):
            self.i = max(0, self.i - 1)
        elif tag == "code":
            self.code = max(0, self.code - 1)
        elif tag == "a":
            self.href = None

    def handle_data(self, data):
        if not data:
            return
        self.runs.append({"text": data, "bold": self.b > 0, "italic": self.i > 0,
                          "code": self.code > 0, "href": self.href})


def inline_runs(s):
    """HTML inline -> [{text, bold, italic, code, href}] para python-docx."""
    p = _RunParser()
    p.feed(s or "")
    return [r for r in p.runs if r["text"]]
