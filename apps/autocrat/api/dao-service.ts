/**
 * DAO Service - Multi-tenant DAO Management
 * Handles all DAO operations including creation, configuration, and state management
 */

import {
  expectTrue as expect,
  expectDefined,
  hasKey,
  isPlainObject,
  toBigInt,
} from '@jejunetwork/types'
import { isProductionEnv } from '@jejunetwork/config'
import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hash,
  type HttpTransport,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createKMSWalletClient } from './kms-signer'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  type CEOPersona,
  type CouncilMemberConfig,
  type DAOStatus,
  type FundingConfig,
  type FundingStatus,
  type GovernanceParams,
  toHex,
} from '../lib'

import type {
  DAO,
  DAOFull,
  FundingAllocation,
  FundingProject,
} from '../lib/types'

// Types FundingEpoch is local to this service (not in lib/types.ts)
export interface FundingEpoch {
  epochId: number
  daoId: string
  startTime: number
  endTime: number
  totalBudget: bigint
  matchingPool: bigint
  distributed: bigint
  finalized: boolean
}
const DAORegistryABI = [
  {
    type: 'function',
    name: 'createDAO',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'displayName', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'treasury', type: 'address' },
      { name: 'manifestCid', type: 'string' },
      {
        name: 'ceoPersona',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'minQualityScore', type: 'uint256' },
          { name: 'councilVotingPeriod', type: 'uint256' },
          { name: 'gracePeriod', type: 'uint256' },
          { name: 'minProposalStake', type: 'uint256' },
          { name: 'quorumBps', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'daoId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDAO',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'daoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'displayName', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'treasury', type: 'address' },
          { name: 'council', type: 'address' },
          { name: 'ceoAgent', type: 'address' },
          { name: 'feeConfig', type: 'address' },
          { name: 'ceoModelId', type: 'bytes32' },
          { name: 'manifestCid', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'creator', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOFull',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'dao',
            type: 'tuple',
            components: [
              { name: 'daoId', type: 'bytes32' },
              { name: 'name', type: 'string' },
              { name: 'displayName', type: 'string' },
              { name: 'description', type: 'string' },
              { name: 'treasury', type: 'address' },
              { name: 'council', type: 'address' },
              { name: 'ceoAgent', type: 'address' },
              { name: 'feeConfig', type: 'address' },
              { name: 'ceoModelId', type: 'bytes32' },
              { name: 'manifestCid', type: 'string' },
              { name: 'status', type: 'uint8' },
              { name: 'createdAt', type: 'uint256' },
              { name: 'updatedAt', type: 'uint256' },
              { name: 'creator', type: 'address' },
            ],
          },
          {
            name: 'ceoPersona',
            type: 'tuple',
            components: [
              { name: 'name', type: 'string' },
              { name: 'pfpCid', type: 'string' },
              { name: 'description', type: 'string' },
              { name: 'personality', type: 'string' },
              { name: 'traits', type: 'string[]' },
            ],
          },
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'minQualityScore', type: 'uint256' },
              { name: 'councilVotingPeriod', type: 'uint256' },
              { name: 'gracePeriod', type: 'uint256' },
              { name: 'minProposalStake', type: 'uint256' },
              { name: 'quorumBps', type: 'uint256' },
            ],
          },
          {
            name: 'councilMembers',
            type: 'tuple[]',
            components: [
              { name: 'member', type: 'address' },
              { name: 'agentId', type: 'uint256' },
              { name: 'role', type: 'string' },
              { name: 'weight', type: 'uint256' },
              { name: 'addedAt', type: 'uint256' },
              { name: 'isActive', type: 'bool' },
            ],
          },
          { name: 'linkedPackages', type: 'bytes32[]' },
          { name: 'linkedRepos', type: 'bytes32[]' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOByName',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'daoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'displayName', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'treasury', type: 'address' },
          { name: 'council', type: 'address' },
          { name: 'ceoAgent', type: 'address' },
          { name: 'feeConfig', type: 'address' },
          { name: 'ceoModelId', type: 'bytes32' },
          { name: 'manifestCid', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'creator', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCEOPersona',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getGovernanceParams',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'minQualityScore', type: 'uint256' },
          { name: 'councilVotingPeriod', type: 'uint256' },
          { name: 'gracePeriod', type: 'uint256' },
          { name: 'minProposalStake', type: 'uint256' },
          { name: 'quorumBps', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCouncilMembers',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'member', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'role', type: 'string' },
          { name: 'weight', type: 'uint256' },
          { name: 'addedAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedPackages',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedRepos',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllDAOs',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveDAOs',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'daoExists',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOCount',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isDAOAdmin',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'admin', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isCouncilMember',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setCEOPersona',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      {
        name: 'persona',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCEOModel',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'modelId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setGovernanceParams',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'minQualityScore', type: 'uint256' },
          { name: 'councilVotingPeriod', type: 'uint256' },
          { name: 'gracePeriod', type: 'uint256' },
          { name: 'minProposalStake', type: 'uint256' },
          { name: 'quorumBps', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addCouncilMember',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'member', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'role', type: 'string' },
      { name: 'weight', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeCouncilMember',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkPackage',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'packageId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unlinkPackage',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'packageId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkRepo',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'repoId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unlinkRepo',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'repoId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAOCouncilContract',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'council', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAOCEOAgent',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'ceoAgent', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAOFeeConfig',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'feeConfig', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAOStatus',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'DAOCreated',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'treasury', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'CEOPersonaUpdated',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'pfpCid', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CEOModelChanged',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'oldModel', type: 'bytes32', indexed: false },
      { name: 'newModel', type: 'bytes32', indexed: false },
    ],
  },
] as const

const DAOFundingABI = [
  {
    type: 'function',
    name: 'proposeProject',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'projectType', type: 'uint8' },
      { name: 'registryId', type: 'bytes32' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'primaryRecipient', type: 'address' },
      { name: 'additionalRecipients', type: 'address[]' },
      { name: 'recipientShares', type: 'uint256[]' },
    ],
    outputs: [{ name: 'projectId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'acceptProject',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rejectProject',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCEOWeight',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'weight', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stake',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'unstake',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'epochId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createEpoch',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'budget', type: 'uint256' },
      { name: 'matchingPool', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizeEpoch',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getProject',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'projectId', type: 'bytes32' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'projectType', type: 'uint8' },
          { name: 'registryId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'primaryRecipient', type: 'address' },
          { name: 'additionalRecipients', type: 'address[]' },
          { name: 'recipientShares', type: 'uint256[]' },
          { name: 'ceoWeight', type: 'uint256' },
          { name: 'communityStake', type: 'uint256' },
          { name: 'totalFunded', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'lastFundedAt', type: 'uint256' },
          { name: 'proposer', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOProjects',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveProjects',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'projectId', type: 'bytes32' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'projectType', type: 'uint8' },
          { name: 'registryId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'primaryRecipient', type: 'address' },
          { name: 'additionalRecipients', type: 'address[]' },
          { name: 'recipientShares', type: 'uint256[]' },
          { name: 'ceoWeight', type: 'uint256' },
          { name: 'communityStake', type: 'uint256' },
          { name: 'totalFunded', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'lastFundedAt', type: 'uint256' },
          { name: 'proposer', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentEpoch',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'epochId', type: 'uint256' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'totalBudget', type: 'uint256' },
          { name: 'matchingPool', type: 'uint256' },
          { name: 'distributed', type: 'uint256' },
          { name: 'finalized', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'calculateAllocation',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProjectEpochStake',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'epochId', type: 'uint256' },
    ],
    outputs: [
      { name: 'totalStake', type: 'uint256' },
      { name: 'numStakers', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setDAOConfig',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'minStake', type: 'uint256' },
          { name: 'maxStake', type: 'uint256' },
          { name: 'epochDuration', type: 'uint256' },
          { name: 'cooldownPeriod', type: 'uint256' },
          { name: 'matchingMultiplier', type: 'uint256' },
          { name: 'quadraticEnabled', type: 'bool' },
          { name: 'ceoWeightCap', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDAOConfig',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'minStake', type: 'uint256' },
          { name: 'maxStake', type: 'uint256' },
          { name: 'epochDuration', type: 'uint256' },
          { name: 'cooldownPeriod', type: 'uint256' },
          { name: 'matchingMultiplier', type: 'uint256' },
          { name: 'quadraticEnabled', type: 'bool' },
          { name: 'ceoWeightCap', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
export interface DAOServiceConfig {
  rpcUrl: string
  chainId: number
  daoRegistryAddress: Address
  daoFundingAddress: Address
  privateKey?: string
}

interface RawDAOResult {
  daoId: `0x${string}`
  name: string
  displayName: string
  description: string
  treasury: Address
  council: Address
  ceoAgent: Address
  feeConfig: Address
  ceoModelId: `0x${string}`
  manifestCid: string
  status: number
  createdAt: bigint
  updatedAt: bigint
  creator: Address
}

interface RawPersonaResult {
  name: string
  pfpCid: string
  description: string
  personality: string
  traits: readonly string[]
}

interface RawParamsResult {
  minQualityScore: bigint
  councilVotingPeriod: bigint
  gracePeriod: bigint
  minProposalStake: bigint
  quorumBps: bigint
}

interface RawMemberResult {
  member: Address
  agentId: bigint
  role: string
  weight: bigint
  addedAt: bigint
  isActive: boolean
}

interface RawDAOFullResult {
  dao: RawDAOResult
  ceoPersona: RawPersonaResult
  params: RawParamsResult
  councilMembers: readonly RawMemberResult[]
  linkedPackages: readonly `0x${string}`[]
  linkedRepos: readonly `0x${string}`[]
}

interface RawProjectResult {
  projectId: `0x${string}`
  daoId: `0x${string}`
  projectType: number
  registryId: `0x${string}`
  name: string
  description: string
  primaryRecipient: Address
  additionalRecipients: readonly Address[]
  recipientShares: readonly bigint[]
  ceoWeight: bigint
  communityStake: bigint
  totalFunded: bigint
  status: number
  createdAt: bigint
  lastFundedAt: bigint
  proposer: Address
}

interface RawEpochResult {
  epochId: bigint
  daoId: `0x${string}`
  startTime: bigint
  endTime: bigint
  totalBudget: bigint
  matchingPool: bigint
  distributed: bigint
  finalized: boolean
}

interface RawFundingConfigResult {
  minStake: bigint
  maxStake: bigint
  epochDuration: bigint
  cooldownPeriod: bigint
  matchingMultiplier: bigint
  quadraticEnabled: boolean
  ceoWeightCap: bigint
}

// Type guards for contract results
function isRawDAOResult(value: unknown): value is RawDAOResult {
  return (
    isPlainObject(value) &&
    hasKey(value, 'daoId') &&
    hasKey(value, 'name') &&
    hasKey(value, 'treasury')
  )
}

function expectRawDAO(result: unknown): RawDAOResult {
  if (!isRawDAOResult(result)) {
    throw new Error('Invalid DAO result from contract')
  }
  return result
}

function isRawDAOFullResult(value: unknown): value is RawDAOFullResult {
  return isPlainObject(value) && hasKey(value, 'dao') && hasKey(value, 'params')
}

function expectRawDAOFull(result: unknown): RawDAOFullResult {
  if (!isRawDAOFullResult(result)) {
    throw new Error('Invalid DAOFull result from contract')
  }
  return result
}

function isRawPersonaResult(value: unknown): value is RawPersonaResult {
  return (
    isPlainObject(value) && hasKey(value, 'name') && hasKey(value, 'traits')
  )
}

function expectRawPersona(result: unknown): RawPersonaResult {
  if (!isRawPersonaResult(result)) {
    throw new Error('Invalid persona result from contract')
  }
  return result
}

function isRawParamsResult(value: unknown): value is RawParamsResult {
  return (
    isPlainObject(value) &&
    hasKey(value, 'minQualityScore') &&
    hasKey(value, 'quorumBps')
  )
}

function expectRawParams(result: unknown): RawParamsResult {
  if (!isRawParamsResult(result)) {
    throw new Error('Invalid params result from contract')
  }
  return result
}

function isRawProjectResult(value: unknown): value is RawProjectResult {
  return (
    isPlainObject(value) &&
    hasKey(value, 'projectId') &&
    hasKey(value, 'daoId') &&
    hasKey(value, 'name')
  )
}

function expectRawProject(result: unknown): RawProjectResult {
  if (!isRawProjectResult(result)) {
    throw new Error('Invalid project result from contract')
  }
  return result
}

function isRawEpochResult(value: unknown): value is RawEpochResult {
  return (
    isPlainObject(value) &&
    hasKey(value, 'epochId') &&
    hasKey(value, 'daoId') &&
    hasKey(value, 'startTime')
  )
}

function expectRawEpoch(result: unknown): RawEpochResult {
  if (!isRawEpochResult(result)) {
    throw new Error('Invalid epoch result from contract')
  }
  return result
}

function isRawFundingConfigResult(
  value: unknown,
): value is RawFundingConfigResult {
  return (
    isPlainObject(value) &&
    hasKey(value, 'minStake') &&
    hasKey(value, 'maxStake')
  )
}

function expectRawFundingConfig(result: unknown): RawFundingConfigResult {
  if (!isRawFundingConfigResult(result)) {
    throw new Error('Invalid funding config result from contract')
  }
  return result
}

function expectHexArray(result: unknown): `0x${string}`[] {
  if (!Array.isArray(result)) throw new Error('Expected hex array')
  return [...result]
}

function expectMemberArray(result: unknown): readonly RawMemberResult[] {
  if (!Array.isArray(result)) throw new Error('Expected member array')
  return result
}

function expectProjectArray(result: unknown): readonly RawProjectResult[] {
  if (!Array.isArray(result)) throw new Error('Expected project array')
  return result
}

function expectTupleResult(result: unknown): [bigint, bigint] {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error('Expected tuple of [bigint, bigint]')
  }
  return [toBigInt(result[0]), toBigInt(result[1])]
}

// Type guard for DAOStatus values
function isDAOStatus(value: number): value is DAOStatus {
  return value >= 0 && value <= 3
}

// Type guard for FundingStatus values
function isFundingStatus(value: number): value is FundingStatus {
  return value >= 0 && value <= 5
}

// Enum converters (status values come from contract as numbers)
function toDAOStatus(value: number): DAOStatus {
  if (!isDAOStatus(value)) {
    throw new Error(`Invalid DAOStatus: ${value}`)
  }
  return value
}

function toFundingStatus(value: number): FundingStatus {
  if (!isFundingStatus(value)) {
    throw new Error(`Invalid FundingStatus: ${value}`)
  }
  return value
}

// Define client types using ReturnType to avoid monorepo type resolution issues
type ViemPublicClient = ReturnType<
  typeof createPublicClient<HttpTransport, Chain>
>
type ViemWalletClient = ReturnType<
  typeof createWalletClient<HttpTransport, Chain, Account>
>

export class DAOService {
  private publicClient: ViemPublicClient
  private walletClient: ViemWalletClient | null = null
  private chain: Chain
  private config: DAOServiceConfig
  private daoCache: Map<string, DAOFull> = new Map()

  /**
   * Create a DAOService instance.
   *
   * SECURITY: In production (mainnet/testnet), raw private keys are blocked.
   * Use DAOService.create() which initializes KMS automatically.
   */
  constructor(config: DAOServiceConfig) {
    this.config = config
    this.chain = this.getChain(config.chainId)

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    if (config.privateKey) {
      const keyHex = toHex(config.privateKey)

      // SECURITY: Block raw private keys in production
      if (keyHex.length === 66 && isProductionEnv()) {
        throw new Error(
          'SECURITY: Raw private keys are not allowed in production. ' +
            'Use DAOService.create() with KMS or provide an address for KMS lookup.',
        )
      }

      // Development only: Allow local signing with warning
      if (keyHex.length === 66) {
        console.warn(
          '[DAOService] ⚠️  Using local private key. NOT secure for production.',
        )
        const account = privateKeyToAccount(keyHex)
        this.walletClient = createWalletClient({
          account,
          chain: this.chain,
          transport: http(config.rpcUrl),
        })
      }
      // If address only, wallet client stays null until KMS init
    }
  }

  /**
   * Create a DAOService with KMS initialized.
   * This is the recommended way to create a DAOService in production.
   */
  static async create(
    config: DAOServiceConfig,
    operatorAddress: Address,
  ): Promise<DAOService> {
    const service = new DAOService({
      ...config,
      privateKey: undefined, // Don't use private key path
    })
    await service.initializeKMS(operatorAddress)
    return service
  }

  /**
   * Initialize KMS for secure threshold signing
   * Call this in production before any write operations
   */
  async initializeKMS(operatorAddress: Address): Promise<void> {
    const result = await createKMSWalletClient(
      { address: operatorAddress },
      this.chain,
      this.config.rpcUrl,
    )
    this.walletClient = result.client
    console.log(
      `[DAOService] KMS initialized for ${operatorAddress} (${result.account.type})`,
    )
  }

  private getChain(chainId: number) {
    switch (chainId) {
      case 8453:
        return base
      case 84532:
        return baseSepolia
      case 31337:
        return localhost
      default:
        return localhost
    }
  }
  async getDAO(daoId: string): Promise<DAO> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAO',
      args: [toHex(daoId)],
    })

    return this.parseDAO(expectRawDAO(result))
  }

  async getDAOByName(name: string): Promise<DAO> {
    expectDefined(name, 'DAO name is required')
    expect(
      name.length > 0 && name.length <= 100,
      `DAO name must be 1-100 characters, got ${name.length}`,
    )
    const result = await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOByName',
      args: [name],
    })

    return this.parseDAO(expectRawDAO(result))
  }

  async getDAOFull(daoId: string): Promise<DAOFull> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const cached = this.daoCache.get(daoId)
    if (cached) {
      return cached
    }

    const result = await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOFull',
      args: [toHex(daoId)],
    })

    const daoFull = this.parseDAOFull(expectRawDAOFull(result))
    this.daoCache.set(daoId, daoFull)

    return daoFull
  }

  async getCEOPersona(daoId: string): Promise<CEOPersona> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectRawPersona(
      await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getCEOPersona',
        args: [toHex(daoId)],
      }),
    )

    return {
      name: result.name,
      pfpCid: result.pfpCid,
      description: result.description,
      personality: result.personality,
      traits: [...result.traits],
      voiceStyle: '',
      communicationTone: 'professional',
      specialties: [],
    }
  }

  async getGovernanceParams(daoId: string): Promise<GovernanceParams> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectRawParams(
      await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getGovernanceParams',
        args: [toHex(daoId)],
      }),
    )

    return {
      minQualityScore: Number(result.minQualityScore),
      councilVotingPeriod: Number(result.councilVotingPeriod),
      gracePeriod: Number(result.gracePeriod),
      minProposalStake: result.minProposalStake,
      quorumBps: Number(result.quorumBps),
    }
  }

  async getCouncilMembers(daoId: string): Promise<CouncilMemberConfig[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectMemberArray(
      await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getCouncilMembers',
        args: [toHex(daoId)],
      }),
    )

    return result.map((m) => ({
      member: m.member,
      agentId: m.agentId,
      role: m.role,
      weight: Number(m.weight),
      addedAt: Number(m.addedAt),
      isActive: m.isActive,
    }))
  }

  async getLinkedPackages(daoId: string): Promise<string[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getLinkedPackages',
      args: [toHex(daoId)],
    })) as readonly `0x${string}`[]

    return [...result]
  }

  async getLinkedRepos(daoId: string): Promise<string[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getLinkedRepos',
      args: [toHex(daoId)],
    })) as readonly `0x${string}`[]

    return [...result]
  }

  async getAllDAOs(): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getAllDAOs',
    })) as readonly `0x${string}`[]

    return [...result]
  }

  async getActiveDAOs(): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getActiveDAOs',
    })) as readonly `0x${string}`[]

    return [...result]
  }

  async daoExists(daoId: string): Promise<boolean> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    return this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'daoExists',
      args: [toHex(daoId)],
    })
  }

  async getDAOCount(): Promise<number> {
    const result = await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOCount',
    })

    return Number(result)
  }

  async isDAOAdmin(daoId: string, admin: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'isDAOAdmin',
      args: [toHex(daoId), admin],
    })
  }

  async isCouncilMember(daoId: string, member: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'isCouncilMember',
      args: [toHex(daoId), member],
    })
  }
  async createDAO(params: {
    name: string
    displayName: string
    description: string
    treasury: Address
    manifestCid: string
    ceoPersona: CEOPersona
    governanceParams: GovernanceParams
  }): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'createDAO',
      args: [
        params.name,
        params.displayName,
        params.description,
        params.treasury,
        params.manifestCid,
        {
          name: params.ceoPersona.name,
          pfpCid: params.ceoPersona.pfpCid,
          description: params.ceoPersona.description,
          personality: params.ceoPersona.personality,
          traits: params.ceoPersona.traits,
        },
        {
          minQualityScore: BigInt(params.governanceParams.minQualityScore),
          councilVotingPeriod: BigInt(
            params.governanceParams.councilVotingPeriod,
          ),
          gracePeriod: BigInt(params.governanceParams.gracePeriod),
          minProposalStake: params.governanceParams.minProposalStake,
          quorumBps: BigInt(params.governanceParams.quorumBps),
        },
      ],
    })

    return hash
  }

  async setCEOPersona(daoId: string, persona: CEOPersona): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setCEOPersona',
      args: [
        toHex(daoId),
        {
          name: persona.name,
          pfpCid: persona.pfpCid,
          description: persona.description,
          personality: persona.personality,
          traits: persona.traits,
        },
      ],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async setCEOModel(daoId: string, modelId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setCEOModel',
      args: [toHex(daoId), toHex(modelId)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async setGovernanceParams(
    daoId: string,
    params: GovernanceParams,
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setGovernanceParams',
      args: [
        toHex(daoId),
        {
          minQualityScore: BigInt(params.minQualityScore),
          councilVotingPeriod: BigInt(params.councilVotingPeriod),
          gracePeriod: BigInt(params.gracePeriod),
          minProposalStake: params.minProposalStake,
          quorumBps: BigInt(params.quorumBps),
        },
      ],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async addCouncilMember(
    daoId: string,
    member: Address,
    agentId: bigint,
    role: string,
    weight: number,
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'addCouncilMember',
      args: [toHex(daoId), member, agentId, role, BigInt(weight)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async removeCouncilMember(daoId: string, member: Address): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'removeCouncilMember',
      args: [toHex(daoId), member],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async linkPackage(daoId: string, packageId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'linkPackage',
      args: [toHex(daoId), toHex(packageId)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async unlinkPackage(daoId: string, packageId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'unlinkPackage',
      args: [toHex(daoId), toHex(packageId)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async linkRepo(daoId: string, repoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'linkRepo',
      args: [toHex(daoId), toHex(repoId)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async unlinkRepo(daoId: string, repoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'unlinkRepo',
      args: [toHex(daoId), toHex(repoId)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async setDAOContracts(
    daoId: string,
    contracts: { council?: Address; ceoAgent?: Address; feeConfig?: Address },
  ): Promise<Hash[]> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hashes: Hash[] = []

    if (contracts.council) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOCouncilContract',
        args: [toHex(daoId), contracts.council],
      })
      hashes.push(hash)
    }

    if (contracts.ceoAgent) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOCEOAgent',
        args: [toHex(daoId), contracts.ceoAgent],
      })
      hashes.push(hash)
    }

    if (contracts.feeConfig) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOFeeConfig',
        args: [toHex(daoId), contracts.feeConfig],
      })
      hashes.push(hash)
    }

    this.daoCache.delete(daoId)
    return hashes
  }

  async setDAOStatus(daoId: string, status: DAOStatus): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setDAOStatus',
      args: [toHex(daoId), status],
    })

    this.daoCache.delete(daoId)
    return hash
  }
  async getFundingProject(projectId: string): Promise<FundingProject> {
    const result = expectRawProject(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getProject',
        args: [toHex(projectId)],
      }),
    )

    return this.parseFundingProject(result)
  }

  async getDAOProjects(daoId: string): Promise<string[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectHexArray(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getDAOProjects',
        args: [toHex(daoId)],
      }),
    )

    return result
  }

  async getActiveProjects(daoId: string): Promise<FundingProject[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectProjectArray(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getActiveProjects',
        args: [toHex(daoId)],
      }),
    )

    return result.map((p) => this.parseFundingProject(p))
  }

  async getCurrentEpoch(daoId: string): Promise<FundingEpoch> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectRawEpoch(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getCurrentEpoch',
        args: [toHex(daoId)],
      }),
    )

    return {
      epochId: Number(result.epochId),
      daoId: result.daoId,
      startTime: Number(result.startTime),
      endTime: Number(result.endTime),
      totalBudget: result.totalBudget,
      matchingPool: result.matchingPool,
      distributed: result.distributed,
      finalized: result.finalized,
    }
  }

  async calculateAllocation(projectId: string): Promise<bigint> {
    return toBigInt(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'calculateAllocation',
        args: [toHex(projectId)],
      }),
    )
  }

  async getProjectEpochStake(
    projectId: string,
    epochId: number,
  ): Promise<{ totalStake: bigint; numStakers: number }> {
    const result = expectTupleResult(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getProjectEpochStake',
        args: [toHex(projectId), BigInt(epochId)],
      }),
    )

    return {
      totalStake: result[0],
      numStakers: Number(result[1]),
    }
  }

  async getFundingConfig(daoId: string): Promise<FundingConfig> {
    const result = expectRawFundingConfig(
      await this.publicClient.readContract({
        address: this.config.daoFundingAddress,
        abi: DAOFundingABI,
        functionName: 'getDAOConfig',
        args: [toHex(daoId)],
      }),
    )

    return {
      minStake: result.minStake,
      maxStake: result.maxStake,
      epochDuration: Number(result.epochDuration),
      cooldownPeriod: Number(result.cooldownPeriod),
      matchingMultiplier: Number(result.matchingMultiplier),
      quadraticEnabled: result.quadraticEnabled,
      ceoWeightCap: Number(result.ceoWeightCap),
    }
  }
  async proposeProject(params: {
    daoId: string
    projectType: 'package' | 'repo'
    registryId: string
    name: string
    description: string
    primaryRecipient: Address
    additionalRecipients: Address[]
    recipientShares: number[]
  }): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const projectType = params.projectType === 'package' ? 0 : 1

    const hash = await this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'proposeProject',
      args: [
        toHex(params.daoId),
        projectType,
        toHex(params.registryId),
        params.name,
        params.description,
        params.primaryRecipient,
        params.additionalRecipients,
        params.recipientShares.map((s) => BigInt(s)),
      ],
    })

    return hash
  }

  async acceptProject(projectId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'acceptProject',
      args: [toHex(projectId)],
    })
  }

  async rejectProject(projectId: string, reason: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'rejectProject',
      args: [toHex(projectId), reason],
    })
  }

  async setCEOWeight(projectId: string, weight: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'setCEOWeight',
      args: [toHex(projectId), BigInt(weight)],
    })
  }

  async stake(projectId: string, amount: bigint): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'stake',
      args: [toHex(projectId), amount],
      value: amount,
    })
  }

  async unstake(projectId: string, epochId: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'unstake',
      args: [toHex(projectId), BigInt(epochId)],
    })
  }

  async createEpoch(
    daoId: string,
    budget: bigint,
    matchingPool: bigint,
  ): Promise<Hash> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    expect(budget > 0n, `Budget must be positive, got ${budget.toString()}`)
    expect(
      matchingPool >= 0n,
      `Matching pool must be non-negative, got ${matchingPool.toString()}`,
    )
    expect(
      this.walletClient !== null && this.walletClient !== undefined,
      'Wallet client not initialized',
    )

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'createEpoch',
      args: [toHex(daoId), budget, matchingPool],
    })
  }

  async finalizeEpoch(daoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'finalizeEpoch',
      args: [toHex(daoId)],
    })
  }

  async setFundingConfig(daoId: string, config: FundingConfig): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'setDAOConfig',
      args: [
        toHex(daoId),
        {
          minStake: config.minStake,
          maxStake: config.maxStake,
          epochDuration: BigInt(config.epochDuration),
          cooldownPeriod: BigInt(config.cooldownPeriod),
          matchingMultiplier: BigInt(config.matchingMultiplier),
          quadraticEnabled: config.quadraticEnabled,
          ceoWeightCap: BigInt(config.ceoWeightCap),
        },
      ],
    })
  }
  async getFundingAllocations(daoId: string): Promise<FundingAllocation[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const projects = await this.getActiveProjects(daoId)
    const epoch = await this.getCurrentEpoch(daoId)

    const allocations: FundingAllocation[] = []
    let totalAllocation = BigInt(0)

    for (const project of projects) {
      const allocation = await this.calculateAllocation(project.projectId)
      const stake = await this.getProjectEpochStake(
        project.projectId,
        epoch.epochId,
      )

      allocations.push({
        projectId: project.projectId,
        projectName: project.name,
        ceoWeight: project.ceoWeight,
        communityStake: stake.totalStake,
        stakerCount: stake.numStakers,
        allocation,
        allocationPercentage: 0,
      })

      totalAllocation += allocation
    }

    // Calculate percentages
    for (const alloc of allocations) {
      if (totalAllocation > 0) {
        alloc.allocationPercentage =
          Number((alloc.allocation * BigInt(10000)) / totalAllocation) / 100
      }
    }

    return allocations.sort((a, b) => Number(b.allocation - a.allocation))
  }

  clearCache(): void {
    this.daoCache.clear()
  }
  private parseDAO(raw: RawDAOResult): DAO {
    return {
      daoId: raw.daoId,
      name: raw.name,
      displayName: raw.displayName,
      description: raw.description,
      treasury: raw.treasury,
      council: raw.council,
      ceoAgent: raw.ceoAgent,
      feeConfig: raw.feeConfig,
      ceoModelId: raw.ceoModelId,
      manifestCid: raw.manifestCid,
      status: toDAOStatus(raw.status),
      createdAt: Number(raw.createdAt),
      updatedAt: Number(raw.updatedAt),
      creator: raw.creator,
    }
  }

  private parseDAOFull(raw: RawDAOFullResult): DAOFull {
    return {
      dao: this.parseDAO(raw.dao),
      ceoPersona: {
        name: raw.ceoPersona.name,
        pfpCid: raw.ceoPersona.pfpCid,
        description: raw.ceoPersona.description,
        personality: raw.ceoPersona.personality,
        traits: [...raw.ceoPersona.traits],
        voiceStyle: '',
        communicationTone: 'professional',
        specialties: [],
      },
      params: {
        minQualityScore: Number(raw.params.minQualityScore),
        councilVotingPeriod: Number(raw.params.councilVotingPeriod),
        gracePeriod: Number(raw.params.gracePeriod),
        minProposalStake: raw.params.minProposalStake,
        quorumBps: Number(raw.params.quorumBps),
      },
      councilMembers: raw.councilMembers.map((m) => ({
        member: m.member,
        agentId: m.agentId,
        role: m.role,
        weight: Number(m.weight),
        addedAt: Number(m.addedAt),
        isActive: m.isActive,
      })),
      linkedPackages: [...raw.linkedPackages],
      linkedRepos: [...raw.linkedRepos],
    }
  }

  private parseFundingProject(raw: RawProjectResult): FundingProject {
    return {
      projectId: raw.projectId,
      daoId: raw.daoId,
      projectType: raw.projectType === 0 ? 'package' : 'repo',
      registryId: raw.registryId,
      name: raw.name,
      description: raw.description,
      primaryRecipient: raw.primaryRecipient,
      additionalRecipients: [...raw.additionalRecipients],
      recipientShares: raw.recipientShares.map((s) => Number(s)),
      ceoWeight: Number(raw.ceoWeight),
      communityStake: raw.communityStake,
      totalFunded: raw.totalFunded,
      status: toFundingStatus(raw.status),
      createdAt: Number(raw.createdAt),
      lastFundedAt: Number(raw.lastFundedAt),
      proposer: raw.proposer,
    }
  }
}
let daoServiceInstance: DAOService | null = null

export function createDAOService(config: DAOServiceConfig): DAOService {
  daoServiceInstance = new DAOService(config)
  return daoServiceInstance
}

export function getDAOService(): DAOService {
  if (!daoServiceInstance) {
    throw new Error('DAOService not initialized. Call createDAOService first.')
  }
  return daoServiceInstance
}
