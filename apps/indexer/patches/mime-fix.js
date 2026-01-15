#!/usr/bin/env node
/**
 * Patch for mime module Bun compatibility
 * Fixes mime.lookup() errors when used with Express/Subsquid in Bun
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');

// Find mime module in various possible locations
const possiblePaths = [
  join(rootDir, 'node_modules', 'mime', 'mime.js'),
  join(rootDir, 'node_modules', '.bun', 'mime@1.6.0', 'node_modules', 'mime', 'mime.js'),
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
    const result = execSync('find node_modules -path "*/mime/mime.js" 2>/dev/null | head -1', {
      cwd: rootDir,
      encoding: 'utf-8'
    }).trim();
    if (result) filePath = join(rootDir, result);
  } catch {}
}

if (filePath && existsSync(filePath)) {
  const original = readFileSync(filePath, 'utf-8');
  if (!original.includes('// PATCHED for Bun compatibility')) {
    // Patch the Mime.prototype.lookup method to handle undefined types gracefully
    let patched = original.replace(
      'Mime.prototype.lookup = function(path, fallback) {\n  var ext = path.replace(/^.*[\\.\\/\\\\]/, \'\').toLowerCase();\n\n  return this.types[ext] || fallback || this.default_type;\n};',
      `Mime.prototype.lookup = function(path, fallback) {
  // PATCHED for Bun compatibility - ensure types is initialized
  if (!this.types || typeof this.types !== 'object') {
    this.types = Object.create(null);
    if (this._load) this._load();
  }
  var ext = path.replace(/^.*[\\.\\/\\\\]/, '').toLowerCase();
  return this.types[ext] || fallback || this.default_type;
};`
    );
    
    // Patch the default mime instance initialization to ensure types are loaded
    patched = patched.replace(
      '// Default instance\nvar mime = new Mime();\n\n// Define built-in types\nmime.define(require(\'./types.json\'));',
      `// Default instance
var mime = new Mime();

// PATCHED for Bun compatibility - ensure types are loaded
try {
  // Define built-in types
  mime.define(require('./types.json'));
} catch (e) {
  // Fallback if require fails in Bun - initialize with empty types
  if (!mime.types) mime.types = Object.create(null);
  if (!mime.extensions) mime.extensions = Object.create(null);
}`
    );
    
    // Wrap the default mime.lookup to ensure types are always initialized when called
    patched = patched.replace(
      '// Default type\nmime.default_type = mime.lookup(\'bin\');',
      `// PATCHED for Bun - wrap lookup to ensure types are always initialized
const originalMimeLookup = mime.lookup.bind(mime);
mime.lookup = function(path, fallback) {
  if (!this.types || typeof this.types !== 'object' || Object.keys(this.types).length === 0) {
    this.types = Object.create(null);
    try {
      if (this.define && typeof require !== 'undefined') {
        const typesJson = require('./types.json');
        if (typesJson) this.define(typesJson);
      }
    } catch (e) {
      // Ignore errors - types will be empty but won't crash
    }
  }
  return originalMimeLookup(path, fallback);
};

// Default type
mime.default_type = mime.lookup('bin');`
    );
    
    writeFileSync(filePath, patched);
    console.log('Patched mime module for Bun compatibility');
  } else {
    console.log('Mime module already patched');
  }
} else {
  console.log('Could not find mime.js to patch');
}
