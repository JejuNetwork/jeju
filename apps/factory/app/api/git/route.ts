import { type NextRequest, NextResponse } from 'next/server'
import { dwsClient } from '@/lib/services/dws'
import { errorResponse, validateBody, validateQuery } from '@/lib/validation'
import {
  createRepositorySchema,
  getRepositoriesQuerySchema,
} from '@/lib/validation/schemas'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = validateQuery(getRepositoriesQuerySchema, searchParams)

    const repos = await dwsClient.listRepositories(query.owner)
    return NextResponse.json(repos)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createRepositorySchema, request.json())

    const repo = await dwsClient.createRepository({
      name: body.name,
      description: body.description,
      isPrivate: body.isPrivate,
    })

    return NextResponse.json(repo)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message, 400)
  }
}
