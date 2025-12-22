/**
 * Dataset Routes
 */

import { Elysia, t } from 'elysia'
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
    async () => {
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
      query: t.Object({
        type: t.Optional(t.String()),
        org: t.Optional(t.String()),
        q: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
      }),
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

      const dataset: Dataset = {
        id: `dataset-${Date.now()}`,
        name: body.name,
        organization: body.organization,
        description: body.description,
        type: body.type,
        license: body.license,
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
      body: t.Object({
        name: t.String({
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9._-]+$',
        }),
        organization: t.String({
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9._-]+$',
        }),
        description: t.String({ minLength: 10 }),
        type: t.Union([
          t.Literal('text'),
          t.Literal('code'),
          t.Literal('image'),
          t.Literal('audio'),
          t.Literal('multimodal'),
          t.Literal('tabular'),
        ]),
        license: t.String({ minLength: 1 }),
      }),
      detail: {
        tags: ['datasets'],
        summary: 'Upload dataset',
        description: 'Upload a new dataset',
      },
    },
  )
