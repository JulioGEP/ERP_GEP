#!/usr/bin/env bash
set -euo pipefail

echo "[guard-no-ellipsis] Escaneando placeholders en TS/TSX/TOML…"

# Lista de archivos versionados relevantes (evita node_modules, dist, etc.)
FILES=$(git ls-files '*.ts' '*.tsx' '*.toml' 2>/dev/null || true)

if [ -z "${FILES}" ]; then
  echo "[guard-no-ellipsis] No hay archivos .ts/.tsx/.toml a escanear. OK."
  exit 0
fi

# Patrón:
# - línea exactamente "..." (con espacios opcionales)
# - unicode ellipsis (… = \xE2\x80\xA6)
# - literales "...", '...'
# - comentarios con "..."  // ...   o   /* ... */
# - toml:  = "..."  |  = '...'
REGEX='(^[[:space:]]*\.\.\.[[:space:]]*$)|(\xE2\x80\xA6)|(["'\'']\.\.\.["'\''])|(//[[:space:]]*\.\.\.)|(/\*[^*]*\.\.\.[^*]*\*/)|([[:space:]]=[[:space:]]["'\'']\.\.\.["'\''])'

FOUND=0

while IFS= read -r file; do
  # Saltar si el archivo no existe (por si git ls-files devolvió algo raro)
  [ -f "$file" ] || continue

  # Buscar líneas problemáticas, ignorando aquellas con 'allow-ellipsis'
  if grep -n -E "${REGEX}" "$file" | grep -v -i 'allow-ellipsis' >/tmp/ellipsis_hits.$$ 2>/dev/null; then
    if [ -s /tmp/ellipsis_hits.$$ ]; then
      echo "❌ ${file}:"
      cat /tmp/ellipsis_hits.$$
      echo
      FOUND=1
    fi
    rm -f /tmp/ellipsis_hits.$$ || true
  fi
done <<< "${FILES}"

if [ "${FOUND}" -ne 0 ]; then
  echo "[guard-no-ellipsis] Se han encontrado placeholders '...' prohibidos."
  echo "Añade contenido real o marca líneas excepcionales con 'allow-ellipsis'."
  exit 1
fi

echo "[guard-no-ellipsis] OK — sin placeholders peligrosos."
