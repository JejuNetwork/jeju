/**
 * GitHub Discussion Actions
 *
 * POST_GITHUB_DISCUSSION: Creates a discussion via GraphQL API
 * SEARCH_DISCUSSIONS: Searches existing discussions via REST API
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { z } from 'zod'
import { fetchWithTimeout } from '../validation'

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const GITHUB_API_URL = 'https://api.github.com'

// Response schemas
const createDiscussionResponseSchema = z.object({
  data: z.object({
    createDiscussion: z.object({
      discussion: z.object({
        url: z.string(),
        number: z.number(),
      }),
    }),
  }),
})

const searchDiscussionItemSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string().optional(),
  created_at: z.string(),
  user: z
    .object({
      login: z.string(),
    })
    .optional(),
})

const searchDiscussionsResponseSchema = z.object({
  total_count: z.number(),
  items: z.array(searchDiscussionItemSchema),
})

// Environment config
function getGithubConfig() {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_REPO_OWNER
  const repo = process.env.GITHUB_REPO_NAME
  const repositoryId = process.env.GITHUB_REPO_ID
  const categoryId = process.env.GITHUB_CATEGORY_ID

  if (!token) throw new Error('GITHUB_TOKEN not configured')
  if (!owner) throw new Error('GITHUB_REPO_OWNER not configured')
  if (!repo) throw new Error('GITHUB_REPO_NAME not configured')

  return { token, owner, repo, repositoryId, categoryId }
}

// Parse title and body from message text
// Expected format: "Title: <title>\nBody: <body>" or "Title: <title>\n\n<body>"
function parseTitleAndBody(text: string): { title: string; body: string } {
  const lines = text.trim().split('\n')

  // Try "Title: X" format
  const titleLine = lines.find((l) => l.toLowerCase().startsWith('title:'))
  if (titleLine) {
    const title = titleLine.replace(/^title:\s*/i, '').trim()
    const bodyStartIndex = lines.indexOf(titleLine) + 1
    const bodyLines = lines.slice(bodyStartIndex)

    // Check for "Body:" prefix
    const bodyLineIndex = bodyLines.findIndex((l) =>
      l.toLowerCase().startsWith('body:'),
    )
    let body: string
    if (bodyLineIndex !== -1) {
      body =
        bodyLines[bodyLineIndex].replace(/^body:\s*/i, '') +
        '\n' +
        bodyLines.slice(bodyLineIndex + 1).join('\n')
    } else {
      body = bodyLines.join('\n')
    }

    return { title: title || 'Untitled Discussion', body: body.trim() || title }
  }

  // Fallback: first line is title, rest is body
  const title = lines[0] || 'Untitled Discussion'
  const body = lines.slice(1).join('\n').trim() || title

  return { title, body }
}

// Create discussion via GraphQL
async function createDiscussion(
  title: string,
  body: string,
): Promise<{ url: string; number: number }> {
  const config = getGithubConfig()

  if (!config.repositoryId) throw new Error('GITHUB_REPO_ID not configured')
  if (!config.categoryId) throw new Error('GITHUB_CATEGORY_ID not configured')

  const query = `
    mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId
        categoryId: $categoryId
        title: $title
        body: $body
      }) {
        discussion { url number }
      }
    }
  `

  const response = await fetchWithTimeout(
    GITHUB_GRAPHQL_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          repositoryId: config.repositoryId,
          categoryId: config.categoryId,
          title,
          body,
        },
      }),
    },
    30000,
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GitHub API error: ${response.status} ${errorText}`)
  }

  const json = await response.json()

  // Check for GraphQL errors
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`)
  }

  const parsed = createDiscussionResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`Invalid response: ${parsed.error.message}`)
  }

  return parsed.data.data.createDiscussion.discussion
}

// Search discussions via REST API
async function searchDiscussions(
  query: string,
): Promise<{
  totalCount: number
  items: z.infer<typeof searchDiscussionItemSchema>[]
}> {
  const config = getGithubConfig()

  const searchQuery = encodeURIComponent(
    `${query} repo:${config.owner}/${config.repo} type:discussions`,
  )
  const url = `${GITHUB_API_URL}/search/issues?q=${searchQuery}`

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    30000,
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GitHub API error: ${response.status} ${errorText}`)
  }

  const json = await response.json()
  const parsed = searchDiscussionsResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`Invalid response: ${parsed.error.message}`)
  }

  return { totalCount: parsed.data.total_count, items: parsed.data.items }
}

function formatDiscussionResult(discussion: {
  url: string
  number: number
}): string {
  return `Discussion #${discussion.number} created: ${discussion.url}`
}

function formatSearchResults(results: {
  totalCount: number
  items: z.infer<typeof searchDiscussionItemSchema>[]
}): string {
  if (results.items.length === 0) {
    return 'No discussions found.'
  }

  const lines = [`Found ${results.totalCount} discussion(s):\n`]
  for (const item of results.items.slice(0, 10)) {
    const author = item.user?.login ?? 'unknown'
    lines.push(`#${item.number}: ${item.title}`)
    lines.push(
      `  By ${author} on ${new Date(item.created_at).toLocaleDateString()}`,
    )
    lines.push(`  ${item.html_url}\n`)
  }

  if (results.totalCount > 10) {
    lines.push(`... and ${results.totalCount - 10} more`)
  }

  return lines.join('\n')
}

export const postGithubDiscussionAction: Action = {
  name: 'POST_GITHUB_DISCUSSION',
  description: 'Create a GitHub Discussion via GraphQL API',
  similes: [
    'create github discussion',
    'post discussion',
    'new github discussion',
    'start discussion',
    'open discussion',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => {
    try {
      const config = getGithubConfig()
      // POST requires repo ID and category ID
      return !!config.repositoryId && !!config.categoryId
    } catch {
      return false
    }
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = (message.content as { text?: string })?.text ?? ''

    if (!text.trim()) {
      callback?.({
        text: 'Error: Please provide a title and body for the discussion.',
        content: { type: 'error', error: 'Empty message' },
      })
      return
    }

    const { title, body } = parseTitleAndBody(text)

    try {
      const discussion = await createDiscussion(title, body)
      callback?.({
        text: formatDiscussionResult(discussion),
        content: {
          type: 'github_discussion',
          discussion,
        },
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      callback?.({
        text: `Failed to create discussion: ${errorMessage}`,
        content: { type: 'error', error: errorMessage },
      })
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Title: Feature Request: Dark Mode\nBody: Would love to see dark mode support.',
        },
      },
      {
        name: 'agent',
        content: {
          text: 'Discussion #42 created: https://github.com/owner/repo/discussions/42',
        },
      },
    ],
  ],
}

export const searchDiscussionsAction: Action = {
  name: 'SEARCH_DISCUSSIONS',
  description: 'Search GitHub Discussions via REST API',
  similes: [
    'search discussions',
    'find discussions',
    'look up discussions',
    'query discussions',
    'search github discussions',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => {
    try {
      getGithubConfig()
      return true
    } catch {
      return false
    }
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = (message.content as { text?: string })?.text ?? ''

    if (!text.trim()) {
      callback?.({
        text: 'Error: Please provide a search query.',
        content: { type: 'error', error: 'Empty query' },
      })
      return
    }

    try {
      const results = await searchDiscussions(text.trim())
      callback?.({
        text: formatSearchResults(results),
        content: {
          type: 'github_search_results',
          totalCount: results.totalCount,
          items: results.items,
        },
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      callback?.({
        text: `Failed to search discussions: ${errorMessage}`,
        content: { type: 'error', error: errorMessage },
      })
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'dark mode' },
      },
      {
        name: 'agent',
        content: {
          text: 'Found 3 discussion(s):\n\n#42: Feature Request: Dark Mode\n  By user1 on 1/1/2024\n  https://github.com/owner/repo/discussions/42',
        },
      },
    ],
  ],
}
