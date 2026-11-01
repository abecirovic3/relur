#!/usr/bin/env bash
# Builds the app icon from build/icon-small.svg (drawn for 16 and 32 px and
# their @2x) and build/icon.svg (128 px and up): build/icon.icns, build/icon.png
# (1024 px) and build/icons/<n>x<n>.png, the sizes Linux uses. macOS only: swift
# and iconutil.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# render <pixels> <out.png>: the small drawing up to 64 px, the big one above.
render() {
  local svg=build/icon.svg
  if [ "$1" -le 64 ]; then svg=build/icon-small.svg; fi
  swift scripts/render-svg.swift "$svg" "$2" "$1" >/dev/null
}

set_dir="$work/icon.iconset"
mkdir "$set_dir"
for size in 16 32 128 256 512; do
  render "$size" "$set_dir/icon_${size}x${size}.png"
  render $((size * 2)) "$set_dir/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$set_dir" -o build/icon.icns

rm -rf build/icons
mkdir build/icons
for size in 16 24 32 48 64 128 256 512 1024; do
  render "$size" "build/icons/${size}x${size}.png"
done
cp build/icons/1024x1024.png build/icon.png
echo "build/icon.icns, build/icon.png, build/icons/"
