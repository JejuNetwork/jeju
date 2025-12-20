#!/bin/bash
# Patch @elizaos/core to fix zod .loose() compatibility
# Run after bun install

CORE_FILE="node_modules/@elizaos/core/dist/node/index.node.js"

if [ -f "$CORE_FILE" ]; then
  # Replace .loose() with .passthrough() (they are functionally equivalent)
  sed -i 's/\.loose()/\.passthrough()/g' "$CORE_FILE"
  echo "Patched @elizaos/core zod compatibility"
fi

