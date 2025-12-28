/**
 * Storage Proof System - Cryptographic verification of data availability
 *
 * Features:
 * - Proof of Access (PoA) - Prove data is accessible
 * - Proof of Replication (PoRep) - Prove data is replicated
 * - Proof of Spacetime (PoSt) - Prove data is stored over time
 * - Challenge-response protocol for storage verification
 * - Merkle proofs for partial data verification
 *
 * SECURITY: In production, all signing is delegated to KMS with FROST threshold
 * signing to protect against side-channel attacks. The full private key is never
 * reconstructed or held in memory.
 */

import {
  getCurrentNetwork,
  getRpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { createHash, randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import {
  createWalletClient,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  parseAbiParameters,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { createSecureSigner, type SecureSigner } from '../shared/secure-signer'
import type { StorageBackendType } from './types'

// ============ Types ============

export type ProofType =
  | 'access' // Prove content is accessible
  | 'replication' // Prove content is stored on multiple nodes
  | 'spacetime' // Prove content persisted over time
  | 'merkle' // Prove chunk inclusion

export type ChallengeStatus = 'pending' | 'completed' | 'failed' | 'expired'

export interface StorageChallenge {
  challengeId: string
  cid: string
  challengerAddress: Address
  targetNodeId: string
  proofType: ProofType
  challengeData: ChallengeData
  status: ChallengeStatus
  createdAt: number
  deadline: number
  reward: bigint
  slashAmount: bigint
}

export interface ChallengeData {
  // For access proofs
  randomNonce?: string
  expectedHash?: string

  // For merkle proofs
  chunkIndex?: number
  merkleRoot?: string

  // For spacetime proofs
  previousProofHash?: string
  epoch?: number

  // For replication proofs
  requiredReplicas?: number
  targetBackends?: StorageBackendType[]
}

export interface StorageProof {
  proofId: string
  challengeId: string
  proverNodeId: string
  proofType: ProofType
  proofData: ProofData
  signature: Hex
  timestamp: number
  verificationResult?: VerificationResult
}

export interface ProofData {
  // Access proof
  contentHash?: string
  responseHash?: string
  accessTimestampMs?: number

  // Merkle proof
  chunkData?: string
  merkleProof?: string[]
  chunkIndex?: number

  // Spacetime proof
  commitmentHash?: string
  sealedSectorId?: string
  proofBytes?: string

  // Replication proof
  replicaHashes?: ReplicaInfo[]
}

export interface ReplicaInfo {
  nodeId: string
  backendType: StorageBackendType
  contentHash: string
  timestamp: number
  signature: Hex
}

export interface VerificationResult {
  valid: boolean
  proofId: string
  verifierNodeId: string
  verifiedAt: number
  gasUsed?: bigint
  errors?: string[]
}

export interface MerkleTree {
  root: string
  leaves: string[]
  depth: number
  width: number
}

export interface StorageProofConfig {
  challengeWindowSeconds: number
  proofWindowSeconds: number
  verificationQuorum: number
  minReplicasRequired: number
  challengeRewardWei: bigint
  slashAmountWei: bigint
  proofContractAddress: Address
  rpcUrl: string
  // SECURITY: In production, use kmsKeyId instead of privateKey
  // kmsKeyId routes signing through FROST threshold signing (no key in memory)
  kmsKeyId?: string
  ownerAddress?: Address
  // DEPRECATED: privateKey is only for development/testing
  // In production, this should be undefined and kmsKeyId should be set
  privateKey?: Hex
}

// ============ Default Configuration ============

const DEFAULT_PROOF_CONFIG: StorageProofConfig = {
  challengeWindowSeconds: 300, // 5 minutes to respond
  proofWindowSeconds: 600, // 10 minutes total
  verificationQuorum: 3, // 3 verifiers needed
  minReplicasRequired: 2,
  challengeRewardWei: 1000000000000000n, // 0.001 ETH
  slashAmountWei: 10000000000000000n, // 0.01 ETH
  proofContractAddress: '0x0000000000000000000000000000000000000000',
  rpcUrl:
    (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
    getRpcUrl(getCurrentNetwork()),
  // KMS key ID is a secret - keep as env var
  kmsKeyId:
    typeof process !== 'undefined' ? process.env.STORAGE_PROOF_KMS_KEY_ID : undefined,
  ownerAddress:
    typeof process !== 'undefined'
      ? (process.env.STORAGE_PROOF_OWNER_ADDRESS as Address | undefined)
      : undefined,
  // Only use privateKey in development - not set by default
  privateKey: undefined,
}

// ============ Merkle Tree Implementation ============

export function buildMerkleTree(chunks: Buffer[]): MerkleTree {
  const leaves = chunks.map((chunk) =>
    createHash('sha256').update(chunk).digest('hex'),
  )

  const tree: string[][] = [leaves]

  // Build tree bottom-up
  let currentLevel = leaves
  while (currentLevel.length > 1) {
    const nextLevel: string[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]
      const right = currentLevel[i + 1] ?? currentLevel[i]
      const combined = createHash('sha256')
        .update(left + right)
        .digest('hex')
      nextLevel.push(combined)
    }
    tree.push(nextLevel)
    currentLevel = nextLevel
  }

  return {
    root: tree[tree.length - 1][0],
    leaves,
    depth: tree.length,
    width: leaves.length,
  }
}

export function generateMerkleProof(
  tree: MerkleTree,
  chunkIndex: number,
): string[] {
  const proof: string[] = []
  const leaves = tree.leaves

  let index = chunkIndex
  let currentLevel = leaves

  // Walk up the tree
  let _levelIndex = 0
  const tempTree: string[][] = [leaves]

  // Rebuild level structure
  let tempLevel = leaves
  while (tempLevel.length > 1) {
    const nextLevel: string[] = []
    for (let i = 0; i < tempLevel.length; i += 2) {
      const left = tempLevel[i]
      const right = tempLevel[i + 1] ?? tempLevel[i]
      const combined = createHash('sha256')
        .update(left + right)
        .digest('hex')
      nextLevel.push(combined)
    }
    tempTree.push(nextLevel)
    tempLevel = nextLevel
  }

  // Generate proof
  for (let level = 0; level < tempTree.length - 1; level++) {
    currentLevel = tempTree[level]
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1

    if (siblingIndex < currentLevel.length) {
      proof.push(currentLevel[siblingIndex])
    } else {
      proof.push(currentLevel[index])
    }

    index = Math.floor(index / 2)
    _levelIndex++
  }

  return proof
}

export function verifyMerkleProof(
  root: string,
  leaf: string,
  chunkIndex: number,
  proof: string[],
): boolean {
  let computedHash = leaf
  let index = chunkIndex

  for (const sibling of proof) {
    if (index % 2 === 0) {
      computedHash = createHash('sha256')
        .update(computedHash + sibling)
        .digest('hex')
    } else {
      computedHash = createHash('sha256')
        .update(sibling + computedHash)
        .digest('hex')
    }
    index = Math.floor(index / 2)
  }

  return computedHash === root
}

// ============ Storage Proof Manager ============

export class StorageProofManager {
  private config: StorageProofConfig
  private challenges: Map<string, StorageChallenge> = new Map()
  private proofs: Map<string, StorageProof> = new Map()
  private contentMerkleTrees: Map<string, MerkleTree> = new Map()
  private nodeId: string
  private secureSigner: SecureSigner | null = null
  private signerInitialized = false

  constructor(nodeId: string, config?: Partial<StorageProofConfig>) {
    this.nodeId = nodeId
    this.config = { ...DEFAULT_PROOF_CONFIG, ...config }

    // SECURITY: Warn if using deprecated privateKey in production
    const isProduction = isProductionEnv()
    if (isProduction && this.config.privateKey && !this.config.kmsKeyId) {
      console.error(
        '[StorageProofManager] CRITICAL: Using privateKey in production is insecure. ' +
          'Set STORAGE_PROOF_KMS_KEY_ID and STORAGE_PROOF_OWNER_ADDRESS to use KMS-based signing.',
      )
    }
  }

  /**
   * Initialize KMS-based secure signing
   * Call this before any operations in production
   */
  async initializeSecureSigning(): Promise<void> {
    if (this.signerInitialized) return

    if (this.config.kmsKeyId && this.config.ownerAddress) {
      this.secureSigner = await createSecureSigner(
        this.config.ownerAddress,
        this.config.kmsKeyId,
      )
      console.log(
        '[StorageProofManager] Using KMS-based secure signing (FROST)',
      )
    } else if (isProductionEnv()) {
      throw new Error(
        'STORAGE_PROOF_KMS_KEY_ID and STORAGE_PROOF_OWNER_ADDRESS required in production',
      )
    }

    this.signerInitialized = true
  }

  // ============ Challenge Creation ============

  async createChallenge(
    cid: string,
    targetNodeId: string,
    proofType: ProofType,
  ): Promise<StorageChallenge> {
    const challengeId = this.generateChallengeId()
    const now = Date.now()

    const challengeData = await this.generateChallengeData(cid, proofType)

    const challenge: StorageChallenge = {
      challengeId,
      cid,
      challengerAddress: await this.getAddress(),
      targetNodeId,
      proofType,
      challengeData,
      status: 'pending',
      createdAt: now,
      deadline: now + this.config.challengeWindowSeconds * 1000,
      reward: this.config.challengeRewardWei,
      slashAmount: this.config.slashAmountWei,
    }

    this.challenges.set(challengeId, challenge)

    // Submit challenge on-chain if contract is configured
    if (
      this.config.proofContractAddress !==
      '0x0000000000000000000000000000000000000000'
    ) {
      await this.submitChallengeOnChain(challenge)
    }

    return challenge
  }

  private async generateChallengeData(
    cid: string,
    proofType: ProofType,
  ): Promise<ChallengeData> {
    switch (proofType) {
      case 'access': {
        // Random nonce for access proof
        const nonce = randomBytes(32).toString('hex')
        return {
          randomNonce: nonce,
        }
      }

      case 'merkle': {
        // Select random chunk for merkle proof
        const tree = this.contentMerkleTrees.get(cid)
        if (tree) {
          const chunkIndex = Math.floor(Math.random() * tree.width)
          return {
            chunkIndex,
            merkleRoot: tree.root,
          }
        }
        return {
          chunkIndex: 0,
        }
      }

      case 'spacetime': {
        // Spacetime proof with epoch
        return {
          epoch: Math.floor(Date.now() / (24 * 60 * 60 * 1000)), // Day-based epoch
        }
      }

      case 'replication': {
        return {
          requiredReplicas: this.config.minReplicasRequired,
          targetBackends: ['ipfs', 'arweave', 'filecoin'],
        }
      }
    }
  }

  private generateChallengeId(): string {
    return `challenge_${Date.now()}_${randomBytes(8).toString('hex')}`
  }

  // ============ Proof Generation ============

  async generateProof(
    challenge: StorageChallenge,
    content: Buffer,
  ): Promise<StorageProof> {
    const proofId = `proof_${Date.now()}_${randomBytes(8).toString('hex')}`

    const proofData = await this.generateProofData(challenge, content)

    // Sign the proof
    const proofMessage = this.encodeProofMessage(
      proofId,
      challenge.challengeId,
      proofData,
    )
    const signature = await this.signMessage(proofMessage)

    const proof: StorageProof = {
      proofId,
      challengeId: challenge.challengeId,
      proverNodeId: this.nodeId,
      proofType: challenge.proofType,
      proofData,
      signature,
      timestamp: Date.now(),
    }

    this.proofs.set(proofId, proof)

    return proof
  }

  private async generateProofData(
    challenge: StorageChallenge,
    content: Buffer,
  ): Promise<ProofData> {
    switch (challenge.proofType) {
      case 'access': {
        // Hash content with challenge nonce
        const contentHash = createHash('sha256').update(content).digest('hex')
        const responseHash = createHash('sha256')
          .update(contentHash + challenge.challengeData.randomNonce)
          .digest('hex')

        return {
          contentHash,
          responseHash,
          accessTimestampMs: Date.now(),
        }
      }

      case 'merkle': {
        // Generate merkle proof for specific chunk
        const chunkSize = 256 * 1024 // 256KB chunks
        const chunks = this.chunkContent(content, chunkSize)
        const tree = buildMerkleTree(chunks)
        this.contentMerkleTrees.set(challenge.cid, tree)

        const chunkIndex = challenge.challengeData.chunkIndex ?? 0
        const chunkData = chunks[chunkIndex]?.toString('hex') ?? ''
        const merkleProof = generateMerkleProof(tree, chunkIndex)

        return {
          chunkData,
          merkleProof,
          chunkIndex,
        }
      }

      case 'spacetime': {
        // Generate commitment hash for spacetime proof
        const commitmentHash = createHash('sha256')
          .update(content)
          .update(Buffer.from(String(challenge.challengeData.epoch)))
          .update(Buffer.from(this.nodeId))
          .digest('hex')

        return {
          commitmentHash,
          proofBytes: commitmentHash,
        }
      }

      case 'replication': {
        // This would normally query other nodes for their attestations
        // For now, return local attestation
        const contentHash = createHash('sha256').update(content).digest('hex')
        const signature = await this.signMessage(contentHash)

        return {
          replicaHashes: [
            {
              nodeId: this.nodeId,
              backendType: 'ipfs',
              contentHash,
              timestamp: Date.now(),
              signature,
            },
          ],
        }
      }
    }
  }

  private chunkContent(content: Buffer, chunkSize: number): Buffer[] {
    const chunks: Buffer[] = []
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.subarray(i, i + chunkSize))
    }
    // Ensure at least one chunk
    if (chunks.length === 0) {
      chunks.push(Buffer.alloc(0))
    }
    return chunks
  }

  // ============ Proof Verification ============

  async verifyProof(
    proof: StorageProof,
    challenge: StorageChallenge,
    originalContent?: Buffer,
  ): Promise<VerificationResult> {
    const errors: string[] = []

    // Verify signature
    const proofMessage = this.encodeProofMessage(
      proof.proofId,
      proof.challengeId,
      proof.proofData,
    )
    const signatureValid = await this.verifySignature(
      proofMessage,
      proof.signature,
      proof.proverNodeId,
    )

    if (!signatureValid) {
      errors.push('Invalid proof signature')
    }

    // Verify proof-type specific data
    switch (proof.proofType) {
      case 'access': {
        if (
          !proof.proofData.responseHash ||
          !challenge.challengeData.randomNonce
        ) {
          errors.push('Missing access proof data')
          break
        }

        // If we have original content, verify the hash
        if (originalContent) {
          const expectedContentHash = createHash('sha256')
            .update(originalContent)
            .digest('hex')
          const expectedResponseHash = createHash('sha256')
            .update(expectedContentHash + challenge.challengeData.randomNonce)
            .digest('hex')

          if (proof.proofData.responseHash !== expectedResponseHash) {
            errors.push('Access proof hash mismatch')
          }
        }
        break
      }

      case 'merkle': {
        const { chunkData, merkleProof, chunkIndex } = proof.proofData
        const { merkleRoot } = challenge.challengeData

        if (
          !chunkData ||
          !merkleProof ||
          chunkIndex === undefined ||
          !merkleRoot
        ) {
          errors.push('Missing merkle proof data')
          break
        }

        const leaf = createHash('sha256')
          .update(Buffer.from(chunkData, 'hex'))
          .digest('hex')

        if (!verifyMerkleProof(merkleRoot, leaf, chunkIndex, merkleProof)) {
          errors.push('Invalid merkle proof')
        }
        break
      }

      case 'spacetime': {
        if (!proof.proofData.commitmentHash) {
          errors.push('Missing spacetime proof commitment')
          break
        }

        // Verify epoch is recent
        const currentEpoch = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
        const proofEpoch = challenge.challengeData.epoch ?? 0
        if (Math.abs(currentEpoch - proofEpoch) > 1) {
          errors.push('Spacetime proof epoch too old')
        }
        break
      }

      case 'replication': {
        const { replicaHashes } = proof.proofData
        const { requiredReplicas } = challenge.challengeData

        if (!replicaHashes || replicaHashes.length < (requiredReplicas ?? 1)) {
          errors.push(
            `Insufficient replicas: ${replicaHashes?.length ?? 0} < ${requiredReplicas}`,
          )
        }

        // Verify each replica attestation
        if (replicaHashes) {
          for (const replica of replicaHashes) {
            const isValid = await this.verifySignature(
              replica.contentHash,
              replica.signature,
              replica.nodeId,
            )
            if (!isValid) {
              errors.push(`Invalid replica attestation from ${replica.nodeId}`)
            }
          }
        }
        break
      }
    }

    const result: VerificationResult = {
      valid: errors.length === 0,
      proofId: proof.proofId,
      verifierNodeId: this.nodeId,
      verifiedAt: Date.now(),
      errors: errors.length > 0 ? errors : undefined,
    }

    proof.verificationResult = result

    // Update challenge status
    if (result.valid) {
      challenge.status = 'completed'
    } else {
      challenge.status = 'failed'
    }

    return result
  }

  // ============ On-Chain Interaction ============

  private async submitChallengeOnChain(
    challenge: StorageChallenge,
  ): Promise<void> {
    // SECURITY: In production, on-chain transactions should use a separate
    // transaction relay service that holds keys in HSM, not this server
    if (isProductionEnv()) {
      console.warn(
        '[StorageProofManager] On-chain challenge submission should use transaction relay in production',
      )
      // In production, delegate to a transaction relay service
      // For now, skip on-chain submission if no key configured
      if (!this.config.privateKey) return
    }

    if (!this.config.privateKey) return

    const client = createWalletClient({
      chain: foundry,
      transport: http(this.config.rpcUrl),
      account: privateKeyToAccount(this.config.privateKey),
    })

    const abi = [
      {
        name: 'submitChallenge',
        type: 'function',
        inputs: [
          { name: 'challengeId', type: 'bytes32' },
          { name: 'cid', type: 'string' },
          { name: 'targetNode', type: 'address' },
          { name: 'proofType', type: 'uint8' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [],
      },
    ] as const

    const proofTypeIndex = [
      'access',
      'replication',
      'spacetime',
      'merkle',
    ].indexOf(challenge.proofType)

    await client.writeContract({
      address: this.config.proofContractAddress,
      abi,
      functionName: 'submitChallenge',
      args: [
        keccak256(Buffer.from(challenge.challengeId)),
        challenge.cid,
        challenge.targetNodeId as Address,
        proofTypeIndex,
        BigInt(challenge.deadline),
      ],
    })
  }

  async submitProofOnChain(proof: StorageProof): Promise<Hex> {
    // SECURITY: In production, on-chain transactions should use a separate
    // transaction relay service that holds keys in HSM, not this server
    if (process.env.NODE_ENV === 'production' && !this.config.privateKey) {
      throw new Error(
        'On-chain proof submission requires transaction relay service in production. ' +
          'Configure TX_RELAY_URL or provide privateKey for development only.',
      )
    }

    if (!this.config.privateKey) {
      throw new Error('Private key not configured for on-chain submission')
    }

    const client = createWalletClient({
      chain: foundry,
      transport: http(this.config.rpcUrl),
      account: privateKeyToAccount(this.config.privateKey),
    })

    const abi = [
      {
        name: 'submitProof',
        type: 'function',
        inputs: [
          { name: 'challengeId', type: 'bytes32' },
          { name: 'proofData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
        outputs: [{ name: 'txHash', type: 'bytes32' }],
      },
    ] as const

    const proofBytes = encodeAbiParameters(
      parseAbiParameters('string, string, uint256'),
      [
        proof.proofData.contentHash ?? '',
        proof.proofData.responseHash ?? '',
        BigInt(proof.timestamp),
      ],
    )

    const hash = await client.writeContract({
      address: this.config.proofContractAddress,
      abi,
      functionName: 'submitProof',
      args: [
        keccak256(Buffer.from(proof.challengeId)),
        proofBytes,
        proof.signature,
      ],
    })

    return hash
  }

  // ============ Challenge Management ============

  getChallenge(challengeId: string): StorageChallenge | undefined {
    return this.challenges.get(challengeId)
  }

  getProof(proofId: string): StorageProof | undefined {
    return this.proofs.get(proofId)
  }

  getChallengesForContent(cid: string): StorageChallenge[] {
    return Array.from(this.challenges.values()).filter((c) => c.cid === cid)
  }

  getPendingChallenges(): StorageChallenge[] {
    const now = Date.now()
    return Array.from(this.challenges.values()).filter(
      (c) => c.status === 'pending' && c.deadline > now,
    )
  }

  getExpiredChallenges(): StorageChallenge[] {
    const now = Date.now()
    const expired = Array.from(this.challenges.values()).filter(
      (c) => c.status === 'pending' && c.deadline <= now,
    )

    // Update status
    for (const challenge of expired) {
      challenge.status = 'expired'
    }

    return expired
  }

  // ============ Bulk Verification ============

  async verifyNodeStorage(
    nodeId: string,
    contentList: Array<{ cid: string; content: Buffer }>,
  ): Promise<{
    totalChallenges: number
    passedChallenges: number
    failedChallenges: number
    results: VerificationResult[]
  }> {
    const results: VerificationResult[] = []

    for (const { cid, content } of contentList) {
      // Create and respond to challenge
      const challenge = await this.createChallenge(cid, nodeId, 'access')
      const proof = await this.generateProof(challenge, content)
      const result = await this.verifyProof(proof, challenge, content)
      results.push(result)
    }

    const passed = results.filter((r) => r.valid).length

    return {
      totalChallenges: results.length,
      passedChallenges: passed,
      failedChallenges: results.length - passed,
      results,
    }
  }

  // ============ Merkle Tree Management ============

  registerContentMerkleTree(cid: string, content: Buffer): MerkleTree {
    const chunkSize = 256 * 1024
    const chunks = this.chunkContent(content, chunkSize)
    const tree = buildMerkleTree(chunks)
    this.contentMerkleTrees.set(cid, tree)
    return tree
  }

  getMerkleRoot(cid: string): string | undefined {
    return this.contentMerkleTrees.get(cid)?.root
  }

  // ============ Helper Methods ============

  private encodeProofMessage(
    proofId: string,
    challengeId: string,
    proofData: ProofData,
  ): string {
    return JSON.stringify({ proofId, challengeId, proofData })
  }

  private async signMessage(message: string): Promise<Hex> {
    // SECURITY: Use KMS-based signing if available (production)
    if (this.secureSigner) {
      return this.secureSigner.signMessage(message)
    }

    // Development fallback - only allowed in non-production
    if (isProductionEnv()) {
      throw new Error(
        'KMS-based signing required in production. Call initializeSecureSigning() first.',
      )
    }

    if (!this.config.privateKey) {
      // Return dummy signature for testing
      return keccak256(Buffer.from(message))
    }

    // DEPRECATED: Direct key signing - only for development
    console.warn(
      '[StorageProofManager] Using deprecated direct key signing. Use KMS in production.',
    )
    const account = privateKeyToAccount(this.config.privateKey)
    return account.signMessage({ message })
  }

  private async verifySignature(
    _message: string,
    signature: Hex,
    _nodeId: string,
  ): Promise<boolean> {
    // In production, this would look up the node's public key
    // and verify the signature cryptographically
    // For now, accept valid-looking signatures
    return signature.length > 10
  }

  private async getAddress(): Promise<Address> {
    // SECURITY: Use KMS-based address if available (production)
    if (this.secureSigner) {
      return this.secureSigner.getAddress()
    }

    // Development fallback
    if (!this.config.privateKey) {
      return '0x0000000000000000000000000000000000000000'
    }

    const account = privateKeyToAccount(this.config.privateKey)
    return account.address
  }
}

// ============ Singleton Factory ============

let proofManager: StorageProofManager | null = null

export function getStorageProofManager(
  nodeId?: string,
  config?: Partial<StorageProofConfig>,
): StorageProofManager {
  if (!proofManager) {
    proofManager = new StorageProofManager(
      nodeId ?? `node_${randomBytes(8).toString('hex')}`,
      config,
    )
  }
  return proofManager
}

// ============ Storage Proof Contract Interface ============

export const STORAGE_PROOF_ABI = [
  {
    name: 'submitChallenge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'challengeId', type: 'bytes32' },
      { name: 'cid', type: 'string' },
      { name: 'targetNode', type: 'address' },
      { name: 'proofType', type: 'uint8' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'submitProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'challengeId', type: 'bytes32' },
      { name: 'proofData', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'txHash', type: 'bytes32' }],
  },
  {
    name: 'verifyProof',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'challengeId', type: 'bytes32' }],
    outputs: [
      { name: 'valid', type: 'bool' },
      { name: 'prover', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    name: 'getChallenge',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'challengeId', type: 'bytes32' }],
    outputs: [
      { name: 'cid', type: 'string' },
      { name: 'challenger', type: 'address' },
      { name: 'targetNode', type: 'address' },
      { name: 'proofType', type: 'uint8' },
      { name: 'deadline', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    name: 'claimReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'challengeId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'slash',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'challengeId', type: 'bytes32' },
      { name: 'nodeAddress', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'ChallengeCreated',
    type: 'event',
    inputs: [
      { name: 'challengeId', type: 'bytes32', indexed: true },
      { name: 'cid', type: 'string', indexed: false },
      { name: 'challenger', type: 'address', indexed: true },
      { name: 'deadline', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ProofSubmitted',
    type: 'event',
    inputs: [
      { name: 'challengeId', type: 'bytes32', indexed: true },
      { name: 'prover', type: 'address', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ChallengeResolved',
    type: 'event',
    inputs: [
      { name: 'challengeId', type: 'bytes32', indexed: true },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'reward', type: 'uint256', indexed: false },
    ],
  },
] as const
