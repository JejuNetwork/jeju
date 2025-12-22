/**
 * Dataset Routes
 */

import { Elysia } from 'elysia'
import {
  CreateDatasetBodySchema,
  DatasetsQuerySchema,
  expectValid,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Dataset {
  id: string
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  format: string
  size: string
  rows: number
  downloads: number
  stars: number
  license: string
  tags: string[]
  isVerified: boolean
  status: 'processing' | 'ready' | 'failed'
  createdAt: number
  updatedAt: number
}

export const datasetsRoutes = new Elysia({ prefix: '/api/datasets' })
  .get(
    '/',
    async ({ query }) => {
      expectValid(DatasetsQuerySchema, query, 'query params')

      const datasets: Dataset[] = [
        {
          id: '1',
          name: 'jeju-contracts-v2',
          organization: 'jeju',
          description: 'Curated dataset of audited Solidity smart contracts',
          type: 'code',
          format: 'parquet',
          size: '2.3 GB',
          rows: 150000,
          downloads: 8420,
          stars: 234,
          license: 'Apache-2.0',
          tags: ['solidity', 'smart-contracts', 'security'],
          isVerified: true,
          status: 'ready',
          createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        },
      ]

      return { datasets, total: datasets.length }
    },
    {
      detail: {
        tags: ['datasets'],
        summary: 'List datasets',
        description: 'Get a list of datasets',
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

      const validated = expectValid(
        CreateDatasetBodySchema,
        body,
        'request body',
      )

      const dataset: Dataset = {
        id: `dataset-${Date.now()}`,
        name: validated.name,
        organization: validated.organization,
        description: validated.description,
        type: validated.type,
        license: validated.license,
        format: 'unknown',
        size: '0',
        rows: 0,
        downloads: 0,
        stars: 0,
        tags: [],
        isVerified: false,
        status: 'processing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return dataset
    },
    {
      detail: {
        tags: ['datasets'],
        summary: 'Upload dataset',
        description: 'Upload a new dataset',
      },
    },
  )
