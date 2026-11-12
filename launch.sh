#!/usr/bin/env bash
cd /home/s1lonik/.gemini/antigravity/scratch/archivetune-desktop || exit 1
exec ./node_modules/electron/dist/electron dist/main/index.js --no-sandbox --disable-gpu-sandbox "$@"
