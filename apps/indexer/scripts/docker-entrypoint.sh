#!/bin/sh
# Docker entrypoint for Network Indexer
set -e

MODE="${1:-${MODE:-processor}}"
echo "Starting indexer in ${MODE} mode"

# Use compiled JavaScript with decorator metadata
case "$MODE" in
  processor) exec bun lib/api/main.js ;;
  api)
    [ "$SQLIT_READ_ENABLED" = "true" ] && export INDEXER_MODE=sqlit-only
    exec bun lib/api/api-server.js
    ;;
  graphql) exec npx sqd serve ;;
  full)
    npx sqd serve &
    bun lib/api/api-server.js &
    exec bun lib/api/main.js
    ;;
  sqlit-reader)
    export INDEXER_MODE=sqlit-only SQLIT_READ_ENABLED=true
    exec bun lib/api/api-server.js
    ;;
  health)
    curl -sf "http://localhost:${REST_PORT:-4352}/health" || exit 1
    ;;
  *) echo "Modes: processor, api, graphql, full, sqlit-reader, health" && exit 1 ;;
esac
