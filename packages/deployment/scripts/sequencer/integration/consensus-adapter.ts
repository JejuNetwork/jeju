import {
  type Address,
  encodePacked,
  keccak256,
  type PublicClient,
  recoverAddress,
  stringToBytes,
  zeroHash,
} from 'viem'
import { expectValid, SignResponseSchema } from '../../../schemas'

interface Sequencer {
  address: string
  weight: bigint
  lastBlock: number
  signerUrl?: string
}

interface BlockProposal {
  blockNumber: number
  stateRoot: string
  parentHash: string
  timestamp: number
  sequencer: string
}

interface Vote {
  sequencer: string
  signature: string
  blockNumber: number
}

interface ConsensusConfig {
  signerUrls: string[]
  signerApiKey?: string
  requestTimeout: number
}

export class ConsensusAdapter {
  private sequencers: Sequencer[] = []
  private height = 0
  private round = 0
  private leader: string | null = null
  private totalWeight = 0n
  private isRunning = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private config: ConsensusConfig

  constructor(
    private publicClient: PublicClient,
    private sequencerRegistryAddress: Address,
    private sequencerRegistryAbi: ReturnType<typeof import('viem').parseAbi>,
    private blockInterval = 2000,
    private requiredVoteRatio = 2 / 3,
    config?: Partial<ConsensusConfig>,
  ) {
    this.config = {
      signerUrls: config?.signerUrls ?? [
        process.env.SIGNER_1_URL ?? 'http://signer-1:4100',
        process.env.SIGNER_2_URL ?? 'http://signer-2:4100',
        process.env.SIGNER_3_URL || 'http://signer-3:4100',
      ],
      // SECURITY: API key must be provided via config or environment
      signerApiKey:
        config?.signerApiKey ||
        process.env.SIGNER_API_KEY ||
        (() => {
          throw new Error('SIGNER_API_KEY required')
        })(),
      requestTimeout: config?.requestTimeout ?? 5000,
    }
  }

  async loadSequencers(): Promise<void> {
    const result = (await this.publicClient.readContract({
      address: this.sequencerRegistryAddress,
      abi: this.sequencerRegistryAbi,
      functionName: 'getActiveSequencers',
    })) as [Address[], bigint[]]
    const addresses = result[0]
    const weights = result[1]
    this.sequencers = addresses.map((addr, i) => ({
      address: addr,
      weight: weights[i],
      lastBlock: 0,
      signerUrl: this.config.signerUrls[i] || undefined,
    }))
    this.totalWeight = this.sequencers.reduce((sum, s) => sum + s.weight, 0n)
    console.log(
      `Loaded ${this.sequencers.length} sequencers, total weight: ${this.totalWeight}`,
    )
  }

  selectNextSequencer(): string {
    if (this.sequencers.length === 0)
      throw new Error('No sequencers registered')
    const rand = BigInt(Math.floor(Math.random() * Number(this.totalWeight)))
    let cumulative = 0n
    for (const seq of this.sequencers) {
      cumulative += seq.weight
      if (rand < cumulative) return seq.address
    }
    return this.sequencers[this.round % this.sequencers.length].address
  }

  async proposeBlock(parentHash: `0x${string}`): Promise<BlockProposal> {
    this.height++
    this.round = 0
    this.leader = this.selectNextSequencer()

    const stateRoot = keccak256(
      stringToBytes(`state_${this.height}_${Date.now()}`),
    )

    return {
      blockNumber: this.height,
      stateRoot,
      parentHash,
      timestamp: Date.now(),
      sequencer: this.leader,
    }
  }

  /**
   * Collect REAL signatures from P2P signer services via HTTP
   */
  async collectVotesP2P(proposal: BlockProposal): Promise<Vote[]> {
    const votes: Vote[] = []
    const requiredVotes = Math.ceil(
      this.sequencers.length * this.requiredVoteRatio,
    )

    // Create the message digest
    const messageHash = keccak256(
      encodePacked(
        ['uint256', 'bytes32', 'bytes32', 'uint256'],
        [
          BigInt(proposal.blockNumber),
          proposal.stateRoot as `0x${string}`,
          proposal.parentHash as `0x${string}`,
          BigInt(proposal.timestamp),
        ],
      ),
    )
    const digest = messageHash

    console.log(
      `[Consensus] Collecting signatures for block ${proposal.blockNumber}...`,
    )
    console.log(
      `[Consensus] Required: ${requiredVotes}/${this.sequencers.length}`,
    )

    // Request signatures from all signer services in parallel
    const signerPromises = this.config.signerUrls.map(async (url, index) => {
      const requestId = `${proposal.blockNumber}-${index}-${Date.now()}`

      try {
        const controller = new AbortController()
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.requestTimeout,
        )

        const response = await fetch(`${url}/sign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.signerApiKey}`,
          },
          body: JSON.stringify({
            digest,
            requestId,
            timestamp: Date.now(),
            context: `block_${proposal.blockNumber}`,
          }),
          signal: controller.signal,
        })

        clearTimeout(timeout)

        if (!response.ok) {
          console.log(
            `[Consensus] Signer ${index + 1} (${url}) returned ${response.status}`,
          )
          return null
        }

        const resultRaw = await response.json()
        const result = expectValid(
          SignResponseSchema,
          resultRaw,
          'signer response',
        )

        if (result.error) {
          console.log(`[Consensus] Signer ${index + 1} error: ${result.error}`)
          return null
        }

        console.log(
          `[Consensus] ✓ Got signature from signer ${index + 1} (${result.signer.slice(0, 10)}...)`,
        )

        return {
          sequencer: result.signer,
          signature: result.signature,
          blockNumber: proposal.blockNumber,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (errorMsg.includes('abort')) {
          console.log(`[Consensus] Signer ${index + 1} (${url}) timed out`)
        } else {
          console.log(
            `[Consensus] Signer ${index + 1} (${url}) failed: ${errorMsg.slice(0, 50)}`,
          )
        }
        return null
      }
    })

    const results = await Promise.all(signerPromises)

    // Filter out failed requests
    for (const result of results) {
      if (result) votes.push(result)
    }

    console.log(
      `[Consensus] Collected ${votes.length}/${requiredVotes} required signatures`,
    )
    return votes
  }

  /**
   * Verify signatures are valid and from registered sequencers
   */
  async verifyVotes(proposal: BlockProposal, votes: Vote[]): Promise<boolean> {
    const requiredVotes = Math.ceil(
      this.sequencers.length * this.requiredVoteRatio,
    )
    if (votes.length < requiredVotes) {
      console.log(
        `[Consensus] Insufficient votes: ${votes.length}/${requiredVotes}`,
      )
      return false
    }

    const messageHash = keccak256(
      encodePacked(
        ['uint256', 'bytes32', 'bytes32', 'uint256'],
        [
          BigInt(proposal.blockNumber),
          proposal.stateRoot as `0x${string}`,
          proposal.parentHash as `0x${string}`,
          BigInt(proposal.timestamp),
        ],
      ),
    )

    const validSigners = new Set<string>()
    const sequencerAddrs = new Set(
      this.sequencers.map((s) => s.address.toLowerCase()),
    )

    for (const vote of votes) {
      try {
        const recovered = await recoverAddress({
          hash: messageHash,
          signature: vote.signature as `0x${string}`,
        })
        const recoveredLower = recovered.toLowerCase()

        if (
          recoveredLower === vote.sequencer.toLowerCase() &&
          sequencerAddrs.has(recoveredLower)
        ) {
          validSigners.add(recoveredLower)
        } else {
          console.log(
            `[Consensus] Invalid signature: claimed ${vote.sequencer.slice(0, 10)}, recovered ${recovered.slice(0, 10)}`,
          )
        }
      } catch (error) {
        console.log(`[Consensus] Signature verification failed: ${error}`)
      }
    }

    const isValid = validSigners.size >= requiredVotes
    console.log(
      `[Consensus] Valid signatures: ${validSigners.size}/${requiredVotes} - ${isValid ? 'PASS' : 'FAIL'}`,
    )
    return isValid
  }

  async finalizeBlock(
    proposal: BlockProposal,
    votes: Vote[],
  ): Promise<{ stateRoot: string; signatures: string[] }> {
    const seq = this.sequencers.find(
      (s) => s.address.toLowerCase() === proposal.sequencer.toLowerCase(),
    )
    if (seq) seq.lastBlock = proposal.blockNumber

    console.log(`[Consensus] ✅ Block ${proposal.blockNumber} finalized`)
    console.log(`[Consensus]    Leader: ${proposal.sequencer.slice(0, 10)}...`)
    console.log(`[Consensus]    Signatures: ${votes.length}`)
    console.log(
      `[Consensus]    State root: ${proposal.stateRoot.slice(0, 20)}...`,
    )

    return {
      stateRoot: proposal.stateRoot,
      signatures: votes.map((v) => v.signature),
    }
  }

  getHeight(): number {
    return this.height
  }
  getLeader(): string | null {
    return this.leader
  }
  getSequencerCount(): number {
    return this.sequencers.length
  }
  getRequiredVotes(): number {
    return Math.ceil(this.sequencers.length * this.requiredVoteRatio)
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    console.log('[Consensus] Starting consensus adapter...')
    console.log(`[Consensus] Signer URLs: ${this.config.signerUrls.join(', ')}`)
    console.log(
      `[Consensus] Required vote ratio: ${this.requiredVoteRatio * 100}%`,
    )

    await this.loadSequencers()
    this.pollInterval = setInterval(
      () => this.loadSequencers().catch(console.error),
      10000,
    )
    this.runBlockProduction()
  }

  stop(): void {
    this.isRunning = false
    if (this.pollInterval) clearInterval(this.pollInterval)
    console.log('[Consensus] Stopped')
  }

  private async runBlockProduction(): Promise<void> {
    let parentHash: `0x${string}` = zeroHash
    let consecutiveFailures = 0
    const maxConsecutiveFailures = 5

    while (this.isRunning) {
      if (this.sequencers.length === 0) {
        console.log('[Consensus] Waiting for sequencers to register...')
        await this.sleep(this.blockInterval)
        continue
      }

      const proposal = await this.proposeBlock(parentHash)

      // Collect REAL signatures via P2P
      const votes = await this.collectVotesP2P(proposal)

      // Verify signatures
      const hasConsensus = await this.verifyVotes(proposal, votes)

      if (hasConsensus) {
        const result = await this.finalizeBlock(proposal, votes)
        parentHash = keccak256(stringToBytes(result.stateRoot))
        consecutiveFailures = 0
      } else {
        consecutiveFailures++
        console.log(
          `[Consensus] Block ${proposal.blockNumber} failed consensus (attempt ${this.round + 1})`,
        )

        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.log(
            `[Consensus] ⚠️ ${consecutiveFailures} consecutive failures, check signer services`,
          )
        }

        this.round++
        // Don't increment height on failure - retry same block
        this.height--
      }

      await this.sleep(this.blockInterval)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
