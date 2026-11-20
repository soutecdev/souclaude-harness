#!/usr/bin/env python3
"""
Soutec — lanzador único: Markdown -> PDF y/o DOCX corporativo.

Es un envoltorio sobre `md_to_pdf.py` y `md_to_docx.py`. Ambos comparten el
núcleo `soutec_md.py`, así que el PDF y el Word del mismo `.md` salen con la
misma estructura, numeración y textos.

Uso:
    python md_to_soutec.py ENTRADA.md                 # PDF (por defecto)
    python md_to_soutec.py ENTRADA.md --to docx
    python md_to_soutec.py ENTRADA.md --to ambos      # PDF + DOCX
    python md_to_soutec.py ENTRADA.md SALIDA.pdf --to ambos

Con `--to ambos` la salida se nombra a partir del `.md` (o del nombre que se
pase, ignorando su extensión) y se generan los dos archivos.

El resto de opciones son las mismas de los dos scripts:
    --title / --header / --subtitle / --date / --author / --url / --client-logo
    --no-cover | --no-toc | --no-backcover
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FORMATS = {"pdf": "pdf", "docx": "docx", "doc": "docx", "word": "docx"}

# El módulo que falta no siempre se llama como el paquete que lo trae.
PAQUETES = {"docx": "python-docx", "PIL": "pillow"}


def salida_utf8():
    """Fuerza UTF-8 en stdout y stderr: la salida la lee Claude Code (como UTF-8)
    y, en Windows, la consola usa otra página de códigos, así que las tildes de
    los mensajes llegaban rotas. Es la misma función de soutec_md.py; se repite
    acá porque el lanzador no puede importar el núcleo antes de saber si están
    sus dependencias."""
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def falta_dependencia(error, fmt):
    paquete = PAQUETES.get(error.name, error.name)
    sys.exit(
        f"Falta el paquete de Python '{paquete}' (módulo '{error.name}'), necesario para generar {fmt.upper()}.\n"
        f"Instálalo en el entorno virtual de la skill: python -m pip install {paquete}"
    )


def cargar_motor(fmt):
    """Importa solo el motor del formato pedido: generar un PDF no exige tener
    python-docx instalado. Si falta una dependencia, lo dice con el nombre del
    paquete de pip en vez de un traceback."""
    try:
        if fmt == "pdf":
            import md_to_pdf
            return md_to_pdf.render
        import md_to_docx
        return md_to_docx.render
    except ModuleNotFoundError as error:
        falta_dependencia(error, fmt)


def main():
    salida_utf8()
    ap = argparse.ArgumentParser(
        description="Convierte Markdown a PDF y/o DOCX corporativo Soutec.")
    ap.add_argument("input")
    ap.add_argument("output", nargs="?",
                    help="Ruta de salida. Con --to ambos se usa solo su nombre base.")
    ap.add_argument("--to", default="pdf",
                    help="pdf | docx | ambos (también 'both', 'doc', 'word').")
    ap.add_argument("--title")
    ap.add_argument("--header")
    ap.add_argument("--subtitle")
    ap.add_argument("--date")
    ap.add_argument("--author")
    ap.add_argument("--url")
    ap.add_argument("--client-logo", help="Logo del cliente para la portada y el "
                    "encabezado. Si se omite, se usa el de Soutec.")
    ap.add_argument("--no-cover", action="store_true")
    ap.add_argument("--no-toc", action="store_true")
    ap.add_argument("--no-backcover", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"No existe el archivo: {args.input}")

    key = args.to.strip().lower()
    if key in ("ambos", "both", "todo", "all", "pdf+docx"):
        targets = ["pdf", "docx"]
    elif key in FORMATS:
        targets = [FORMATS[key]]
    else:
        sys.exit(f"Formato no reconocido: {args.to}. Usa pdf, docx o ambos.")

    base = os.path.splitext(args.output or args.input)[0]
    for fmt in targets:
        render = cargar_motor(fmt)
        out = f"{base}.{fmt}"
        if args.output and len(targets) == 1:
            out = args.output
        try:
            render(args.input, out, args)
        except ModuleNotFoundError as error:  # dependencias que un motor importa tarde
            falta_dependencia(error, fmt)
        print(f"{fmt.upper()} generado: {out}")


if __name__ == "__main__":
    main()
