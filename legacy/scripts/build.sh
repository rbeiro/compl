#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Only tracked browser assets belong in a release. Build fresh on every run.
stage=$(mktemp -d .compi-build-XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
while IFS= read -r -d '' file; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Recurso web ausente o enlace simbólico: $file" >&2; exit 1; }
  case "$file" in
    *.html|*.css|*.js|*.svg|*.png|*.ico|*.webp|*.woff2|*.webmanifest|public/brand/fonts/OFL-*.txt|public/brand/fonts/FUENTES_Y_LICENCIAS.txt) ;;
    public/vendor/bergamot/*.wasm|public/vendor/bergamot/NOTICE.txt|public/vendor/bergamot/LICENSE|public/vendor/zip/LICENSE|public/vendor/pdf/LICENSE|public/vendor/pdfjs-5.6.205/*.bcmap|public/vendor/pdfjs-5.6.205/*.pfb|public/vendor/pdfjs-5.6.205/*.ttf|public/vendor/pdfjs-5.6.205/*.wasm|public/vendor/pdfjs-5.6.205/*.icc|public/vendor/pdfjs-5.6.205/LICENSE|public/vendor/pdfjs-5.6.205/*/LICENSE*) ;;
    *) echo "Tipo de archivo no autorizado: $file" >&2; exit 1 ;;
  esac
  install -D -m 644 -- "$file" "$stage/${file#public/}"
done < <(git ls-files --cached -z -- public)
test -s "$stage/index.html"
rm -rf -- dist
mv -- "$stage" dist
