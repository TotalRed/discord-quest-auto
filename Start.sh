#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/discord-quest-auto"
nohup ./runtime/node app/agent.mjs --ui >> "${XDG_CACHE_HOME:-$HOME/.cache}/discord-quest-auto/launcher.log" 2>&1 < /dev/null &
