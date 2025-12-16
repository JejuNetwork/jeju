#!/usr/bin/env bun
/**
 * Development Environment Starter
 * Wraps the CLI dev command for quick access
 */

import { spawn } from 'child_process';
import { join } from 'path';

const rootDir = process.cwd();
const cliPath = join(rootDir, 'packages/cli/src/index.ts');

// Pass through all arguments to the CLI dev command
const args = ['run', cliPath, 'dev', ...process.argv.slice(2)];

const proc = spawn('bun', args, {
  stdio: 'inherit',
  cwd: rootDir,
  env: process.env,
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});

proc.on('error', (err) => {
  console.error('Failed to start dev environment:', err);
  process.exit(1);
});

