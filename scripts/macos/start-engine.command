#!/bin/zsh
cd -- "${0:A:h}/../.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22.13 or later from https://nodejs.org/ and reopen this file.'
  if [[ -t 0 ]]; then read -k 1 '?Press any key to close.'; fi
  exit 1
fi
node scripts/local.mjs engine
pluma_status=$?
if [[ $pluma_status -ne 0 && -t 0 ]]; then read -k 1 '?Press any key to close.'; fi
exit $pluma_status
