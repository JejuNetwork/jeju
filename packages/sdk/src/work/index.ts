/**
 * Work Module - Bounties, projects, and developer coordination
 *
 * This module exposes the BountyRegistry, ProjectBoard, and GuardianRegistry
 * contracts for decentralized work coordination.
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { safeGetContract } from '../config'
import type { BaseWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const BountyStatus = {
  OPEN: 0,
  IN_PROGRESS: 1,
  REVIEW: 2,
  COMPLETED: 3,
  CANCELLED: 4,
  DISPUTED: 5,
} as const
export type BountyStatus = (typeof BountyStatus)[keyof typeof BountyStatus]

export const ProjectStatus = {
  DRAFT: 0,
  OPEN: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  CANCELLED: 4,
} as const
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

export const SubmissionStatus = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  REVISION_REQUESTED: 3,
} as const
export type SubmissionStatus =
  (typeof SubmissionStatus)[keyof typeof SubmissionStatus]

export interface Bounty {
  bountyId: Hex
  creator: Address
  title: string
  description: string
  reward: bigint
  deadline: bigint
  status: BountyStatus
  hunter: Address | null
  tags: string[]
  createdAt: bigint
  completedAt: bigint
}

export interface BountySubmission {
  submissionId: Hex
  bountyId: Hex
  hunter: Address
  content: string
  proofOfWork: string
  status: SubmissionStatus
  submittedAt: bigint
  reviewedAt: bigint
  feedback: string
}

export interface Project {
  projectId: Hex
  owner: Address
  name: string
  description: string
  repository: string
  budget: bigint
  status: ProjectStatus
  memberCount: number
  bountyCount: number
  createdAt: bigint
}

export interface ProjectTask {
  taskId: Hex
  projectId: Hex
  title: string
  description: string
  assignee: Address | null
  reward: bigint
  status: BountyStatus
  priority: number
  createdAt: bigint
  dueDate: bigint
}

export interface Guardian {
  guardianId: Hex
  address: Address
  name: string
  stake: bigint
  reputation: bigint
  reviewCount: bigint
  approvalRate: number
  isActive: boolean
  joinedAt: bigint
}

export interface CreateBountyParams {
  title: string
  description: string
  reward: bigint
  deadline: number // Unix timestamp
  tags?: string[]
}

export interface CreateProjectParams {
  name: string
  description: string
  repository?: string
  budget?: bigint
}

export interface SubmitWorkParams {
  bountyId: Hex
  content: string
  proofOfWork: string // IPFS hash or URL
}

export interface WorkModule {
  // ═══════════════════════════════════════════════════════════════════════════
  //                          BOUNTIES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Create a new bounty */
  createBounty(
    params: CreateBountyParams,
  ): Promise<{ bountyId: Hex; txHash: Hex }>

  /** Get bounty by ID */
  getBounty(bountyId: Hex): Promise<Bounty | null>

  /** List open bounties */
  listBounties(status?: BountyStatus): Promise<Bounty[]>

  /** List bounties I created */
  listMyBounties(): Promise<Bounty[]>

  /** List bounties I'm hunting */
  listMyHunts(): Promise<Bounty[]>

  /** Claim a bounty to work on */
  claimBounty(bountyId: Hex): Promise<Hex>

  /** Submit work for a bounty */
  submitWork(params: SubmitWorkParams): Promise<Hex>

  /** Approve a submission (bounty creator only) */
  approveSubmission(submissionId: Hex): Promise<Hex>

  /** Reject a submission with feedback */
  rejectSubmission(submissionId: Hex, feedback: string): Promise<Hex>

  /** Request revision on submission */
  requestRevision(submissionId: Hex, feedback: string): Promise<Hex>

  /** Get submissions for a bounty */
  getSubmissions(bountyId: Hex): Promise<BountySubmission[]>

  /** Cancel a bounty (creator only, refunds reward) */
  cancelBounty(bountyId: Hex): Promise<Hex>

  /** Add more reward to a bounty */
  topUpBounty(bountyId: Hex, amount: bigint): Promise<Hex>

  // ═══════════════════════════════════════════════════════════════════════════
  //                          PROJECTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Create a new project */
  createProject(
    params: CreateProjectParams,
  ): Promise<{ projectId: Hex; txHash: Hex }>

  /** Get project by ID */
  getProject(projectId: Hex): Promise<Project | null>

  /** List all projects */
  listProjects(): Promise<Project[]>

  /** List my projects */
  listMyProjects(): Promise<Project[]>

  /** Add member to project */
  addMember(projectId: Hex, member: Address): Promise<Hex>

  /** Remove member from project */
  removeMember(projectId: Hex, member: Address): Promise<Hex>

  /** Create task within project */
  createTask(
    projectId: Hex,
    title: string,
    description: string,
    reward: bigint,
    dueDate?: number,
  ): Promise<Hex>

  /** Get project tasks */
  getTasks(projectId: Hex): Promise<ProjectTask[]>

  /** Assign task to member */
  assignTask(taskId: Hex, assignee: Address): Promise<Hex>

  /** Complete task */
  completeTask(taskId: Hex): Promise<Hex>

  // ═══════════════════════════════════════════════════════════════════════════
  //                          GUARDIANS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Register as a guardian (requires stake) */
  registerAsGuardian(name: string, stake: bigint): Promise<Hex>

  /** Get guardian info */
  getGuardian(address: Address): Promise<Guardian | null>

  /** List active guardians */
  listGuardians(): Promise<Guardian[]>

  /** Increase guardian stake */
  increaseStake(amount: bigint): Promise<Hex>

  /** Withdraw guardian stake (if not active in reviews) */
  withdrawStake(amount: bigint): Promise<Hex>

  /** Deactivate guardian status */
  deactivateGuardian(): Promise<Hex>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const BOUNTY_REGISTRY_ABI = [
  {
    name: 'createBounty',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'deadline', type: 'uint256' },
      { name: 'tags', type: 'string[]' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getBounty',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'bountyId', type: 'bytes32' },
          { name: 'creator', type: 'address' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'reward', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'hunter', type: 'address' },
          { name: 'tags', type: 'string[]' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'completedAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getBountiesByStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'status', type: 'uint8' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getBountiesByCreator',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getBountiesByHunter',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hunter', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'claimBounty',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'submitWork',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'bountyId', type: 'bytes32' },
      { name: 'content', type: 'string' },
      { name: 'proofOfWork', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'approveSubmission',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'submissionId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'rejectSubmission',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'submissionId', type: 'bytes32' },
      { name: 'feedback', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'requestRevision',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'submissionId', type: 'bytes32' },
      { name: 'feedback', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'getSubmissions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'submissionId', type: 'bytes32' },
          { name: 'bountyId', type: 'bytes32' },
          { name: 'hunter', type: 'address' },
          { name: 'content', type: 'string' },
          { name: 'proofOfWork', type: 'string' },
          { name: 'status', type: 'uint8' },
          { name: 'submittedAt', type: 'uint256' },
          { name: 'reviewedAt', type: 'uint256' },
          { name: 'feedback', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'cancelBounty',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'topUpBounty',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'bountyId', type: 'bytes32' }],
    outputs: [],
  },
] as const

const PROJECT_BOARD_ABI = [
  {
    name: 'createProject',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'repository', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getProject',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'projectId', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'repository', type: 'string' },
          { name: 'budget', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'memberCount', type: 'uint256' },
          { name: 'bountyCount', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getAllProjects',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getProjectsByOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'addMember',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'removeMember',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'member', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'createTask',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'bytes32' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'reward', type: 'uint256' },
      { name: 'dueDate', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getTasks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'taskId', type: 'bytes32' },
          { name: 'projectId', type: 'bytes32' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'assignee', type: 'address' },
          { name: 'reward', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'priority', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'dueDate', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'assignTask',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'bytes32' },
      { name: 'assignee', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'completeTask',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    outputs: [],
  },
] as const

const GUARDIAN_REGISTRY_ABI = [
  {
    name: 'registerGuardian',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getGuardian',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'guardian', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'guardianId', type: 'bytes32' },
          { name: 'guardian', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'reputation', type: 'uint256' },
          { name: 'reviewCount', type: 'uint256' },
          { name: 'approvalRate', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'joinedAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getActiveGuardians',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'increaseStake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdrawStake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'deactivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createWorkModule(
  wallet: BaseWallet,
  network: NetworkType,
): WorkModule {
  // Use safe getters - contracts may not be deployed on all networks
  const bountyRegistryAddressOpt = safeGetContract(
    'work',
    'BountyRegistry',
    network,
  )
  const projectBoardAddressOpt = safeGetContract(
    'work',
    'ProjectBoard',
    network,
  )
  const guardianRegistryAddressOpt = safeGetContract(
    'work',
    'GuardianRegistry',
    network,
  )

  // Lazy-load contract addresses - throw on method call if not deployed
  const getBountyRegistryAddress = () => {
    if (!bountyRegistryAddressOpt) {
      throw new Error(
        'Work BountyRegistry contract not deployed on this network',
      )
    }
    return bountyRegistryAddressOpt
  }

  const getProjectBoardAddress = () => {
    if (!projectBoardAddressOpt) {
      throw new Error('Work ProjectBoard contract not deployed on this network')
    }
    return projectBoardAddressOpt
  }

  const getGuardianRegistryAddress = () => {
    if (!guardianRegistryAddressOpt) {
      throw new Error(
        'Work GuardianRegistry contract not deployed on this network',
      )
    }
    return guardianRegistryAddressOpt
  }

  // Helper to read bounty
  async function readBounty(bountyId: Hex): Promise<Bounty | null> {
    const result = await wallet.publicClient.readContract({
      address: getBountyRegistryAddress(),
      abi: BOUNTY_REGISTRY_ABI,
      functionName: 'getBounty',
      args: [bountyId],
    })

    if (!result || result.bountyId === `0x${'0'.repeat(64)}`) {
      return null
    }

    return {
      bountyId: result.bountyId,
      creator: result.creator,
      title: result.title,
      description: result.description,
      reward: result.reward,
      deadline: result.deadline,
      status: result.status as BountyStatus,
      hunter:
        result.hunter === '0x0000000000000000000000000000000000000000'
          ? null
          : result.hunter,
      tags: [...result.tags],
      createdAt: result.createdAt,
      completedAt: result.completedAt,
    }
  }

  // Helper to read project
  async function readProject(projectId: Hex): Promise<Project | null> {
    const result = await wallet.publicClient.readContract({
      address: getProjectBoardAddress(),
      abi: PROJECT_BOARD_ABI,
      functionName: 'getProject',
      args: [projectId],
    })

    if (!result || result.projectId === `0x${'0'.repeat(64)}`) {
      return null
    }

    return {
      projectId: result.projectId,
      owner: result.owner,
      name: result.name,
      description: result.description,
      repository: result.repository,
      budget: result.budget,
      status: result.status as ProjectStatus,
      memberCount: Number(result.memberCount),
      bountyCount: Number(result.bountyCount),
      createdAt: result.createdAt,
    }
  }

  return {
    // ═══════════════════════════════════════════════════════════════════════
    //                          BOUNTIES
    // ═══════════════════════════════════════════════════════════════════════

    async createBounty(params) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'createBounty',
        args: [
          params.title,
          params.description,
          BigInt(params.deadline),
          params.tags ?? [],
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
        value: params.reward,
      })

      const bountyId =
        `0x${Buffer.from(params.title).toString('hex').padEnd(64, '0')}` as Hex

      return { bountyId, txHash }
    },

    getBounty: readBounty,

    async listBounties(status) {
      const statusFilter = status ?? BountyStatus.OPEN

      const ids = await wallet.publicClient.readContract({
        address: getBountyRegistryAddress(),
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'getBountiesByStatus',
        args: [statusFilter],
      })

      const bounties: Bounty[] = []
      for (const id of ids) {
        const bounty = await readBounty(id)
        if (bounty) bounties.push(bounty)
      }
      return bounties
    },

    async listMyBounties() {
      const ids = await wallet.publicClient.readContract({
        address: getBountyRegistryAddress(),
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'getBountiesByCreator',
        args: [wallet.address],
      })

      const bounties: Bounty[] = []
      for (const id of ids) {
        const bounty = await readBounty(id)
        if (bounty) bounties.push(bounty)
      }
      return bounties
    },

    async listMyHunts() {
      const ids = await wallet.publicClient.readContract({
        address: getBountyRegistryAddress(),
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'getBountiesByHunter',
        args: [wallet.address],
      })

      const bounties: Bounty[] = []
      for (const id of ids) {
        const bounty = await readBounty(id)
        if (bounty) bounties.push(bounty)
      }
      return bounties
    },

    async claimBounty(bountyId) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'claimBounty',
        args: [bountyId],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async submitWork(params) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'submitWork',
        args: [params.bountyId, params.content, params.proofOfWork],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async approveSubmission(submissionId) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'approveSubmission',
        args: [submissionId],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async rejectSubmission(submissionId, feedback) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'rejectSubmission',
        args: [submissionId, feedback],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async requestRevision(submissionId, feedback) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'requestRevision',
        args: [submissionId, feedback],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async getSubmissions(bountyId) {
      const result = await wallet.publicClient.readContract({
        address: getBountyRegistryAddress(),
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'getSubmissions',
        args: [bountyId],
      })

      return result.map((s) => ({
        submissionId: s.submissionId,
        bountyId: s.bountyId,
        hunter: s.hunter,
        content: s.content,
        proofOfWork: s.proofOfWork,
        status: s.status as SubmissionStatus,
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
        feedback: s.feedback,
      }))
    },

    async cancelBounty(bountyId) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'cancelBounty',
        args: [bountyId],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
      })
    },

    async topUpBounty(bountyId, amount) {
      const data = encodeFunctionData({
        abi: BOUNTY_REGISTRY_ABI,
        functionName: 'topUpBounty',
        args: [bountyId],
      })

      return wallet.sendTransaction({
        to: getBountyRegistryAddress(),
        data,
        value: amount,
      })
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                          PROJECTS
    // ═══════════════════════════════════════════════════════════════════════

    async createProject(params) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'createProject',
        args: [params.name, params.description, params.repository ?? ''],
      })

      const txHash = await wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
        value: params.budget ?? 0n,
      })

      const projectId =
        `0x${Buffer.from(params.name).toString('hex').padEnd(64, '0')}` as Hex

      return { projectId, txHash }
    },

    getProject: readProject,

    async listProjects() {
      const ids = await wallet.publicClient.readContract({
        address: getProjectBoardAddress(),
        abi: PROJECT_BOARD_ABI,
        functionName: 'getAllProjects',
        args: [],
      })

      const projects: Project[] = []
      for (const id of ids) {
        const project = await readProject(id)
        if (project) projects.push(project)
      }
      return projects
    },

    async listMyProjects() {
      const ids = await wallet.publicClient.readContract({
        address: getProjectBoardAddress(),
        abi: PROJECT_BOARD_ABI,
        functionName: 'getProjectsByOwner',
        args: [wallet.address],
      })

      const projects: Project[] = []
      for (const id of ids) {
        const project = await readProject(id)
        if (project) projects.push(project)
      }
      return projects
    },

    async addMember(projectId, member) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'addMember',
        args: [projectId, member],
      })

      return wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
      })
    },

    async removeMember(projectId, member) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'removeMember',
        args: [projectId, member],
      })

      return wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
      })
    },

    async createTask(projectId, title, description, reward, dueDate) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'createTask',
        args: [
          projectId,
          title,
          description,
          reward,
          BigInt(dueDate ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
        ],
      })

      return wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
      })
    },

    async getTasks(projectId) {
      const result = await wallet.publicClient.readContract({
        address: getProjectBoardAddress(),
        abi: PROJECT_BOARD_ABI,
        functionName: 'getTasks',
        args: [projectId],
      })

      return result.map((t) => ({
        taskId: t.taskId,
        projectId: t.projectId,
        title: t.title,
        description: t.description,
        assignee:
          t.assignee === '0x0000000000000000000000000000000000000000'
            ? null
            : t.assignee,
        reward: t.reward,
        status: t.status as BountyStatus,
        priority: t.priority,
        createdAt: t.createdAt,
        dueDate: t.dueDate,
      }))
    },

    async assignTask(taskId, assignee) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'assignTask',
        args: [taskId, assignee],
      })

      return wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
      })
    },

    async completeTask(taskId) {
      const data = encodeFunctionData({
        abi: PROJECT_BOARD_ABI,
        functionName: 'completeTask',
        args: [taskId],
      })

      return wallet.sendTransaction({
        to: getProjectBoardAddress(),
        data,
      })
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                          GUARDIANS
    // ═══════════════════════════════════════════════════════════════════════

    async registerAsGuardian(name, stake) {
      const data = encodeFunctionData({
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'registerGuardian',
        args: [name],
      })

      return wallet.sendTransaction({
        to: getGuardianRegistryAddress(),
        data,
        value: stake,
      })
    },

    async getGuardian(address) {
      const result = await wallet.publicClient.readContract({
        address: getGuardianRegistryAddress(),
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'getGuardian',
        args: [address],
      })

      if (!result || result.guardianId === `0x${'0'.repeat(64)}`) {
        return null
      }

      return {
        guardianId: result.guardianId,
        address: result.guardian,
        name: result.name,
        stake: result.stake,
        reputation: result.reputation,
        reviewCount: result.reviewCount,
        approvalRate: Number(result.approvalRate),
        isActive: result.isActive,
        joinedAt: result.joinedAt,
      }
    },

    async listGuardians() {
      const addresses = await wallet.publicClient.readContract({
        address: getGuardianRegistryAddress(),
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'getActiveGuardians',
        args: [],
      })

      const guardians: Guardian[] = []
      for (const addr of addresses) {
        const guardian = await this.getGuardian(addr)
        if (guardian) guardians.push(guardian)
      }
      return guardians
    },

    async increaseStake(amount) {
      const data = encodeFunctionData({
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'increaseStake',
        args: [],
      })

      return wallet.sendTransaction({
        to: getGuardianRegistryAddress(),
        data,
        value: amount,
      })
    },

    async withdrawStake(amount) {
      const data = encodeFunctionData({
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'withdrawStake',
        args: [amount],
      })

      return wallet.sendTransaction({
        to: getGuardianRegistryAddress(),
        data,
      })
    },

    async deactivateGuardian() {
      const data = encodeFunctionData({
        abi: GUARDIAN_REGISTRY_ABI,
        functionName: 'deactivate',
        args: [],
      })

      return wallet.sendTransaction({
        to: getGuardianRegistryAddress(),
        data,
      })
    },
  }
}
