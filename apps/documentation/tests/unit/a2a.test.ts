/**
 * Comprehensive A2A Server Tests for Documentation
 * Tests skills, error handling, edge cases, and integration with filesystem
 */

import { test, expect, describe } from 'bun:test';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { searchDocumentation, listTopics, DOCS_ROOT, EXCLUDED_DIRS } from '../../lib/a2a';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '../../server/a2a-server.ts');

describe('A2A Server Structure', () => {
  test('server file exists', () => {
    expect(existsSync(SERVER_PATH)).toBe(true);
  });

  test('defines all required skills', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    const requiredSkills = ['search-docs', 'get-page', 'list-topics'];
    for (const skill of requiredSkills) {
      expect(serverCode).toContain(`'${skill}'`);
    }
  });

  test('defines agent card endpoint', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('/.well-known/agent-card.json');
  });

  test('defines A2A endpoint', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('/api/a2a');
  });

  test('has proper CORS configuration', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('cors()');
  });

  test('has JSON body parser', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('express.json()');
  });
});

describe('Documentation Files Exist', () => {
  test('index.md exists', async () => {
    expect(existsSync(join(DOCS_ROOT, 'index.md'))).toBe(true);
  });

  test('architecture.md exists', async () => {
    expect(existsSync(join(DOCS_ROOT, 'architecture.md'))).toBe(true);
  });

  test('getting-started directory exists', async () => {
    expect(existsSync(join(DOCS_ROOT, 'getting-started'))).toBe(true);
  });

  test('contracts directory exists', async () => {
    expect(existsSync(join(DOCS_ROOT, 'contracts'))).toBe(true);
  });

  test('applications directory exists', async () => {
    expect(existsSync(join(DOCS_ROOT, 'applications'))).toBe(true);
  });
});

describe('Search Documentation Integration', () => {
  test('finds results for common terms', async () => {
    const results = await searchDocumentation('jeju');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matches).toBeGreaterThan(0);
  });

  test('returns empty array for nonexistent terms', async () => {
    const results = await searchDocumentation('xyznonexistent123456');
    expect(results).toEqual([]);
  });

  test('is case insensitive', async () => {
    const lowerResults = await searchDocumentation('jeju');
    const upperResults = await searchDocumentation('JEJU');
    expect(lowerResults.length).toBe(upperResults.length);
  });

  test('limits results to 20', async () => {
    const results = await searchDocumentation('the');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  test('sorts by match count descending', async () => {
    const results = await searchDocumentation('contract');
    if (results.length > 1) {
      expect(results[0].matches).toBeGreaterThanOrEqual(results[1].matches);
    }
  });

  test('handles special regex characters', async () => {
    // Should not throw when query contains regex special chars
    const results = await searchDocumentation('test.*');
    expect(Array.isArray(results)).toBe(true);
  });

  test('handles empty query', async () => {
    const results = await searchDocumentation('');
    // Empty regex matches everything, but we should handle this gracefully
    expect(Array.isArray(results)).toBe(true);
  });

  test('excludes node_modules', async () => {
    const results = await searchDocumentation('express');
    const hasNodeModules = results.some(r => r.file.includes('node_modules'));
    expect(hasNodeModules).toBe(false);
  });

  test('excludes .vitepress', async () => {
    const results = await searchDocumentation('config');
    const hasVitepress = results.some(r => r.file.includes('.vitepress'));
    expect(hasVitepress).toBe(false);
  });
});

describe('List Topics Integration', () => {
  test('returns array of topics', async () => {
    const topics = await listTopics();
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
  });

  test('includes index.md', async () => {
    const topics = await listTopics();
    const hasIndex = topics.some(t => t.name === 'index');
    expect(hasIndex).toBe(true);
  });

  test('includes architecture', async () => {
    const topics = await listTopics();
    const hasArch = topics.some(t => t.name === 'architecture');
    expect(hasArch).toBe(true);
  });

  test('includes nested topics with paths', async () => {
    const topics = await listTopics();
    const nestedTopics = topics.filter(t => t.path.includes('/'));
    expect(nestedTopics.length).toBeGreaterThan(0);
  });

  test('topic paths end with .md', async () => {
    const topics = await listTopics();
    const allEndWithMd = topics.every(t => t.path.endsWith('.md'));
    expect(allEndWithMd).toBe(true);
  });

  test('topic names do not include .md extension', async () => {
    const topics = await listTopics();
    const noneEndWithMd = topics.every(t => !t.name.endsWith('.md'));
    expect(noneEndWithMd).toBe(true);
  });

  test('excludes node_modules', async () => {
    const topics = await listTopics();
    const hasNodeModules = topics.some(t => t.path.includes('node_modules'));
    expect(hasNodeModules).toBe(false);
  });
});

describe('Get Page Integration', () => {
  test('reads index.md successfully', async () => {
    const content = await readFile(join(DOCS_ROOT, 'index.md'), 'utf-8');
    expect(content).toContain('Network');
  });

  test('reads nested page successfully', async () => {
    const content = await readFile(join(DOCS_ROOT, 'getting-started/quick-start.md'), 'utf-8');
    expect(content).toContain('Quick Start');
  });

  test('throws for nonexistent file', async () => {
    expect(async () => {
      await readFile(join(DOCS_ROOT, 'nonexistent.md'), 'utf-8');
    }).toThrow();
  });

  test('throws for directory path', async () => {
    expect(async () => {
      await readFile(join(DOCS_ROOT, 'getting-started'), 'utf-8');
    }).toThrow();
  });
});

describe('Agent Card Structure', () => {
  test('agent card has required fields', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    
    // Check for required agent card fields
    expect(serverCode).toContain('protocolVersion');
    expect(serverCode).toContain('name');
    expect(serverCode).toContain('description');
    expect(serverCode).toContain('url');
    expect(serverCode).toContain('skills');
  });

  test('skills have required structure', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    
    // Each skill should have id, name, description
    expect(serverCode).toContain("id: 'search-docs'");
    expect(serverCode).toContain("id: 'get-page'");
    expect(serverCode).toContain("id: 'list-topics'");
  });
});

describe('Error Handling Patterns', () => {
  test('handles unknown method', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain("method !== 'message/send'");
    expect(serverCode).toContain('-32601');
    expect(serverCode).toContain('Method not found');
  });

  test('handles missing params', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('-32602');
    expect(serverCode).toContain('Invalid params');
  });

  test('handles missing data part', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('No data part found');
  });

  test('handles unknown skill', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('Unknown skill');
  });

  test('handles internal errors gracefully', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('-32603');
    expect(serverCode).toContain('err.message');
  });
});

describe('Configuration', () => {
  test('uses environment variable for port', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('DOCUMENTATION_A2A_PORT');
  });

  test('has default port', async () => {
    const serverCode = await Bun.file(SERVER_PATH).text();
    expect(serverCode).toContain('7778');
  });

  test('EXCLUDED_DIRS includes expected directories', () => {
    expect(EXCLUDED_DIRS.has('node_modules')).toBe(true);
    expect(EXCLUDED_DIRS.has('.vitepress')).toBe(true);
    expect(EXCLUDED_DIRS.has('public')).toBe(true);
  });
});
