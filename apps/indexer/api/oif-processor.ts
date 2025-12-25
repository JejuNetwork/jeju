/**
 * OIF intent event processor
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import {
  OIFAttestation,
  OIFChainStats,
  OIFIntent,
  OIFIntentStatus,
  OIFOracleType,
  OIFRoute,
  OIFSettlement,
  OIFSettlementStatus,
  OIFSlashEvent,
  OIFSolver,
  OIFStats,
} from './model'
import { getChainId } from './network-config'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeLogData, isEventInSet } from './utils/hex'

const ORDER_OPENED = keccak256(
  stringToHex(
    'Open(bytes32,(address,uint256,uint32,uint32,bytes32,(bytes32,uint256,bytes32,uint256)[],(bytes32,uint256,bytes32,uint256)[],(uint64,bytes32,bytes)[]))',
  ),
)
const ORDER_CREATED = keccak256(
  stringToHex(
    'OrderCreated(bytes32,address,address,uint256,uint256,address,uint32)',
  ),
)
const ORDER_CLAIMED = keccak256(
  stringToHex('OrderClaimed(bytes32,address,uint256)'),
)
const ORDER_SETTLED = keccak256(
  stringToHex('OrderSettled(bytes32,address,uint256,uint256)'),
)
const ORDER_REFUNDED = keccak256(
  stringToHex('OrderRefunded(bytes32,address,uint256)'),
)

// Event signatures for OutputSettler
const FILL_EVENT = keccak256(stringToHex('Fill(bytes32,bytes32,bytes)'))
const ORDER_FILLED = keccak256(
  stringToHex('OrderFilled(bytes32,address,address,address,uint256)'),
)
const LIQUIDITY_DEPOSITED = keccak256(
  stringToHex('LiquidityDeposited(address,address,uint256)'),
)
const LIQUIDITY_WITHDRAWN = keccak256(
  stringToHex('LiquidityWithdrawn(address,address,uint256)'),
)

// Event signatures for SolverRegistry
const SOLVER_REGISTERED = keccak256(
  stringToHex('SolverRegistered(address,uint256,uint256[])'),
)
const SOLVER_STAKE_DEPOSITED = keccak256(
  stringToHex('SolverStakeDeposited(address,uint256,uint256)'),
)
const SOLVER_SLASHED = keccak256(
  stringToHex('SolverSlashed(address,bytes32,uint256)'),
)
const SOLVER_WITHDRAWN = keccak256(
  stringToHex('SolverWithdrawn(address,uint256)'),
)
const FILL_RECORDED = keccak256(
  stringToHex('FillRecorded(address,bytes32,bool)'),
)

// Event signatures for Oracle
const ATTESTATION_SUBMITTED = keccak256(
  stringToHex('AttestationSubmitted(bytes32,address,uint256)'),
)

const OIF_EVENT_SIGNATURES = new Set([
  ORDER_OPENED,
  ORDER_CREATED,
  ORDER_CLAIMED,
  ORDER_SETTLED,
  ORDER_REFUNDED,
  FILL_EVENT,
  ORDER_FILLED,
  LIQUIDITY_DEPOSITED,
  LIQUIDITY_WITHDRAWN,
  SOLVER_REGISTERED,
  SOLVER_STAKE_DEPOSITED,
  SOLVER_SLASHED,
  SOLVER_WITHDRAWN,
  FILL_RECORDED,
  ATTESTATION_SUBMITTED,
]) as Set<Hex>

export function isOIFEvent(topic0: string): boolean {
  return isEventInSet(topic0, OIF_EVENT_SIGNATURES)
}

export async function processOIFEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const intents = new Map<string, OIFIntent>()
  const solvers = new Map<string, OIFSolver>()
  const settlements = new Map<string, OIFSettlement>()
  const attestations = new Map<string, OIFAttestation>()
  const slashEvents: OIFSlashEvent[] = []
  const accountFactory = createAccountFactory()
  const routes = new Map<string, OIFRoute>()
  const chainStats = new Map<number, OIFChainStats>()

  async function getOrCreateSolver(
    address: string,
    timestamp: Date,
  ): Promise<OIFSolver> {
    const id = address.toLowerCase()
    let solver = solvers.get(id)
    if (!solver) {
      solver = await ctx.store.get(OIFSolver, id)
    }
    if (!solver) {
      solver = new OIFSolver({
        id,
        address: id,
        stakedAmount: 0n,
        unbondingAmount: 0n,
        slashedAmount: 0n,
        isActive: false,
        registeredAt: timestamp,
        lastActiveAt: timestamp,
        supportedChains: [],
        totalFills: 0,
        successfulFills: 0,
        failedFills: 0,
        successRate: 0,
        averageResponseMs: 0,
        averageFillTimeMs: 0,
        totalVolumeUsd: 0n,
        totalFeesEarned: 0n,
        reputation: 50,
      })
    }
    solvers.set(id, solver)
    return solver
  }

  function getOrCreateRoute(
    sourceChainId: number,
    destChainId: number,
  ): OIFRoute {
    const id = `${sourceChainId}-${destChainId}`
    let route = routes.get(id)
    if (!route) {
      route = new OIFRoute({
        id,
        routeId: id,
        sourceChainId,
        destinationChainId: destChainId,
        inputSettler: '',
        outputSettler: '',
        oracle: OIFOracleType.SIMPLE,
        isActive: true,
        totalVolume: 0n,
        totalVolumeUsd: 0n,
        totalIntents: 0,
        successfulIntents: 0,
        failedIntents: 0,
        averageFeePercent: 50,
        averageFillTimeSeconds: 10,
        successRate: 100,
        activeSolvers: 0,
        totalLiquidity: 0n,
        createdAt: new Date(),
        lastUpdated: new Date(),
      })
      routes.set(id, route)
    }
    return route
  }

  // Load existing entities
  const existingSolvers = await ctx.store.find(OIFSolver)
  for (const solver of existingSolvers) {
    solvers.set(solver.id, solver)
  }

  for (const block of ctx.blocks) {
    const header = block.header
    const blockTimestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]

      if (!eventSig || !isEventInSet(eventSig, OIF_EVENT_SIGNATURES)) continue

      const txHash =
        log.transaction?.hash ?? `${header.hash}-${log.transactionIndex}`

      // Process each event type
      if (eventSig === ORDER_CREATED) {
        // OrderCreated(bytes32 indexed orderId, address indexed user, address inputToken, uint256 inputAmount, uint256 destinationChainId, address recipient, uint32 fillDeadline)
        // topics[0] = sig, topics[1] = orderId (indexed), topics[2] = user (indexed)
        // data = (inputToken, inputAmount, destinationChainId, recipient, fillDeadline)
        const orderId = log.topics[1]
        const userAddr = `0x${log.topics[2].slice(26)}`
        const decoded = decodeLogData(
          [
            { type: 'address' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'address' },
            { type: 'uint32' },
          ] as const,
          log.data,
        )

        const user = accountFactory.getOrCreate(
          userAddr,
          header.height,
          blockTimestamp,
        )
        const sourceChainId = getChainId()
        const destChainId = Number(decoded[2])

        const intent = new OIFIntent({
          id: orderId,
          intentId: orderId,
          user,
          nonce: 0n,
          sourceChainId,
          openDeadline: BigInt(header.height) + 100n,
          fillDeadline: BigInt(decoded[4].toString()),
          inputToken: decoded[0], // inputToken
          inputAmount: BigInt(decoded[1].toString()), // inputAmount
          outputToken: decoded[0], // Same token for now
          outputAmount: (BigInt(decoded[1].toString()) * 995n) / 1000n, // 0.5% fee estimate
          outputChainId: destChainId,
          recipient: decoded[3], // recipient
          maxFee: 0n,
          status: OIFIntentStatus.OPEN,
          createdAt: blockTimestamp,
          inputSettlerTx: txHash,
          createdBlock: BigInt(header.height),
        })

        intents.set(orderId, intent)
        ctx.log.info(`OIF Intent created: ${orderId.slice(0, 16)}...`)

        // Update route stats
        const route = getOrCreateRoute(sourceChainId, destChainId)
        route.totalIntents++
        route.lastUpdated = blockTimestamp
      }

      if (eventSig === ORDER_CLAIMED) {
        const orderId = log.topics[1]
        const intent =
          intents.get(orderId) || (await ctx.store.get(OIFIntent, orderId))
        if (intent) {
          intent.status = OIFIntentStatus.CLAIMED
          intent.claimedAt = blockTimestamp
          intent.claimTx = txHash
          intents.set(orderId, intent)
        }
      }

      if (eventSig === ORDER_FILLED) {
        // OrderFilled(bytes32 indexed orderId, address indexed solver, address indexed recipient, address token, uint256 amount)
        // topics[0] = sig, topics[1] = orderId, topics[2] = solver, topics[3] = recipient
        // data = (token, amount)
        const orderId = log.topics[1]
        const solverAddr = `0x${log.topics[2].slice(26)}`
        decodeLogData(
          [{ type: 'address' }, { type: 'uint256' }] as const,
          log.data,
        )

        const intent =
          intents.get(orderId) || (await ctx.store.get(OIFIntent, orderId))
        if (intent) {
          intent.status = OIFIntentStatus.FILLED
          intent.filledAt = blockTimestamp
          intent.filledBlock = BigInt(header.height)
          intent.outputSettlerTx = txHash
          intents.set(orderId, intent)

          const solver = await getOrCreateSolver(solverAddr, blockTimestamp)

          // Create settlement
          const settlementId = `${orderId}-${txHash}`
          const settlement = new OIFSettlement({
            id: settlementId,
            settlementId,
            intent,
            solver,
            sourceChainId: intent.sourceChainId,
            destinationChainId: intent.outputChainId,
            inputToken: intent.inputToken,
            outputToken: intent.outputToken,
            inputAmount: intent.inputAmount,
            outputAmount: intent.outputAmount,
            fee: intent.actualFee ?? 0n,
            status: OIFSettlementStatus.PENDING,
            createdAt: blockTimestamp,
            inputSettlerTx: intent.inputSettlerTx,
            outputSettlerTx: txHash,
          })
          settlements.set(settlementId, settlement)

          intent.solver = solver

          // Update solver stats
          solver.totalFills++
          solver.lastActiveAt = blockTimestamp
        }
      }

      if (eventSig === ORDER_SETTLED) {
        const orderId = log.topics[1]
        const intent =
          intents.get(orderId) || (await ctx.store.get(OIFIntent, orderId))
        if (intent) {
          intent.status = OIFIntentStatus.SETTLED
          intent.settledAt = blockTimestamp
          intents.set(orderId, intent)

          // Update settlements
          for (const [_id, settlement] of settlements) {
            if (settlement.intent.id === orderId) {
              settlement.status = OIFSettlementStatus.SETTLED
              settlement.settledAt = blockTimestamp
              settlement.claimTx = txHash

              // Update solver stats
              if (settlement.solver) {
                settlement.solver.successfulFills++
                settlement.solver.totalVolumeUsd += settlement.inputAmount
                settlement.solver.totalFeesEarned += settlement.fee
                settlement.solver.reputation = Math.min(
                  100,
                  settlement.solver.reputation + 1,
                )
                solvers.set(settlement.solver.id, settlement.solver)
              }
            }
          }

          // Update route stats
          const route = getOrCreateRoute(
            intent.sourceChainId,
            intent.outputChainId,
          )
          route.successfulIntents++
          route.totalVolume += intent.inputAmount
          route.lastUpdated = blockTimestamp
        }
      }

      if (eventSig === ORDER_REFUNDED) {
        const orderId = log.topics[1]
        const intent =
          intents.get(orderId) || (await ctx.store.get(OIFIntent, orderId))
        if (intent) {
          intent.status = OIFIntentStatus.CANCELLED
          intents.set(orderId, intent)

          // Update route stats
          const route = getOrCreateRoute(
            intent.sourceChainId,
            intent.outputChainId,
          )
          route.failedIntents++
          route.lastUpdated = blockTimestamp
        }
      }

      if (eventSig === SOLVER_REGISTERED) {
        const solverAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'uint256[]' }] as const,
          log.data,
        )

        const solver = await getOrCreateSolver(solverAddr, blockTimestamp)
        solver.stakedAmount = BigInt(decoded[0].toString())
        solver.isActive = true
        solver.supportedChains = decoded[1].map((c: bigint) => Number(c))
        solver.registeredAt = blockTimestamp
        solvers.set(solver.id, solver)

        ctx.log.info(`OIF Solver registered: ${solverAddr.slice(0, 16)}...`)
      }

      if (eventSig === SOLVER_STAKE_DEPOSITED) {
        const solverAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData(
          [{ type: 'uint256' }, { type: 'uint256' }] as const,
          log.data,
        )

        const solver = await getOrCreateSolver(solverAddr, blockTimestamp)
        solver.stakedAmount = decoded[1]
        solver.lastActiveAt = blockTimestamp
        solvers.set(solver.id, solver)
      }

      if (eventSig === SOLVER_SLASHED) {
        const solverAddr = `0x${log.topics[1].slice(26)}`
        const intentId = log.topics[2]
        const amount = BigInt(log.data)

        const solver = await getOrCreateSolver(solverAddr, blockTimestamp)
        solver.slashedAmount += amount
        solver.stakedAmount =
          solver.stakedAmount > amount ? solver.stakedAmount - amount : 0n
        solver.reputation = Math.max(0, solver.reputation - 10)
        solver.failedFills++
        solver.lastActiveAt = blockTimestamp

        if (solver.stakedAmount === 0n) {
          solver.isActive = false
        }

        solvers.set(solver.id, solver)

        slashEvents.push(
          new OIFSlashEvent({
            id: `${txHash}-${log.logIndex}`,
            solver,
            intentId,
            orderId: intentId,
            chainId: getChainId(),
            amount,
            victim: '',
            reason: 'Failed to fulfill intent',
            timestamp: blockTimestamp,
            disputed: false,
            txHash,
          }),
        )
      }

      if (eventSig === SOLVER_WITHDRAWN) {
        const solverAddr = `0x${log.topics[1].slice(26)}`
        const amount = BigInt(log.data)

        const solver = await getOrCreateSolver(solverAddr, blockTimestamp)
        solver.stakedAmount =
          solver.stakedAmount > amount ? solver.stakedAmount - amount : 0n
        solver.isActive = solver.stakedAmount > 0n
        solver.lastActiveAt = blockTimestamp
        solvers.set(solver.id, solver)
      }

      if (eventSig === FILL_RECORDED) {
        // FillRecorded(address indexed solver, bytes32 indexed orderId, bool success)
        // topics[0] = sig, topics[1] = solver, topics[2] = orderId
        // data = (success)
        const solverAddr = `0x${log.topics[1].slice(26)}`
        const decoded = decodeLogData([{ type: 'bool' }] as const, log.data)

        const success = decoded[0]
        const solver = await getOrCreateSolver(solverAddr, blockTimestamp)
        solver.totalFills++
        if (success) {
          solver.successfulFills++
          solver.reputation = Math.min(100, solver.reputation + 1)
        } else {
          solver.failedFills++
          solver.reputation = Math.max(0, solver.reputation - 5)
        }

        // Update success rate
        if (solver.totalFills > 0) {
          solver.successRate = Math.floor(
            (solver.successfulFills / solver.totalFills) * 100,
          )
        }

        solver.lastActiveAt = blockTimestamp
        solvers.set(solver.id, solver)
      }

      if (eventSig === ATTESTATION_SUBMITTED) {
        // AttestationSubmitted(bytes32 indexed orderId, address indexed attester, uint256 timestamp)
        // topics[0] = sig, topics[1] = orderId, topics[2] = attester
        // data = (timestamp)
        const orderId = log.topics[1]
        decodeLogData([{ type: 'uint256' }] as const, log.data)

        const attestationId = `${orderId}-${txHash}`
        const intent =
          intents.get(orderId) || (await ctx.store.get(OIFIntent, orderId))

        if (intent) {
          intent.attestationTx = txHash
          intents.set(orderId, intent)

          const attestation = new OIFAttestation({
            id: attestationId,
            attestationId,
            intent,
            orderId,
            oracleType: OIFOracleType.SIMPLE,
            sourceChainId: intent.sourceChainId,
            destinationChainId: intent.outputChainId,
            proof: '',
            proofBlockNumber: BigInt(header.height),
            proofTimestamp: blockTimestamp,
            verified: true,
            verifiedAt: blockTimestamp,
            verificationTx: txHash,
          })
          attestations.set(attestationId, attestation)

          // Update settlements
          for (const [_id, settlement] of settlements) {
            if (settlement.intent.id === orderId) {
              settlement.status = OIFSettlementStatus.ATTESTED
              settlement.attestedAt = blockTimestamp
              settlement.attestationTx = txHash
              settlement.attestation = attestation
            }
          }
        }
      }

      // Update chain stats
      updateChainStats(log.address, header.height, chainStats)
    }
  }

  // Update route success rates
  for (const [, route] of routes) {
    if (route.totalIntents > 0) {
      route.successRate = Math.floor(
        (route.successfulIntents / route.totalIntents) * 100,
      )
    }
  }

  // Persist all entities
  await ctx.store.upsert(accountFactory.getAll())

  if (intents.size > 0) {
    await ctx.store.upsert([...intents.values()])
  }
  if (solvers.size > 0) {
    await ctx.store.upsert([...solvers.values()])
  }
  if (settlements.size > 0) {
    await ctx.store.upsert([...settlements.values()])
  }
  if (attestations.size > 0) {
    await ctx.store.upsert([...attestations.values()])
  }
  if (slashEvents.length > 0) {
    await ctx.store.insert(slashEvents)
  }
  if (routes.size > 0) {
    await ctx.store.upsert([...routes.values()])
  }
  if (chainStats.size > 0) {
    await ctx.store.upsert([...chainStats.values()])
  }

  // Update global stats
  await updateGlobalStats(ctx)

  const totalEvents =
    intents.size + solvers.size + settlements.size + attestations.size
  if (totalEvents > 0) {
    ctx.log.info(
      `OIF: ${intents.size} intents, ${solvers.size} solvers, ${settlements.size} settlements, ${attestations.size} attestations`,
    )
  }
}

function updateChainStats(
  contractAddress: string,
  _blockNumber: number,
  chainStats: Map<number, OIFChainStats>,
): void {
  const chainId = getChainId()

  let stats = chainStats.get(chainId)
  if (!stats) {
    stats = new OIFChainStats({
      id: chainId.toString(),
      chainId,
      chainName: 'Mainnet',
      inputSettlerAddress: contractAddress,
      outputSettlerAddress: '',
      totalIntents: 0,
      totalVolume: 0n,
      totalVolumeUsd: 0n,
      activeSolvers: 0,
      totalLiquidity: 0n,
      outboundIntents: 0,
      outboundVolume: 0n,
      inboundIntents: 0,
      inboundVolume: 0n,
      lastUpdated: new Date(),
    })
  }

  stats.totalIntents++
  stats.lastUpdated = new Date()
  chainStats.set(chainId, stats)
}

async function updateGlobalStats(ctx: ProcessorContext<Store>): Promise<void> {
  const globalId = 'global'
  let stats = await ctx.store.get(OIFStats, globalId)

  if (!stats) {
    stats = new OIFStats({
      id: globalId,
      totalIntents: 0n,
      openIntents: 0,
      pendingIntents: 0,
      filledIntents: 0,
      expiredIntents: 0,
      totalVolume: 0n,
      totalVolumeUsd: 0n,
      totalFees: 0n,
      totalFeesUsd: 0n,
      totalSolvers: 0,
      activeSolvers: 0,
      totalSolverStake: 0n,
      totalRoutes: 0,
      activeRoutes: 0,
      averageFillTimeSeconds: 10,
      successRate: 100,
      last24hIntents: 0,
      last24hVolume: 0n,
      last24hFees: 0n,
      lastUpdated: new Date(),
    })
  }

  // Update counts from database
  const intentCount = await ctx.store.count(OIFIntent)
  const solverCount = await ctx.store.count(OIFSolver)
  const activeSolverCount = await ctx.store.count(OIFSolver, {
    where: { isActive: true },
  })
  const settledCount = await ctx.store.count(OIFIntent, {
    where: { status: OIFIntentStatus.SETTLED },
  })

  stats.totalIntents = BigInt(intentCount)
  stats.totalSolvers = solverCount
  stats.activeSolvers = activeSolverCount
  stats.filledIntents = settledCount
  stats.successRate =
    intentCount > 0 ? Math.floor((settledCount / intentCount) * 100) : 100
  stats.lastUpdated = new Date()

  await ctx.store.upsert(stats)
}
