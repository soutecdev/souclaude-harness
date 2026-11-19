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
import md_to_pdf
import md_to_docx

FORMATS = {
    "pdf": ("pdf", md_to_pdf.render),
    "docx": ("docx", md_to_docx.render),
    "doc": ("docx", md_to_docx.render),
    "word": ("docx", md_to_docx.render),
}


def main():
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
        targets = [FORMATS[key][0]]
    else:
        sys.exit(f"Formato no reconocido: {args.to}. Usa pdf, docx o ambos.")

    base = os.path.splitext(args.output or args.input)[0]
    for fmt in targets:
        render = md_to_pdf.render if fmt == "pdf" else md_to_docx.render
        out = f"{base}.{fmt}"
        if args.output and len(targets) == 1:
            out = args.output
        render(args.input, out, args)
        print(f"{fmt.upper()} generado: {out}")


if __name__ == "__main__":
    main()
