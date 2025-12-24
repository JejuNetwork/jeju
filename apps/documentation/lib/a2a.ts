import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DOCS_ROOT = path.join(__dirname, '..', 'docs', 'pages')
export const EXCLUDED_DIRS = new Set(['node_modules', 'public', 'components'])
const MAX_SEARCH_RESULTS = 20
const MAX_DIRECTORY_DEPTH = 10
const MAX_FILES_PER_SEARCH = 1000
const DOC_EXTENSIONS = ['.md', '.mdx']

export interface SearchResult {
  file: string
  matches: number
}

export interface Topic {
  name: string
  path: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function searchDocumentation(
  query: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const safeQuery = escapeRegex(query)
  if (!safeQuery) return results
  const regex = new RegExp(safeQuery, 'gi')
  let filesProcessed = 0

  async function searchDir(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) return
    if (filesProcessed >= MAX_FILES_PER_SEARCH) return

    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (filesProcessed >= MAX_FILES_PER_SEARCH) return

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await searchDir(fullPath, depth + 1)
      } else if (
        entry.isFile() &&
        DOC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ) {
        filesProcessed++
        const content = await readFile(fullPath, 'utf-8')
        const matches = (content.match(regex) || []).length
        if (matches > 0) {
          results.push({ file: path.relative(DOCS_ROOT, fullPath), matches })
        }
      }
    }
  }

  await searchDir(DOCS_ROOT, 0)
  return results
    .sort((a, b) => b.matches - a.matches)
    .slice(0, MAX_SEARCH_RESULTS)
}

export async function listTopics(): Promise<Topic[]> {
  const topics: Topic[] = []
  let filesProcessed = 0

  async function scanDir(
    dir: string,
    prefix: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) return
    if (filesProcessed >= MAX_FILES_PER_SEARCH) return

    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (filesProcessed >= MAX_FILES_PER_SEARCH) return

      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await scanDir(
          path.join(dir, entry.name),
          `${prefix}${entry.name}/`,
          depth + 1,
        )
      } else if (
        entry.isFile() &&
        DOC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ) {
        filesProcessed++
        const ext = DOC_EXTENSIONS.find((e) => entry.name.endsWith(e)) ?? ''
        topics.push({
          name: entry.name.replace(ext, ''),
          path: prefix + entry.name,
        })
      }
    }
  }

  await scanDir(DOCS_ROOT, '', 0)
  return topics
}
