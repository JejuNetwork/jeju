/**
 * Provider utilities
 * Shared business logic for provider-related operations
 */

import type { DataSource } from 'typeorm'
import { ComputeProvider, StorageProvider, ContainerImage } from '../model'
import { NotFoundError } from './types'

export interface FullStackProvider {
  agentId: number
  compute: Array<{ address: string; name: string; endpoint: string }>
  storage: Array<{
    address: string
    name: string
    endpoint: string
    providerType: string
  }>
}

export async function getFullStackProviders(
  dataSource: DataSource,
  limit: number = 20,
): Promise<{ fullStackProviders: FullStackProvider[]; total: number }> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof limit !== 'number' || limit <= 0 || limit > 100) {
    throw new Error(`Invalid limit: ${limit}. Must be between 1 and 100.`)
  }

  // Find agents that are linked to both compute and storage providers
  const computeRepo = dataSource.getRepository(ComputeProvider)
  const storageRepo = dataSource.getRepository(StorageProvider)

  const computeWithAgent = await computeRepo.find({
    where: { isActive: true },
  })
  const storageWithAgent = await storageRepo.find({
    where: { isActive: true },
  })

  // Group by agent ID
  const computeByAgent = new Map<number, ComputeProvider[]>()
  for (const p of computeWithAgent) {
    if (p.agentId) {
      const existing = computeByAgent.get(p.agentId) || []
      existing.push(p)
      computeByAgent.set(p.agentId, existing)
    }
  }

  const fullStackProviders: FullStackProvider[] = []

  for (const storage of storageWithAgent) {
    if (storage.agentId && computeByAgent.has(storage.agentId)) {
      const computeProviders = computeByAgent.get(storage.agentId) || []

      // Check if we already have this agent
      let existing = fullStackProviders.find(
        (f) => f.agentId === storage.agentId,
      )
      if (!existing) {
        existing = {
          agentId: storage.agentId,
          compute: computeProviders.map((c) => ({
            address: c.address,
            name: c.name || 'Compute Provider',
            endpoint: c.endpoint,
          })),
          storage: [],
        }
        fullStackProviders.push(existing)
      }

      existing.storage.push({
        address: storage.address,
        name: storage.name,
        endpoint: storage.endpoint,
        providerType: storage.providerType,
      })
    }
  }

  return {
    fullStackProviders: fullStackProviders.slice(0, limit),
    total: fullStackProviders.length,
  }
}

export interface ContainerDetail {
  cid: string
  name: string
  tag: string
  sizeBytes: string
  uploadedAt: string
  uploadedBy: string | null
  storageProvider: {
    address: string
    name: string
    endpoint: string
  } | null
  tier: string
  expiresAt: string | null
  architecture: string
  gpuRequired: boolean
  minGpuVram: number | null | undefined
  teeRequired: boolean
  contentHash: string | null
  verified: boolean
  verifiedBy: string | null
  pullCount: number
  lastPulledAt: string | null
}

export interface CompatibleProvider {
  address: string
  name: string
  endpoint: string
  agentId: number | null
  isActive: boolean
}

export async function getContainerDetail(
  dataSource: DataSource,
  cid: string,
): Promise<{
  container: ContainerDetail
  compatibleProviders: CompatibleProvider[]
}> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!cid || typeof cid !== 'string' || cid.trim().length === 0) {
    throw new Error('cid is required and must be a non-empty string')
  }

  const repo = dataSource.getRepository(ContainerImage)
  const container = await repo.findOne({
    where: { cid },
    relations: ['storageProvider', 'uploadedBy', 'verifiedBy'],
  })

  if (!container) {
    throw new NotFoundError('Container', cid)
  }

  const computeRepo = dataSource.getRepository(ComputeProvider)
  const compatibleProviders = await computeRepo.find({
    where: { isActive: true },
    order: { totalEarnings: 'DESC' },
    take: 10,
  })

  return {
    container: {
      cid: container.cid,
      name: container.name,
      tag: container.tag,
      sizeBytes: container.sizeBytes.toString(),
      uploadedAt: container.uploadedAt.toISOString(),
      uploadedBy: container.uploadedBy?.address || null,
      storageProvider: container.storageProvider
        ? {
            address: container.storageProvider.address,
            name: container.storageProvider.name,
            endpoint: container.storageProvider.endpoint,
          }
        : null,
      tier: container.tier,
      expiresAt: container.expiresAt?.toISOString() || null,
      architecture: container.architecture,
      gpuRequired: container.gpuRequired,
      minGpuVram: container.minGpuVram,
      teeRequired: container.teeRequired,
      contentHash: container.contentHash,
      verified: container.verified,
      verifiedBy: container.verifiedBy?.agentId
        ? container.verifiedBy.agentId.toString()
        : null,
      pullCount: container.pullCount,
      lastPulledAt: container.lastPulledAt?.toISOString() || null,
    },
    compatibleProviders: compatibleProviders.map((p) => ({
      address: p.address,
      name: p.name || 'Compute Provider',
      endpoint: p.endpoint,
      agentId: p.agentId ?? null,
      isActive: p.isActive,
    })),
  }
}
