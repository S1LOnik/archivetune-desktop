#!/usr/bin/env bash
cd -- "$(dirname -- "$0")" || exit 1
exec ./node_modules/electron/dist/electron dist/main/index.js --no-sandbox --disable-gpu-sandbox "$@"
