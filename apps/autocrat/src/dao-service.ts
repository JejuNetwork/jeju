/**
 * DAO Service - Multi-tenant DAO Management
 * Handles all DAO operations including creation, configuration, and state management
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  type Hash,
  parseEther,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, localhost } from 'viem/chains';
import type {
  DAO,
  DAOFull,
  DAOConfig,
  CEOPersona,
  GovernanceParams,
  CouncilMemberConfig,
  DAOContracts,
  DAOAgents,
  FundingConfig,
  DAOStatus,
  DAOStats,
  PackageInfo,
  RepoInfo,
  ModelInfo,
  FundingProject,
  FundingEpoch,
  FundingAllocation,
} from './types';

// ============ ABIs ============

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
] as const;

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
] as const;

// ============ Types ============

export interface DAOServiceConfig {
  rpcUrl: string;
  chainId: number;
  daoRegistryAddress: Address;
  daoFundingAddress: Address;
  privateKey?: string;
}

interface RawDAOResult {
  daoId: `0x${string}`;
  name: string;
  displayName: string;
  description: string;
  treasury: Address;
  council: Address;
  ceoAgent: Address;
  feeConfig: Address;
  ceoModelId: `0x${string}`;
  manifestCid: string;
  status: number;
  createdAt: bigint;
  updatedAt: bigint;
  creator: Address;
}

interface RawPersonaResult {
  name: string;
  pfpCid: string;
  description: string;
  personality: string;
  traits: readonly string[];
}

interface RawParamsResult {
  minQualityScore: bigint;
  councilVotingPeriod: bigint;
  gracePeriod: bigint;
  minProposalStake: bigint;
  quorumBps: bigint;
}

interface RawMemberResult {
  member: Address;
  agentId: bigint;
  role: string;
  weight: bigint;
  addedAt: bigint;
  isActive: boolean;
}

interface RawDAOFullResult {
  dao: RawDAOResult;
  ceoPersona: RawPersonaResult;
  params: RawParamsResult;
  councilMembers: readonly RawMemberResult[];
  linkedPackages: readonly `0x${string}`[];
  linkedRepos: readonly `0x${string}`[];
}

interface RawProjectResult {
  projectId: `0x${string}`;
  daoId: `0x${string}`;
  projectType: number;
  registryId: `0x${string}`;
  name: string;
  description: string;
  primaryRecipient: Address;
  additionalRecipients: readonly Address[];
  recipientShares: readonly bigint[];
  ceoWeight: bigint;
  communityStake: bigint;
  totalFunded: bigint;
  status: number;
  createdAt: bigint;
  lastFundedAt: bigint;
  proposer: Address;
}

interface RawEpochResult {
  epochId: bigint;
  daoId: `0x${string}`;
  startTime: bigint;
  endTime: bigint;
  totalBudget: bigint;
  matchingPool: bigint;
  distributed: bigint;
  finalized: boolean;
}

interface RawFundingConfigResult {
  minStake: bigint;
  maxStake: bigint;
  epochDuration: bigint;
  cooldownPeriod: bigint;
  matchingMultiplier: bigint;
  quadraticEnabled: boolean;
  ceoWeightCap: bigint;
}

// ============ DAO Service Class ============

export class DAOService {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private config: DAOServiceConfig;
  private daoCache: Map<string, DAOFull> = new Map();

  constructor(config: DAOServiceConfig) {
    this.config = config;

    const chain = this.getChain(config.chainId);

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      });
    }
  }

  private getChain(chainId: number) {
    switch (chainId) {
      case 8453:
        return base;
      case 84532:
        return baseSepolia;
      case 31337:
        return localhost;
      default:
        return localhost;
    }
  }

  // ============ DAO Read Operations ============

  async getDAO(daoId: string): Promise<DAO> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAO',
      args: [daoId as `0x${string}`],
    })) as RawDAOResult;

    return this.parseDAO(result);
  }

  async getDAOByName(name: string): Promise<DAO> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOByName',
      args: [name],
    })) as RawDAOResult;

    return this.parseDAO(result);
  }

  async getDAOFull(daoId: string): Promise<DAOFull> {
    const cached = this.daoCache.get(daoId);
    if (cached) {
      return cached;
    }

    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOFull',
      args: [daoId as `0x${string}`],
    })) as RawDAOFullResult;

    const daoFull = this.parseDAOFull(result);
    this.daoCache.set(daoId, daoFull);

    return daoFull;
  }

  async getCEOPersona(daoId: string): Promise<CEOPersona> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getCEOPersona',
      args: [daoId as `0x${string}`],
    })) as RawPersonaResult;

    return {
      name: result.name,
      pfpCid: result.pfpCid,
      description: result.description,
      personality: result.personality,
      traits: [...result.traits],
      voiceStyle: '',
      communicationTone: 'professional',
      specialties: [],
    };
  }

  async getGovernanceParams(daoId: string): Promise<GovernanceParams> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getGovernanceParams',
      args: [daoId as `0x${string}`],
    })) as RawParamsResult;

    return {
      minQualityScore: Number(result.minQualityScore),
      councilVotingPeriod: Number(result.councilVotingPeriod),
      gracePeriod: Number(result.gracePeriod),
      minProposalStake: result.minProposalStake,
      quorumBps: Number(result.quorumBps),
    };
  }

  async getCouncilMembers(daoId: string): Promise<CouncilMemberConfig[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getCouncilMembers',
      args: [daoId as `0x${string}`],
    })) as readonly RawMemberResult[];

    return result.map((m) => ({
      member: m.member,
      agentId: m.agentId,
      role: m.role,
      weight: Number(m.weight),
      addedAt: Number(m.addedAt),
      isActive: m.isActive,
    }));
  }

  async getLinkedPackages(daoId: string): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getLinkedPackages',
      args: [daoId as `0x${string}`],
    })) as readonly `0x${string}`[];

    return [...result];
  }

  async getLinkedRepos(daoId: string): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getLinkedRepos',
      args: [daoId as `0x${string}`],
    })) as readonly `0x${string}`[];

    return [...result];
  }

  async getAllDAOs(): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getAllDAOs',
    })) as readonly `0x${string}`[];

    return [...result];
  }

  async getActiveDAOs(): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getActiveDAOs',
    })) as readonly `0x${string}`[];

    return [...result];
  }

  async daoExists(daoId: string): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'daoExists',
      args: [daoId as `0x${string}`],
    })) as boolean;
  }

  async getDAOCount(): Promise<number> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'getDAOCount',
    })) as bigint;

    return Number(result);
  }

  async isDAOAdmin(daoId: string, admin: Address): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'isDAOAdmin',
      args: [daoId as `0x${string}`, admin],
    })) as boolean;
  }

  async isCouncilMember(daoId: string, member: Address): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'isCouncilMember',
      args: [daoId as `0x${string}`, member],
    })) as boolean;
  }

  // ============ DAO Write Operations ============

  async createDAO(params: {
    name: string;
    displayName: string;
    description: string;
    treasury: Address;
    manifestCid: string;
    ceoPersona: CEOPersona;
    governanceParams: GovernanceParams;
  }): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
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
          councilVotingPeriod: BigInt(params.governanceParams.councilVotingPeriod),
          gracePeriod: BigInt(params.governanceParams.gracePeriod),
          minProposalStake: params.governanceParams.minProposalStake,
          quorumBps: BigInt(params.governanceParams.quorumBps),
        },
      ],
    });

    return hash;
  }

  async setCEOPersona(daoId: string, persona: CEOPersona): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setCEOPersona',
      args: [
        daoId as `0x${string}`,
        {
          name: persona.name,
          pfpCid: persona.pfpCid,
          description: persona.description,
          personality: persona.personality,
          traits: persona.traits,
        },
      ],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async setCEOModel(daoId: string, modelId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setCEOModel',
      args: [daoId as `0x${string}`, modelId as `0x${string}`],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async setGovernanceParams(daoId: string, params: GovernanceParams): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setGovernanceParams',
      args: [
        daoId as `0x${string}`,
        {
          minQualityScore: BigInt(params.minQualityScore),
          councilVotingPeriod: BigInt(params.councilVotingPeriod),
          gracePeriod: BigInt(params.gracePeriod),
          minProposalStake: params.minProposalStake,
          quorumBps: BigInt(params.quorumBps),
        },
      ],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async addCouncilMember(
    daoId: string,
    member: Address,
    agentId: bigint,
    role: string,
    weight: number
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'addCouncilMember',
      args: [daoId as `0x${string}`, member, agentId, role, BigInt(weight)],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async removeCouncilMember(daoId: string, member: Address): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'removeCouncilMember',
      args: [daoId as `0x${string}`, member],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async linkPackage(daoId: string, packageId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'linkPackage',
      args: [daoId as `0x${string}`, packageId as `0x${string}`],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async unlinkPackage(daoId: string, packageId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'unlinkPackage',
      args: [daoId as `0x${string}`, packageId as `0x${string}`],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async linkRepo(daoId: string, repoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'linkRepo',
      args: [daoId as `0x${string}`, repoId as `0x${string}`],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async unlinkRepo(daoId: string, repoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'unlinkRepo',
      args: [daoId as `0x${string}`, repoId as `0x${string}`],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  async setDAOContracts(
    daoId: string,
    contracts: { council?: Address; ceoAgent?: Address; feeConfig?: Address }
  ): Promise<Hash[]> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hashes: Hash[] = [];

    if (contracts.council) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOCouncilContract',
        args: [daoId as `0x${string}`, contracts.council],
      });
      hashes.push(hash);
    }

    if (contracts.ceoAgent) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOCEOAgent',
        args: [daoId as `0x${string}`, contracts.ceoAgent],
      });
      hashes.push(hash);
    }

    if (contracts.feeConfig) {
      const hash = await this.walletClient.writeContract({
        address: this.config.daoRegistryAddress,
        abi: DAORegistryABI,
        functionName: 'setDAOFeeConfig',
        args: [daoId as `0x${string}`, contracts.feeConfig],
      });
      hashes.push(hash);
    }

    this.daoCache.delete(daoId);
    return hashes;
  }

  async setDAOStatus(daoId: string, status: DAOStatus): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.daoRegistryAddress,
      abi: DAORegistryABI,
      functionName: 'setDAOStatus',
      args: [daoId as `0x${string}`, status],
    });

    this.daoCache.delete(daoId);
    return hash;
  }

  // ============ Funding Read Operations ============

  async getFundingProject(projectId: string): Promise<FundingProject> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getProject',
      args: [projectId as `0x${string}`],
    })) as RawProjectResult;

    return this.parseFundingProject(result);
  }

  async getDAOProjects(daoId: string): Promise<string[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getDAOProjects',
      args: [daoId as `0x${string}`],
    })) as readonly `0x${string}`[];

    return [...result];
  }

  async getActiveProjects(daoId: string): Promise<FundingProject[]> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getActiveProjects',
      args: [daoId as `0x${string}`],
    })) as readonly RawProjectResult[];

    return result.map((p) => this.parseFundingProject(p));
  }

  async getCurrentEpoch(daoId: string): Promise<FundingEpoch> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getCurrentEpoch',
      args: [daoId as `0x${string}`],
    })) as RawEpochResult;

    return {
      epochId: Number(result.epochId),
      daoId: result.daoId,
      startTime: Number(result.startTime),
      endTime: Number(result.endTime),
      totalBudget: result.totalBudget,
      matchingPool: result.matchingPool,
      distributed: result.distributed,
      finalized: result.finalized,
    };
  }

  async calculateAllocation(projectId: string): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'calculateAllocation',
      args: [projectId as `0x${string}`],
    })) as bigint;
  }

  async getProjectEpochStake(projectId: string, epochId: number): Promise<{ totalStake: bigint; numStakers: number }> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getProjectEpochStake',
      args: [projectId as `0x${string}`, BigInt(epochId)],
    })) as [bigint, bigint];

    return {
      totalStake: result[0],
      numStakers: Number(result[1]),
    };
  }

  async getFundingConfig(daoId: string): Promise<FundingConfig> {
    const result = (await this.publicClient.readContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'getDAOConfig',
      args: [daoId as `0x${string}`],
    })) as RawFundingConfigResult;

    return {
      minStake: result.minStake,
      maxStake: result.maxStake,
      epochDuration: Number(result.epochDuration),
      cooldownPeriod: Number(result.cooldownPeriod),
      matchingMultiplier: Number(result.matchingMultiplier),
      quadraticEnabled: result.quadraticEnabled,
      ceoWeightCap: Number(result.ceoWeightCap),
    };
  }

  // ============ Funding Write Operations ============

  async proposeProject(params: {
    daoId: string;
    projectType: 'package' | 'repo';
    registryId: string;
    name: string;
    description: string;
    primaryRecipient: Address;
    additionalRecipients: Address[];
    recipientShares: number[];
  }): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    const projectType = params.projectType === 'package' ? 0 : 1;

    const hash = await this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'proposeProject',
      args: [
        params.daoId as `0x${string}`,
        projectType,
        params.registryId as `0x${string}`,
        params.name,
        params.description,
        params.primaryRecipient,
        params.additionalRecipients,
        params.recipientShares.map((s) => BigInt(s)),
      ],
    });

    return hash;
  }

  async acceptProject(projectId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'acceptProject',
      args: [projectId as `0x${string}`],
    });
  }

  async rejectProject(projectId: string, reason: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'rejectProject',
      args: [projectId as `0x${string}`, reason],
    });
  }

  async setCEOWeight(projectId: string, weight: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'setCEOWeight',
      args: [projectId as `0x${string}`, BigInt(weight)],
    });
  }

  async stake(projectId: string, amount: bigint): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'stake',
      args: [projectId as `0x${string}`, amount],
      value: amount,
    });
  }

  async unstake(projectId: string, epochId: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'unstake',
      args: [projectId as `0x${string}`, BigInt(epochId)],
    });
  }

  async createEpoch(daoId: string, budget: bigint, matchingPool: bigint): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'createEpoch',
      args: [daoId as `0x${string}`, budget, matchingPool],
    });
  }

  async finalizeEpoch(daoId: string): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'finalizeEpoch',
      args: [daoId as `0x${string}`],
    });
  }

  async setFundingConfig(daoId: string, config: FundingConfig): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized');
    }

    return this.walletClient.writeContract({
      address: this.config.daoFundingAddress,
      abi: DAOFundingABI,
      functionName: 'setDAOConfig',
      args: [
        daoId as `0x${string}`,
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
    });
  }

  // ============ Utility Methods ============

  async getFundingAllocations(daoId: string): Promise<FundingAllocation[]> {
    const projects = await this.getActiveProjects(daoId);
    const epoch = await this.getCurrentEpoch(daoId);

    const allocations: FundingAllocation[] = [];
    let totalAllocation = BigInt(0);

    for (const project of projects) {
      const allocation = await this.calculateAllocation(project.projectId);
      const stake = await this.getProjectEpochStake(project.projectId, epoch.epochId);

      allocations.push({
        projectId: project.projectId,
        projectName: project.name,
        ceoWeight: project.ceoWeight,
        communityStake: stake.totalStake,
        stakerCount: stake.numStakers,
        allocation,
        allocationPercentage: 0,
      });

      totalAllocation += allocation;
    }

    // Calculate percentages
    for (const alloc of allocations) {
      if (totalAllocation > 0) {
        alloc.allocationPercentage = Number((alloc.allocation * BigInt(10000)) / totalAllocation) / 100;
      }
    }

    return allocations.sort((a, b) => Number(b.allocation - a.allocation));
  }

  clearCache(): void {
    this.daoCache.clear();
  }

  // ============ Parse Functions ============

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
      status: raw.status as DAOStatus,
      createdAt: Number(raw.createdAt),
      updatedAt: Number(raw.updatedAt),
      creator: raw.creator,
    };
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
    };
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
      status: raw.status,
      createdAt: Number(raw.createdAt),
      lastFundedAt: Number(raw.lastFundedAt),
      proposer: raw.proposer,
    };
  }
}

// ============ Export Singleton Creator ============

let daoServiceInstance: DAOService | null = null;

export function createDAOService(config: DAOServiceConfig): DAOService {
  daoServiceInstance = new DAOService(config);
  return daoServiceInstance;
}

export function getDAOService(): DAOService {
  if (!daoServiceInstance) {
    throw new Error('DAOService not initialized. Call createDAOService first.');
  }
  return daoServiceInstance;
}

