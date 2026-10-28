#!/bin/bash
# Builds a synthetic jigsaw, assembles it with jigsaw2pdf, renders the PDF with
# CoreGraphics and checks every page against the PIL reference composite.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$here/../jigsaw2pdf"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 -I "$here/case.py" make "$work"
"$bin" "$work/layout.txt" "$work/out.pdf"

pages="$(swift "$here/render.swift" "$work/out.pdf" "$work/actual")"
expected_pages="$(ls "$work"/expected-*.png | wc -l | tr -d ' ')"
if [ "$pages" != "$expected_pages" ]; then
    echo "FAIL: PDF has $pages pages, expected $expected_pages"
    exit 1
fi
for n in $(seq 1 "$pages"); do
    python3 -I "$here/case.py" compare "$work/expected-$n.png" "$work/actual-$n.png"
done

# A missing sheet must fail without leaving a PDF behind.
rm "$work/2.jpg" "$work/out.pdf"
if "$bin" "$work/layout.txt" "$work/out.pdf" 2>/dev/null || [ -e "$work/out.pdf" ] || [ -e "$work/out.pdf.tmp" ]; then
    echo "FAIL: missing sheet did not fail cleanly"
    exit 1
fi
echo "ok missing sheet fails cleanly"
