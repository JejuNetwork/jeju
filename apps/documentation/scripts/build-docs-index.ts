/**
 * Build script for documentation index
 *
 * Generates docs-index.json for the A2A server to use
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DOCS_ROOT } from '../lib/build-utils'
import type { DocIndex, Topic } from '../lib/a2a'

const EXCLUDED_DIRS = new Set(['node_modules', 'public', 'components'])

async function collectDocs(
  dir: string,
  baseDir: string = dir,
): Promise<{ topics: Topic[]; content: Record<string, string> }> {
  const topics: Topic[] = []
  const content: Record<string, string> = {}

  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relativePath = fullPath.replace(baseDir + '/', '')

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        const subResults = await collectDocs(fullPath, baseDir)
        topics.push(...subResults.topics)
        Object.assign(content, subResults.content)
      }
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const fileContent = await readFile(fullPath, 'utf-8')
      const name = entry.name.replace(/\.(md|mdx)$/, '')
      topics.push({ name, path: relativePath })
      content[relativePath] = fileContent
    }
  }

  return { topics, content }
}

async function main() {
  console.log('Building documentation index...')
  console.log('DOCS_ROOT:', DOCS_ROOT)

  const { topics, content } = await collectDocs(DOCS_ROOT)

  const index: DocIndex = {
    topics,
    content,
    buildTime: Date.now(),
  }

  const outputPath = join(import.meta.dir, '..', 'docs-index.json')
  await writeFile(outputPath, JSON.stringify(index, null, 2))

  console.log(`Built docs-index.json with ${topics.length} topics`)
}

main().catch(console.error)

