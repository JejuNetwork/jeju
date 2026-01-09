import { isProductionEnv } from '@jejunetwork/config'
import {
  expectTrue as expect,
  expectDefined,
  hasKey,
  isPlainObject,
  toBigInt,
} from '@jejunetwork/types'
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
import {
  type BoardMemberConfig,
  type DAOStatus,
  type DirectorPersona,
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
import { getChainById } from './chains'
import { createKMSHttpWalletClient } from './kms-signer'

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
        name: 'directorPersona',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfpCid', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'traits', type: 'string[]' },
          { name: 'isHuman', type: 'bool' },
          { name: 'humanAddress', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'decisionFallbackDays', type: 'uint256' },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'minQualityScore', type: 'uint256' },
          { name: 'boardVotingPeriod', type: 'uint256' },
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
          { name: 'board', type: 'address' },
          { name: 'directorAgent', type: 'address' },
          { name: 'feeConfig', type: 'address' },
          { name: 'directorModelId', type: 'bytes32' },
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
              { name: 'board', type: 'address' },
              { name: 'directorAgent', type: 'address' },
              { name: 'feeConfig', type: 'address' },
              { name: 'directorModelId', type: 'bytes32' },
              { name: 'manifestCid', type: 'string' },
              { name: 'status', type: 'uint8' },
              { name: 'createdAt', type: 'uint256' },
              { name: 'updatedAt', type: 'uint256' },
              { name: 'creator', type: 'address' },
            ],
          },
          {
            name: 'directorPersona',
            type: 'tuple',
            components: [
              { name: 'name', type: 'string' },
              { name: 'pfpCid', type: 'string' },
              { name: 'description', type: 'string' },
              { name: 'personality', type: 'string' },
              { name: 'traits', type: 'string[]' },
              { name: 'isHuman', type: 'bool' },
              { name: 'humanAddress', type: 'address' },
              { name: 'agentId', type: 'uint256' },
              { name: 'decisionFallbackDays', type: 'uint256' },
            ],
          },
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'minQualityScore', type: 'uint256' },
              { name: 'boardVotingPeriod', type: 'uint256' },
              { name: 'gracePeriod', type: 'uint256' },
              { name: 'minProposalStake', type: 'uint256' },
              { name: 'quorumBps', type: 'uint256' },
            ],
          },
          {
            name: 'boardMembers',
            type: 'tuple[]',
            components: [
              { name: 'member', type: 'address' },
              { name: 'agentId', type: 'uint256' },
              { name: 'role', type: 'string' },
              { name: 'weight', type: 'uint256' },
              { name: 'addedAt', type: 'uint256' },
              { name: 'isActive', type: 'bool' },
              { name: 'isHuman', type: 'bool' },
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
          { name: 'board', type: 'address' },
          { name: 'directorAgent', type: 'address' },
          { name: 'feeConfig', type: 'address' },
          { name: 'directorModelId', type: 'bytes32' },
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
    name: 'getDirectorPersona',
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
          { name: 'isHuman', type: 'bool' },
          { name: 'humanAddress', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'decisionFallbackDays', type: 'uint256' },
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
          { name: 'boardVotingPeriod', type: 'uint256' },
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
    name: 'getBoardMembers',
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
          { name: 'isHuman', type: 'bool' },
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
    name: 'isBoardMember',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setDirectorPersona',
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
          { name: 'isHuman', type: 'bool' },
          { name: 'humanAddress', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'decisionFallbackDays', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDirectorModel',
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
          { name: 'boardVotingPeriod', type: 'uint256' },
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
    name: 'addBoardMember',
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
    name: 'removeBoardMember',
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
    name: 'setDAOBoardContract',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'board', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDAODirectorAgent',
    inputs: [
      { name: 'daoId', type: 'bytes32' },
      { name: 'directorAgent', type: 'address' },
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
    name: 'DirectorPersonaUpdated',
    inputs: [
      { name: 'daoId', type: 'bytes32', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'pfpCid', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DirectorModelChanged',
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
    name: 'setDirectorWeight',
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
          { name: 'directorWeight', type: 'uint256' },
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
          { name: 'directorWeight', type: 'uint256' },
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
          { name: 'directorWeightCap', type: 'uint256' },
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
          { name: 'directorWeightCap', type: 'uint256' },
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
  operatorAddress?: Address // For KMS-based signing
}

interface RawDAOResult {
  daoId: `0x${string}`
  name: string
  displayName: string
  description: string
  treasury: Address
  board: Address
  directorAgent: Address
  feeConfig: Address
  directorModelId: `0x${string}`
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
  isHuman?: boolean
  decisionFallbackDays?: number
}

interface RawParamsResult {
  minQualityScore: bigint
  boardVotingPeriod: bigint
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
  isHuman?: boolean
}

interface RawDAOFullResult {
  dao: RawDAOResult
  directorPersona: RawPersonaResult
  params: RawParamsResult
  boardMembers: readonly RawMemberResult[]
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
  directorWeight: bigint
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
  directorWeightCap: bigint
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
        if (isProductionEnv()) {
          throw new Error(
            'SECURITY: Raw private keys are forbidden in production. Use KMS.',
          )
        }
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
    const walletClient = await createKMSHttpWalletClient({
      address: operatorAddress,
      chain: this.chain,
      rpcUrl: this.config.rpcUrl,
    })
    this.walletClient = walletClient as ViemWalletClient
    console.log(
      `[DAOService] KMS initialized for ${operatorAddress} (${walletClient.account?.type || 'local'})`,
    )
  }

  private getChain(chainId: number) {
    return getChainById(chainId)
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

  async getDAOFull(daoIdOrName: string): Promise<DAOFull> {
    expectDefined(daoIdOrName, 'DAO ID or name is required')
    expect(
      daoIdOrName.length > 0 && daoIdOrName.length <= 100,
      `DAO ID/name must be 1-100 characters, got ${daoIdOrName.length}`,
    )
    const cached = this.daoCache.get(daoIdOrName)
    if (cached) {
      return cached
    }

    let daoIdHex: `0x${string}`

    // If it looks like a bytes32 hex, use it directly
    if (daoIdOrName.startsWith('0x') && daoIdOrName.length === 66) {
      daoIdHex = daoIdOrName as `0x${string}`
    } else {
      // Look up by name first to get the actual daoId
      const nameResult = await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getDAOByName',
        args: [daoIdOrName],
      })
      const dao = nameResult as { daoId: `0x${string}` }
      daoIdHex = dao.daoId
    }

    const result = await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOFull',
      args: [daoIdHex],
    })

    const daoFull = this.parseDAOFull(expectRawDAOFull(result))
    this.daoCache.set(daoIdOrName, daoFull)

    return daoFull
  }

  async getDirectorPersona(daoId: string): Promise<DirectorPersona> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectRawPersona(
      await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getDirectorPersona',
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
      isHuman: result.isHuman ?? false,
      decisionFallbackDays: result.decisionFallbackDays ?? 7,
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
      boardVotingPeriod: Number(result.boardVotingPeriod),
      gracePeriod: Number(result.gracePeriod),
      minProposalStake: result.minProposalStake.toString(),
      quorumBps: Number(result.quorumBps),
    }
  }

  async getBoardMembers(daoId: string): Promise<BoardMemberConfig[]> {
    expectDefined(daoId, 'DAO ID is required')
    expect(
      daoId.length > 0 && daoId.length <= 100,
      `DAO ID must be 1-100 characters, got ${daoId.length}`,
    )
    const result = expectMemberArray(
      await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getBoardMembers',
        args: [toHex(daoId)],
      }),
    )

    return result.map((m) => ({
      member: m.member,
      agentId: m.agentId.toString(),
      role: m.role,
      weight: Number(m.weight),
      addedAt: Number(m.addedAt),
      isActive: m.isActive,
      isHuman: m.isHuman ?? false,
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

  async daoExists(daoIdOrName: string): Promise<boolean> {
    expectDefined(daoIdOrName, 'DAO ID or name is required')
    expect(
      daoIdOrName.length > 0 && daoIdOrName.length <= 100,
      `DAO ID/name must be 1-100 characters, got ${daoIdOrName.length}`,
    )

    // If it looks like a bytes32 hex, check by ID directly
    if (daoIdOrName.startsWith('0x') && daoIdOrName.length === 66) {
      return this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'daoExists',
        args: [daoIdOrName as `0x${string}`],
      })
    }

    // Otherwise, try to look up by name using getDAOByName
    // If it returns a non-zero daoId, the DAO exists
    try {
      const result = await this.publicClient.readContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'getDAOByName',
        args: [daoIdOrName],
      })
      // Check if the returned daoId is non-zero
      const dao = result as { daoId: `0x${string}` }
      return (
        dao.daoId !==
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    } catch {
      return false
    }
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

  async isBoardMember(daoId: string, member: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'isBoardMember',
      args: [toHex(daoId), member],
    })
  }
  async createDAO(params: {
    name: string
    displayName: string
    description: string
    treasury: Address
    manifestCid: string
    directorPersona: DirectorPersona
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
          name: params.directorPersona.name,
          pfpCid: params.directorPersona.pfpCid,
          description: params.directorPersona.description,
          personality: params.directorPersona.personality,
          traits: params.directorPersona.traits,
          isHuman: params.directorPersona.isHuman,
          humanAddress:
            params.directorPersona.humanAddress ??
            '0x0000000000000000000000000000000000000000',
          agentId: BigInt(params.directorPersona.agentId ?? 0),
          decisionFallbackDays: BigInt(
            params.directorPersona.decisionFallbackDays ?? 7,
          ),
        },
        {
          minQualityScore: BigInt(params.governanceParams.minQualityScore),
          boardVotingPeriod: BigInt(params.governanceParams.boardVotingPeriod),
          gracePeriod: BigInt(params.governanceParams.gracePeriod),
          minProposalStake: BigInt(params.governanceParams.minProposalStake),
          quorumBps: BigInt(params.governanceParams.quorumBps),
        },
      ],
    })

    return hash
  }

  async setDirectorPersona(
    daoId: string,
    persona: DirectorPersona,
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setDirectorPersona',
      args: [
        toHex(daoId),
        {
          name: persona.name,
          pfpCid: persona.pfpCid,
          description: persona.description,
          personality: persona.personality,
          traits: persona.traits,
          isHuman: persona.isHuman,
          humanAddress:
            persona.humanAddress ??
            '0x0000000000000000000000000000000000000000',
          agentId: BigInt(persona.agentId ?? 0),
          decisionFallbackDays: BigInt(persona.decisionFallbackDays ?? 7),
        },
      ],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async setDirectorModel(daoId: string, modelId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setDirectorModel',
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
          boardVotingPeriod: BigInt(params.boardVotingPeriod),
          gracePeriod: BigInt(params.gracePeriod),
          minProposalStake: BigInt(params.minProposalStake),
          quorumBps: BigInt(params.quorumBps),
        },
      ],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async addBoardMember(
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
      functionName: 'addBoardMember',
      args: [toHex(daoId), member, agentId, role, BigInt(weight)],
    })

    this.daoCache.delete(daoId)
    return hash
  }

  async removeBoardMember(daoId: string, member: Address): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'removeBoardMember',
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
    contracts: {
      board?: Address
      directorAgent?: Address
      feeConfig?: Address
    },
  ): Promise<Hash[]> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    const hashes: Hash[] = []

    if (contracts.board) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOBoardContract',
        args: [toHex(daoId), contracts.board],
      })
      hashes.push(hash)
    }

    if (contracts.directorAgent) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAODirectorAgent',
        args: [toHex(daoId), contracts.directorAgent],
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
      directorWeightCap: Number(result.directorWeightCap),
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

  async setDirectorWeight(projectId: string, weight: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized')
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'setDirectorWeight',
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
          directorWeightCap: BigInt(config.directorWeightCap),
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
        directorWeight: project.directorWeight,
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
      board: raw.board, // Map from raw 'board' to typed 'board'
      directorAgent: raw.directorAgent,
      feeConfig: raw.feeConfig,
      directorModelId: raw.directorModelId,
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
      directorPersona: {
        name: raw.directorPersona.name,
        pfpCid: raw.directorPersona.pfpCid,
        description: raw.directorPersona.description,
        personality: raw.directorPersona.personality,
        traits: [...raw.directorPersona.traits],
        voiceStyle: '',
        communicationTone: 'professional',
        specialties: [],
        isHuman: raw.directorPersona.isHuman ?? false,
        decisionFallbackDays: raw.directorPersona.decisionFallbackDays ?? 7,
      },
      params: {
        minQualityScore: Number(raw.params.minQualityScore),
        boardVotingPeriod: Number(raw.params.boardVotingPeriod),
        gracePeriod: Number(raw.params.gracePeriod),
        minProposalStake: raw.params.minProposalStake.toString(),
        quorumBps: Number(raw.params.quorumBps),
      },
      boardMembers: raw.boardMembers.map((m) => ({
        member: m.member,
        agentId: m.agentId.toString(),
        role: m.role,
        weight: Number(m.weight),
        addedAt: Number(m.addedAt),
        isActive: m.isActive,
        isHuman: m.isHuman ?? false,
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
      directorWeight: Number(raw.directorWeight),
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
