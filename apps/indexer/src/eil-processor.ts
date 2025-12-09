/**
 * EIL (Ethereum Interop Layer) Event Processor
 * 
 * Indexes cross-chain transfer events from CrossChainPaymaster and L1StakeManager
 */

import { Store } from '@subsquid/typeorm-store'
import { ProcessorContext } from './processor'
import { 
    XLP, XLPLiquidityDeposit, CrossChainVoucherRequest, CrossChainVoucher,
    EILTransfer, XLPSlashEvent, EILStats, EILChainStats,
    VoucherRequestStatus, VoucherStatus, TransferStatus, Account
} from './model'
import { ethers } from 'ethers'

// Event signatures for CrossChainPaymaster
const VOUCHER_REQUESTED = ethers.id('VoucherRequested(bytes32,address,address,uint256,uint256,address,uint256,uint256)')
const VOUCHER_ISSUED = ethers.id('VoucherIssued(bytes32,bytes32,address,uint256)')
const VOUCHER_FULFILLED = ethers.id('VoucherFulfilled(bytes32,address,uint256)')
const VOUCHER_EXPIRED = ethers.id('VoucherExpired(bytes32,address)')
const FUNDS_REFUNDED = ethers.id('FundsRefunded(bytes32,address,uint256)')
const XLP_DEPOSIT = ethers.id('XLPDeposit(address,address,uint256)')
const XLP_WITHDRAW = ethers.id('XLPWithdraw(address,address,uint256)')
const SOURCE_FUNDS_CLAIMED = ethers.id('SourceFundsClaimed(bytes32,address,uint256,uint256)')

// Event signatures for L1StakeManager  
const XLP_REGISTERED = ethers.id('XLPRegistered(address,uint256,uint256[])')
const STAKE_DEPOSITED = ethers.id('StakeDeposited(address,uint256,uint256)')
const UNBONDING_STARTED = ethers.id('UnbondingStarted(address,uint256,uint256)')
const STAKE_WITHDRAWN = ethers.id('StakeWithdrawn(address,uint256)')
const XLP_SLASHED = ethers.id('XLPSlashed(address,bytes32,uint256,address)')

const EIL_EVENT_SIGNATURES = new Set([
    VOUCHER_REQUESTED, VOUCHER_ISSUED, VOUCHER_FULFILLED, VOUCHER_EXPIRED,
    FUNDS_REFUNDED, XLP_DEPOSIT, XLP_WITHDRAW, SOURCE_FUNDS_CLAIMED,
    XLP_REGISTERED, STAKE_DEPOSITED, UNBONDING_STARTED, STAKE_WITHDRAWN, XLP_SLASHED
])

interface LogData {
    address: string
    topics: string[]
    data: string
    logIndex: number
    transactionIndex: number
    transaction?: { hash: string }
}

interface BlockHeader {
    hash: string
    height: number
    timestamp: number
}

export async function processEILEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const xlps = new Map<string, XLP>()
    const xlpDeposits = new Map<string, XLPLiquidityDeposit>()
    const voucherRequests = new Map<string, CrossChainVoucherRequest>()
    const vouchers = new Map<string, CrossChainVoucher>()
    const transfers = new Map<string, EILTransfer>()
    const slashEvents: XLPSlashEvent[] = []
    const chainStats = new Map<number, EILChainStats>()

    // Load existing XLPs
    const existingXLPs = await ctx.store.find(XLP)
    for (const xlp of existingXLPs) {
        xlps.set(xlp.id, xlp)
    }

    for (const block of ctx.blocks) {
        const header = block.header as unknown as BlockHeader
        const blockTimestamp = new Date(header.timestamp)

        for (const rawLog of block.logs) {
            const log = rawLog as unknown as LogData
            const eventSig = log.topics[0]

            if (!eventSig || !EIL_EVENT_SIGNATURES.has(eventSig)) continue

            const txHash = log.transaction?.hash || `${header.hash}-${log.transactionIndex}`

            // Process CrossChainPaymaster events
            if (eventSig === VOUCHER_REQUESTED) {
                await processVoucherRequested(ctx, log, header, blockTimestamp, voucherRequests, transfers)
            } else if (eventSig === VOUCHER_ISSUED) {
                await processVoucherIssued(ctx, log, header, blockTimestamp, xlps, voucherRequests, vouchers)
            } else if (eventSig === VOUCHER_FULFILLED) {
                await processVoucherFulfilled(ctx, log, header, blockTimestamp, xlps, vouchers, transfers)
            } else if (eventSig === VOUCHER_EXPIRED) {
                await processVoucherExpired(ctx, log, voucherRequests)
            } else if (eventSig === FUNDS_REFUNDED) {
                await processFundsRefunded(ctx, log, voucherRequests, transfers)
            } else if (eventSig === XLP_DEPOSIT) {
                await processXLPDeposit(ctx, log, header, blockTimestamp, xlps, xlpDeposits)
            } else if (eventSig === XLP_WITHDRAW) {
                await processXLPWithdraw(ctx, log, header, blockTimestamp, xlps, xlpDeposits)
            } else if (eventSig === SOURCE_FUNDS_CLAIMED) {
                await processSourceFundsClaimed(ctx, log, header, xlps, vouchers)
            }

            // Process L1StakeManager events
            else if (eventSig === XLP_REGISTERED) {
                await processXLPRegistered(ctx, log, header, blockTimestamp, xlps)
            } else if (eventSig === STAKE_DEPOSITED) {
                await processStakeDeposited(ctx, log, xlps)
            } else if (eventSig === UNBONDING_STARTED) {
                await processUnbondingStarted(ctx, log, header, xlps)
            } else if (eventSig === STAKE_WITHDRAWN) {
                await processStakeWithdrawn(ctx, log, xlps)
            } else if (eventSig === XLP_SLASHED) {
                await processXLPSlashed(ctx, log, header, blockTimestamp, xlps, slashEvents, txHash)
            }

            // Update chain stats
            updateChainStats(log.address, chainStats)
        }
    }

    // Persist all entities
    if (xlps.size > 0) {
        await ctx.store.upsert(Array.from(xlps.values()))
    }
    if (xlpDeposits.size > 0) {
        await ctx.store.upsert(Array.from(xlpDeposits.values()))
    }
    if (voucherRequests.size > 0) {
        await ctx.store.upsert(Array.from(voucherRequests.values()))
    }
    if (vouchers.size > 0) {
        await ctx.store.upsert(Array.from(vouchers.values()))
    }
    if (transfers.size > 0) {
        await ctx.store.upsert(Array.from(transfers.values()))
    }
    if (slashEvents.length > 0) {
        await ctx.store.insert(slashEvents)
    }
    if (chainStats.size > 0) {
        await ctx.store.upsert(Array.from(chainStats.values()))
    }

    // Update global stats
    await updateGlobalStats(ctx)

    const totalEvents = voucherRequests.size + vouchers.size + transfers.size
    if (totalEvents > 0) {
        ctx.log.info(`EIL: Processed ${voucherRequests.size} requests, ${vouchers.size} vouchers, ${transfers.size} transfers`)
    }
}

async function processVoucherRequested(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    voucherRequests: Map<string, CrossChainVoucherRequest>,
    transfers: Map<string, EILTransfer>
): Promise<void> {
    const requestId = log.topics[1]
    const requesterAddr = '0x' + log.topics[2].slice(26)

    // Decode data: token, amount, destinationChainId, recipient, maxFee, deadline
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address', 'uint256', 'uint256', 'address', 'uint256', 'uint256'],
        log.data
    )

    const requester = await getOrCreateAccount(ctx, requesterAddr, header.height, timestamp)

    const request = new CrossChainVoucherRequest({
        id: requestId,
        requestId,
        requester,
        sourceChain: 420691, // Jeju mainnet - in production, derive from contract address
        destinationChain: Number(decoded[2]),
        sourceToken: decoded[0],
        destinationToken: decoded[0], // Same token by default
        amount: decoded[1],
        maxFee: decoded[4],
        currentFee: 0n,
        feeIncrement: 0n,
        recipient: decoded[3],
        gasOnDestination: 0n,
        deadline: decoded[5],
        createdAt: timestamp,
        createdBlock: BigInt(header.height),
        status: VoucherRequestStatus.PENDING,
        claimed: false,
        expired: false,
        refunded: false
    })

    voucherRequests.set(requestId, request)

    // Create transfer record
    const transfer = new EILTransfer({
        id: `${requestId}-transfer`,
        user: requester,
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
        sourceToken: request.sourceToken,
        destinationToken: request.destinationToken,
        amount: request.amount,
        fee: request.maxFee,
        request,
        status: TransferStatus.PENDING,
        initiatedAt: timestamp,
        sourceTxHash: log.transaction?.hash || ''
    })

    transfers.set(transfer.id, transfer)
}

async function processVoucherIssued(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>,
    voucherRequests: Map<string, CrossChainVoucherRequest>,
    vouchers: Map<string, CrossChainVoucher>
): Promise<void> {
    const voucherId = log.topics[1]
    const requestId = log.topics[2]
    const xlpAddr = '0x' + log.topics[3].slice(26)

    // Decode fee from data
    const fee = BigInt(log.data)

    const xlp = await getOrCreateXLP(ctx, xlpAddr, timestamp, xlps)
    const request = voucherRequests.get(requestId) || await ctx.store.get(CrossChainVoucherRequest, requestId)

    if (request) {
        request.status = VoucherRequestStatus.CLAIMED
        request.claimed = true
        voucherRequests.set(requestId, request)
    }

    const voucher = new CrossChainVoucher({
        id: voucherId,
        voucherId,
        request: request || undefined,
        xlp,
        sourceChainId: request?.sourceChain || 420691,
        destinationChainId: request?.destinationChain || 1,
        sourceToken: request?.sourceToken || '',
        destinationToken: request?.destinationToken || '',
        amount: request?.amount || 0n,
        fee,
        gasProvided: 0n,
        issuedAt: timestamp,
        issuedBlock: BigInt(header.height),
        expiresBlock: BigInt(header.height) + 100n, // VOUCHER_TIMEOUT
        status: VoucherStatus.ISSUED,
        fulfilled: false,
        slashed: false
    })

    vouchers.set(voucherId, voucher)

    // Update XLP stats
    xlp.totalVouchersIssued++
    xlps.set(xlp.id, xlp)
}

async function processVoucherFulfilled(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>,
    vouchers: Map<string, CrossChainVoucher>,
    transfers: Map<string, EILTransfer>
): Promise<void> {
    const voucherId = log.topics[1]
    const recipientAddr = '0x' + log.topics[2].slice(26)
    const amount = BigInt(log.data)

    let voucher = vouchers.get(voucherId) || await ctx.store.get(CrossChainVoucher, voucherId)
    if (voucher) {
        voucher.fulfilled = true
        voucher.status = VoucherStatus.FULFILLED
        voucher.destinationFulfillTx = log.transaction?.hash
        voucher.fulfillmentTime = timestamp
        vouchers.set(voucherId, voucher)

        // Update XLP stats
        if (voucher.xlp) {
            const xlp = xlps.get(voucher.xlp.id) || await ctx.store.get(XLP, voucher.xlp.id)
            if (xlp) {
                xlp.totalVouchersFulfilled++
                xlp.totalFeesEarned += voucher.fee
                xlps.set(xlp.id, xlp)
            }
        }

        // Update transfer
        const requestId = voucher.request?.id
        if (requestId) {
            const transferId = `${requestId}-transfer`
            let transfer = transfers.get(transferId) || await ctx.store.get(EILTransfer, transferId)
            if (transfer) {
                transfer.status = TransferStatus.COMPLETED
                transfer.completedAt = timestamp
                transfer.destinationTxHash = log.transaction?.hash
                transfers.set(transferId, transfer)
            }
        }
    }
}

async function processVoucherExpired(
    ctx: ProcessorContext<Store>,
    log: LogData,
    voucherRequests: Map<string, CrossChainVoucherRequest>
): Promise<void> {
    const requestId = log.topics[1]
    
    let request = voucherRequests.get(requestId) || await ctx.store.get(CrossChainVoucherRequest, requestId)
    if (request) {
        request.status = VoucherRequestStatus.EXPIRED
        request.expired = true
        voucherRequests.set(requestId, request)
    }
}

async function processFundsRefunded(
    ctx: ProcessorContext<Store>,
    log: LogData,
    voucherRequests: Map<string, CrossChainVoucherRequest>,
    transfers: Map<string, EILTransfer>
): Promise<void> {
    const requestId = log.topics[1]
    
    let request = voucherRequests.get(requestId) || await ctx.store.get(CrossChainVoucherRequest, requestId)
    if (request) {
        request.status = VoucherRequestStatus.REFUNDED
        request.refunded = true
        voucherRequests.set(requestId, request)
    }

    const transferId = `${requestId}-transfer`
    let transfer = transfers.get(transferId) || await ctx.store.get(EILTransfer, transferId)
    if (transfer) {
        transfer.status = TransferStatus.REFUNDED
        transfers.set(transferId, transfer)
    }
}

async function processXLPDeposit(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>,
    xlpDeposits: Map<string, XLPLiquidityDeposit>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    const tokenAddr = '0x' + log.topics[2].slice(26)
    const amount = BigInt(log.data)

    const xlp = await getOrCreateXLP(ctx, xlpAddr, timestamp, xlps)
    const depositId = `${xlpAddr}-${tokenAddr}-420691` // chainId

    let deposit = xlpDeposits.get(depositId) || await ctx.store.get(XLPLiquidityDeposit, depositId)
    
    const isETH = tokenAddr === '0x0000000000000000000000000000000000000000'
    
    if (!deposit) {
        deposit = new XLPLiquidityDeposit({
            id: depositId,
            xlp,
            token: tokenAddr,
            chainId: 420691,
            amount: isETH ? 0n : amount,
            ethAmount: isETH ? amount : 0n,
            lastUpdated: timestamp
        })
    } else {
        if (isETH) {
            deposit.ethAmount += amount
        } else {
            deposit.amount += amount
        }
        deposit.lastUpdated = timestamp
    }

    xlpDeposits.set(depositId, deposit)
}

async function processXLPWithdraw(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>,
    xlpDeposits: Map<string, XLPLiquidityDeposit>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    const tokenAddr = '0x' + log.topics[2].slice(26)
    const amount = BigInt(log.data)

    const depositId = `${xlpAddr}-${tokenAddr}-420691`
    let deposit = xlpDeposits.get(depositId) || await ctx.store.get(XLPLiquidityDeposit, depositId)
    
    if (deposit) {
        const isETH = tokenAddr === '0x0000000000000000000000000000000000000000'
        if (isETH) {
            deposit.ethAmount = deposit.ethAmount > amount ? deposit.ethAmount - amount : 0n
        } else {
            deposit.amount = deposit.amount > amount ? deposit.amount - amount : 0n
        }
        deposit.lastUpdated = timestamp
        xlpDeposits.set(depositId, deposit)
    }
}

async function processSourceFundsClaimed(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    xlps: Map<string, XLP>,
    vouchers: Map<string, CrossChainVoucher>
): Promise<void> {
    const requestId = log.topics[1]
    const xlpAddr = '0x' + log.topics[2].slice(26)
    
    // Decode amount and fee from data
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data)
    const amount = decoded[0]
    const fee = decoded[1]

    // Find voucher by request ID and update XLP earnings
    const xlp = xlps.get(xlpAddr.toLowerCase())
    if (xlp) {
        xlp.totalFeesEarned += fee
        xlps.set(xlp.id, xlp)
    }
}

async function processXLPRegistered(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    
    // Decode stakedAmount and chains from data
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256[]'], log.data)
    const stakedAmount = decoded[0]
    const chains = decoded[1].map((c: bigint) => Number(c))

    const xlp = await getOrCreateXLP(ctx, xlpAddr, timestamp, xlps)
    xlp.stakedAmount = stakedAmount
    xlp.isActive = true
    xlp.supportedChains = chains
    xlps.set(xlp.id, xlp)
}

async function processStakeDeposited(
    ctx: ProcessorContext<Store>,
    log: LogData,
    xlps: Map<string, XLP>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    
    // Decode amount and totalStake
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data)
    const totalStake = decoded[1]

    const xlp = xlps.get(xlpAddr.toLowerCase())
    if (xlp) {
        xlp.stakedAmount = totalStake
        xlps.set(xlp.id, xlp)
    }
}

async function processUnbondingStarted(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    xlps: Map<string, XLP>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    
    // Decode amount and unbondingComplete
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data)
    const amount = decoded[0]
    const unbondingComplete = decoded[1]

    const xlp = xlps.get(xlpAddr.toLowerCase())
    if (xlp) {
        xlp.unbondingAmount = amount
        xlp.unbondingStartTime = BigInt(header.timestamp)
        xlps.set(xlp.id, xlp)
    }
}

async function processStakeWithdrawn(
    ctx: ProcessorContext<Store>,
    log: LogData,
    xlps: Map<string, XLP>
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    const amount = BigInt(log.data)

    const xlp = xlps.get(xlpAddr.toLowerCase())
    if (xlp) {
        xlp.unbondingAmount = 0n
        xlp.unbondingStartTime = null
        xlp.isActive = xlp.stakedAmount > 0n
        xlps.set(xlp.id, xlp)
    }
}

async function processXLPSlashed(
    ctx: ProcessorContext<Store>,
    log: LogData,
    header: BlockHeader,
    timestamp: Date,
    xlps: Map<string, XLP>,
    slashEvents: XLPSlashEvent[],
    txHash: string
): Promise<void> {
    const xlpAddr = '0x' + log.topics[1].slice(26)
    const voucherId = log.topics[2]
    
    // Decode amount and victim
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'address'], log.data)
    const amount = decoded[0]
    const victim = decoded[1]

    const xlp = xlps.get(xlpAddr.toLowerCase())
    if (xlp) {
        xlp.slashedAmount += amount
        xlp.totalVouchersFailed++
        xlp.reputation = Math.max(0, xlp.reputation - 10) // Decrease reputation
        
        if (xlp.stakedAmount < amount) {
            xlp.stakedAmount = 0n
            xlp.isActive = false
        } else {
            xlp.stakedAmount -= amount
        }
        xlps.set(xlp.id, xlp)

        slashEvents.push(new XLPSlashEvent({
            id: `${txHash}-${log.logIndex}`,
            xlp,
            voucherId,
            chainId: 420691,
            amount,
            victim,
            timestamp,
            disputed: false,
            txHash
        }))
    }
}

async function getOrCreateAccount(
    ctx: ProcessorContext<Store>,
    address: string,
    blockNumber: number,
    timestamp: Date
): Promise<Account> {
    const id = address.toLowerCase()
    let account = await ctx.store.get(Account, id)
    
    if (!account) {
        account = new Account({
            id,
            address: id,
            isContract: false,
            firstSeenBlock: blockNumber,
            lastSeenBlock: blockNumber,
            transactionCount: 0,
            totalValueSent: 0n,
            totalValueReceived: 0n,
            labels: [],
            firstSeenAt: timestamp,
            lastSeenAt: timestamp
        })
        await ctx.store.insert(account)
    }
    
    return account
}

async function getOrCreateXLP(
    ctx: ProcessorContext<Store>,
    address: string,
    timestamp: Date,
    xlps: Map<string, XLP>
): Promise<XLP> {
    const id = address.toLowerCase()
    let xlp = xlps.get(id)
    
    if (!xlp) {
        xlp = await ctx.store.get(XLP, id)
    }
    
    if (!xlp) {
        xlp = new XLP({
            id,
            address: id,
            stakedAmount: 0n,
            unbondingAmount: 0n,
            slashedAmount: 0n,
            isActive: false,
            registeredAt: timestamp,
            supportedChains: [],
            totalVouchersIssued: 0,
            totalVouchersFulfilled: 0,
            totalVouchersFailed: 0,
            totalFeesEarned: 0n,
            averageResponseTimeMs: 0,
            reputation: 100 // Start with max reputation
        })
    }
    
    xlps.set(id, xlp)
    return xlp
}

function updateChainStats(contractAddress: string, chainStats: Map<number, EILChainStats>): void {
    // In production, map contract address to chain ID
    const chainId = 420691 // Default to Jeju mainnet
    
    let stats = chainStats.get(chainId)
    if (!stats) {
        stats = new EILChainStats({
            id: chainId.toString(),
            chainId,
            chainName: 'Jeju Mainnet',
            paymasterAddress: contractAddress,
            totalVolume: 0n,
            totalTransfers: 0n,
            activeXLPs: 0,
            totalLiquidity: 0n,
            lastUpdated: new Date()
        })
    }
    
    stats.totalTransfers++
    stats.lastUpdated = new Date()
    chainStats.set(chainId, stats)
}

async function updateGlobalStats(ctx: ProcessorContext<Store>): Promise<void> {
    const globalId = 'global'
    let stats = await ctx.store.get(EILStats, globalId)
    
    if (!stats) {
        stats = new EILStats({
            id: globalId,
            totalVolumeUsd: 0n,
            totalTransactions: 0n,
            totalXLPs: 0,
            activeXLPs: 0,
            totalStakedEth: 0n,
            averageFeePercent: 50, // 0.5%
            averageTimeSeconds: 10,
            successRate: 100,
            last24hVolume: 0n,
            last24hTransactions: 0n
        })
    }

    // Update from database counts
    const xlpCount = await ctx.store.count(XLP)
    const activeXLPCount = await ctx.store.count(XLP, { where: { isActive: true } })
    const transferCount = await ctx.store.count(EILTransfer)
    const completedCount = await ctx.store.count(EILTransfer, { where: { status: TransferStatus.COMPLETED } })

    stats.totalXLPs = xlpCount
    stats.activeXLPs = activeXLPCount
    stats.totalTransactions = BigInt(transferCount)
    stats.successRate = transferCount > 0 ? Math.floor((completedCount / transferCount) * 100) : 100

    await ctx.store.upsert(stats)
}

