#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cd "$ROOT_DIR/extension" && node -p "require('./package.json').version")"

cd "$ROOT_DIR/extension"
pnpm test
pnpm typecheck
pnpm build

PACKAGE_PATH="$ROOT_DIR/moodmaps-$VERSION.zip"
cd dist
zip -FSqr "$PACKAGE_PATH" .
cd "$ROOT_DIR"
unzip -t "$PACKAGE_PATH"

FIRST_ENTRY="$(unzip -Z1 "$PACKAGE_PATH" | head -1)"
if ! unzip -Z1 "$PACKAGE_PATH" | grep -qx "manifest.json"; then
  echo "manifest.json is not at the ZIP root" >&2
  exit 1
fi
echo "Created $PACKAGE_PATH (first entry: $FIRST_ENTRY)"
