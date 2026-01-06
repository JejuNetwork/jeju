#!/usr/bin/env node
/**
 * Patches for Express/Apollo compatibility with Bun
 * 1. Apollo server URL handling
 * 2. Send/mime symlink fixes for Bun's incorrect module resolution
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, symlinkSync, lstatSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');

// --- Part 1: Apollo server patch ---

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
    console.log('✓ Patched Apollo server for Express 5 compatibility');
  } else {
    console.log('✓ Apollo server already patched');
  }
} else {
  console.log('⚠️  Could not find nodeHttpToRequest.js to patch');
}

// --- Part 2: Fix Bun's incorrect send/mime symlinks ---
// Express/serve-static need send@0.19.0 which exports .mime with .lookup()
// But Bun incorrectly links to send@1.2.1 which doesn't exist after override

const bunDir = join(rootDir, 'node_modules', '.bun');
const sendTarget = '../../send@0.19.0/node_modules/send';
const mimeTarget = '../../mime@1.6.0/node_modules/mime';

let fixedCount = 0;

// Fix send symlinks in express and serve-static
for (const pkg of ['express@4.21.2', 'serve-static@1.16.2', 'serve-static@1.16.3']) {
  const sendPath = join(bunDir, pkg, 'node_modules', 'send');
  if (existsSync(join(bunDir, pkg))) {
    try {
      const stat = lstatSync(sendPath);
      if (stat.isSymbolicLink()) {
        unlinkSync(sendPath);
        symlinkSync(sendTarget, sendPath);
        fixedCount++;
      }
    } catch {}
  }
}

// Fix mime symlink in send@0.19.0
const sendMimePath = join(bunDir, 'send@0.19.0', 'node_modules', 'mime');
if (existsSync(join(bunDir, 'send@0.19.0'))) {
  try {
    const stat = lstatSync(sendMimePath);
    if (stat.isSymbolicLink()) {
      unlinkSync(sendMimePath);
      symlinkSync(mimeTarget, sendMimePath);
      fixedCount++;
    }
  } catch {}
}

if (fixedCount > 0) {
  console.log(`✓ Fixed ${fixedCount} send/mime symlinks for Express compatibility`);
} else {
  console.log('✓ Send/mime symlinks OK');
}

// --- Part 3: Patch Express to support mime v2+ (getType instead of lookup, charsets fix) ---
const expressResponsePath = join(rootDir, 'node_modules', 'express', 'lib', 'response.js');
if (existsSync(expressResponsePath)) {
  let expressResponse = readFileSync(expressResponsePath, 'utf-8');
  let patched = false;

  // Patch 1: mime.lookup() -> (mime.lookup || mime.getType)()
  if (!expressResponse.includes('// PATCHED for mime v2+ compatibility') && expressResponse.includes('mime.lookup(type)')) {
    expressResponse = expressResponse.replace(
      /mime\.lookup\(type\)/g,
      '(mime.lookup || mime.getType)(type) // PATCHED for mime v2+ compatibility'
    );
    patched = true;
  }

  // Patch 2: mime.charsets.lookup() -> handle missing charsets
  if (expressResponse.includes('mime.charsets.lookup(') && !expressResponse.includes('// PATCHED for mime v2+ compatibility - charsets')) {
    expressResponse = expressResponse.replace(
      /var charset = mime\.charsets\.lookup\(([^)]+)\);/g,
      `// PATCHED for mime v2+ compatibility - charsets.lookup doesn't exist
        var charset = (mime.charsets && mime.charsets.lookup) 
          ? mime.charsets.lookup($1)
          : null;`
    );
    patched = true;
  }

  if (patched) {
    writeFileSync(expressResponsePath, expressResponse);
    console.log('✓ Patched Express response.js for mime v2+ compatibility');
  } else if (expressResponse.includes('// PATCHED for mime v2+ compatibility')) {
    console.log('✓ Express response.js already patched');
  } else {
    console.log('⚠️  Express response.js patterns not found - may need manual patch');
  }
} else {
  console.log('⚠️  Could not find express/lib/response.js to patch');
}
