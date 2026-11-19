#!/usr/bin/env python3
"""
Soutec — Convierte un archivo Markdown (.md) en un PDF corporativo Soutec.

Render 100% Python con ReportLab: NO depende de WeasyPrint ni de librerías
nativas del sistema (Pango/Cairo/GTK). Corre en cualquier máquina con Python:

    pip install reportlab pillow markdown

Usa fuentes internas de ReportLab (Helvetica/Courier), así que tampoco depende
de fuentes instaladas en la máquina.

Uso:
    python md_to_pdf.py ENTRADA.md [SALIDA.pdf] [opciones]

Opciones (sobre-escriben el front-matter y los defaults):
    --title / --header / --subtitle / --date / --author / --url / --client-logo
    --no-cover | --no-toc | --no-backcover

Front-matter YAML-lite opcional al inicio del .md, entre '---':
    ---
    title: Informe de Arquitectura
    header: Informe de Arquitectura
    subtitle: Plataforma Edge AI
    date: Julio 2026
    ---
"""
import argparse
import datetime
import io
import os
import re
import sys

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT, TA_CENTER
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    Preformatted, PageBreak, Flowable, ListFlowable, ListItem, HRFlowable,
    NextPageTemplate, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents

# Núcleo compartido con md_to_docx.py: front-matter, parseo a bloques,
# numeración jerárquica y paleta. No dupliques nada de eso aquí.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soutec_md as core
from soutec_md import (
    parse_front_matter, truthy, extract_title, md_to_blocks, today_es,
    inline_to_rl, plain,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))

# ---------- Paleta oficial Soutec (los hex viven en soutec_md.py) ----------
def _c(hexval):
    return colors.HexColor(hexval)

CYAN       = _c(core.CYAN)
BLUE       = _c(core.BLUE)
DEEP       = _c(core.DEEP)
CARBON     = _c(core.CARBON)
GREEN      = _c(core.GREEN)
YELLOW     = _c(core.YELLOW)
MAGENTA    = _c(core.MAGENTA)
BODY       = _c(core.BODY_TXT)
RULE       = _c(core.RULE)
GREY       = _c(core.GREY)
ZEBRA      = _c(core.ZEBRA)
CODEBG     = _c(core.CODEBG)
BACK_BLUE  = _c(core.BACK_BLUE)    # fondo pleno de la contraportada
COVER_GREY = _c(core.COVER_GREY)   # título/subtítulo de la portada
FOOT_GREY  = _c(core.FOOT_GREY)    # pie de página y fecha de portada

PAGE_W, PAGE_H = letter
LM = RM = 2 * cm
TM = 2.85 * cm          # top del marco de contenido (bajo el banner corrido)
BM = 1.9 * cm           # bottom del marco de contenido
CONTENT_W = PAGE_W - LM - RM

LOGO = os.path.join(ASSETS, "soutec_logo.png")
ISOTIPO_3D = os.path.join(ASSETS, "soutec_isotipo_3d_color.png")
ISOTIPO_3D_WHITE = os.path.join(ASSETS, "soutec_isotipo_3d_white.png")

# Total de páginas para el folio "Página X de Y". Se resuelve en una pasada de
# conteo previa (ver render) y se lee al dibujar el pie con un canvas normal, de
# modo que los anclajes del índice se liguen a la página correcta.
_TOTAL_PAGES = None


# ============================================================
#  Estilos de párrafo
# ============================================================
def build_styles():
    S = {}
    # Cuerpo justificado con sangría SOLO en la primera línea (0.53 cm, como la
    # plantilla 2026); las líneas de continuación quedan alineadas al margen
    # izquierdo. La plantilla sangra también el primer párrafo tras un título.
    S["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=15,
                               alignment=TA_JUSTIFY, textColor=BODY, spaceAfter=5,
                               leftIndent=0, firstLineIndent=0.53 * cm)
    S["body0"] = ParagraphStyle("body0", parent=S["body"], firstLineIndent=0.53 * cm)
    S["H2"] = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=13, leading=16,
                             textColor=BLUE, spaceBefore=12, spaceAfter=5,
                             leftIndent=0.8 * cm)
    S["H3"] = ParagraphStyle("H3", fontName="Helvetica-Bold", fontSize=11.5, leading=14,
                             textColor=CYAN, spaceBefore=9, spaceAfter=3,
                             leftIndent=1.75 * cm)
    S["H4"] = ParagraphStyle("H4", fontName="Helvetica-Bold", fontSize=10.5, leading=13,
                             textColor=CYAN, spaceBefore=7, spaceAfter=2,
                             leftIndent=3.0 * cm)
    S["li"] = ParagraphStyle("li", parent=S["body"], firstLineIndent=0, leftIndent=0,
                             spaceAfter=2, alignment=TA_JUSTIFY)
    S["cell"] = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.5, leading=12,
                               textColor=BODY)
    S["cellh"] = ParagraphStyle("cellh", fontName="Helvetica-Bold", fontSize=9.5,
                                leading=12, textColor=colors.white)
    S["callout"] = ParagraphStyle("callout", fontName="Helvetica", fontSize=10, leading=13.5,
                                  textColor=CARBON)
    S["code"] = ParagraphStyle("code", fontName="Courier", fontSize=9, leading=12.5,
                               textColor=CARBON)
    S["toc0"] = ParagraphStyle("toc0", fontName="Helvetica", fontSize=10.5, leading=17,
                               leftIndent=0.53 * cm, textColor=CARBON)
    S["toc1"] = ParagraphStyle("toc1", fontName="Helvetica", fontSize=10.5, leading=15,
                               leftIndent=0.95 * cm, textColor=CARBON)
    S["toc2"] = ParagraphStyle("toc2", fontName="Helvetica", fontSize=10, leading=13,
                               leftIndent=1.55 * cm, textColor=colors.HexColor("#55605D"))
    S["toch"] = ParagraphStyle("toch", fontName="Helvetica-Bold", fontSize=15, leading=19,
                               textColor=BLUE, alignment=TA_LEFT, spaceAfter=12)
    return S


# ============================================================
#  Flowable: banner de sección numerado (paralelogramo cyan)
# ============================================================
class SectionBanner(Flowable):
    def __init__(self, number, title):
        super().__init__()
        self.number = number
        self.title = re.sub(r"<[^>]+>", "", title)   # el banner usa texto plano
        self.key = f"sec{number}"
        # No dejar la franja huérfana al pie: si el contenido que sigue no cabe
        # bajo el banner, ReportLab mueve el banner a la página siguiente.
        self.keepWithNext = 1
        self._pad_top = 0.55 * cm
        self._pad_bot = 0.32 * cm
        self._skew = 0.46 * cm
        self._layout()

    def _layout(self):
        """Decide fuente, líneas (1 ó 2) y ancho de la franja para que el título
        NUNCA se corte: una línea a 14.5 pt; si no cabe, encoge hasta un mínimo
        legible; si aún no cabe, se parte en dos líneas y la franja crece de alto.
        Se mide con pdfmetrics (sin canvas) para poder fijar la altura en wrap()."""
        from reportlab.pdfbase.pdfmetrics import stringWidth

        def w(s, fs):
            return stringWidth(s, "Helvetica-Bold", fs)

        x_title, pad_r, fs_full, fs_min1 = 1.68 * cm, 0.7 * cm, 13.5, 10.5
        # Ancho máximo para que la franja no rebase el papel (arranca en -LM y la
        # punta llega a bw + skew, medidos desde el origen del flowable en LM).
        bw_max = PAGE_W - LM - self._skew - 0.4 * cm
        avail = bw_max - x_title - pad_r
        t = self.title
        full = w(t, fs_full)
        if full <= avail:                          # 1) una línea a tamaño pleno
            self._fs, self._lines = fs_full, [t]
        else:
            fs = max(fs_min1, fs_full * avail / full)
            if w(t, fs) <= avail:                  # 2) una línea encogida y legible
                self._fs, self._lines = fs, [t]
            else:                                  # 3) dos líneas equilibradas
                self._fs, self._lines = self._wrap_two(t, avail)
        self._line_h = self._fs + 3.5
        self._bar_h = max(0.88 * cm, len(self._lines) * self._line_h + 0.24 * cm)
        widest = max(w(l, self._fs) for l in self._lines)
        self._bw = min(max(7.4 * cm, x_title + widest + pad_r), bw_max)

    @staticmethod
    def _wrap_two(text, avail):
        """Parte el título en dos líneas equilibradas que quepan en 'avail',
        bajando la fuente si hiciera falta."""
        from reportlab.pdfbase.pdfmetrics import stringWidth
        words = text.split()
        for fs in (12.0, 11.0, 10.0, 9.0, 8.0):
            best = None
            for i in range(1, len(words)):
                a, b = " ".join(words[:i]), " ".join(words[i:])
                wa = stringWidth(a, "Helvetica-Bold", fs)
                wb = stringWidth(b, "Helvetica-Bold", fs)
                if wa <= avail and wb <= avail and (best is None or abs(wa - wb) < best[0]):
                    best = (abs(wa - wb), [a, b])
            if best:
                return fs, best[1]
        return 8.0, [text]     # fallback extremo (título de una sola palabra enorme)

    def wrap(self, availW, availH):
        self._availW = availW
        self.height = self._bar_h + self._pad_top + self._pad_bot
        return (availW, self.height)

    def draw(self):
        c = self.canv
        y = self._pad_bot
        h = self._bar_h
        skew = self._skew
        # Franja azul (formato 2026): un ÚNICO polígono (rect + punta) que
        # sangra al borde izquierdo del papel.
        c.setFillColor(BLUE)
        p = c.beginPath()
        p.moveTo(-LM, y)
        p.lineTo(self._bw, y)
        p.lineTo(self._bw + skew, y + h)
        p.lineTo(-LM, y + h)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
        c.setFillColor(colors.white)
        # número a tamaño fijo, centrado en la franja
        c.setFont("Helvetica-Bold", 13.5)
        c.drawString(0.6 * cm, y + (h - 13.5) / 2 + 1.5, str(self.number))
        # título en 1 ó 2 líneas, bloque centrado verticalmente
        fs, n = self._fs, len(self._lines)
        base0 = y + h / 2 - 0.40 * fs + (n - 1) * self._line_h / 2
        c.setFont("Helvetica-Bold", fs)
        for i, line in enumerate(self._lines):
            c.drawString(1.68 * cm, base0 - i * self._line_h, line)


# ============================================================
#  Cromática de página (canvas) — banner, logo, pie, portada, contra
# ============================================================
def _draw_run_banner(c, header):
    # Formato 2026: franja azul #00688F que sangra por la izquierda, borde
    # derecho inclinado (más ancha arriba), texto blanco al margen izquierdo.
    h = 0.84 * cm
    y = PAGE_H - 1.55 * cm - h   # tope de la franja a 1.55 cm del borde superior
    c.setFont("Helvetica-Bold", 9.5)
    tw = c.stringWidth(header, "Helvetica-Bold", 9.5)
    bw = max(6.8 * cm, LM + tw + 0.6 * cm)
    skew = 0.48 * cm
    # Banner como un ÚNICO polígono (rect + punta) para que no haya costura.
    c.setFillColor(BLUE)
    p = c.beginPath()
    p.moveTo(0, y)
    p.lineTo(bw, y)
    p.lineTo(bw + skew, y + h)
    p.lineTo(0, y + h)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.drawString(LM, y + (h - 9.5) / 2 + 1.3, header)


# Altura fija del logo de cliente en el encabezado de página.
PAGE_LOGO_H = 1.05 * cm


def _draw_page_logo(c, client_logo=None):
    """Logo de la esquina superior derecha de cada página ("Inserte logo del
    cliente" en la plantilla): el del cliente si se indicó; si no, el de Soutec.
    Se centra verticalmente sobre la banda del banner corrido."""
    band_c = PAGE_H - 1.97 * cm
    if client_logo:
        lw, lh = _logo_dims_by_height(client_logo, PAGE_LOGO_H, max_w=4.6 * cm)
        path = client_logo
    else:
        lw = 3.0 * cm
        lh = lw * 51.0 / 279.0
        path = LOGO
    c.drawImage(path, PAGE_W - RM - lw, band_c - lh / 2, width=lw, height=lh,
                mask="auto", preserveAspectRatio=True, anchor="sw")


def _draw_footer(c, copyright_txt, pageno=None, total=None):
    # Formato 2026: sin línea; copyright a la izquierda y folio a la derecha,
    # ambos en la misma fila.
    yb = 1.15 * cm
    c.setFont("Helvetica", 8.5)
    c.setFillColor(FOOT_GREY)
    c.drawString(LM, yb, copyright_txt)
    if pageno:
        tot = total if total else pageno   # en la pasada de conteo total aún es None
        c.drawRightString(PAGE_W - RM, yb, f"Página {pageno} de {tot}")


_ASPECT_CACHE = {}


def _img_aspect(path, fallback=1.32):
    """Relación ancho/alto real de una imagen (cacheada)."""
    if path not in _ASPECT_CACHE:
        try:
            from PIL import Image
            with Image.open(path) as im:
                _ASPECT_CACHE[path] = im.width / float(im.height)
        except Exception:
            _ASPECT_CACHE[path] = fallback
    return _ASPECT_CACHE[path]


# Altura fija del logo de cliente en la portada: todos los logos salen a la misma
# altura y el ancho se adapta al aspecto real de la imagen (sin deformarla).
CLIENT_LOGO_H = 2.2 * cm


def _logo_dims_by_height(path, height, max_w=9.0 * cm):
    """(ancho, alto) para dibujar un logo a una ALTURA fija, con el ancho
    calculado desde el aspecto real de la imagen. max_w es una salvaguarda para
    logotipos extremadamente apaisados que si no se saldrían de la página."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            iw, ih = im.size
        ar = iw / float(ih) if ih else 1.0
    except Exception:
        ar = 1.0
    w = height * ar
    if w > max_w:
        w, height = max_w, max_w / ar
    return w, height


def _fit_cover_lines(text, fs_full=17.5, fs_min=13.0, maxw=None):
    """(fs, [líneas]) para el título/subtítulo de portada: una línea a 17.5 pt;
    si no cabe encoge hasta 13; si aún no cabe, dos líneas equilibradas."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    if maxw is None:
        maxw = CONTENT_W
    if stringWidth(text, "Helvetica-Bold", fs_full) <= maxw:
        return fs_full, [text]
    fs = max(fs_min, fs_full * maxw / stringWidth(text, "Helvetica-Bold", fs_full))
    if stringWidth(text, "Helvetica-Bold", fs) <= maxw:
        return fs, [text]
    words = text.split()
    for fs in (15.0, 14.0, 13.0, 12.0, 11.0):
        best = None
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            wa = stringWidth(a, "Helvetica-Bold", fs)
            wb = stringWidth(b, "Helvetica-Bold", fs)
            if wa <= maxw and wb <= maxw and (best is None or abs(wa - wb) < best[0]):
                best = (abs(wa - wb), [a, b])
        if best:
            return fs, best[1]
    return 11.0, [text]


def make_cover_painter(title, subtitle, date_str, author, client_logo=None):
    """Portada formato 2026: sin banner corrido; fecha arriba a la derecha;
    isotipo 3D a color gigante sangrando por la izquierda (borde derecho al
    margen); bloque a la derecha con logo (cliente o Soutec), título y
    subtítulo en gris #595959 negrita."""
    def paint(c, doc):
        # fecha, arriba a la derecha
        c.setFont("Helvetica", 9)
        c.setFillColor(FOOT_GREY)
        c.drawRightString(PAGE_W - RM, PAGE_H - 1.5 * cm, date_str)
        # isotipo 3D a color: borde derecho alineado al margen derecho, sangra
        # por la izquierda (como en la plantilla)
        iso_h = 18.4 * cm
        iso_w = iso_h * _img_aspect(ISOTIPO_3D)
        iso_top = PAGE_H - 3.1 * cm
        c.drawImage(ISOTIPO_3D, PAGE_W - RM - iso_w, iso_top - iso_h,
                    width=iso_w, height=iso_h, mask="auto")
        xr = PAGE_W - RM
        # hueco "Inserte logo del cliente": logo del cliente a altura fija; si
        # no hay, el lockup de Soutec
        if client_logo:
            lw, lh = _logo_dims_by_height(client_logo, CLIENT_LOGO_H)
            logo_path = client_logo
        else:
            lw = 4.6 * cm
            lh = lw * 51.0 / 279.0
            logo_path = LOGO
        logo_c = 6.45 * cm            # centro vertical del hueco del logo
        c.drawImage(logo_path, xr - lw, logo_c - lh / 2, width=lw, height=lh,
                    mask="auto", preserveAspectRatio=True, anchor="sw")
        # título (y subtítulo) en gris, negrita, alineados a la derecha
        c.setFillColor(COVER_GREY)
        fs_t, tlines = _fit_cover_lines(title)
        line_h = 0.92 * cm
        base_t = 3.66 * cm
        c.setFont("Helvetica-Bold", fs_t)
        for i, line in enumerate(reversed(tlines)):
            c.drawRightString(xr, base_t + i * line_h, line)
        y = 2.72 * cm
        if subtitle:
            fs_s, slines = _fit_cover_lines(subtitle)
            c.setFont("Helvetica-Bold", fs_s)
            for line in slines:
                c.drawRightString(xr, y, line)
                y -= line_h
        if author:
            c.setFillColor(FOOT_GREY)
            c.setFont("Helvetica", 10)
            c.drawRightString(xr, max(y, 1.55 * cm), author)
    return paint


def make_toc_painter(header, copyright_txt, client_logo=None):
    def paint(c, doc):
        _draw_run_banner(c, header)
        _draw_page_logo(c, client_logo)
        _draw_footer(c, copyright_txt, c.getPageNumber(), _TOTAL_PAGES)
    return paint


def make_content_painter(header, copyright_txt, client_logo=None):
    def paint(c, doc):
        _draw_run_banner(c, header)
        _draw_page_logo(c, client_logo)
        _draw_footer(c, copyright_txt, c.getPageNumber(), _TOTAL_PAGES)
    return paint


def make_backcover_painter(url):
    """Contraportada formato 2026: fondo azul #156A8F a sangre completa,
    isotipo 3D blanco sangrando por arriba-izquierda y URL centrada abajo.
    Sin pie ni folio."""
    def paint(c, doc):
        c.setFillColor(BACK_BLUE)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        iso_h = 19.0 * cm
        iso_w = iso_h * _img_aspect(ISOTIPO_3D_WHITE)
        c.drawImage(ISOTIPO_3D_WHITE, -8.5 * cm, PAGE_H + 3.2 * cm - iso_h,
                    width=iso_w, height=iso_h, mask="auto")
        c.setFillColor(colors.white)
        c.setFont("Helvetica", 11.5)
        c.drawCentredString(PAGE_W / 2, 2.8 * cm, url)
    return paint


# ============================================================
#  DocTemplate con hook de TOC — ancla cada entrada del índice a su encabezado
# ============================================================
class SoutecDoc(BaseDocTemplate):
    def _anchor_top(self, flowable):
        # Y absoluta del borde superior del flowable recién colocado. En este
        # punto self.frame._y ya está por debajo del flowable (con su spaceAfter
        # descontado), así que el tope = _y + spaceAfter + alto. Con un pequeño
        # respiro arriba, el destino /FitH salta al encabezado, no a la página.
        y = self.frame._y + getattr(flowable, "height", 0)
        try:
            y += flowable.getSpaceAfter()
        except Exception:
            pass
        return min(y + 0.3 * cm, PAGE_H)

    def afterFlowable(self, flowable):
        if isinstance(flowable, SectionBanner):
            # Destino /FitH a la altura del banner; el 4º campo del TOCEntry (la
            # key) hace la entrada del índice clicable y anclada al encabezado.
            self.canv.bookmarkHorizontalAbsolute(flowable.key, self._anchor_top(flowable))
            txt = f"{flowable.number}&nbsp;&nbsp;{re.sub(r'<[^>]+>', '', flowable.title)}"
            self.notify("TOCEntry", (0, txt, self.page, flowable.key))
            self.canv.addOutlineEntry(re.sub(r"<[^>]+>", "", flowable.title),
                                      flowable.key, level=0)
        elif isinstance(flowable, Paragraph):
            name = flowable.style.name
            if name in ("H2", "H3"):
                # Genera una key estable por encabezado (cacheada en el flowable
                # para que sea la misma en todas las pasadas de multiBuild) y la
                # ancla a la posición del subtítulo con un destino /FitH.
                key = getattr(flowable, "_bkey", None)
                if key is None:
                    self._hkeyseq = getattr(self, "_hkeyseq", 0) + 1
                    key = f"h{self._hkeyseq}"
                    flowable._bkey = key
                self.canv.bookmarkHorizontalAbsolute(key, self._anchor_top(flowable))
                lvl = 1 if name == "H2" else 2
                self.notify("TOCEntry", (lvl, flowable.getPlainText(), self.page, key))


# ============================================================
#  Construcción de flowables
# ============================================================
def blocks_to_flowables(blocks, S):
    """Bloques (ya numerados por soutec_md.number_blocks) -> flowables."""
    story = []
    suppress_indent = True
    for b in blocks:
        t = b["t"]
        if t == "section":
            sp = Spacer(0, 0.35 * cm) if story else Spacer(0, 0)
            story.append(sp)
            story.append(SectionBanner(b["num"], plain(b["title"])))
            suppress_indent = True
        elif t == "h":
            num = b.get("num") or ""
            prefix = f"{num}&nbsp;&nbsp;&nbsp;" if num else ""
            style = {2: "H2", 3: "H3", 4: "H4"}.get(b["level"], "H4")
            para = Paragraph(prefix + inline_to_rl(b["text"]), S[style])
            para.keepWithNext = 1   # el subtítulo viaja con el contenido que le sigue
            story.append(para)
            suppress_indent = True
        elif t == "p":
            if not b["text"]:
                continue
            style = S["body0"] if suppress_indent else S["body"]
            story.append(Paragraph(inline_to_rl(b["text"]), style))
            suppress_indent = False
        elif t == "list":
            story.append(ListFlowable(
                [ListItem(Paragraph(inline_to_rl(it), S["li"])) for it in b["items"]],
                bulletType="1" if b["ordered"] else "bullet",
                bulletColor=BLUE, bulletFontName="Helvetica-Bold",
                leftIndent=1.65 * cm, bulletDedent=0.35 * cm, bulletFontSize=9,
            ))
            suppress_indent = False
        elif t == "table":
            story.append(_make_table(b, S))
            suppress_indent = False
        elif t == "code":
            story.append(_make_code(b["text"], S))
            suppress_indent = False
        elif t == "callout":
            # Los blockquotes se renderizan como nota en texto plano (sin caja ni
            # color), como en los informes de referencia: el rótulo en negrita
            # ("Nota:", "NOTA:") queda inline dentro de un párrafo normal.
            style = S["body0"] if suppress_indent else S["body"]
            story.append(Paragraph(inline_to_rl(b["text"]), style))
            suppress_indent = False
        elif t == "hr":
            story.append(Spacer(0, 0.15 * cm))
            story.append(HRFlowable(width="100%", thickness=0.8, color=RULE))
            story.append(Spacer(0, 0.15 * cm))
    return story


def _col_widths(head, rows, ncol):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    maxw = [1.0] * ncol
    def measure(cells, fs, fn):
        for i, cell in enumerate(cells):
            if i >= ncol:
                continue
            plain = re.sub(r"<[^>]+>", "", cell)
            maxw[i] = max(maxw[i], stringWidth(plain, fn, fs))
    if head:
        measure(head, 9.5, "Helvetica-Bold")
    for r in rows:
        measure(r, 9.5, "Helvetica")
    pad = 12
    raw = [min(w + pad, CONTENT_W * 0.42) for w in maxw]
    total = sum(raw)
    if total <= CONTENT_W:
        extra = (CONTENT_W - total) / ncol
        return [w + extra for w in raw]
    scale = CONTENT_W / total
    return [w * scale for w in raw]


def _make_table(b, S):
    head = b.get("head") or []
    rows = b.get("rows") or []
    ncol = max([len(head)] + [len(r) for r in rows]) if (head or rows) else 1
    data = []
    if head:
        data.append([Paragraph(inline_to_rl(x), S["cellh"]) for x in head]
                    + [""] * (ncol - len(head)))
    for r in rows:
        data.append([Paragraph(inline_to_rl(x), S["cell"]) for x in r]
                    + [""] * (ncol - len(r)))
    colw = _col_widths(head, rows, ncol)
    tbl = Table(data, colWidths=colw, repeatRows=1 if head else 0)
    ts = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DFE4E6")),
    ]
    start = 0
    if head:
        ts += [("BACKGROUND", (0, 0), (-1, 0), BLUE),
               ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.white)]
        start = 1
    for i in range(start, len(data)):
        if (i - start) % 2 == 1:
            ts.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    tbl.setStyle(TableStyle(ts))
    return KeepTogether([Spacer(0, 0.1 * cm), tbl, Spacer(0, 0.2 * cm)]) if len(data) <= 6 else \
        _wrap_spaced(tbl)


def _wrap_spaced(fl):
    return fl


def _make_code(text, S):
    pre = Preformatted(text, S["code"])
    tbl = Table([[pre]], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODEBG),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, DEEP),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return KeepTogether([Spacer(0, 0.1 * cm), tbl, Spacer(0, 0.2 * cm)])


# ============================================================
#  Render principal
# ============================================================
def render(md_path, out_path, args):
    global _TOTAL_PAGES
    _TOTAL_PAGES = None

    with open(md_path, "r", encoding="utf-8") as f:
        raw = f.read()
    meta, body = parse_front_matter(raw)

    if args.title:
        title = args.title
    else:
        title, body = extract_title(body, meta)
    header = args.header or meta.get("header") or title
    subtitle = args.subtitle or meta.get("subtitle", "")
    author = args.author or meta.get("author", "")
    url = args.url or meta.get("url", "www.soutec-group.com")

    # Logo de cliente en la portada (opcional). Si se indica pero no existe el
    # archivo, se detiene con un mensaje claro para que el usuario envíe la
    # imagen. Si no se indica nada, la portada usa el logo de Soutec por defecto.
    client_logo = args.client_logo or meta.get("client_logo") or ""
    if client_logo:
        client_logo = os.path.expanduser(client_logo)
        if not os.path.isabs(client_logo):
            client_logo = os.path.join(os.path.dirname(os.path.abspath(md_path)),
                                       client_logo)
        if not os.path.isfile(client_logo):
            sys.exit(f"No se encontró el logo del cliente: {client_logo}\n"
                     "Envía la imagen del logo (PNG/JPG, preferible con fondo "
                     "transparente) o corrige la ruta con --client-logo.")

    want_cover = not args.no_cover
    want_toc = not args.no_toc
    want_backcover = not args.no_backcover and not (
        "backcover" in meta and not truthy(meta.get("backcover", "true")))

    date_str = args.date or meta.get("date", today_es())
    year = datetime.date.today().year
    copyright_txt = meta.get("copyright") or \
        f"©{year} Soutec – Todos los Derechos Reservados"

    blocks = md_to_blocks(body)
    has_headings = any(b["t"] in ("section", "h") for b in blocks)

    S = build_styles()

    # --- Plantillas de página (frescas por build para no arrastrar estado) ---
    def make_templates():
        frame_cover = Frame(0, 0, PAGE_W, PAGE_H, id="cover",
                            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        frame_content = Frame(LM, BM, CONTENT_W, PAGE_H - TM - BM, id="content",
                              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        frame_toc = Frame(LM, BM, CONTENT_W, PAGE_H - TM - BM, id="toc",
                          leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        return [
            PageTemplate(id="cover", frames=[frame_cover],
                         onPage=make_cover_painter(title, subtitle, date_str,
                                                   author, client_logo or None)),
            PageTemplate(id="toc", frames=[frame_toc],
                         onPage=make_toc_painter(header, copyright_txt,
                                                 client_logo or None)),
            PageTemplate(id="content", frames=[frame_content],
                         onPage=make_content_painter(header, copyright_txt,
                                                     client_logo or None)),
            PageTemplate(id="backcover", frames=[frame_cover],
                         onPage=make_backcover_painter(url)),
        ]

    first_template = "cover" if want_cover else ("toc" if (want_toc and has_headings) else "content")

    def assemble_story():
        # Regenera flowables y TOC frescos: el mismo story no puede reutilizarse
        # entre dos builds distintos (el TOC y los banners guardan estado).
        story = []
        if want_cover:
            story.append(Spacer(0, 1))
            nxt = "toc" if (want_toc and has_headings) else "content"
            story.append(NextPageTemplate(nxt))
            story.append(PageBreak())
        if want_toc and has_headings:
            story.append(Paragraph("Contenidos", S["toch"]))
            toc = TableOfContents()
            toc.levelStyles = [S["toc0"], S["toc1"], S["toc2"]]
            toc.dotsMinLevel = 0
            story.append(toc)
            story.append(NextPageTemplate("content"))
            story.append(PageBreak())
        story += blocks_to_flowables(blocks, S)
        if want_backcover:
            story.append(NextPageTemplate("backcover"))
            story.append(PageBreak())
            story.append(Spacer(0, 1))
        return story

    def build_to(target):
        templates = make_templates()
        d = SoutecDoc(target, pagesize=letter, pageTemplates=templates,
                      title=title, author="Soutec")
        d._firstPageTemplateIndex = [t.id for t in templates].index(first_template)
        d.multiBuild(assemble_story())
        return d

    # Pasada 1 (a buffer descartable): cuenta las páginas para el "de N" del pie.
    # Pasada 2: build real, ya con el total y con los anclajes del índice ligados
    # a la página correcta (canvas normal, no diferido).
    _TOTAL_PAGES = build_to(io.BytesIO()).page
    build_to(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Convierte Markdown a PDF corporativo Soutec (ReportLab).")
    ap.add_argument("input")
    ap.add_argument("output", nargs="?")
    ap.add_argument("--title")
    ap.add_argument("--header")
    ap.add_argument("--subtitle")
    ap.add_argument("--date")
    ap.add_argument("--author")
    ap.add_argument("--url")
    ap.add_argument("--client-logo", help="Ruta al logo del cliente para la portada "
                    "(a altura fija, ancho adaptado). Si se omite, se usa el logo de Soutec.")
    ap.add_argument("--no-cover", action="store_true")
    ap.add_argument("--no-toc", action="store_true")
    ap.add_argument("--no-backcover", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"No existe el archivo: {args.input}")
    out = args.output or os.path.splitext(args.input)[0] + ".pdf"
    render(args.input, out, args)
    print(f"PDF generado: {out}")


if __name__ == "__main__":
    main()
