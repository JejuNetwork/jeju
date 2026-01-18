/**
 * Build utilities for documentation
 *
 * This module provides file system utilities for build scripts and tests.
 * NOT compatible with serverless/worker environments - use a2a.ts instead.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Root directory for documentation source files */
export const DOCS_ROOT = join(__dirname, '..', 'docs', 'pages')
