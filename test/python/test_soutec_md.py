"""Pruebas del núcleo de la skill soutec-md-a-pdf (soutec_md.py).

Cubren solo la lógica PROPIA -- bloques, listas, enlaces, numeración, títulos y
front-matter -- y por eso no necesitan las dependencias de la skill (reportlab,
python-docx, pillow, markdown): el parser de Markdown se reemplaza por un
módulo vacío y a BlockBuilder se le da el HTML que ese parser produciría.

Las corre la suite de Node (test/skill-md-a-pdf.test.js). A mano:

    python -I -B test/python/test_soutec_md.py
"""
import os
import sys
import types
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.join(RAIZ, "templates", "base", "claude", "skills", "soutec-md-a-pdf", "scripts")
sys.path.insert(0, SCRIPTS)
sys.modules.setdefault("markdown", types.ModuleType("markdown"))

import soutec_md as sm  # noqa: E402


def bloques(html):
    bb = sm.BlockBuilder()
    bb.feed(html)
    bb.close()
    return bb.blocks


class Listas(unittest.TestCase):
    def test_lista_plana_sale_igual_que_siempre(self):
        b = bloques("<ul><li>uno</li><li><strong>dos</strong></li></ul>")
        self.assertEqual(b, [{"t": "list", "ordered": False, "items": ["uno", "<strong>dos</strong>"]}])

    def test_lista_anidada_no_rompe_y_se_aplana(self):
        # Antes: la lista interna pisaba a la externa y </li> del padre fallaba
        # con TypeError: 'NoneType' object is not subscriptable.
        b = bloques("<ul><li>A<ul><li>B</li><li>C</li></ul></li><li>D</li></ul>")
        self.assertEqual(b, [{"t": "list", "ordered": False, "items": ["A", "– B", "– C", "D"]}])

    def test_tres_niveles_y_tipos_mezclados(self):
        b = bloques("<ol><li>A<ul><li>B<ol><li>C</li></ol></li></ul></li><li>D</li></ol>")
        self.assertEqual(b, [{"t": "list", "ordered": True, "items": ["A", "– B", "– – C", "D"]}])

    def test_lista_suelta_con_parrafos(self):
        b = bloques("<ul><li><p>uno</p></li><li><p>dos</p><ul><li><p>tres</p></li></ul></li></ul>")
        self.assertEqual(b[0]["items"], ["uno", "dos", "– tres"])

    def test_dos_listas_seguidas_son_dos_bloques(self):
        b = bloques("<ul><li>a</li></ul><p>medio</p><ol><li>b</li></ol>")
        self.assertEqual([x["t"] for x in b], ["list", "p", "list"])
        self.assertEqual([b[0]["ordered"], b[2]["ordered"]], [False, True])


class EnlacesYMarcado(unittest.TestCase):
    def texto(self, html):
        return bloques(f"<p>{html}</p>")[0]["text"]

    def test_enlace_web_y_de_correo_se_conservan_con_href_escapado(self):
        self.assertEqual(self.texto('<a href="https://x.test/?a=1&amp;b=2">ver</a>'),
                         '<a href="https://x.test/?a=1&amp;b=2">ver</a>')
        self.assertEqual(self.texto('<a href="mailto:a@x.test">correo</a>'), '<a href="mailto:a@x.test">correo</a>')

    def test_enlace_relativo_o_ancla_sale_como_texto(self):
        # ReportLab trata un href sin esquema como destino interno del PDF y, al
        # no existir, abortaba el render.
        self.assertEqual(self.texto('Consulta la <a href="docs/guia.md">guía</a> o <a href="#detalle">más abajo</a>.'),
                         "Consulta la guía o más abajo.")

    def test_un_href_no_puede_cerrar_la_etiqueta_e_inyectar_otra(self):
        t = self.texto("""<a href='https://x.test/"><img src="file:///etc/hosts"/>'>clic</a>""")
        self.assertNotIn("<img", t)
        self.assertEqual(t.count("<a "), 1)
        self.assertIn("&quot;", t)
        self.assertEqual(self.texto("""<a href='x"><img src="y"/>'>clic</a>"""), "clic")

    def test_html_crudo_solo_conserva_el_marcado_conocido(self):
        t = self.texto('hola <img src="x.png"> <font color="red">rojo</font> <b>negrita</b> <em>cursiva</em> <code>cod</code> <span class="z">s</span>')
        for prohibido in ("<img", "<font", "<span", "</font>", "</span>"):
            self.assertNotIn(prohibido, t)
        self.assertIn("rojo", t)
        self.assertIn("<b>negrita</b>", t)
        self.assertIn("<em>cursiva</em>", t)
        self.assertIn("<code>cod</code>", t)

    def test_el_texto_sigue_escapado(self):
        self.assertEqual(self.texto("a &lt; b &amp; c"), "a &lt; b &amp; c")


class Numeracion(unittest.TestCase):
    def test_numeracion_explicita_se_quita(self):
        for crudo, limpio in [("1. Introducción", "Introducción"), ("3) Alcance", "Alcance"),
                              ("1.2 Alcance", "Alcance"), ("1.2. Alcance", "Alcance"),
                              ("10. Conclusiones", "Conclusiones"), ("<b>2.1</b> X", "<b>2.1</b> X"),
                              ("<b>2.1 X</b>", "<b>X</b>")]:
            self.assertEqual(sm.strip_manual_number(crudo), limpio, crudo)

    def test_un_numero_suelto_no_es_numeracion(self):
        # Antes se borraba: "2026 Roadmap" quedaba "Roadmap".
        for titulo in ("2026 Roadmap", "3 razones para migrar", "365 días de soporte", "5G en planta"):
            self.assertEqual(sm.strip_manual_number(titulo), titulo)
            self.assertEqual(sm.strip_manual_number(titulo, 1), titulo)

    def test_un_numero_suelto_igual_al_automatico_si_se_quita(self):
        self.assertEqual(sm.strip_manual_number("1 Introducción", 1), "Introducción")
        self.assertEqual(sm.strip_manual_number("2 Alcance", 2), "Alcance")
        self.assertEqual(sm.strip_manual_number("2 Alcance", 3), "2 Alcance")

    def test_number_blocks_numera_y_limpia_sin_comerse_titulos(self):
        b = sm.number_blocks([
            {"t": "section", "title": "2026 Roadmap"},
            {"t": "h", "level": 2, "text": "1 Contexto"},
            {"t": "h", "level": 2, "text": "3 razones para migrar"},
            {"t": "h", "level": 3, "text": "1.2.1 Detalle"},
            {"t": "section", "title": "2 Plan"},
            {"t": "h", "level": 3, "text": "suelto sin padre"},
        ])
        self.assertEqual([(x.get("num"), x.get("title", x.get("text"))) for x in b], [
            ("1", "2026 Roadmap"), ("1.1", "Contexto"), ("1.2", "3 razones para migrar"),
            ("1.2.1", "Detalle"), ("2", "Plan"), ("", "suelto sin padre"),
        ])


class TitulosYFrontMatter(unittest.TestCase):
    def test_plain_deshace_las_entidades(self):
        self.assertEqual(sm.plain("<b>Q&amp;A</b> &quot;piloto&quot; &lt;v2&gt;"), 'Q&A "piloto" <v2>')

    def test_el_titulo_se_encuentra_aunque_el_archivo_empiece_con_bom(self):
        titulo, cuerpo = sm.extract_title(chr(0xFEFF) + "# Informe\n\ntexto\n", {})
        self.assertEqual(titulo, "Informe")
        self.assertNotIn("# Informe", cuerpo)

    def test_un_comentario_dentro_de_un_bloque_de_codigo_no_es_el_titulo(self):
        md = "```bash\n# instalar\nnpm ci\n```\n\n# Manual\n\ntexto\n"
        titulo, cuerpo = sm.extract_title(md, {})
        self.assertEqual(titulo, "Manual")
        self.assertIn("# instalar", cuerpo, "se borró una línea del bloque de código")

    def test_title_del_front_matter_manda(self):
        self.assertEqual(sm.extract_title("# Sección\n", {"title": "Mi título"}), ("Mi título", "# Sección\n"))

    def test_front_matter_con_comentarios_en_linea(self):
        meta, cuerpo = sm.parse_front_matter(
            '---\ntitle: Informe anual   # se ve en la portada\nclient_logo: logo_cliente.png          # logo del cliente\n'
            'subtitle: "Edición #3"\nurl: https://x.test/#seccion\n# comentario suelto\n---\n# Cuerpo\n')
        self.assertEqual(meta["title"], "Informe anual")
        self.assertEqual(meta["client_logo"], "logo_cliente.png")
        self.assertEqual(meta["subtitle"], "Edición #3", "entre comillas, el # es parte del valor")
        self.assertEqual(meta["url"], "https://x.test/#seccion", "un # pegado al texto no abre comentario")
        self.assertEqual(cuerpo, "# Cuerpo\n")


class IndiceDelPDF(unittest.TestCase):
    def test_el_texto_de_una_entrada_va_escapado(self):
        # ReportLab lo interpreta como marcado: sin escapar, lo que queda entre
        # «<» y «>» se perdía o entraba como etiqueta.
        self.assertEqual(sm.toc_markup('Precio < 10 & "x" > 5'), "Precio &lt; 10 &amp; &quot;x&quot; &gt; 5")
        self.assertEqual(sm.toc_markup(sm.plain("Uso de <code>&lt;script&gt;</code> &amp; más")), "Uso de &lt;script&gt; &amp; más")

    def test_el_motor_de_pdf_escapa_todas_las_entradas_y_no_vuelve_a_quitar_etiquetas(self):
        # md_to_pdf.py no se puede importar sin reportlab: se lee su texto.
        with open(os.path.join(SCRIPTS, "md_to_pdf.py"), encoding="utf-8") as f:
            fuente = f.read()
        entradas = [linea for linea in fuente.splitlines() if 'notify("TOCEntry"' in linea]
        self.assertEqual(len(entradas), 2, "se esperaba una entrada para las secciones y otra para los subtítulos")
        for linea in entradas:
            self.assertIn("toc_markup(", linea)
        # El título de sección llega como texto literal (plain()): volver a
        # quitarle "etiquetas" se comía «< 10 & cantidad >».
        self.assertNotIn("flowable.title)}", fuente.replace("toc_markup(flowable.title)}", ""))
        self.assertIn("self.title = title", fuente)


class ImagenesYSalida(unittest.TestCase):
    def test_una_imagen_del_cuerpo_no_desaparece_en_silencio(self):
        # Los motores no incrustan imagenes; antes se perdian sin dejar rastro.
        self.assertEqual(bloques('<p>Antes <img src="img/flujo.png" alt="diagrama de flujo"> y despues</p>')[0]["text"],
                         "Antes [Imagen: diagrama de flujo] y despues")
        self.assertEqual(bloques('<p><img src="img/flujo.png?v=2"/></p>')[0]["text"], "[Imagen: flujo.png]")
        self.assertEqual(bloques('<p><img alt="a &lt;b&gt;"></p>')[0]["text"], "[Imagen: a &lt;b&gt;]")
        self.assertEqual(bloques("<p><img></p>")[0]["text"], "[Imagen: sin descripción]")

    def test_los_mensajes_salen_en_utf8_aunque_la_consola_use_otra_pagina_de_codigos(self):
        # En Windows la consola es cp1252: sin forzar UTF-8, quien lee la salida
        # como UTF-8 (Claude Code) veia las tildes rotas.
        import io
        crudo = io.BytesIO()
        consola = io.TextIOWrapper(crudo, encoding="cp1252")  # se guarda: al soltarla cerraria `crudo`
        original = sys.stderr
        sys.stderr = consola
        try:
            sm.salida_utf8()
            print("Falta el módulo; instálalo", file=sys.stderr)
            consola.flush()
            escrito = crudo.getvalue()
        finally:
            sys.stderr = original
        self.assertEqual(escrito.decode("utf-8").strip(), "Falta el módulo; instálalo")


if __name__ == "__main__":
    unittest.main(verbosity=1)
