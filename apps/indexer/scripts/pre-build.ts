/**
 * Pre-build fixes for squid-generated TypeScript models.
 * Removes unused imports that would cause TS6133 errors.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const indexerRoot = join(import.meta.dir, '..')

// Remove unused Column_ import from generated models
// squid generates "Column as Column_" but uses typed columns like StringColumn_, IntColumn_, etc.
function fixUnusedColumnImports(): number {
  const modelDirs = [
    join(indexerRoot, 'src/model/generated'),
    join(indexerRoot, 'api/model/generated'),
  ]

  let fixed = 0

  for (const modelDir of modelDirs) {
    if (!existsSync(modelDir)) continue

    for (const file of readdirSync(modelDir).filter((f) =>
      f.endsWith('.model.ts'),
    )) {
      const filePath = join(modelDir, file)
      const content = readFileSync(filePath, 'utf-8')

      // Check if Column_ is in the import
      if (!content.includes('Column as Column_')) continue

      // Check if @Column_( is actually used (the decorator)
      // Note: StringColumn_, IntColumn_ etc. all contain "Column_" but are different imports
      const hasDirectColumnUsage = content.includes('@Column_(')

      if (!hasDirectColumnUsage) {
        // Column_ is imported but @Column_() decorator is never used - remove it
        const newContent = content
          .replace(/, Column as Column_/g, '')
          .replace(/Column as Column_, /g, '')

        if (newContent !== content) {
          writeFileSync(filePath, newContent)
          fixed++
        }
      }
    }
  }
  return fixed
}

const unusedImports = fixUnusedColumnImports()
console.log(`[pre-build] Removed ${unusedImports} unused Column_ imports`)
