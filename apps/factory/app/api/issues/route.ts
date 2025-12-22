import { type NextRequest, NextResponse } from 'next/server'
import { errorResponse, validateBody, validateQuery } from '@/lib/validation'
import {
  createIssueSchema,
  getIssuesQuerySchema,
} from '@/lib/validation/schemas'
import type { Issue } from '@/types'

// GET /api/issues - List issues
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = validateQuery(getIssuesQuerySchema, searchParams)

    const issues: Issue[] = [
      {
        id: '42',
        number: 42,
        repo: 'jeju/protocol',
        title: 'Bug: Smart contract verification fails on Base Sepolia',
        body: 'Description of the bug...',
        status: 'open',
        author: {
          name: 'alice.eth',
          avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
        labels: ['bug', 'help wanted'],
        assignees: [
          {
            name: 'bob.eth',
            avatar: 'https://avatars.githubusercontent.com/u/2?v=4',
          },
        ],
        comments: 8,
        createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 1 * 60 * 60 * 1000,
      },
    ]

    return NextResponse.json({ issues, total: issues.length, page: query.page })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}

// POST /api/issues - Create a new issue
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createIssueSchema, request.json())

    const issue: Issue = {
      id: `issue-${Date.now()}`,
      number: Math.floor(Math.random() * 1000),
      repo: body.repo,
      title: body.title,
      body: body.body,
      labels: body.labels || [],
      assignees: (body.assignees || []).map((addr) => ({ name: addr })),
      status: 'open',
      author: { name: 'unknown' },
      comments: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    return NextResponse.json(issue, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}
