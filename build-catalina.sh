#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This packaging script must be run on macOS."
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This build is intended for Intel Macs (x86_64)."
  exit 1
fi
npm install
npm run check
npm run build:catalina
printf '\nBuild complete. Look in ./dist for the .app bundle, DMG, and ZIP.\n'
