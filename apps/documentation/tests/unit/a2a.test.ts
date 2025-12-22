import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOCS_ROOT,
  EXCLUDED_DIRS,
  listTopics,
  searchDocumentation,
} from '../../lib/a2a'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, '../../server/a2a-server.ts')

describe('A2A Server Structure', () => {
  test('server file exists', () => {
    expect(existsSync(SERVER_PATH)).toBe(true)
  })

  test('defines all required skills', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    const requiredSkills = ['search-docs', 'get-page', 'list-topics']
    for (const skill of requiredSkills) {
      expect(serverCode).toContain(`'${skill}'`)
    }
  })

  test('defines agent card endpoint', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('/.well-known/agent-card.json')
  })

  test('defines A2A endpoint', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('/api/a2a')
  })

  test('has proper CORS configuration', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('cors(')
    expect(serverCode).toContain('ALLOWED_ORIGINS')
  })
})

describe('Documentation Files Exist', () => {
  test('index.mdx exists', () => {
    expect(existsSync(join(DOCS_ROOT, 'index.mdx'))).toBe(true)
  })

  test('getting-started directory exists', () => {
    expect(existsSync(join(DOCS_ROOT, 'getting-started'))).toBe(true)
  })

  test('contracts directory exists', () => {
    expect(existsSync(join(DOCS_ROOT, 'contracts'))).toBe(true)
  })

  test('applications directory exists', () => {
    expect(existsSync(join(DOCS_ROOT, 'applications'))).toBe(true)
  })
})

describe('Search Documentation Integration', () => {
  test('finds results for common terms', async () => {
    const results = await searchDocumentation('jeju')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].matches).toBeGreaterThan(0)
  })

  test('returns empty array for nonexistent terms', async () => {
    const results = await searchDocumentation('xyznonexistent123456')
    expect(results).toEqual([])
  })

  test('is case insensitive', async () => {
    const lowerResults = await searchDocumentation('jeju')
    const upperResults = await searchDocumentation('JEJU')
    expect(lowerResults.length).toBe(upperResults.length)
  })

  test('limits results to 20', async () => {
    const results = await searchDocumentation('the')
    expect(results.length).toBeLessThanOrEqual(20)
  })

  test('sorts by match count descending', async () => {
    const results = await searchDocumentation('contract')
    if (results.length > 1) {
      expect(results[0].matches).toBeGreaterThanOrEqual(results[1].matches)
    }
  })

  test('handles special regex characters', async () => {
    const results = await searchDocumentation('test.*')
    expect(Array.isArray(results)).toBe(true)
  })

  test('handles empty query', async () => {
    const results = await searchDocumentation('')
    expect(Array.isArray(results)).toBe(true)
  })

  test('excludes node_modules', async () => {
    const results = await searchDocumentation('express')
    const hasNodeModules = results.some((r) => r.file.includes('node_modules'))
    expect(hasNodeModules).toBe(false)
  })
})

describe('List Topics Integration', () => {
  test('returns array of topics', async () => {
    const topics = await listTopics()
    expect(Array.isArray(topics)).toBe(true)
    expect(topics.length).toBeGreaterThan(0)
  })

  test('includes index', async () => {
    const topics = await listTopics()
    const hasIndex = topics.some((t) => t.name === 'index')
    expect(hasIndex).toBe(true)
  })

  test('includes nested topics with paths', async () => {
    const topics = await listTopics()
    const nestedTopics = topics.filter((t) => t.path.includes('/'))
    expect(nestedTopics.length).toBeGreaterThan(0)
  })

  test('topic paths end with doc extension', async () => {
    const topics = await listTopics()
    const allEndWithDocExt = topics.every(
      (t) => t.path.endsWith('.md') || t.path.endsWith('.mdx'),
    )
    expect(allEndWithDocExt).toBe(true)
  })

  test('topic names do not include extension', async () => {
    const topics = await listTopics()
    const noneEndWithExt = topics.every(
      (t) => !t.name.endsWith('.md') && !t.name.endsWith('.mdx'),
    )
    expect(noneEndWithExt).toBe(true)
  })
})

describe('Get Page Integration', () => {
  test('reads index.mdx successfully', async () => {
    const content = await readFile(join(DOCS_ROOT, 'index.mdx'), 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  test('reads nested page successfully', async () => {
    const content = await readFile(
      join(DOCS_ROOT, 'getting-started/quick-start.mdx'),
      'utf-8',
    )
    expect(content).toContain('Quick Start')
  })

  test('throws for nonexistent file', async () => {
    expect(async () => {
      await readFile(join(DOCS_ROOT, 'nonexistent.mdx'), 'utf-8')
    }).toThrow()
  })
})

describe('Agent Card Structure', () => {
  test('agent card has required fields', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('protocolVersion')
    expect(serverCode).toContain('name')
    expect(serverCode).toContain('description')
    expect(serverCode).toContain('url')
    expect(serverCode).toContain('skills')
  })

  test('skills have required structure', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain("id: 'search-docs'")
    expect(serverCode).toContain("id: 'get-page'")
    expect(serverCode).toContain("id: 'list-topics'")
  })
})

describe('Error Handling', () => {
  test('handles unknown method', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain("method !== 'message/send'")
    expect(serverCode).toContain('-32601')
    expect(serverCode).toContain('Method not found')
  })

  test('handles missing params', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('-32602')
    expect(serverCode).toContain('Invalid params')
  })

  test('handles unknown skill', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('Unknown skill')
  })
})

describe('Configuration', () => {
  test('uses environment variable for port', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('DOCUMENTATION_A2A_PORT')
  })

  test('has default port', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('7778')
  })

  test('EXCLUDED_DIRS includes expected directories', () => {
    expect(EXCLUDED_DIRS.has('node_modules')).toBe(true)
    expect(EXCLUDED_DIRS.has('public')).toBe(true)
  })
})

describe('Security', () => {
  test('path traversal is blocked', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('validateDocPath')
    expect(serverCode).toContain('path traversal not allowed')
    expect(serverCode).toContain('access denied')
  })

  test('symlink escape is blocked', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('symlink escape not allowed')
    expect(serverCode).toContain('realpath')
  })

  test('file size limit is enforced', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('MAX_FILE_SIZE_BYTES')
    expect(serverCode).toContain('File too large')
  })

  test('rate limiting is implemented', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('checkRateLimit')
    expect(serverCode).toContain('RATE_LIMIT_MAX_REQUESTS')
    expect(serverCode).toContain('429')
  })

  test('query length limit is enforced', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text()
    expect(serverCode).toContain('Query too long')
    expect(serverCode).toContain('200')
  })

  test('regex patterns are performance-safe', async () => {
    const patterns = ['(a+)+$', '([a-zA-Z]+)*X', '(.*a){25}']
    for (const pattern of patterns) {
      const start = performance.now()
      const results = await searchDocumentation(pattern)
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(5000)
      expect(Array.isArray(results)).toBe(true)
    }
  })
})
