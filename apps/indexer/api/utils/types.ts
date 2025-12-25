/**
 * Shared indexer types - import from @jejunetwork/types
 */

export type {
  AgentSearchResult,
  ProviderResult,
  SearchResult,
} from '@jejunetwork/types'

// Error Types

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string[]; message: string }>,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`)
    this.name = 'NotFoundError'
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}
