/**
 * A2A Documentation Search Functions
 * Shared utilities for searching and listing documentation
 */

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOCS_ROOT = path.join(__dirname, '..');
export const EXCLUDED_DIRS = new Set(['node_modules', '.vitepress', 'public', 'api', 'tests', 'server', 'lib']);
const MAX_SEARCH_RESULTS = 20;

export interface SearchResult {
  file: string;
  matches: number;
}

export interface Topic {
  name: string;
  path: string;
}

export async function searchDocumentation(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const regex = new RegExp(query, 'gi');

  async function searchDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await searchDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const matches = (content.match(regex) || []).length;
        if (matches > 0) {
          results.push({ file: path.relative(DOCS_ROOT, fullPath), matches });
        }
      }
    }
  }

  await searchDir(DOCS_ROOT);
  return results.sort((a, b) => b.matches - a.matches).slice(0, MAX_SEARCH_RESULTS);
}

export async function listTopics(): Promise<Topic[]> {
  const topics: Topic[] = [];

  async function scanDir(dir: string, prefix = ''): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        await scanDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        topics.push({ name: entry.name.replace('.md', ''), path: prefix + entry.name });
      }
    }
  }

  await scanDir(DOCS_ROOT);
  return topics;
}
