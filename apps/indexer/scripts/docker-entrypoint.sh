#!/bin/sh
# Docker entrypoint for Network Indexer
set -e

MODE="${1:-${MODE:-processor}}"
echo "Starting indexer in ${MODE} mode"

case "$MODE" in
  processor) exec bun lib/main.js ;;
  api)
    [ "$SQLIT_READ_ENABLED" = "true" ] && export INDEXER_MODE=sqlit-only
    exec bun api/api-server.ts
    ;;
  graphql) exec npx sqd serve ;;
  full)
    npx sqd serve &
    bun api/api-server.ts &
    exec bun lib/main.js
    ;;
  sqlit-reader)
    export INDEXER_MODE=sqlit-only SQLIT_READ_ENABLED=true
    exec bun api/api-server.ts
    ;;
  health)
    curl -sf "http://localhost:${REST_PORT:-4352}/health" || exit 1
    ;;
  *) echo "Modes: processor, api, graphql, full, sqlit-reader, health" && exit 1 ;;
esac
