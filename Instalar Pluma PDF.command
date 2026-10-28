#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Instala Node.js 22.13 o posterior desde https://nodejs.org/ y vuelve a abrir este archivo.'
  if [[ -t 0 ]]; then read -k 1 '?Pulsa una tecla para cerrar.'; fi
  exit 1
fi
node scripts/local.mjs install
pluma_status=$?
if [[ -t 0 ]]; then read -k 1 '?Pulsa una tecla para cerrar.'; fi
exit $pluma_status
