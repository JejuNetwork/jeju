/**
 * Model Types
 */

import type { Timestamps } from './common'

export type ModelType =
  | 'llm'
  | 'embedding'
  | 'image'
  | 'audio'
  | 'multimodal'
  | 'code'

export interface Model extends Timestamps {
  id: string
  name: string
  organization: string
  type: ModelType
  description: string
  version: string
  fileUri: string
  configUri?: string
  downloads: number
  stars: number
  size?: string
  license?: string
  status?: 'processing' | 'ready' | 'failed'
  tags?: string[]
  isVerified?: boolean
}

export interface ModelVersion {
  versionId: string
  modelId: string
  version: string
  weightsUri: string
  weightsHash: string
  weightsSize: number
  configUri: string
  tokenizerUri: string
  parameterCount: number
  precision: string
  publishedAt: number
  isLatest: boolean
}

export interface ModelFile {
  filename: string
  cid: string
  size: number
  sha256: string
  type: 'weights' | 'config' | 'tokenizer' | 'other'
}
