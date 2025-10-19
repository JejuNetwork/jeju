import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

/**
 * Expands tilde path to current working directory
 */
export function expandTildePath(filepath: string): string {
  if (!filepath || typeof filepath !== 'string') {
    return filepath;
  }

  if (filepath.startsWith('~')) {
    return path.join(process.cwd(), filepath.slice(1));
  }

  return filepath;
}

/**
 * Resolves the PGlite directory with proper fallbacks
 */
export function resolvePgliteDir(dir?: string, fallbackDir?: string): string {
  // If explicit directory provided and not empty, use it
  if (dir && dir.trim()) {
    return expandTildePath(dir);
  }

  // Try environment variable
  const envFile = '.env';
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
  }

  const envDir = process.env.PGLITE_DIR;
  if (envDir) {
    return expandTildePath(envDir);
  }

  // Use fallback directory if provided
  if (fallbackDir) {
    return expandTildePath(fallbackDir);
  }

  // Default fallback
  return expandTildePath('~/eliza/data');
}
