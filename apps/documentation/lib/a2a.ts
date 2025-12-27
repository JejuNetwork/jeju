/**
 * Documentation A2A utilities - serverless-compatible
 *
 * Uses a pre-built documentation index generated at build time.
 * Run `bun run build:docs-index` to generate the index.
 *
 * NOTE: This module is worker-compatible - no node:path/fs imports.
 * DOCS_ROOT is only for build scripts and tests (they import it from build-index.ts).
 */

export const EXCLUDED_DIRS = new Set(['node_modules', 'public', 'components'])
const MAX_SEARCH_RESULTS = 20

export interface SearchResult {
  file: string
  matches: number
}

export interface Topic {
  name: string
  path: string
}

/** Pre-built documentation index structure */
export interface DocIndex {
  topics: Topic[]
  /** Map of file path to content for searching */
  content: Record<string, string>
  /** Build timestamp */
  buildTime: number
}

/** Try to import pre-built documentation index */
let docIndex: DocIndex | null = null

async function loadDocIndex(): Promise<DocIndex | null> {
  if (docIndex) return docIndex

  try {
    // Try to import the pre-built index (generated at build time)
    const indexModule = await import('../docs-index.json')
    docIndex = indexModule.default as DocIndex
    return docIndex
  } catch {
    console.warn(
      '[Documentation] No pre-built docs-index.json found. Run "bun run build:docs-index" to generate.',
    )
    return null
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Search documentation using pre-built index
 */
export async function searchDocumentation(
  query: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const safeQuery = escapeRegex(query)
  if (!safeQuery) return results

  const index = await loadDocIndex()
  if (!index) {
    console.warn('[Documentation] Search unavailable - no index loaded')
    return results
  }

  const regex = new RegExp(safeQuery, 'gi')

  for (const [filePath, content] of Object.entries(index.content)) {
    const matches = (content.match(regex) ?? []).length
    if (matches > 0) {
      results.push({ file: filePath, matches })
    }
  }

  return results
    .sort((a, b) => b.matches - a.matches)
    .slice(0, MAX_SEARCH_RESULTS)
}

/**
 * List documentation topics using pre-built index
 */
export async function listTopics(): Promise<Topic[]> {
  const index = await loadDocIndex()
  if (!index) {
    console.warn('[Documentation] Topics unavailable - no index loaded')
    return []
  }

  return index.topics
}

/**
 * Get documentation page content from pre-built index
 */
export async function getPageContent(pagePath: string): Promise<string | null> {
  const index = await loadDocIndex()
  if (!index) {
    console.warn('[Documentation] Page content unavailable - no index loaded')
    return null
  }

  return index.content[pagePath] ?? null
}
