/**
 * Factory Services Index
 *
 * Comprehensive service layer for Factory app integrating:
 * - DWS (Decentralized Web Services) - git, packages, containers, compute
 * - External Web2 Services (GitHub, Linear, npm) - via MPC KMS secrets
 * - Crucible (Agent orchestration) - agent jobs, PR reviews, validation
 * - Autocrat (AI CEO governance) - proposals, feedback, reputation
 * - Farcaster (Social) - feed, messaging, collaboration
 */

// DWS Services
import { dwsClient as _dwsClient } from './dws'

export type { Model } from '@/types'
export type {
  CDNDeployResult,
  CIWorkflow,
  ComputeJob,
  DWSContainerImage,
  DWSHealth,
  DWSNode,
  InferenceResult,
  Package,
  Repository,
} from './dws'
export const dwsClient = _dwsClient

// External Services (with MPC KMS secrets)
import {
  githubService as _githubService,
  kmsService as _kmsService,
  linearService as _linearService,
  npmService as _npmService,
} from './external'

export type {
  GitHubIssue,
  GitHubPR,
  GitHubRepo,
  LinearIssue,
  LinearProject,
  NpmPackage,
  NpmSearchResult,
} from './external'
export const githubService = _githubService
export const linearService = _linearService
export const npmService = _npmService
export const kmsService = _kmsService

// Crucible Agent Integration
import { crucibleService as _crucibleService } from './crucible'

export type {
  Agent,
  AgentRoom,
  AgentTask,
  ExecutionRequest,
  ExecutionResult,
} from './crucible'
export const crucibleService = _crucibleService

// Autocrat AI CEO Integration
import { autocratService as _autocratService } from './autocrat'

export type {
  CEODecision,
  CouncilVote,
  Proposal,
  ReputationUpdate,
  WorkFeedback,
} from './autocrat'
export const autocratService = _autocratService

// Farcaster Social Integration
import {
  farcasterClient as _farcasterClient,
  messagingClient as _messagingClient,
} from './farcaster'

export {
  type Cast,
  type Channel,
  type DirectMessage,
  type FarcasterUser,
  type MessageThread,
  sendBountyMessage,
  sendCollaborationRequest,
} from './farcaster'
export const farcasterClient = _farcasterClient
export const messagingClient = _messagingClient

// ============ Unified Service Initialization ============

interface FactoryServicesConfig {
  userAddress: string
  signature: string
  timestamp: string
  kmsKeys?: {
    github?: string
    linear?: string
    npm?: string
  }
}

/**
 * Initialize all Factory services with authentication
 */
export async function initializeServices(
  config: FactoryServicesConfig,
): Promise<void> {
  // Set auth headers for all services
  crucibleService.setAuth(
    config.userAddress,
    config.signature,
    config.timestamp,
  )
  autocratService.setAuth(
    config.userAddress,
    config.signature,
    config.timestamp,
  )
  messagingClient.setAuth(
    config.userAddress,
    config.signature,
    config.timestamp,
  )

  // Initialize external services with MPC KMS if keys provided
  if (config.kmsKeys?.github) {
    await githubService.initialize(
      config.kmsKeys.github,
      config.userAddress,
      config.signature,
    )
  }
  if (config.kmsKeys?.linear) {
    await linearService.initialize(
      config.kmsKeys.linear,
      config.userAddress,
      config.signature,
    )
  }
  if (config.kmsKeys?.npm) {
    await npmService.initialize(
      config.kmsKeys.npm,
      config.userAddress,
      config.signature,
    )
  }
}

// ============ Service Status ============

export interface ServiceStatus {
  dws: boolean
  crucible: boolean
  autocrat: boolean
  farcaster: boolean
  messaging: boolean
}

/**
 * Check health of all services
 */
export async function checkServicesHealth(): Promise<ServiceStatus> {
  const status: ServiceStatus = {
    dws: false,
    crucible: false,
    autocrat: false,
    farcaster: false,
    messaging: false,
  }

  const checks = await Promise.allSettled([
    dwsClient.healthCheck(),
    fetch(
      `${process.env.NEXT_PUBLIC_CRUCIBLE_URL || 'http://localhost:4020'}/health`,
    ),
    fetch(
      `${process.env.NEXT_PUBLIC_AUTOCRAT_URL || 'http://localhost:4040'}/health`,
    ),
    fetch(
      `${process.env.NEXT_PUBLIC_NEYNAR_API_URL || 'https://api.neynar.com'}/health`,
    ),
    fetch(
      `${process.env.NEXT_PUBLIC_MESSAGING_URL || 'http://localhost:4050'}/health`,
    ),
  ])

  if (checks[0].status === 'fulfilled') status.dws = true
  if (checks[1].status === 'fulfilled' && (checks[1].value as Response).ok)
    status.crucible = true
  if (checks[2].status === 'fulfilled' && (checks[2].value as Response).ok)
    status.autocrat = true
  if (checks[3].status === 'fulfilled' && (checks[3].value as Response).ok)
    status.farcaster = true
  if (checks[4].status === 'fulfilled' && (checks[4].value as Response).ok)
    status.messaging = true

  return status
}
