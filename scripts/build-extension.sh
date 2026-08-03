#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/extension"
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
