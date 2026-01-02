/**
 * Script to generate SQLit schema DDL from TypeORM model files
 *
 * Analyzes all .model.ts files in src/model/generated/
 * and generates CREATE TABLE statements for each entity
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MODELS_DIR = join(__dirname, '../src/model/generated')

// TypeORM decorator to SQLite type mapping
const _TYPE_MAP: Record<string, string> = {
  PrimaryColumn: 'TEXT PRIMARY KEY',
  StringColumn: 'TEXT',
  IntColumn: 'INTEGER',
  BigIntColumn: 'TEXT', // Store bigint as TEXT for precision
  BooleanColumn: 'INTEGER', // SQLite uses 0/1 for boolean
  DateTimeColumn: 'TEXT', // ISO 8601 string
  BytesColumn: 'BLOB',
  JSONColumn: 'TEXT',
  Column: 'TEXT', // Default for varchar columns
}

interface Column {
  name: string
  type: string
  nullable: boolean
  isFk: boolean
  isPrimary: boolean
  isUnique: boolean
  isIndex: boolean
  isArray: boolean
}

interface Model {
  name: string
  tableName: string
  columns: Column[]
  fkColumns: string[]
  skipColumns: string[]
}

// Convert camelCase to snake_case
function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

// Parse a model file and extract column info
async function parseModelFile(filepath: string): Promise<Model | null> {
  const content = await readFile(filepath, 'utf-8')

  // Extract class name
  const classMatch = content.match(/export class (\w+)/)
  if (!classMatch) return null

  const className = classMatch[1]
  const tableName = toSnakeCase(className)

  const columns: Column[] = []
  const fkColumns: string[] = []
  const skipColumns: string[] = []

  // Find all property definitions with decorators
  const lines = content.split('\n')

  let currentDecorators: string[] = []
  let isIndex = false
  let isUnique = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Track decorators
    if (trimmed.startsWith('@')) {
      currentDecorators.push(trimmed)
      if (trimmed.includes('@Index_')) {
        isIndex = true
        if (
          trimmed.includes('unique: true') ||
          trimmed.includes('{unique: true}')
        ) {
          isUnique = true
        }
      }
      continue
    }

    // Check for property definition
    const propMatch = trimmed.match(/^(\w+)!?:\s*(.+)$/)
    if (propMatch && currentDecorators.length > 0) {
      const [, propName, propType] = propMatch

      // Skip constructor and private properties
      if (propName === 'constructor' || propName.startsWith('_')) {
        currentDecorators = []
        isIndex = false
        isUnique = false
        continue
      }

      // Check for ManyToOne (FK)
      const isManyToOne = currentDecorators.some((d) =>
        d.includes('@ManyToOne_'),
      )

      // Check for OneToMany (skip column)
      const isOneToMany = currentDecorators.some((d) =>
        d.includes('@OneToMany_'),
      )

      if (isOneToMany) {
        skipColumns.push(propName)
        currentDecorators = []
        isIndex = false
        isUnique = false
        continue
      }

      if (isManyToOne) {
        fkColumns.push(propName)
      }

      // Determine column type
      let sqlType = 'TEXT'
      let nullable = propType.includes('undefined') || propType.includes('null')
      let isPrimary = false
      const isArray = propType.includes('[]')

      for (const decorator of currentDecorators) {
        if (decorator.includes('PrimaryColumn_')) {
          isPrimary = true
          sqlType = 'TEXT PRIMARY KEY'
        } else if (decorator.includes('StringColumn_')) {
          sqlType = 'TEXT'
        } else if (decorator.includes('IntColumn_')) {
          sqlType = 'INTEGER'
        } else if (decorator.includes('BigIntColumn_')) {
          sqlType = 'TEXT' // BigInt as text for precision
        } else if (decorator.includes('BooleanColumn_')) {
          sqlType = 'INTEGER'
        } else if (decorator.includes('DateTimeColumn_')) {
          sqlType = 'TEXT'
        } else if (decorator.includes('BytesColumn_')) {
          sqlType = 'BLOB'
        } else if (decorator.includes('JSONColumn_')) {
          sqlType = 'TEXT'
        } else if (decorator.includes('Column_("varchar"')) {
          sqlType = 'TEXT' // Enum stored as text
        }

        // Check nullable from decorator
        if (
          decorator.includes('nullable: true') ||
          decorator.includes('nullable:true')
        ) {
          nullable = true
        } else if (
          decorator.includes('nullable: false') ||
          decorator.includes('nullable:false')
        ) {
          nullable = false
        }
      }

      // For FK columns, use the snake_case name + _id
      const columnName = isManyToOne
        ? `${toSnakeCase(propName)}_id`
        : toSnakeCase(propName)

      // Arrays are stored as JSON text
      if (isArray && !isManyToOne) {
        sqlType = 'TEXT'
      }

      columns.push({
        name: columnName,
        type: isPrimary ? 'TEXT PRIMARY KEY' : sqlType,
        nullable,
        isFk: isManyToOne,
        isPrimary,
        isUnique,
        isIndex,
        isArray,
      })

      currentDecorators = []
      isIndex = false
      isUnique = false
    }
  }

  return { name: className, tableName, columns, fkColumns, skipColumns }
}

// Generate DDL for a model
function generateDDL(model: Model): string {
  const columnDefs = model.columns.map((col) => {
    let def = `    ${col.name} ${col.type}`
    if (!col.isPrimary && !col.nullable) {
      def += ' NOT NULL'
    }
    return def
  })

  // Quote reserved words
  const reservedWords = [
    'transaction',
    'log',
    'trace',
    'order',
    'group',
    'index',
    'key',
    'constraint',
  ]
  const tableName = reservedWords.includes(model.tableName)
    ? `"${model.tableName}"`
    : model.tableName

  return `  \`CREATE TABLE IF NOT EXISTS ${tableName} (
${columnDefs.join(',\n')}
  )\`,`
}

// Generate indexes for a model
function generateIndexes(model: Model): string[] {
  const indexes: string[] = []

  for (const col of model.columns) {
    if (col.isIndex && !col.isPrimary) {
      const indexName = `idx_${model.tableName}_${col.name}`
      const tableName = ['transaction', 'log', 'trace'].includes(
        model.tableName,
      )
        ? `"${model.tableName}"`
        : model.tableName

      if (col.isUnique) {
        indexes.push(
          `  'CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${col.name})',`,
        )
      } else {
        indexes.push(
          `  'CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${col.name})',`,
        )
      }
    }
  }

  return indexes
}

async function main() {
  const files = await readdir(MODELS_DIR)
  const modelFiles = files.filter((f) => f.endsWith('.model.ts'))

  console.log(`Found ${modelFiles.length} model files\n`)

  const models: Model[] = []
  const allDDL: string[] = []
  const allIndexes: string[] = []
  const fkMapping: Record<string, string[]> = {}
  const skipMapping: Record<string, string[]> = {}

  for (const file of modelFiles) {
    const model = await parseModelFile(join(MODELS_DIR, file))
    if (model && model.columns.length > 0) {
      models.push(model)
      allDDL.push(generateDDL(model))
      allIndexes.push(...generateIndexes(model))

      if (model.fkColumns.length > 0) {
        fkMapping[model.tableName] = model.fkColumns
      }
      if (model.skipColumns.length > 0) {
        skipMapping[model.tableName] = model.skipColumns
      }
    }
  }

  // Sort models alphabetically
  models.sort((a, b) => a.tableName.localeCompare(b.tableName))

  console.log('=== SCHEMA_DDL ===')
  console.log('export const SCHEMA_DDL = [')
  for (const model of models.sort((a, b) =>
    a.tableName.localeCompare(b.tableName),
  )) {
    console.log(generateDDL(model))
    console.log('')
  }
  console.log(']')

  console.log('\n=== INDEX_DDL ===')
  console.log('export const INDEX_DDL = [')
  for (const idx of allIndexes.sort()) {
    console.log(idx)
  }
  console.log(']')

  console.log('\n=== KNOWN_FK_COLUMNS ===')
  console.log('const KNOWN_FK_COLUMNS: Record<string, string[]> = {')
  for (const [table, fks] of Object.entries(fkMapping).sort()) {
    console.log(`  ${table}: [${fks.map((f) => `'${f}'`).join(', ')}],`)
  }
  console.log('}')

  console.log('\n=== KNOWN_SKIP_COLUMNS ===')
  console.log('const KNOWN_SKIP_COLUMNS: Record<string, string[]> = {')
  for (const [table, skips] of Object.entries(skipMapping).sort()) {
    console.log(`  ${table}: [${skips.map((s) => `'${s}'`).join(', ')}],`)
  }
  console.log('}')

  console.log(
    `\n\nTotal: ${models.length} tables, ${allIndexes.length} indexes`,
  )
}

main().catch(console.error)
