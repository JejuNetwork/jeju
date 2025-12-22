/**
 * AI Model Hub Routes
 */

import { Elysia } from 'elysia'
import {
  CreateModelBodySchema,
  expectValid,
  ModelParamsSchema,
  ModelsQuerySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Model {
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

export const modelsRoutes = new Elysia({ prefix: '/api/models' })
  .get(
    '/',
    async ({ query }) => {
      expectValid(ModelsQuerySchema, query, 'query params')

      const models: Model[] = [
        {
          id: 'jeju/llama-3-jeju-ft',
          name: 'Llama 3 Jeju Fine-tuned',
          organization: 'jeju',
          type: 'llm',
          description: 'Fine-tuned for smart contract development',
          version: '1.0.0',
          fileUri: 'ipfs://...',
          downloads: 15000,
          stars: 234,
          size: '4.2GB',
          license: 'MIT',
          status: 'ready',
          createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        },
        {
          id: 'jeju/code-embed-v1',
          name: 'Code Embedding v1',
          organization: 'jeju',
          type: 'embedding',
          description: 'Code embedding model for semantic search',
          version: '1.0.0',
          fileUri: 'ipfs://...',
          downloads: 8500,
          stars: 156,
          size: '400MB',
          license: 'Apache-2.0',
          status: 'ready',
          createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
        },
      ]

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

      const model: Model = {
        id: `${validated.organization}/${validated.name}`,
        name: validated.name,
        organization: validated.organization,
        description: validated.description,
        type: validated.type,
        version: '1.0.0',
        fileUri: '',
        downloads: 0,
        stars: 0,
        status: 'processing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return model
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
    async ({ params }) => {
      const validated = expectValid(ModelParamsSchema, params, 'params')
      const model: Model = {
        id: `${validated.org}/${validated.name}`,
        name: validated.name,
        organization: validated.org,
        type: 'llm',
        description: 'Example model',
        version: '1.0.0',
        fileUri: 'ipfs://...',
        downloads: 1000,
        stars: 50,
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      return model
    },
    {
      detail: {
        tags: ['models'],
        summary: 'Get model',
        description: 'Get details of a specific model',
      },
    },
  )
