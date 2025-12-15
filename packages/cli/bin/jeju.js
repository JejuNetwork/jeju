#!/usr/bin/env bun

/**
 * Jeju CLI Entry Point
 * 
 * Usage:
 *   npx @jejunetwork/cli
 *   bunx @jejunetwork/cli  
 *   jeju (when installed globally)
 */

// Import and run the CLI
import('../dist/index.js').catch((err) => {
  // Provide helpful error if dist not built
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
    console.error('\n  Jeju CLI not built. Run: cd packages/cli && bun run build\n');
    process.exit(1);
  }
  console.error('Error:', err.message);
  process.exit(1);
});
