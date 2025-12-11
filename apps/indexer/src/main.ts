/**
 * Main indexer processor - comprehensive blockchain data indexing
 */

// Initialize network configuration and register known contracts
import './init';

import {TypeormDatabase} from '@subsquid/typeorm-store'
import {
    Block, Transaction, Account, Log, Contract, TokenTransfer, 
    DecodedEvent, Trace, TransactionStatus, TokenStandard, 
    ContractType, TraceType, TokenBalance
} from './model'
import {processor, ProcessorContext} from './processor'
import {processGameFeedEvents} from './game-feed-processor'
import {processGameTokenEvents} from './game-tokens-processor'
import {processNodeStakingEvents} from './node-staking-processor'
import {processMarketEvents} from './market-processor'
import {processRegistryEvents} from './registry-game-processor'
import {processEILEvents} from './eil-processor'
import {processComputeEvents} from './compute-processor'
import {processOIFEvents} from './oif-processor'
import {processStorageEvents} from './storage-processor'
import {processCrossServiceEvents} from './cross-service-processor'
import {
    getEventCategory, getEventName,
    ERC20_TRANSFER, ERC1155_TRANSFER_SINGLE, ERC1155_TRANSFER_BATCH
} from './contract-events'
import { Store } from '@subsquid/typeorm-store'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Extended types for processor data with all requested fields
interface BlockHeader {
    hash: string
    height: number
    parentHash: string
    timestamp: number
    gasUsed: bigint
    gasLimit: bigint
    baseFeePerGas?: bigint
    size: number
}

interface TxData {
    hash: string
    from: string
    to?: string
    transactionIndex: number
    value: bigint
    gasPrice?: bigint
    gas: bigint
    gasUsed: bigint
    input: string
    nonce: number
    status: number
    contractAddress?: string
    type?: number
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
}

interface LogData {
    address: string
    topics: string[]
    data: string
    logIndex: number
    transactionIndex: number
    transaction?: { hash: string }
}

interface TraceData {
    transaction?: { hash: string }
    traceAddress: number[]
    error?: string
    type: string
    action: {
        from: string
        to?: string
        value?: bigint
        gas?: bigint
        input?: string
    }
    result?: {
        gasUsed?: bigint
        output?: string
    }
}

processor.run(new TypeormDatabase({supportHotBlocks: true}), async (ctx: ProcessorContext<Store>) => {
    const blocks: Block[] = []
    const transactions: Transaction[] = []
    const logs: Log[] = []
    const decodedEvents: DecodedEvent[] = []
    const tokenTransfers: TokenTransfer[] = []
    const traces: Trace[] = []
    const accounts = new Map<string, Account>()
    const contracts = new Map<string, Contract>()
    const tokenBalances = new Map<string, TokenBalance>()

    function getOrCreateAccount(address: string, blockNumber: number, timestamp: Date): Account {
        const id = address.toLowerCase()
        let account = accounts.get(id)
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
            accounts.set(id, account)
        }
        account.lastSeenBlock = Math.max(account.lastSeenBlock, blockNumber)
        account.lastSeenAt = timestamp
        return account
    }

    function getOrCreateContract(address: string, block: Block, creator: Account): Contract {
        const id = address.toLowerCase()
        let contract = contracts.get(id)
        if (!contract) {
            const account = getOrCreateAccount(address, block.number, block.timestamp)
            account.isContract = true
            
            contract = new Contract({
                id,
                address: id,
                creator,
                creationBlock: block,
                isERC20: false,
                isERC721: false,
                isERC1155: false,
                isProxy: false,
                verified: false,
                firstSeenAt: block.timestamp,
                lastSeenAt: block.timestamp
            })
            contracts.set(id, contract)
        }
        contract.lastSeenAt = block.timestamp
        return contract
    }

    function getOrCreateTokenBalance(accountId: string, tokenAddress: string, block: Block, timestamp: Date): TokenBalance {
        const id = `${accountId}-${tokenAddress}`
        let balance = tokenBalances.get(id)
        if (!balance) {
            const account = accounts.get(accountId) ?? getOrCreateAccount(accountId, block.number, timestamp)
            const token = contracts.get(tokenAddress) ?? getOrCreateContract(tokenAddress, block, account)
            
            balance = new TokenBalance({
                id,
                account,
                token,
                balance: 0n,
                transferCount: 0,
                lastUpdated: timestamp
            })
            tokenBalances.set(id, balance)
        }
        return balance
    }

    for (const block of ctx.blocks) {
        const header = block.header as unknown as BlockHeader
        const blockTimestamp = new Date(header.timestamp)
        const blockEntity = new Block({
            id: header.hash,
            number: header.height,
            hash: header.hash,
            parentHash: header.parentHash,
            timestamp: blockTimestamp,
            miner: getOrCreateAccount(ZERO_ADDRESS, header.height, blockTimestamp),
            gasUsed: header.gasUsed,
            gasLimit: header.gasLimit,
            baseFeePerGas: header.baseFeePerGas ?? null,
            size: header.size,
            transactionCount: block.transactions.length
        })
        blocks.push(blockEntity)

        for (const rawTx of block.transactions) {
            const tx = rawTx as unknown as TxData
            const fromAccount = getOrCreateAccount(tx.from, header.height, blockTimestamp)
            fromAccount.transactionCount++
            fromAccount.totalValueSent += tx.value
            
            let toAccount: Account | undefined
            if (tx.to) {
                toAccount = getOrCreateAccount(tx.to, header.height, blockTimestamp)
                toAccount.totalValueReceived += tx.value
            }

            const txEntity = new Transaction({
                id: tx.hash,
                hash: tx.hash,
                block: blockEntity,
                blockNumber: header.height,
                transactionIndex: tx.transactionIndex,
                from: fromAccount,
                to: toAccount,
                value: tx.value,
                gasPrice: tx.gasPrice ?? null,
                gasLimit: tx.gas,
                gasUsed: tx.gasUsed,
                input: tx.input,
                nonce: tx.nonce,
                status: tx.status === 1 ? TransactionStatus.SUCCESS : TransactionStatus.FAILURE,
                contractAddress: null,
                type: tx.type ?? null,
                maxFeePerGas: tx.maxFeePerGas ?? null,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null
            })
            
            if (tx.contractAddress) {
                const createdContract = getOrCreateContract(tx.contractAddress, blockEntity, fromAccount)
                createdContract.creationTransaction = txEntity
            }
            transactions.push(txEntity)
        }

        for (const rawLog of block.logs) {
            const log = rawLog as unknown as LogData
            const addressAccount = getOrCreateAccount(log.address, header.height, blockTimestamp)
            const contractEntity = getOrCreateContract(log.address, blockEntity, addressAccount)

            const txEntity = transactions.find(t => 
                t.block.id === blockEntity.id && 
                t.transactionIndex === log.transactionIndex
            )
            if (!txEntity) continue

            const logEntity = new Log({
                id: `${txEntity.hash}-${log.logIndex}`,
                block: blockEntity,
                transaction: txEntity,
                logIndex: log.logIndex,
                address: addressAccount,
                topic0: log.topics[0] ?? null,
                topic1: log.topics[1] ?? null,
                topic2: log.topics[2] ?? null,
                topic3: log.topics[3] ?? null,
                data: log.data ?? null,
                removed: false,
                transactionIndex: log.transactionIndex
            })
            logs.push(logEntity)

            const eventSig = log.topics[0]
            if (!eventSig) continue

            const eventCategory = getEventCategory(eventSig)
            const eventName = getEventName(eventSig)
            
            if (eventSig === ERC20_TRANSFER) {
                if (log.topics.length === 3 && log.data) {
                    contractEntity.isERC20 = true
                    contractEntity.contractType = ContractType.ERC20

                    const fromAddr = '0x' + log.topics[1].slice(26)
                    const toAddr = '0x' + log.topics[2].slice(26)
                    const value = BigInt(log.data)

                    const fromAcc = getOrCreateAccount(fromAddr, header.height, blockTimestamp)
                    const toAcc = getOrCreateAccount(toAddr, header.height, blockTimestamp)

                    tokenTransfers.push(new TokenTransfer({
                        id: logEntity.id,
                        block: blockEntity,
                        transaction: txEntity,
                        logIndex: log.logIndex,
                        token: contractEntity,
                        tokenStandard: TokenStandard.ERC20,
                        from: fromAcc,
                        to: toAcc,
                        value,
                        operator: null,
                        tokenId: null,
                        timestamp: blockEntity.timestamp
                    }))

                    if (fromAddr !== ZERO_ADDRESS) {
                        const fromBalance = getOrCreateTokenBalance(fromAddr.toLowerCase(), log.address.toLowerCase(), blockEntity, blockTimestamp)
                        fromBalance.balance = fromBalance.balance - value
                        fromBalance.transferCount++
                        fromBalance.lastUpdated = blockTimestamp
                    }
                    if (toAddr !== ZERO_ADDRESS) {
                        const toBalance = getOrCreateTokenBalance(toAddr.toLowerCase(), log.address.toLowerCase(), blockEntity, blockTimestamp)
                        toBalance.balance = toBalance.balance + value
                        toBalance.transferCount++
                        toBalance.lastUpdated = blockTimestamp
                    }

                    decodedEvents.push(new DecodedEvent({
                        id: logEntity.id,
                        log: logEntity,
                        block: blockEntity,
                        transaction: txEntity,
                        address: addressAccount,
                        eventSignature: eventSig,
                        eventName: 'Transfer',
                        args: { from: fromAddr, to: toAddr, value: value.toString() },
                        timestamp: blockEntity.timestamp
                    }))
                } else if (log.topics.length === 4) {
                    contractEntity.isERC721 = true
                    contractEntity.contractType = ContractType.ERC721

                    const fromAddr = '0x' + log.topics[1].slice(26)
                    const toAddr = '0x' + log.topics[2].slice(26)
                    const tokenId = BigInt(log.topics[3])

                    const fromAcc = getOrCreateAccount(fromAddr, header.height, blockTimestamp)
                    const toAcc = getOrCreateAccount(toAddr, header.height, blockTimestamp)

                    tokenTransfers.push(new TokenTransfer({
                        id: logEntity.id,
                        block: blockEntity,
                        transaction: txEntity,
                        logIndex: log.logIndex,
                        token: contractEntity,
                        tokenStandard: TokenStandard.ERC721,
                        from: fromAcc,
                        to: toAcc,
                        operator: null,
                        value: null,
                        tokenId: tokenId.toString(),
                        timestamp: blockEntity.timestamp
                    }))

                    decodedEvents.push(new DecodedEvent({
                        id: logEntity.id,
                        log: logEntity,
                        block: blockEntity,
                        transaction: txEntity,
                        address: addressAccount,
                        eventSignature: eventSig,
                        eventName: 'Transfer',
                        args: { from: fromAddr, to: toAddr, tokenId: tokenId.toString() },
                        timestamp: blockEntity.timestamp
                    }))
                }
            }
            else if (eventSig === ERC1155_TRANSFER_SINGLE && log.data) {
                contractEntity.isERC1155 = true
                contractEntity.contractType = ContractType.ERC1155

                const operator = '0x' + log.topics[1].slice(26)
                const fromAddr = '0x' + log.topics[2].slice(26)
                const toAddr = '0x' + log.topics[3].slice(26)
                
                const tokenId = BigInt('0x' + log.data.slice(2, 66))
                const value = BigInt('0x' + log.data.slice(66, 130))

                const operatorAcc = getOrCreateAccount(operator, header.height, blockTimestamp)
                const fromAcc = getOrCreateAccount(fromAddr, header.height, blockTimestamp)
                const toAcc = getOrCreateAccount(toAddr, header.height, blockTimestamp)

                tokenTransfers.push(new TokenTransfer({
                    id: logEntity.id,
                    block: blockEntity,
                    transaction: txEntity,
                    logIndex: log.logIndex,
                    token: contractEntity,
                    tokenStandard: TokenStandard.ERC1155,
                    operator: operatorAcc,
                    from: fromAcc,
                    to: toAcc,
                    tokenId: tokenId.toString(),
                    value,
                    timestamp: blockEntity.timestamp
                }))

                decodedEvents.push(new DecodedEvent({
                    id: logEntity.id,
                    log: logEntity,
                    block: blockEntity,
                    transaction: txEntity,
                    address: addressAccount,
                    eventSignature: eventSig,
                    eventName: 'TransferSingle',
                    args: { 
                        operator, 
                        from: fromAddr, 
                        to: toAddr, 
                        id: tokenId.toString(), 
                        value: value.toString() 
                    },
                    timestamp: blockEntity.timestamp
                }))
            }
            else if (eventSig === ERC1155_TRANSFER_BATCH && log.data) {
                contractEntity.isERC1155 = true
                contractEntity.contractType = ContractType.ERC1155

                const operator = '0x' + log.topics[1].slice(26)
                const fromAddr = '0x' + log.topics[2].slice(26)
                const toAddr = '0x' + log.topics[3].slice(26)

                decodedEvents.push(new DecodedEvent({
                    id: logEntity.id,
                    log: logEntity,
                    block: blockEntity,
                    transaction: txEntity,
                    address: addressAccount,
                    eventSignature: eventSig,
                    eventName: 'TransferBatch',
                    args: { operator, from: fromAddr, to: toAddr, data: log.data },
                    timestamp: blockEntity.timestamp
                }))
            }
            else if (eventCategory) {
                const args: Record<string, string> = {
                    category: eventCategory.category,
                    contract: eventCategory.contract
                }
                log.topics.forEach((topic, i) => {
                    if (i > 0) args[`topic${i}`] = topic
                })
                if (log.data && log.data !== '0x') {
                    args.data = log.data
                }

                decodedEvents.push(new DecodedEvent({
                    id: logEntity.id,
                    log: logEntity,
                    block: blockEntity,
                    transaction: txEntity,
                    address: addressAccount,
                    eventSignature: eventSig,
                    eventName,
                    args,
                    timestamp: blockEntity.timestamp
                }))

                if (eventCategory.category === 'game') {
                    contractEntity.contractType = ContractType.GAME
                } else if (eventCategory.category === 'prediction') {
                    contractEntity.contractType = ContractType.PREDICTION_MARKET
                } else if (eventCategory.category === 'marketplace') {
                    contractEntity.contractType = ContractType.NFT_MARKETPLACE
                } else if (eventCategory.category === 'defi') {
                    contractEntity.contractType = ContractType.DEX
                }
            }
        }

        // Process traces if enabled (requires archive node)
        for (const rawTrace of block.traces) {
            const trace = rawTrace as unknown as TraceData
            if (!trace.transaction) continue

            const txEntity = transactions.find(t => t.hash === trace.transaction!.hash)
            if (!txEntity) continue

            let traceType = TraceType.CALL
            if (trace.type === 'create') traceType = TraceType.CREATE
            else if (trace.type === 'create2') traceType = TraceType.CREATE2
            else if (trace.type === 'delegatecall') traceType = TraceType.DELEGATECALL
            else if (trace.type === 'staticcall') traceType = TraceType.STATICCALL
            else if (trace.type === 'suicide') traceType = TraceType.SELFDESTRUCT

            const fromAddr = trace.action.from
            const toAddr = trace.action.to

            traces.push(new Trace({
                id: `${trace.transaction.hash}-${trace.traceAddress.join('-')}`,
                transaction: txEntity,
                traceAddress: trace.traceAddress,
                type: traceType,
                from: getOrCreateAccount(fromAddr, header.height, blockTimestamp),
                to: toAddr ? getOrCreateAccount(toAddr, header.height, blockTimestamp) : null,
                value: trace.action.value ?? null,
                gas: trace.action.gas ?? null,
                gasUsed: trace.result?.gasUsed ?? null,
                input: trace.action.input ?? null,
                output: trace.result?.output ?? null,
                error: trace.error ?? null
            }))
        }
    }

    const startBlock = ctx.blocks[0]?.header.height
    const endBlock = ctx.blocks[ctx.blocks.length - 1]?.header.height
    ctx.log.info(
        `Processed blocks ${startBlock}-${endBlock}: ` +
        `${blocks.length} blocks, ${transactions.length} txs, ${logs.length} logs, ` +
        `${tokenTransfers.length} transfers, ${decodedEvents.length} decoded events, ` +
        `${contracts.size} contracts, ${accounts.size} accounts, ${traces.length} traces, ` +
        `${tokenBalances.size} balances`
    )

    await ctx.store.upsert(Array.from(accounts.values()))
    await ctx.store.insert(blocks)
    await ctx.store.insert(transactions)
    await ctx.store.upsert(Array.from(contracts.values()))
    await ctx.store.insert(logs)
    await ctx.store.insert(decodedEvents)
    await ctx.store.insert(tokenTransfers)
    await ctx.store.upsert(Array.from(tokenBalances.values()))
    await ctx.store.insert(traces)
    
    await processGameFeedEvents(ctx)
    await processGameTokenEvents(ctx)
    await processNodeStakingEvents(ctx)
    await processMarketEvents(ctx)
    await processRegistryEvents(ctx)
    await processEILEvents(ctx)
    await processComputeEvents(ctx)
    await processStorageEvents(ctx)
    await processOIFEvents(ctx)
    await processCrossServiceEvents(ctx)
})
