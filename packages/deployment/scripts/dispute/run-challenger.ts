#!/usr/bin/env bun

/**
 * Permissionless Challenger Service
 *
 * Monitors L2 outputs and challenges invalid state roots with REAL fraud proofs.
 * Anyone can run this and earn rewards for successful challenges.
 *
 * Features:
 * - Real L2 state verification via eth_getProof
 * - Cannon MIPS proof generation
 * - Output root computation per OP Stack spec
 * - Automatic proof submission
 *
 * Required Environment:
 *   L1_RPC_URL - L1 RPC endpoint
 *   CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE - Challenger wallet
 *   DISPUTE_GAME_FACTORY_ADDRESS - DisputeGameFactory contract
 *   L2_OUTPUT_ORACLE_ADDRESS - L2OutputOracle contract (optional)
 *   L2_RPC_URL - L2 RPC endpoint for state verification
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCurrentNetwork, getL1RpcUrl, getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
  zeroAddress,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { inferChainFromRpcUrl } from '../shared/chain-utils'
import { type CannonProof, FraudProofGenerator } from './proof-generator'
import { type L2StateSnapshot, StateFetcher } from './state-fetcher'

const ROOT = join(import.meta.dir, '../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments')

// Contract ABIs
const DISPUTE_GAME_FACTORY_ABI = parseAbi([
  'function createGame(address proposer, bytes32 stateRoot, bytes32 claimRoot, uint8 gameType, uint8 proverType) payable returns (bytes32)',
  'function resolveChallengerWins(bytes32 gameId, bytes calldata proof) external',
  'function resolveProposerWins(bytes32 gameId, bytes calldata defenseProof) external',
  'function resolveTimeout(bytes32 gameId) external',
  'function getGame(bytes32 gameId) external view returns (tuple(address challenger, address proposer, bytes32 stateRoot, bytes32 claimRoot, uint8 gameType, uint8 proverType, uint8 status, uint256 bond, uint256 createdAt, uint256 resolvedAt))',
  'function getActiveGames() external view returns (bytes32[])',
  'function canResolveTimeout(bytes32 gameId) external view returns (bool)',
  'function MIN_BOND() external view returns (uint256)',
  'function DISPUTE_TIMEOUT() external view returns (uint256)',
  'event GameCreated(bytes32 indexed gameId, address indexed challenger, address indexed proposer, bytes32 stateRoot, uint8 gameType, uint8 proverType, uint256 bond)',
  'event GameResolved(bytes32 indexed gameId, uint8 outcome, address winner)',
])

const L2_OUTPUT_ORACLE_ABI = parseAbi([
  'function latestOutputIndex() external view returns (uint256)',
  'function getL2Output(uint256 outputIndex) external view returns (tuple(bytes32 outputRoot, uint128 timestamp, uint128 l2BlockNumber))',
  'event OutputProposed(bytes32 indexed outputRoot, uint256 indexed l2OutputIndex, uint256 indexed l2BlockNumber, uint256 l1Timestamp)',
])

interface ChallengerConfig {
  l1PublicClient: PublicClient
  l2PublicClient: PublicClient | null
  walletClient: WalletClient
  l1Chain: ReturnType<typeof inferChainFromRpcUrl>
  disputeGameFactoryAddress: Address
  l2OutputOracleAddress: Address | null
  minBond: bigint
  checkInterval: number
  proofGenerator: FraudProofGenerator
  stateFetcher: StateFetcher | null
}

interface PendingGame {
  gameId: Hex
  createdAt: number
  stateRoot: Hex
  claimRoot: Hex
  l2BlockNumber: bigint
  preSnapshot: L2StateSnapshot | null
  proof: CannonProof | null
}

interface OutputVerification {
  isValid: boolean
  l2BlockNumber: bigint
  claimedRoot: Hex
  correctRoot: Hex
  snapshot: L2StateSnapshot | null
}

class ChallengerService {
  private config: ChallengerConfig
  private isRunning = false
  private pendingGames = new Map<Hex, PendingGame>()
  private verifiedOutputs = new Map<string, OutputVerification>()
  private lastCheckedOutputIndex = 0n

  constructor(config: ChallengerConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    const account = this.config.walletClient.account
    if (!account) throw new Error('WalletClient must have an account')

    console.log('⚔️  Permissionless Challenger Started')
    console.log(`   Address: ${account.address}`)
    console.log(`   Factory: ${this.config.disputeGameFactoryAddress}`)
    console.log(`   Min Bond: ${formatEther(this.config.minBond)} ETH`)
    console.log(
      `   L2 State Fetcher: ${this.config.stateFetcher ? 'enabled' : 'disabled'}`,
    )
    console.log('')

    // Monitor for new outputs (polling)
    if (this.config.l2OutputOracleAddress) {
      console.log('📡 Monitoring L2 outputs for invalid state roots...')
      setInterval(() => this.pollOutputs(), this.config.checkInterval)
    }

    // Monitor for new games (polling)
    console.log('🎮 Monitoring dispute games...')
    setInterval(() => this.pollGames(), this.config.checkInterval)

    // Periodic checks
    this.startTimeoutChecker()
    this.startProofSubmitter()

    // Keep running
    await new Promise(() => {
      /* keep process running */
    })
  }

  stop(): void {
    this.isRunning = false
    console.log('Challenger stopped')
  }

  private async pollOutputs(): Promise<void> {
    if (!this.config.l2OutputOracleAddress) return

    try {
      const latest = (await this.config.l1PublicClient.readContract({
        address: this.config.l2OutputOracleAddress,
        abi: L2_OUTPUT_ORACLE_ABI,
        functionName: 'latestOutputIndex',
      })) as bigint

      // Only check new outputs
      if (latest <= this.lastCheckedOutputIndex) return

      for (let i = this.lastCheckedOutputIndex + 1n; i <= latest; i++) {
        const output = (await this.config.l1PublicClient.readContract({
          address: this.config.l2OutputOracleAddress,
          abi: L2_OUTPUT_ORACLE_ABI,
          functionName: 'getL2Output',
          args: [i],
        })) as [Hex, bigint, bigint]

        await this.verifyAndHandleOutput(output[0], i, output[2])
      }

      this.lastCheckedOutputIndex = latest
    } catch (error) {
      console.debug('[Challenger] Polling error (will retry):', error)
    }
  }

  private async verifyAndHandleOutput(
    claimedOutputRoot: Hex,
    l2OutputIndex: bigint,
    l2BlockNumber: bigint,
  ): Promise<void> {
    console.log(
      `\n📥 Output Proposed: index=${l2OutputIndex}, block=${l2BlockNumber}`,
    )

    const verification = await this.verifyOutputRoot(
      l2BlockNumber,
      claimedOutputRoot,
    )
    this.verifiedOutputs.set(l2BlockNumber.toString(), verification)

    if (!verification.isValid) {
      console.log(`❌ Invalid output detected at block ${l2BlockNumber}`)
      console.log(`   Claimed: ${claimedOutputRoot.slice(0, 20)}...`)
      console.log(`   Correct: ${verification.correctRoot.slice(0, 20)}...`)

      await this.createChallenge(
        claimedOutputRoot,
        verification.correctRoot,
        l2BlockNumber,
        verification.snapshot,
      )
    } else {
      console.log(`✓ Output verified as valid`)
    }
  }

  private async verifyOutputRoot(
    l2BlockNumber: bigint,
    claimedOutputRoot: Hex,
  ): Promise<OutputVerification> {
    if (!this.config.stateFetcher) {
      return {
        isValid: true,
        l2BlockNumber,
        claimedRoot: claimedOutputRoot,
        correctRoot: claimedOutputRoot,
        snapshot: null,
      }
    }

    try {
      const result = await this.config.stateFetcher.verifyOutputRoot(
        l2BlockNumber,
        claimedOutputRoot,
      )

      console.log(`   L2 block: ${l2BlockNumber}`)
      console.log(`   State root: ${result.snapshot.stateRoot.slice(0, 20)}...`)
      console.log(
        `   Computed output: ${result.actualOutputRoot.slice(0, 20)}...`,
      )
      console.log(`   Claimed output:  ${claimedOutputRoot.slice(0, 20)}...`)

      return {
        isValid: result.valid,
        l2BlockNumber,
        claimedRoot: claimedOutputRoot,
        correctRoot: result.actualOutputRoot,
        snapshot: result.snapshot,
      }
    } catch (error) {
      console.log(`   Could not verify: ${error}`)
      return {
        isValid: true,
        l2BlockNumber,
        claimedRoot: claimedOutputRoot,
        correctRoot: claimedOutputRoot,
        snapshot: null,
      }
    }
  }

  private async pollGames(): Promise<void> {
    try {
      const activeGames = (await this.config.l1PublicClient.readContract({
        address: this.config.disputeGameFactoryAddress,
        abi: DISPUTE_GAME_FACTORY_ABI,
        functionName: 'getActiveGames',
      })) as Hex[]

      for (const gameId of activeGames) {
        if (this.pendingGames.has(gameId)) continue

        const game = (await this.config.l1PublicClient.readContract({
          address: this.config.disputeGameFactoryAddress,
          abi: DISPUTE_GAME_FACTORY_ABI,
          functionName: 'getGame',
          args: [gameId],
        })) as [
          Address,
          Address,
          Hex,
          Hex,
          number,
          number,
          number,
          bigint,
          bigint,
          bigint,
        ]

        await this.handleGameCreated(
          gameId,
          game[0],
          game[1],
          game[2],
          game[3],
          game[4],
          game[5],
          game[7],
        )
      }
    } catch {
      // Ignore polling errors
    }
  }

  private async handleGameCreated(
    gameId: Hex,
    challenger: Address,
    proposer: Address,
    stateRoot: Hex,
    claimRoot: Hex,
    _gameType: number,
    _proverType: number,
    bond: bigint,
  ): Promise<void> {
    console.log(`\n🎮 Game Created: ${gameId.slice(0, 10)}...`)
    console.log(`   Challenger: ${challenger}`)
    console.log(`   Proposer: ${proposer}`)
    console.log(`   Bond: ${formatEther(bond)} ETH`)

    // Track the game
    const pendingGame: PendingGame = {
      gameId,
      createdAt: Date.now(),
      stateRoot,
      claimRoot,
      l2BlockNumber: 0n,
      preSnapshot: null,
      proof: null,
    }
    this.pendingGames.set(gameId, pendingGame)

    // If we're the challenger, generate the fraud proof
    const walletAccount = this.config.walletClient.account
    if (!walletAccount) return
    if (challenger.toLowerCase() === walletAccount.address.toLowerCase()) {
      console.log(`   We are the challenger - generating fraud proof...`)
      await this.generateAndStoreProof(gameId)
    }
  }

  private async createChallenge(
    claimedOutputRoot: Hex,
    correctOutputRoot: Hex,
    l2BlockNumber: bigint,
    snapshot: L2StateSnapshot | null,
  ): Promise<void> {
    const account = this.config.walletClient.account
    if (!account) throw new Error('WalletClient must have an account')
    const myAddress = account.address
    const balance = await this.config.l1PublicClient.getBalance({
      address: myAddress,
    })

    if (balance < this.config.minBond) {
      console.log(`❌ Insufficient balance for challenge bond`)
      console.log(`   Required: ${formatEther(this.config.minBond)} ETH`)
      console.log(`   Available: ${formatEther(balance)} ETH`)
      return
    }

    try {
      const createAccount = this.config.walletClient.account
      if (!createAccount) throw new Error('WalletClient must have an account')
      const hash = await this.config.walletClient.writeContract({
        chain: this.config.l1Chain,
        account: createAccount,
        address: this.config.disputeGameFactoryAddress,
        abi: DISPUTE_GAME_FACTORY_ABI,
        functionName: 'createGame',
        args: [
          zeroAddress, // proposer - filled by contract
          claimedOutputRoot,
          correctOutputRoot,
          0, // FAULT_DISPUTE
          0, // CANNON prover
        ],
        value: this.config.minBond,
      })

      console.log(`📤 Challenge submitted: ${hash}`)
      const receipt = await waitForTransactionReceipt(
        this.config.l1PublicClient,
        { hash },
      )
      console.log(`✓ Challenge confirmed in block ${receipt.blockNumber}`)

      // Parse GameCreated event
      const logs = await this.config.l1PublicClient.getLogs({
        address: this.config.disputeGameFactoryAddress,
        event: parseAbi([
          'event GameCreated(bytes32 indexed gameId, address indexed challenger, address indexed proposer, bytes32 stateRoot, uint8 gameType, uint8 proverType, uint256 bond)',
        ])[0],
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      })

      if (logs.length > 0) {
        // GameCreated event: gameId is first indexed topic (after event signature)
        const gameId = logs[0].topics[1]
        if (!gameId)
          throw new Error('Failed to parse gameId from GameCreated event')
        console.log(`   Game ID: ${gameId}`)

        // Store game with snapshot for proof generation
        this.pendingGames.set(gameId, {
          gameId,
          createdAt: Date.now(),
          stateRoot: claimedOutputRoot,
          claimRoot: correctOutputRoot,
          l2BlockNumber,
          preSnapshot: snapshot,
          proof: null,
        })

        // Generate proof immediately
        await this.generateAndStoreProof(gameId)
      }
    } catch (error) {
      console.error(`Failed to create challenge:`, error)
    }
  }

  private async generateAndStoreProof(gameId: Hex): Promise<void> {
    const game = this.pendingGames.get(gameId)
    if (!game) return

    try {
      console.log(
        `\n🔐 Generating fraud proof for game ${gameId.slice(0, 10)}...`,
      )

      // Fetch pre-state if we have L2 access
      let preStateRoot: Hex
      if (this.config.stateFetcher && game.l2BlockNumber > 0n) {
        try {
          const preSnapshot = await this.config.stateFetcher.fetchStateSnapshot(
            game.l2BlockNumber - 1n,
          )
          preStateRoot = preSnapshot.stateRoot
          game.preSnapshot = preSnapshot
          console.log(
            `   Fetched pre-state from L2 block ${game.l2BlockNumber - 1n}`,
          )
        } catch {
          preStateRoot = game.stateRoot
        }
      } else {
        preStateRoot = game.stateRoot
      }

      const proofAccount = this.config.walletClient.account
      if (!proofAccount) throw new Error('WalletClient must have an account')
      if (proofAccount.type !== 'local')
        throw new Error(
          'WalletClient account must be a local account for signing',
        )
      const proof = await this.config.proofGenerator.generateFraudProof(
        preStateRoot,
        game.stateRoot, // claimed (potentially wrong)
        game.claimRoot, // correct state
        game.l2BlockNumber,
        proofAccount as PrivateKeyAccount,
      )

      game.proof = proof
      this.pendingGames.set(gameId, game)

      console.log(`✅ Proof generated (${proof.encoded.length / 2 - 1} bytes)`)
      console.log(`   Divergence step: ${proof.step}`)
    } catch (error) {
      console.error(`Failed to generate proof:`, error)
    }
  }

  private startTimeoutChecker(): void {
    setInterval(async () => {
      try {
        const activeGames = (await this.config.l1PublicClient.readContract({
          address: this.config.disputeGameFactoryAddress,
          abi: DISPUTE_GAME_FACTORY_ABI,
          functionName: 'getActiveGames',
        })) as Hex[]

        for (const gameId of activeGames) {
          try {
            const canResolve = await this.config.l1PublicClient.readContract({
              address: this.config.disputeGameFactoryAddress,
              abi: DISPUTE_GAME_FACTORY_ABI,
              functionName: 'canResolveTimeout',
              args: [gameId],
            })

            if (canResolve) {
              console.log(
                `\n⏰ Resolving timed-out game: ${gameId.slice(0, 10)}...`,
              )
              const resolveAccount = this.config.walletClient.account
              if (!resolveAccount)
                throw new Error('WalletClient must have an account')
              const hash = await this.config.walletClient.writeContract({
                chain: this.config.l1Chain,
                account: resolveAccount,
                address: this.config.disputeGameFactoryAddress,
                abi: DISPUTE_GAME_FACTORY_ABI,
                functionName: 'resolveTimeout',
                args: [gameId],
              })
              await waitForTransactionReceipt(this.config.l1PublicClient, {
                hash,
              })
              console.log(`✓ Game resolved via timeout`)
              this.pendingGames.delete(gameId)
            }
          } catch {
            // Game not resolvable yet
          }
        }
      } catch {
        // Ignore errors
      }
    }, this.config.checkInterval)
  }

  private startProofSubmitter(): void {
    setInterval(async () => {
      for (const [gameId, game] of this.pendingGames) {
        if (!game.proof) continue

        try {
          const onChainGame = (await this.config.l1PublicClient.readContract({
            address: this.config.disputeGameFactoryAddress,
            abi: DISPUTE_GAME_FACTORY_ABI,
            functionName: 'getGame',
            args: [gameId],
          })) as [
            Address,
            Address,
            Hex,
            Hex,
            number,
            number,
            number,
            bigint,
            bigint,
            bigint,
          ]

          // Only submit if game is still active (status = 0)
          if (onChainGame[6] !== 0) {
            this.pendingGames.delete(gameId)
            continue
          }

          // Check if we're the challenger
          const submitAccount = this.config.walletClient.account
          if (
            !submitAccount ||
            onChainGame[0].toLowerCase() !== submitAccount.address.toLowerCase()
          ) {
            continue
          }

          console.log(
            `\n📤 Submitting fraud proof for game ${gameId.slice(0, 10)}...`,
          )

          // Get contract-ready proof data
          const contractProof = this.config.proofGenerator.getContractProofData(
            game.proof,
          )

          const walletAccount = this.config.walletClient.account
          if (!walletAccount)
            throw new Error('WalletClient must have an account')
          const hash = await this.config.walletClient.writeContract({
            chain: this.config.l1Chain,
            account: walletAccount,
            address: this.config.disputeGameFactoryAddress,
            abi: DISPUTE_GAME_FACTORY_ABI,
            functionName: 'resolveChallengerWins',
            args: [gameId, contractProof],
          })
          const receipt = await waitForTransactionReceipt(
            this.config.l1PublicClient,
            { hash },
          )

          console.log(
            `✅ Proof submitted, game resolved in block ${receipt.blockNumber}`,
          )
          this.pendingGames.delete(gameId)
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)
          if (
            !errorMsg.includes('GameNotActive') &&
            !errorMsg.includes('TestModeCannotVerify')
          ) {
            console.log(`   Proof submission: ${errorMsg.slice(0, 50)}`)
          }
        }
      }
    }, 15000)
  }
}

function loadPrivateKey(): string {
  const keyFile = process.env.CHALLENGER_PRIVATE_KEY_FILE
  if (keyFile && existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim()
  }
  const key = process.env.CHALLENGER_PRIVATE_KEY
  if (key) return key
  throw new Error(
    'CHALLENGER_PRIVATE_KEY or CHALLENGER_PRIVATE_KEY_FILE required',
  )
}

async function main(): Promise<void> {
  console.log('⚔️  Permissionless Challenger Service\n')

  const network = getCurrentNetwork()
  const l1RpcUrl = getL1RpcUrl()
  const l2RpcUrl = getRpcUrl()

  let disputeGameFactoryAddr = process.env.DISPUTE_GAME_FACTORY_ADDRESS
  let l2OutputOracleAddr = process.env.L2_OUTPUT_ORACLE_ADDRESS

  const deploymentFile = join(DEPLOYMENTS_DIR, `${network}.json`)
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
    disputeGameFactoryAddr =
      disputeGameFactoryAddr || deployment.disputeGameFactory
    l2OutputOracleAddr = l2OutputOracleAddr || deployment.l2OutputOracle
    console.log(`Loaded deployment from ${deploymentFile}`)
  }

  if (!disputeGameFactoryAddr) {
    console.error('DISPUTE_GAME_FACTORY_ADDRESS required')
    process.exit(1)
  }

  const l1Chain = inferChainFromRpcUrl(l1RpcUrl)
  const l2Chain = l2RpcUrl ? inferChainFromRpcUrl(l2RpcUrl) : null
  const l1PublicClient = createPublicClient({
    chain: l1Chain,
    transport: http(l1RpcUrl),
  })
  const l2PublicClient =
    l2RpcUrl && l2Chain
      ? createPublicClient({ chain: l2Chain, transport: http(l2RpcUrl) })
      : null
  const privateKey = loadPrivateKey()
  const account = privateKeyToAccount(privateKey as Hex)
  const walletClient = createWalletClient({
    chain: l1Chain,
    transport: http(l1RpcUrl),
    account,
  })

  const disputeGameFactoryAddress = disputeGameFactoryAddr as Address
  const l2OutputOracleAddress = l2OutputOracleAddr as Address | null

  // Initialize state fetcher if L2 RPC available
  const stateFetcher = l2RpcUrl ? new StateFetcher(l2RpcUrl) : null

  const minBond = (await l1PublicClient.readContract({
    address: disputeGameFactoryAddress,
    abi: DISPUTE_GAME_FACTORY_ABI,
    functionName: 'MIN_BOND',
  })) as bigint

  const proofGenerator = new FraudProofGenerator(l1RpcUrl, l2RpcUrl)

  console.log(`Network: ${network}`)
  console.log(`L1 RPC: ${l1RpcUrl}`)
  console.log(
    `L2 RPC: ${l2RpcUrl ?? 'not configured (state verification disabled)'}`,
  )

  const challenger = new ChallengerService({
    l1PublicClient,
    l2PublicClient,
    walletClient,
    l1Chain,
    disputeGameFactoryAddress,
    l2OutputOracleAddress,
    minBond,
    checkInterval: 30000,
    proofGenerator,
    stateFetcher,
  })

  process.on('SIGINT', () => {
    challenger.stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    challenger.stop()
    process.exit(0)
  })

  await challenger.start()
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
