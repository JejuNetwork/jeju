import { Elysia } from 'elysia'
import {
  createModel as dbCreateModel,
  listModels as dbListModels,
  starModel as dbStarModel,
  getModel,
  type ModelRow,
} from '../db/client'
import {
  CreateModelBodySchema,
  expectValid,
  ModelInferenceBodySchema,
  ModelParamsSchema,
  ModelsQuerySchema,
} from '../schemas'
import { dwsService } from '../services/dws'
import { requireAuth } from '../validation/access-control'

export interface Model {
  id: string
  name: string
  organization: string
  type: 'llm' | 'embedding' | 'image' | 'audio' | 'multimodal' | 'code'
  description: string
  version: string
  fileUri: string
  downloads: number
  stars: number
  size?: string
  license?: string
  status: 'processing' | 'ready' | 'failed'
  createdAt: number
  updatedAt: number
}

function transformModel(row: ModelRow): Model {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    type: row.type,
    description: row.description,
    version: row.version,
    fileUri: row.file_uri,
    downloads: row.downloads,
    stars: row.stars,
    size: row.size ?? undefined,
    license: row.license ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const modelsRoutes = new Elysia({ prefix: '/api/models' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(ModelsQuerySchema, query, 'query params')

      const modelRows = dbListModels({
        type: validated.type,
        org: validated.org,
      })

      const models = modelRows.map(transformModel)
      return { models, total: models.length }
    },
    {
      detail: {
        tags: ['models'],
        summary: 'List models',
        description: 'Get a list of AI models',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validated = expectValid(CreateModelBodySchema, body, 'request body')

      const row = dbCreateModel({
        name: validated.name,
        organization: validated.organization,
        description: validated.description,
        type: validated.type,
        fileUri: validated.fileUri ?? '',
        owner: authResult.address,
      })

      set.status = 201
      return transformModel(row)
    },
    {
      detail: {
        tags: ['models'],
        summary: 'Upload model',
        description: 'Upload a new AI model',
      },
    },
  )
  .get(
    '/:org/:name',
    async ({ params, set }) => {
      const validated = expectValid(ModelParamsSchema, params, 'params')
      const row = getModel(validated.org, validated.name)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Model ${validated.org}/${validated.name} not found`,
          },
        }
      }
      return transformModel(row)
    },
    {
      detail: {
        tags: ['models'],
        summary: 'Get model',
        description: 'Get details of a specific model',
      },
    },
  )
  .post(
    '/:org/:name/inference',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validatedParams = expectValid(ModelParamsSchema, params, 'params')
      const validatedBody = expectValid(
        ModelInferenceBodySchema,
        body,
        'request body',
      )

      // Check if model exists
      const row = getModel(validatedParams.org, validatedParams.name)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Model ${validatedParams.org}/${validatedParams.name} not found`,
          },
        }
      }

      // Call DWS for actual inference
      const result = await dwsService.inference({
        modelId: row.id,
        prompt: validatedBody.prompt,
        maxTokens: validatedBody.maxTokens,
        temperature: validatedBody.temperature,
      })

      return result
    },
    { detail: { tags: ['models'], summary: 'Run inference' } },
  )
  .post(
    '/:org/:name/star',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(ModelParamsSchema, params, 'params')
      const row = getModel(validated.org, validated.name)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Model ${validated.org}/${validated.name} not found`,
          },
        }
      }
      dbStarModel(validated.org, validated.name)
      return { success: true, model: `${validated.org}/${validated.name}` }
    },
    { detail: { tags: ['models'], summary: 'Star model' } },
  )
