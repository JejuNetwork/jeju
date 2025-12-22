/**
 * Container utilities
 * Shared business logic for container-related operations
 */

import type { ContainerImage } from '../model'

export interface ContainerListResponse {
  cid: string
  name: string
  tag: string
  sizeBytes: string
  uploadedAt: string
  uploadedBy: string | null
  storageProvider: string | null
  tier: string
  architecture: string
  gpuRequired: boolean
  minGpuVram: number | null | undefined
  teeRequired: boolean
  verified: boolean
  pullCount: number
  lastPulledAt: string | null
}

export function mapContainerListResponse(
  container: ContainerImage,
): ContainerListResponse {
  if (!container) {
    throw new Error('ContainerImage is required')
  }
  return {
    cid: container.cid,
    name: container.name,
    tag: container.tag,
    sizeBytes: container.sizeBytes.toString(),
    uploadedAt: container.uploadedAt.toISOString(),
    uploadedBy: container.uploadedBy?.address || null,
    storageProvider: container.storageProvider?.address || null,
    tier: container.tier,
    architecture: container.architecture,
    gpuRequired: container.gpuRequired,
    minGpuVram: container.minGpuVram,
    teeRequired: container.teeRequired,
    verified: container.verified,
    pullCount: container.pullCount,
    lastPulledAt: container.lastPulledAt?.toISOString() || null,
  }
}
