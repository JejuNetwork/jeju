#!/usr/bin/env node
/**
 * Patch for Apollo server Express 5 compatibility
 * Fixes URL handling in nodeHttpToRequest.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');

const possiblePaths = [
  join(rootDir, 'node_modules', '@subsquid', 'apollo-server-core', 'dist', 'nodeHttpToRequest.js'),
  join(rootDir, 'node_modules', '.bun', '@subsquid+apollo-server-core@3.14.0+6316f085bf5f4404', 'node_modules', '@subsquid', 'apollo-server-core', 'dist', 'nodeHttpToRequest.js'),
];

let filePath = null;
for (const p of possiblePaths) {
  if (existsSync(p)) {
    filePath = p;
    break;
  }
}

if (!filePath) {
  try {
    const { execSync } = await import('child_process');
    const result = execSync('find node_modules -path "*/@subsquid/apollo-server-core/dist/nodeHttpToRequest.js" 2>/dev/null | head -1', {
      cwd: rootDir,
      encoding: 'utf-8'
    }).trim();
    if (result) filePath = join(rootDir, result);
  } catch {}
}

if (filePath && existsSync(filePath)) {
  const original = readFileSync(filePath, 'utf-8');
  if (!original.includes('// PATCHED for Express 5')) {
    const patched = original.replace(
      'return new apollo_server_env_1.Request(req.url, {',
      `// PATCHED for Express 5 + node-fetch 3.x compatibility
    const protocol = req.protocol || 'http';
    const host = req.headers.host || 'localhost';
    const fullUrl = protocol + '://' + host + req.url;
    return new apollo_server_env_1.Request(fullUrl, {`
    );
    writeFileSync(filePath, patched);
    console.log('Patched Apollo server for Express 5 compatibility');
  } else {
    console.log('Apollo server already patched');
  }
} else {
  console.log('Could not find nodeHttpToRequest.js to patch');
}
