#!/usr/bin/env bun
/**
 * git-remote-jeju - Git remote helper for Jeju DWS
 * 
 * This script is the entry point for the git remote helper.
 * Git will invoke this when using jeju:// URLs.
 */

import { runGitRemote } from '../dist/commands/git-remote.js';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: git-remote-jeju <remotename> <url>');
  process.exit(1);
}

runGitRemote(args[0], args[1]).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

