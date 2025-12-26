/** Datasets Routes */

import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  type DatasetRow,
  createDataset as dbCreateDataset,
  listDatasets as dbListDatasets,
} from '../db/client'
import {
  CreateDatasetBodySchema,
  DatasetsQuerySchema,
  expectValid,
} from '../schemas'

// Schema for dataset tags
const TagsSchema = z.array(z.string())
import { requireAuth } from '../validation/access-control'

export interface Dataset {
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

function transformDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    description: row.description,
    type: row.type,
    format: row.format,
    size: row.size,
    rows: row.rows,
    downloads: row.downloads,
    stars: row.stars,
    license: row.license,
    tags: TagsSchema.parse(JSON.parse(row.tags)),
    isVerified: row.is_verified === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const datasetsRoutes = new Elysia({ prefix: '/api/datasets' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(DatasetsQuerySchema, query, 'query params')

      const datasetRows = dbListDatasets({
        type: validated.type,
        org: validated.org,
      })

      const datasets = datasetRows.map(transformDataset)
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

      const row = dbCreateDataset({
        name: validated.name,
        organization: validated.organization,
        description: validated.description,
        type: validated.type,
        license: validated.license,
        owner: authResult.address,
      })

      set.status = 201
      return transformDataset(row)
    },
    {
      detail: {
        tags: ['datasets'],
        summary: 'Upload dataset',
        description: 'Upload a new dataset',
      },
    },
  )
