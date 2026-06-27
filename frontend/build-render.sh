#!/bin/sh
set -eu

rm -rf dist
mkdir -p dist/src dist/pages
cp index.html style.css dist/
cp -R src/* dist/src/
cp -R pages/* dist/pages/
printf 'window.__GREENHOUSE_API_BASE__ = %s;\n' "${RENDER_API_BASE:-\"\"}" > dist/config.js
