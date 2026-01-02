/**
 * Main blockchain indexer processor
 */

import './init'

import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  Account,
  Block as BlockEntity,
  Contract,
  ContractType,
  DecodedEvent,
  Log as LogEntity,
  NFTApprovalEvent,
  TokenApprovalEvent,
  TokenBalance,
  TokenStandard,
  TokenTransfer,
  Trace as TraceEntity,
  TraceType,
  Transaction as TransactionEntity,
  TransactionStatus,
} from '../src/model'
import { processComputeEvents } from './compute-processor'
import { config } from './config'
import {
  ERC20_APPROVAL,
  ERC20_TRANSFER,
  ERC721_APPROVAL_FOR_ALL,
  ERC1155_TRANSFER_BATCH,
  ERC1155_TRANSFER_SINGLE,
  getEventCategory,
  getEventName,
} from './contract-events'
import { processCrossServiceEvents } from './cross-service-processor'
import { processDEXEvents } from './dex-processor'
import { processEILEvents } from './eil-processor'
import { processMarketEvents } from './market-processor'
import { processModerationEvent } from './moderation-processor'
import { processNodeStakingEvents } from './node-staking-processor'
import { processOIFEvents } from './oif-processor'
import { processOracleEvents } from './oracle-processor'
import { type ProcessorContext, processor } from './processor'
import { processRegistryEvents } from './registry-game-processor'
import { SQLitDatabase } from './sqlit-database'
import { processStorageEvents } from './storage-processor'

const SQLIT_DATABASE_ID = config.sqlitDatabaseId || 'indexer-testnet'

console.log(`[Indexer] Using SQLit database: ${SQLIT_DATABASE_ID}`)

// SQLitDatabase implements all Store methods used by the indexer
// Type assertion bridges our custom implementation with subsquid's types
// @ts-expect-error - SQLitDatabase is compatible with subsquid's Database<Store> at runtime
processor.run(
  new SQLitDatabase({ databaseId: SQLIT_DATABASE_ID }),
  async (ctx: ProcessorContext<Store>) => {
    const blocks: BlockEntity[] = []
    const transactions: TransactionEntity[] = []
    const logs: LogEntity[] = []
    const decodedEvents: DecodedEvent[] = []
    const tokenTransfers: TokenTransfer[] = []
    const tokenApprovals: TokenApprovalEvent[] = []
    const nftApprovals: NFTApprovalEvent[] = []
    const traces: TraceEntity[] = []
    const accounts = new Map<string, Account>()
    const contracts = new Map<string, Contract>()
    const tokenBalances = new Map<string, TokenBalance>()

    function getOrCreateAccount(
      address: string,
      blockNumber: number,
      timestamp: Date,
    ): Account {
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
          lastSeenAt: timestamp,
        })
        accounts.set(id, account)
      }
      account.lastSeenBlock = Math.max(account.lastSeenBlock, blockNumber)
      account.lastSeenAt = timestamp
      return account
    }

    function getOrCreateContract(
      address: string,
      block: BlockEntity,
      creator: Account,
    ): Contract {
      const id = address.toLowerCase()
      let contract = contracts.get(id)
      if (!contract) {
        const account = getOrCreateAccount(
          address,
          block.number,
          block.timestamp,
        )
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
          lastSeenAt: block.timestamp,
        })
        contracts.set(id, contract)
      }
      contract.lastSeenAt = block.timestamp
      return contract
    }

    function getOrCreateTokenBalance(
      accountId: string,
      tokenAddress: string,
      block: BlockEntity,
      timestamp: Date,
    ): TokenBalance {
      const id = `${accountId}-${tokenAddress}`
      let balance = tokenBalances.get(id)
      if (!balance) {
        const account =
          accounts.get(accountId) ??
          getOrCreateAccount(accountId, block.number, timestamp)
        const token =
          contracts.get(tokenAddress) ??
          getOrCreateContract(tokenAddress, block, account)

        balance = new TokenBalance({
          id,
          account,
          token,
          balance: 0n,
          transferCount: 0,
          lastUpdated: timestamp,
        })
        tokenBalances.set(id, balance)
      }
      return balance
    }

    for (const block of ctx.blocks) {
      const header = block.header
      const blockTimestamp = new Date(header.timestamp)
      const blockEntity = new BlockEntity({
        id: header.hash,
        number: header.height,
        hash: header.hash,
        parentHash: header.parentHash,
        timestamp: blockTimestamp,
        miner: getOrCreateAccount(ZERO_ADDRESS, header.height, blockTimestamp),
        gasUsed: header.gasUsed,
        gasLimit: header.gasLimit,
        baseFeePerGas: header.baseFeePerGas ?? null,
        size: Number(header.size),
        transactionCount: block.transactions.length,
      })
      blocks.push(blockEntity)

      for (const tx of block.transactions) {
        const fromAccount = getOrCreateAccount(
          tx.from,
          header.height,
          blockTimestamp,
        )
        fromAccount.transactionCount++
        fromAccount.totalValueSent += tx.value

        let toAccount: Account | undefined
        if (tx.to) {
          toAccount = getOrCreateAccount(tx.to, header.height, blockTimestamp)
          toAccount.totalValueReceived += tx.value
        }

        const txEntity = new TransactionEntity({
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
          gasUsed: tx.gasUsed ?? 0n,
          input: tx.input,
          nonce: tx.nonce,
          status:
            tx.status === 1
              ? TransactionStatus.SUCCESS
              : TransactionStatus.FAILURE,
          contractAddress: null,
          type: tx.type ?? null,
          maxFeePerGas: tx.maxFeePerGas ?? null,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
        })

        if (tx.contractAddress) {
          const createdContract = getOrCreateContract(
            tx.contractAddress,
            blockEntity,
            fromAccount,
          )
          createdContract.creationTransaction = txEntity
        }
        transactions.push(txEntity)
      }

      for (const log of block.logs) {
        const addressAccount = getOrCreateAccount(
          log.address,
          header.height,
          blockTimestamp,
        )
        const contractEntity = getOrCreateContract(
          log.address,
          blockEntity,
          addressAccount,
        )

        const txEntity = transactions.find(
          (t) =>
            t.block.id === blockEntity.id &&
            t.transactionIndex === log.transactionIndex,
        )
        if (!txEntity) continue

        const logEntity = new LogEntity({
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
          transactionIndex: log.transactionIndex,
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

            const fromAddr = `0x${log.topics[1].slice(26)}`
            const toAddr = `0x${log.topics[2].slice(26)}`
            const value = BigInt(log.data)

            const fromAcc = getOrCreateAccount(
              fromAddr,
              header.height,
              blockTimestamp,
            )
            const toAcc = getOrCreateAccount(
              toAddr,
              header.height,
              blockTimestamp,
            )

            tokenTransfers.push(
              new TokenTransfer({
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
                timestamp: blockEntity.timestamp,
              }),
            )

            if (fromAddr !== ZERO_ADDRESS) {
              const fromBalance = getOrCreateTokenBalance(
                fromAddr.toLowerCase(),
                log.address.toLowerCase(),
                blockEntity,
                blockTimestamp,
              )
              fromBalance.balance =
                fromBalance.balance >= value ? fromBalance.balance - value : 0n
              fromBalance.transferCount++
              fromBalance.lastUpdated = blockTimestamp
            }
            if (toAddr !== ZERO_ADDRESS) {
              const toBalance = getOrCreateTokenBalance(
                toAddr.toLowerCase(),
                log.address.toLowerCase(),
                blockEntity,
                blockTimestamp,
              )
              toBalance.balance = toBalance.balance + value
              toBalance.transferCount++
              toBalance.lastUpdated = blockTimestamp
            }

            decodedEvents.push(
              new DecodedEvent({
                id: logEntity.id,
                log: logEntity,
                block: blockEntity,
                transaction: txEntity,
                address: addressAccount,
                eventSignature: eventSig,
                eventName: 'Transfer',
                args: { from: fromAddr, to: toAddr, value: value.toString() },
                timestamp: blockEntity.timestamp,
              }),
            )
          } else if (log.topics.length === 4) {
            contractEntity.isERC721 = true
            contractEntity.contractType = ContractType.ERC721

            const fromAddr = `0x${log.topics[1].slice(26)}`
            const toAddr = `0x${log.topics[2].slice(26)}`
            const tokenId = BigInt(log.topics[3])

            const fromAcc = getOrCreateAccount(
              fromAddr,
              header.height,
              blockTimestamp,
            )
            const toAcc = getOrCreateAccount(
              toAddr,
              header.height,
              blockTimestamp,
            )

            tokenTransfers.push(
              new TokenTransfer({
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
                timestamp: blockEntity.timestamp,
              }),
            )

            decodedEvents.push(
              new DecodedEvent({
                id: logEntity.id,
                log: logEntity,
                block: blockEntity,
                transaction: txEntity,
                address: addressAccount,
                eventSignature: eventSig,
                eventName: 'Transfer',
                args: {
                  from: fromAddr,
                  to: toAddr,
                  tokenId: tokenId.toString(),
                },
                timestamp: blockEntity.timestamp,
              }),
            )
          }
        } else if (eventSig === ERC1155_TRANSFER_SINGLE && log.data) {
          if (log.data.length < 130) continue

          contractEntity.isERC1155 = true
          contractEntity.contractType = ContractType.ERC1155

          const operator = `0x${log.topics[1].slice(26)}`
          const fromAddr = `0x${log.topics[2].slice(26)}`
          const toAddr = `0x${log.topics[3].slice(26)}`

          const tokenId = BigInt(`0x${log.data.slice(2, 66)}`)
          const value = BigInt(`0x${log.data.slice(66, 130)}`)

          const operatorAcc = getOrCreateAccount(
            operator,
            header.height,
            blockTimestamp,
          )
          const fromAcc = getOrCreateAccount(
            fromAddr,
            header.height,
            blockTimestamp,
          )
          const toAcc = getOrCreateAccount(
            toAddr,
            header.height,
            blockTimestamp,
          )

          tokenTransfers.push(
            new TokenTransfer({
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
              timestamp: blockEntity.timestamp,
            }),
          )

          decodedEvents.push(
            new DecodedEvent({
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
                value: value.toString(),
              },
              timestamp: blockEntity.timestamp,
            }),
          )
        } else if (eventSig === ERC1155_TRANSFER_BATCH && log.data) {
          contractEntity.isERC1155 = true
          contractEntity.contractType = ContractType.ERC1155

          const operator = `0x${log.topics[1].slice(26)}`
          const fromAddr = `0x${log.topics[2].slice(26)}`
          const toAddr = `0x${log.topics[3].slice(26)}`

          decodedEvents.push(
            new DecodedEvent({
              id: logEntity.id,
              log: logEntity,
              block: blockEntity,
              transaction: txEntity,
              address: addressAccount,
              eventSignature: eventSig,
              eventName: 'TransferBatch',
              args: { operator, from: fromAddr, to: toAddr, data: log.data },
              timestamp: blockEntity.timestamp,
            }),
          )
        } else if (eventSig === ERC20_APPROVAL && log.data) {
          // ERC20 Approval(owner, spender, value)
          if (log.topics.length === 3) {
            const ownerAddr = `0x${log.topics[1].slice(26)}`
            const spenderAddr = `0x${log.topics[2].slice(26)}`
            const value = BigInt(log.data)

            const ownerAcc = getOrCreateAccount(
              ownerAddr,
              header.height,
              blockTimestamp,
            )
            const spenderAcc = getOrCreateAccount(
              spenderAddr,
              header.height,
              blockTimestamp,
            )

            tokenApprovals.push(
              new TokenApprovalEvent({
                id: logEntity.id,
                owner: ownerAcc,
                spender: spenderAcc,
                token: contractEntity,
                value,
                isRevoke: value === 0n,
                block: blockEntity,
                transaction: txEntity,
                timestamp: blockTimestamp,
                chainId: config.chainId,
              }),
            )

            decodedEvents.push(
              new DecodedEvent({
                id: logEntity.id,
                log: logEntity,
                block: blockEntity,
                transaction: txEntity,
                address: addressAccount,
                eventSignature: eventSig,
                eventName: 'Approval',
                args: {
                  owner: ownerAddr,
                  spender: spenderAddr,
                  value: value.toString(),
                },
                timestamp: blockEntity.timestamp,
              }),
            )
          }
        } else if (eventSig === ERC721_APPROVAL_FOR_ALL) {
          // ERC721/ERC1155 ApprovalForAll(owner, operator, approved)
          if (log.topics.length === 3 && log.data) {
            const ownerAddr = `0x${log.topics[1].slice(26)}`
            const operatorAddr = `0x${log.topics[2].slice(26)}`
            const approved = log.data.slice(-1) === '1'

            const ownerAcc = getOrCreateAccount(
              ownerAddr,
              header.height,
              blockTimestamp,
            )
            const operatorAcc = getOrCreateAccount(
              operatorAddr,
              header.height,
              blockTimestamp,
            )

            // Determine if this is ERC721 or ERC1155 based on contract
            const tokenStandard = contractEntity.isERC1155
              ? TokenStandard.ERC1155
              : TokenStandard.ERC721

            if (!contractEntity.isERC1155) {
              contractEntity.isERC721 = true
              contractEntity.contractType = ContractType.ERC721
            }

            nftApprovals.push(
              new NFTApprovalEvent({
                id: logEntity.id,
                owner: ownerAcc,
                operator: operatorAcc,
                token: contractEntity,
                tokenId: null,
                approved,
                isApprovalForAll: true,
                tokenStandard,
                block: blockEntity,
                transaction: txEntity,
                timestamp: blockTimestamp,
                chainId: config.chainId,
              }),
            )

            decodedEvents.push(
              new DecodedEvent({
                id: logEntity.id,
                log: logEntity,
                block: blockEntity,
                transaction: txEntity,
                address: addressAccount,
                eventSignature: eventSig,
                eventName: 'ApprovalForAll',
                args: {
                  owner: ownerAddr,
                  operator: operatorAddr,
                  approved: approved.toString(),
                },
                timestamp: blockEntity.timestamp,
              }),
            )
          }
        } else if (eventCategory) {
          const args: Record<string, string> = {
            category: eventCategory.category,
            contract: eventCategory.contract,
          }
          log.topics.forEach((topic, i) => {
            if (i > 0) args[`topic${i}`] = topic
          })
          if (log.data && log.data !== '0x') {
            args.data = log.data
          }

          decodedEvents.push(
            new DecodedEvent({
              id: logEntity.id,
              log: logEntity,
              block: blockEntity,
              transaction: txEntity,
              address: addressAccount,
              eventSignature: eventSig,
              eventName,
              args,
              timestamp: blockEntity.timestamp,
            }),
          )

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

      for (const trace of block.traces) {
        if (!trace.transaction) continue

        const txHash = trace.transaction.hash
        const txEntity = transactions.find((t) => t.hash === txHash)
        if (!txEntity) continue

        let traceType: TraceType
        let fromAddr: string
        let toAddr: string | undefined
        let value: bigint | null = null
        let gas: bigint | null = null
        let gasUsed: bigint | null = null
        let input: string | null = null
        let output: string | null = null

        if (trace.type === 'call') {
          const callType = trace.action.callType
          if (callType === 'delegatecall') {
            traceType = TraceType.DELEGATECALL
          } else if (callType === 'staticcall') {
            traceType = TraceType.STATICCALL
          } else {
            traceType = TraceType.CALL
          }
          fromAddr = trace.action.from
          toAddr = trace.action.to
          value = trace.action.value ?? null
          gas = trace.action.gas
          input = trace.action.input ?? null
          gasUsed = trace.result?.gasUsed ?? null
          output = trace.result?.output ?? null
        } else if (trace.type === 'create') {
          traceType = TraceType.CREATE
          fromAddr = trace.action.from
          toAddr = trace.result?.address
          value = trace.action.value
          gas = trace.action.gas
          input = trace.action.init ?? null
          gasUsed = trace.result?.gasUsed ?? null
          output = trace.result?.code ?? null
        } else if (trace.type === 'suicide') {
          traceType = TraceType.SELFDESTRUCT
          fromAddr = trace.action.address
          toAddr = trace.action.refundAddress
          value = trace.action.balance
        } else {
          continue
        }

        traces.push(
          new TraceEntity({
            id: `${trace.transaction.hash}-${trace.traceAddress.join('-')}`,
            transaction: txEntity,
            traceAddress: trace.traceAddress,
            type: traceType,
            from: getOrCreateAccount(fromAddr, header.height, blockTimestamp),
            to: toAddr
              ? getOrCreateAccount(toAddr, header.height, blockTimestamp)
              : null,
            value,
            gas,
            gasUsed,
            input,
            output,
            error: trace.error ?? null,
          }),
        )
      }
    }

    const startBlock = ctx.blocks[0].header.height
    const endBlock = ctx.blocks[ctx.blocks.length - 1].header.height
    ctx.log.info(
      `Processed blocks ${startBlock}-${endBlock}: ` +
        `${blocks.length} blocks, ${transactions.length} txs, ${logs.length} logs, ` +
        `${tokenTransfers.length} transfers, ${tokenApprovals.length} token approvals, ` +
        `${nftApprovals.length} NFT approvals, ${decodedEvents.length} decoded events, ` +
        `${contracts.size} contracts, ${accounts.size} accounts, ${traces.length} traces, ` +
        `${tokenBalances.size} balances`,
    )

    await ctx.store.upsert([...accounts.values()])
    await ctx.store.insert(blocks)
    await ctx.store.insert(transactions)
    await ctx.store.upsert([...contracts.values()])
    await ctx.store.insert(logs)
    await ctx.store.insert(decodedEvents)
    await ctx.store.insert(tokenTransfers)
    await ctx.store.insert(tokenApprovals)
    await ctx.store.insert(nftApprovals)
    await ctx.store.upsert([...tokenBalances.values()])
    await ctx.store.insert(traces)

    await processNodeStakingEvents(ctx)
    await processMarketEvents(ctx)
    await processRegistryEvents(ctx)
    await processEILEvents(ctx)
    await processComputeEvents(ctx)
    await processStorageEvents(ctx)
    await processOIFEvents(ctx)
    await processCrossServiceEvents(ctx)
    await processOracleEvents(ctx)
    await processDEXEvents(ctx)

    for (const block of ctx.blocks) {
      for (const log of block.logs) {
        await processModerationEvent(
          {
            address: log.address,
            data: log.data,
            topics: log.topics,
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          },
          ctx.store,
          block.header.height,
          new Date(block.header.timestamp),
          log.transactionHash,
        )
      }
    }
  },
)
