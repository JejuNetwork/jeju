/**
 * Build-time utilities for documentation
 *
 * NOTE: This file uses node:path and is NOT worker-compatible.
 * Only import this in build scripts and tests, not in serverless functions.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Root directory for documentation pages - only for build/test use */
export const DOCS_ROOT = join(__dirname, '..', 'docs', 'pages')
