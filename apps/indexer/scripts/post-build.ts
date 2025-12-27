/**
 * Post-build fixes for TypeORM + ESM compatibility.
 * Consolidates all workarounds for squid/TypeORM/ESM issues into one script.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const indexerRoot = join(import.meta.dir, '..')

// 1. Fix circular imports in compiled models (TypeORM decorator metadata issue)
function fixCircularImports(): number {
  const modelDirs = [
    join(indexerRoot, 'lib/model/generated'),
    join(indexerRoot, 'lib/src/model/generated'),
    join(indexerRoot, 'lib/api/model/generated'),
  ]

  const primitives = [
    'String',
    'Number',
    'Boolean',
    'Date',
    'Object',
    'Function',
    'Array',
    'BigInt',
  ]
  let fixed = 0

  for (const modelDir of modelDirs) {
    if (!existsSync(modelDir)) continue

    for (const file of readdirSync(modelDir).filter((f) =>
      f.endsWith('.model.js'),
    )) {
      const filePath = join(modelDir, file)
      let content = readFileSync(filePath, 'utf-8')
      let modified = false

      content = content.replace(
        /__metadata\("design:type", ([A-Z][A-Za-z0-9_]*)\)/g,
        (match, className) => {
          if (primitives.includes(className)) return match
          modified = true
          return '__metadata("design:type", Function)'
        },
      )

      if (modified) {
        writeFileSync(filePath, content)
        fixed++
      }
    }
  }
  return fixed
}

// 2. Fix ESM imports (add .js extensions for Node ESM compatibility)
function fixEsmImports(): number {
  const modelDirs = [
    join(indexerRoot, 'lib/src/model/generated'),
    join(indexerRoot, 'lib/api/model/generated'),
  ]

  let fixed = 0
  for (const modelDir of modelDirs) {
    if (!existsSync(modelDir)) continue
    fixed += fixEsmImportsInDir(modelDir)
  }
  return fixed
}

function fixEsmImportsInDir(modelDir: string): number {
  if (!existsSync(modelDir)) return 0

  let fixed = 0
  for (const file of readdirSync(modelDir).filter((f) => f.endsWith('.js'))) {
    const filePath = join(modelDir, file)
    const content = readFileSync(filePath, 'utf-8')

    const newContent = content
      .replace(/from ["'](\.[^"']+)["']/g, (match, path) =>
        path.endsWith('.js') || path.endsWith('.json')
          ? match
          : `from "${path}.js"`,
      )
      .replace(/export \* from ["'](\.[^"']+)["']/g, (match, path) =>
        path.endsWith('.js') || path.endsWith('.json')
          ? match
          : `export * from "${path}.js"`,
      )

    if (newContent !== content) {
      writeFileSync(filePath, newContent)
      fixed++
    }
  }
  return fixed
}

// 3. Fix migration files (CommonJS -> ESM)
function fixMigrations(): number {
  const migrationsDir = join(indexerRoot, 'db/migrations')
  if (!existsSync(migrationsDir)) return 0

  let fixed = 0
  for (const file of readdirSync(migrationsDir).filter((f) =>
    f.endsWith('.js'),
  )) {
    const filePath = join(migrationsDir, file)
    let content = readFileSync(filePath, 'utf-8')

    if (content.startsWith('module.exports = ')) {
      content = content.replace(/^module\.exports = /, 'export default ')
      writeFileSync(filePath, content)
      fixed++
    }
  }
  return fixed
}

// Run all fixes
const circular = fixCircularImports()
const esm = fixEsmImports()
const migrations = fixMigrations()

console.log(
  `[post-build] Fixed ${circular} circular imports, ${esm} ESM imports, ${migrations} migrations`,
)
