#!/usr/bin/env bash
# release-local.sh — cut a full Peephole desktop release from this Mac.
#
# .github/workflows/release.yml does the same thing on a tag, and is the normal
# route. This exists for when Actions minutes are exhausted, and for the one
# thing CI cannot do: sign with a Developer ID and notarise. electron-builder
# cross-builds all three platforms from macOS; the targets live in
# electron-builder.yml and the shared pipeline is in scripts/release-electron.sh.
#
#   scripts/release-local.sh                  build into dist-release/
#   scripts/release-local.sh --version 0.2.0  set an explicit version
#   scripts/release-local.sh --mac            restrict to one platform
#   scripts/release-local.sh --upload         tag and publish the GitHub release
#
# Note the output is dist-release/, not the dist-desktop/ that a plain
# `npm run dist` uses, and neither is `dist/` — that is the hosted site.
set -euo pipefail

RE_NAME="Peephole"
RE_SLUG="peephole"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-electron.sh"
