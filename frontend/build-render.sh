#!/bin/sh
set -eu

rm -rf dist
mkdir -p dist/src
cp index.html app.js api.js style.css dist/
cp -R src/ dist/src/
printf 'window.__GREENHOUSE_API_BASE__ = %s;\n' "${RENDER_API_BASE:-\"\"}" > dist/config.js
