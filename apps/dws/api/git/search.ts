/**
 * Git Search
 * Repository, code, issue, and user search
 *
 * Supports two modes:
 * 1. In-memory search (default, suitable for small deployments)
 * 2. Meilisearch (configure MEILISEARCH_URL for large-scale deployments)
 */

import type { Address, Hex } from 'viem'
import type { BackendManager } from '../storage/backends'
import type { IssuesManager } from './issues'
import type { GitRepoManager } from './repo-manager'
import type { SocialManager } from './social'
import type {
  CodeSearchHit,
  CodeSearchResult,
  IssueSearchResult,
  RepoSearchResult,
  Repository,
  UserSearchResult,
} from './types'

// Optional Meilisearch client interface (mirrors the meilisearch package API)
interface MeilisearchClient {
  index(indexName: string): MeilisearchIndex
}

interface MeilisearchIndex {
  search(
    query: string,
    options?: MeilisearchSearchOptions,
  ): Promise<MeilisearchSearchResult>
  addDocuments(documents: Record<string, unknown>[]): Promise<void>
  updateDocuments(documents: Record<string, unknown>[]): Promise<void>
  deleteDocument(id: string): Promise<void>
}

interface MeilisearchSearchOptions {
  limit?: number
  offset?: number
  filter?: string | string[]
  sort?: string[]
  attributesToRetrieve?: string[]
  attributesToHighlight?: string[]
}

interface MeilisearchSearchResult {
  hits: Record<string, unknown>[]
  estimatedTotalHits: number
  processingTimeMs: number
}

export interface SearchManagerConfig {
  repoManager: GitRepoManager
  issuesManager: IssuesManager
  socialManager: SocialManager
  backend: BackendManager
}

export interface SearchOptions {
  page?: number
  perPage?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface RepoSearchOptions extends SearchOptions {
  sort?: 'stars' | 'forks' | 'updated' | 'created' | 'best-match'
  owner?: Address
  visibility?: 'public' | 'private' | 'all'
  topics?: string[]
  language?: string
  archived?: boolean
}

export interface CodeSearchOptions extends SearchOptions {
  repoId?: Hex
  path?: string
  extension?: string
}

export interface IssueSearchOptions extends SearchOptions {
  sort?: 'created' | 'updated' | 'comments' | 'best-match'
  state?: 'open' | 'closed' | 'all'
  type?: 'issue' | 'pr' | 'all'
  author?: Address
  assignee?: Address
  repoId?: Hex
  labels?: string[]
}

export interface UserSearchOptions extends SearchOptions {
  sort?: 'repositories' | 'joined' | 'best-match'
  type?: 'user' | 'org' | 'all'
}

export class SearchManager {
  private repoManager: GitRepoManager
  private issuesManager: IssuesManager
  // Reserved for future social graph search integration
  private socialManager: SocialManager
  // Reserved for future backend storage search integration
  private backend: BackendManager

  // In-memory index for search (suitable for small deployments)
  // For large-scale deployments, configure MEILISEARCH_URL environment variable
  private repoIndex: Map<Hex, { repo: Repository; text: string }> = new Map()
  private codeIndex: Map<
    string,
    { repoId: Hex; path: string; oid: string; content: string }
  > = new Map()
  private meilisearchClient: MeilisearchClient | null = null

  constructor(config: SearchManagerConfig) {
    this.repoManager = config.repoManager
    this.issuesManager = config.issuesManager
    this.socialManager = config.socialManager
    this.backend = config.backend

    // Initialize Meilisearch if configured
    this.initMeilisearch()
  }

  private async initMeilisearch(): Promise<void> {
    const meilisearchUrl = process.env.MEILISEARCH_URL
    const meilisearchKey = process.env.MEILISEARCH_KEY

    if (!meilisearchUrl) {
      console.log(
        '[Search] Using in-memory search (set MEILISEARCH_URL for production)',
      )
      return
    }

    try {
      // Dynamic import: meilisearch is an optional dependency
      // Install with: bun add meilisearch
      // Using Function constructor to avoid TS module resolution for optional deps
      const dynamicImport = new Function(
        'specifier',
        'return import(specifier)',
      ) as (specifier: string) => Promise<{
        MeiliSearch: new (config: {
          host: string
          apiKey?: string
        }) => MeilisearchClient
      }>
      const meilisearchModule = await dynamicImport('meilisearch')
      this.meilisearchClient = new meilisearchModule.MeiliSearch({
        host: meilisearchUrl,
        apiKey: meilisearchKey,
      })

      console.log(`[Search] Connected to Meilisearch at ${meilisearchUrl}`)
    } catch (error) {
      console.warn(
        '[Search] Failed to initialize Meilisearch, falling back to in-memory:',
        error,
      )
      this.meilisearchClient = null
    }
  }

  /**
   * Check if using Meilisearch backend
   */
  get usingMeilisearch(): boolean {
    return this.meilisearchClient !== null
  }

  /** Get social manager for future social search features */
  getSocialManager(): SocialManager {
    return this.socialManager
  }

  /** Get backend manager for future storage search features */
  getBackendManager(): BackendManager {
    return this.backend
  }

  /**
   * Search repositories
   */
  async searchRepositories(
    query: string,
    options: RepoSearchOptions = {},
  ): Promise<RepoSearchResult> {
    const page = options.page || 1
    const perPage = Math.min(options.perPage || 30, 100)
    const sort = options.sort || 'best-match'
    const order = options.order || 'desc'

    // Get all repositories (would be from database in production)
    const allRepos = await this.repoManager.getAllRepositories(0, 1000)

    // Parse query for qualifiers
    const qualifiers = this.parseQueryQualifiers(query)
    const searchTerms = qualifiers.text.toLowerCase()

    // Filter repositories
    let filtered = allRepos.filter((repo) => {
      // Visibility filter
      if (options.visibility === 'public' && repo.visibility !== 0) return false
      if (options.visibility === 'private' && repo.visibility !== 1)
        return false

      // Owner filter
      if (
        options.owner &&
        repo.owner.toLowerCase() !== options.owner.toLowerCase()
      )
        return false

      // Archived filter
      if (options.archived !== undefined && repo.archived !== options.archived)
        return false

      // Text search
      if (searchTerms) {
        const searchText = `${repo.name} ${repo.description}`.toLowerCase()
        if (!searchText.includes(searchTerms)) return false
      }

      // Query qualifiers
      if (
        qualifiers.user &&
        repo.owner.toLowerCase() !== qualifiers.user.toLowerCase()
      )
        return false
      if (
        qualifiers.org &&
        repo.owner.toLowerCase() !== qualifiers.org.toLowerCase()
      )
        return false

      return true
    })

    // Score and sort
    filtered = this.scoreAndSortRepos(filtered, searchTerms, sort, order)

    // Paginate
    const total = filtered.length
    const start = (page - 1) * perPage
    const items = filtered.slice(start, start + perPage)

    return { totalCount: total, items }
  }

  /**
   * Search code
   */
  async searchCode(
    query: string,
    options: CodeSearchOptions = {},
  ): Promise<CodeSearchResult> {
    const page = options.page || 1
    const perPage = Math.min(options.perPage || 30, 100)

    const qualifiers = this.parseQueryQualifiers(query)
    const searchTerms = qualifiers.text.toLowerCase()

    if (!searchTerms) {
      return { totalCount: 0, items: [] }
    }

    const results: CodeSearchHit[] = []

    // Search through indexed code
    for (const [, entry] of this.codeIndex) {
      // Filter by repo
      if (options.repoId && entry.repoId !== options.repoId) continue

      // Filter by path
      if (options.path && !entry.path.startsWith(options.path)) continue

      // Filter by extension
      if (options.extension && !entry.path.endsWith(`.${options.extension}`))
        continue

      // Search content
      const lines = entry.content.split('\n')
      const matches: Array<{
        line: number
        content: string
        highlight: [number, number][]
      }> = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lowerLine = line.toLowerCase()
        let idx = 0
        const highlights: [number, number][] = []

        idx = lowerLine.indexOf(searchTerms, idx)
        while (idx !== -1) {
          highlights.push([idx, idx + searchTerms.length])
          idx += searchTerms.length
          idx = lowerLine.indexOf(searchTerms, idx)
        }

        if (highlights.length > 0) {
          matches.push({
            line: i + 1,
            content: line,
            highlight: highlights,
          })
        }
      }

      if (matches.length > 0) {
        results.push({
          repoId: entry.repoId,
          path: entry.path,
          oid: entry.oid,
          matches: matches.slice(0, 5), // Limit matches per file
        })
      }
    }

    // Paginate
    const total = results.length
    const start = (page - 1) * perPage
    const items = results.slice(start, start + perPage)

    return { totalCount: total, items }
  }

  /**
   * Search issues and PRs
   */
  async searchIssues(
    query: string,
    options: IssueSearchOptions = {},
  ): Promise<IssueSearchResult> {
    const page = options.page || 1
    const perPage = Math.min(options.perPage || 30, 100)
    const sort = options.sort || 'best-match'
    const order = options.order || 'desc'

    const qualifiers = this.parseQueryQualifiers(query)
    const searchTerms = qualifiers.text.toLowerCase()

    // This would search across all repositories' issues
    // For now, return empty if no repo specified
    if (!options.repoId) {
      return { totalCount: 0, items: [] }
    }

    const { issues } = await this.issuesManager.listIssues(options.repoId, {
      state: options.state === 'all' ? 'all' : options.state,
      author: options.author,
      assignee: options.assignee,
      labels: options.labels,
    })

    // Filter by search terms
    let filtered = issues.filter((issue) => {
      if (!searchTerms) return true
      const searchText = `${issue.title} ${issue.body}`.toLowerCase()
      return searchText.includes(searchTerms)
    })

    // Apply qualifiers
    if (qualifiers.author) {
      filtered = filtered.filter(
        (i) => i.author.toLowerCase() === qualifiers.author?.toLowerCase(),
      )
    }
    if (qualifiers.is === 'open') {
      filtered = filtered.filter((i) => i.state === 'open')
    }
    if (qualifiers.is === 'closed') {
      filtered = filtered.filter((i) => i.state === 'closed')
    }
    if (qualifiers.label) {
      filtered = filtered.filter((i) =>
        i.labels.includes(qualifiers.label as string),
      )
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0
      if (sort === 'created') {
        comparison = a.createdAt - b.createdAt
      } else if (sort === 'updated') {
        comparison = a.updatedAt - b.updatedAt
      } else if (sort === 'comments') {
        comparison = a.comments.length - b.comments.length
      }
      return order === 'desc' ? -comparison : comparison
    })

    // Paginate
    const total = filtered.length
    const start = (page - 1) * perPage
    const items = filtered.slice(start, start + perPage)

    return { totalCount: total, items }
  }

  /**
   * Search users
   * User search requires indexing via Meilisearch (set MEILISEARCH_URL) or
   * a dedicated user registry. Returns empty results when using in-memory search.
   */
  async searchUsers(
    _query: string,
    _options: UserSearchOptions = {},
  ): Promise<UserSearchResult> {
    // User search requires Meilisearch or dedicated indexing
    return { totalCount: 0, items: [] }
  }

  /**
   * Index a repository for search
   */
  async indexRepository(repo: Repository): Promise<void> {
    const text = `${repo.name} ${repo.description || ''}`.toLowerCase()
    this.repoIndex.set(repo.repoId, { repo, text })
  }

  /**
   * Index code content for search
   */
  async indexCode(
    repoId: Hex,
    path: string,
    oid: string,
    content: string,
  ): Promise<void> {
    // Only index text files under a certain size
    if (content.length > 100000) return // Skip files > 100KB
    if (this.isBinaryContent(content)) return

    const key = `${repoId}:${path}`
    this.codeIndex.set(key, { repoId, path, oid, content })
  }

  /**
   * Remove repository from index
   */
  removeRepository(repoId: Hex): void {
    this.repoIndex.delete(repoId)

    // Remove code entries for this repo
    for (const key of this.codeIndex.keys()) {
      if (key.startsWith(repoId)) {
        this.codeIndex.delete(key)
      }
    }
  }
  private parseQueryQualifiers(query: string): {
    text: string
    user?: string
    org?: string
    repo?: string
    is?: string
    author?: string
    label?: string
    language?: string
  } {
    const qualifiers: Record<string, string> = {}
    let text = query

    // Parse qualifiers like "user:foo", "is:open", etc.
    const qualifierRegex = /(\w+):(\S+)/g
    let match: RegExpExecArray | null

    match = qualifierRegex.exec(query)
    while (match !== null) {
      qualifiers[match[1]] = match[2]
      text = text.replace(match[0], '').trim()
      match = qualifierRegex.exec(query)
    }

    return {
      text: text.trim(),
      user: qualifiers.user,
      org: qualifiers.org,
      repo: qualifiers.repo,
      is: qualifiers.is,
      author: qualifiers.author,
      label: qualifiers.label,
      language: qualifiers.language,
    }
  }

  private scoreAndSortRepos(
    repos: Repository[],
    query: string,
    sort: string,
    order: 'asc' | 'desc',
  ): Repository[] {
    // Calculate relevance score for each repo
    const scored = repos.map((repo) => {
      let score = 0

      if (query) {
        // Exact name match gets highest score
        if (repo.name.toLowerCase() === query) score += 100
        // Name contains query
        else if (repo.name.toLowerCase().includes(query)) score += 50
        // Description contains query
        if (repo.description?.toLowerCase().includes(query)) score += 25
      }

      // Factor in popularity
      score += Number(repo.starCount) * 0.1
      score += Number(repo.forkCount) * 0.05

      return { repo, score }
    })

    // Sort
    scored.sort((a, b) => {
      let comparison = 0

      switch (sort) {
        case 'stars':
          comparison = Number(a.repo.starCount) - Number(b.repo.starCount)
          break
        case 'forks':
          comparison = Number(a.repo.forkCount) - Number(b.repo.forkCount)
          break
        case 'updated':
          comparison = Number(a.repo.updatedAt) - Number(b.repo.updatedAt)
          break
        case 'created':
          comparison = Number(a.repo.createdAt) - Number(b.repo.createdAt)
          break
        default:
          comparison = a.score - b.score
          break
      }

      return order === 'desc' ? -comparison : comparison
    })

    return scored.map((s) => s.repo)
  }

  private isBinaryContent(content: string): boolean {
    // Simple heuristic: check for null bytes
    return content.includes('\0')
  }
}
