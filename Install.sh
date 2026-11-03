#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
exec ./runtime/node scripts/install.mjs
