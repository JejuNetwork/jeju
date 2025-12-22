/**
 * Container Types
 */

import type { Timestamps } from './common'

export interface ContainerImage extends Timestamps {
  id: string
  name: string
  tag: string
  digest: string
  size: number
  platform: string
  downloads: number
  labels?: Record<string, string>
}
