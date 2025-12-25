/**
 * Game Tokens Processor - Indexes Gold.sol and Items.sol events
 *
 * Events indexed:
 * - GoldClaimed: Player claimed gold with game server signature
 * - GoldBurned: Player burned gold for in-game purchase
 * - ItemMinted: Player minted item NFT with game server signature
 * - ItemBurned: Player burned item NFT back to in-game
 * - ItemTypeCreated: New item type created by game owner
 * - NFTProvenance: Provenance tracking for minted items
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Store } from '@subsquid/typeorm-store'
import { formatEther, keccak256, parseAbi, stringToHex } from 'viem'
import {
  type Block as BlockEntity,
  Contract,
  ContractType,
  TokenStandard,
  TokenTransfer,
  type Transaction as TransactionEntity,
} from './model'
import type { ProcessorContext } from './processor'
import { createAccountFactory, relationId } from './utils/entities'
import { decodeLog } from './utils/hex'

// Decoded event argument types
interface GoldClaimedArgs {
  player: string
  amount: bigint
  nonce: bigint
}

interface GoldBurnedArgs {
  player: string
  amount: bigint
}

interface ItemMintedArgs {
  minter: string
  itemId: bigint
  amount: bigint
  instanceId: string
  stackable: boolean
  rarity: number
}

interface ItemBurnedArgs {
  player: string
  itemId: bigint
  amount: bigint
}

interface ItemTypeCreatedArgs {
  itemId: bigint
  name: string
  stackable: boolean
  rarity: number
}

interface NFTProvenanceArgs {
  originalMinter: string
  itemId: bigint
  instanceId: string
  mintedAt: bigint
}

interface TransferSingleArgs {
  operator: string
  from: string
  to: string
  id: bigint
  value: bigint
}

// Event signatures
const GOLD_CLAIMED = keccak256(
  stringToHex('GoldClaimed(address,uint256,uint256)'),
)
const GOLD_BURNED = keccak256(stringToHex('GoldBurned(address,uint256)'))
const ITEM_MINTED = keccak256(
  stringToHex('ItemMinted(address,uint256,uint256,bytes32,bool,uint8)'),
)
const ITEM_BURNED = keccak256(
  stringToHex('ItemBurned(address,uint256,uint256)'),
)
const ITEM_TYPE_CREATED = keccak256(
  stringToHex('ItemTypeCreated(uint256,string,bool,uint8)'),
)
const NFT_PROVENANCE = keccak256(
  stringToHex('NFTProvenance(address,uint256,bytes32,uint256)'),
)
// Game signer updates - topic for future use
// const GAME_SIGNER_UPDATED = keccak256(
//   stringToHex('GameSignerUpdated(address,address)'),
// )

// ERC-1155 standard events (for tracking transfers)
const TRANSFER_SINGLE = keccak256(
  stringToHex('TransferSingle(address,address,address,uint256,uint256)'),
)
// Transfer batch - topic for future use
// const TRANSFER_BATCH = keccak256(
//   stringToHex('TransferBatch(address,address,address,uint256[],uint256[])'),
// )

// ABIs for decoding
const goldInterface = parseAbi([
  'event GoldClaimed(address indexed player, uint256 amount, uint256 nonce)',
  'event GoldBurned(address indexed player, uint256 amount)',
  'event GameSignerUpdated(address indexed oldSigner, address indexed newSigner)',
])

const itemsInterface = parseAbi([
  'event ItemMinted(address indexed minter, uint256 indexed itemId, uint256 amount, bytes32 instanceId, bool stackable, uint8 rarity)',
  'event ItemBurned(address indexed player, uint256 indexed itemId, uint256 amount)',
  'event ItemTypeCreated(uint256 indexed itemId, string name, bool stackable, uint8 rarity)',
  'event NFTProvenance(address indexed originalMinter, uint256 indexed itemId, bytes32 indexed instanceId, uint256 mintedAt)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])

interface MintedItem {
  minter: string
  itemId: bigint
  amount: bigint
  instanceId: string
  stackable: boolean
  rarity: number
  timestamp: Date
  txHash: string
  blockNumber: number
}

interface GoldClaim {
  player: string
  amount: bigint
  nonce: bigint
  timestamp: Date
  txHash: string
  blockNumber: number
}

export async function processGameTokenEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const accountFactory = createAccountFactory()
  const tokenTransfers: TokenTransfer[] = []
  // Token balances for future balance tracking
  // const tokenBalances = new Map<string, TokenBalance>()
  const contracts = new Map<string, Contract>()

  // Track minted items and gold claims for stats
  const mintedItems: MintedItem[] = []
  const goldClaims: GoldClaim[] = []

  function getOrCreateContract(
    address: string,
    _blockNumber: number,
    timestamp: Date,
  ): Contract {
    const id = address.toLowerCase()
    let contract = contracts.get(id)
    if (!contract) {
      contract = new Contract({
        id,
        address: id,
        isERC20: false,
        isERC721: false,
        isERC1155: false,
        isProxy: false,
        verified: false,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      })
      contracts.set(id, contract)
    }
    return contract
  }

  for (const block of ctx.blocks) {
    const blockTimestamp = new Date(block.header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]
      if (!log.transaction) continue
      const txHash = log.transaction.hash
      const contractAddress = log.address.toLowerCase()

      if (eventSig === GOLD_CLAIMED) {
        const decoded = decodeLog({
          abi: goldInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as GoldClaimedArgs

        const player = args.player.toLowerCase()
        const amount = BigInt(args.amount.toString())
        const nonce = BigInt(args.nonce.toString())

        const playerAccount = accountFactory.getOrCreate(
          player,
          block.header.height,
          blockTimestamp,
        )
        const tokenContract = getOrCreateContract(
          contractAddress,
          block.header.height,
          blockTimestamp,
        )
        tokenContract.isERC20 = true
        tokenContract.contractType = ContractType.GAME

        // Track as token transfer (mint from zero address)
        tokenTransfers.push(
          new TokenTransfer({
            id: `${txHash}-${log.logIndex}`,
            logIndex: log.logIndex,
            tokenStandard: TokenStandard.ERC20,
            from: accountFactory.getOrCreate(
              ZERO_ADDRESS,
              block.header.height,
              blockTimestamp,
            ),
            to: playerAccount,
            token: tokenContract,
            value: amount,
            block: relationId<BlockEntity>(block.header.hash),
            transaction: relationId<TransactionEntity>(txHash),
            timestamp: blockTimestamp,
          }),
        )

        goldClaims.push({
          player,
          amount,
          nonce,
          timestamp: blockTimestamp,
          txHash,
          blockNumber: block.header.height,
        })

        ctx.log.info(
          `Gold claimed: ${player} claimed ${formatEther(amount)} gold (nonce: ${nonce})`,
        )
      } else if (eventSig === GOLD_BURNED) {
        const decoded = decodeLog({
          abi: goldInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as GoldBurnedArgs

        const player = args.player.toLowerCase()
        const amount = BigInt(args.amount.toString())

        const playerAccount = accountFactory.getOrCreate(
          player,
          block.header.height,
          blockTimestamp,
        )
        const tokenContract = getOrCreateContract(
          contractAddress,
          block.header.height,
          blockTimestamp,
        )
        tokenContract.isERC20 = true

        // Track as token transfer (burn to zero address)
        tokenTransfers.push(
          new TokenTransfer({
            id: `${txHash}-${log.logIndex}`,
            logIndex: log.logIndex,
            tokenStandard: TokenStandard.ERC20,
            from: playerAccount,
            to: accountFactory.getOrCreate(
              ZERO_ADDRESS,
              block.header.height,
              blockTimestamp,
            ),
            token: tokenContract,
            value: amount,
            block: relationId<BlockEntity>(block.header.hash),
            transaction: relationId<TransactionEntity>(txHash),
            timestamp: blockTimestamp,
          }),
        )

        ctx.log.info(
          `Gold burned: ${player} burned ${formatEther(amount)} gold`,
        )
      } else if (eventSig === ITEM_MINTED) {
        const decoded = decodeLog({
          abi: itemsInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as ItemMintedArgs

        const minter = args.minter.toLowerCase()
        const itemId = BigInt(args.itemId.toString())
        const amount = BigInt(args.amount.toString())
        const instanceId = args.instanceId
        const stackable = args.stackable
        const rarity = args.rarity

        const minterAccount = accountFactory.getOrCreate(
          minter,
          block.header.height,
          blockTimestamp,
        )
        const tokenContract = getOrCreateContract(
          contractAddress,
          block.header.height,
          blockTimestamp,
        )
        tokenContract.isERC1155 = true
        tokenContract.contractType = ContractType.GAME

        // Track as ERC-1155 transfer (mint from zero address)
        tokenTransfers.push(
          new TokenTransfer({
            id: `${txHash}-${log.logIndex}`,
            logIndex: log.logIndex,
            tokenStandard: TokenStandard.ERC1155,
            from: accountFactory.getOrCreate(
              ZERO_ADDRESS,
              block.header.height,
              blockTimestamp,
            ),
            to: minterAccount,
            token: tokenContract,
            value: amount,
            tokenId: itemId.toString(),
            block: relationId<BlockEntity>(block.header.hash),
            transaction: relationId<TransactionEntity>(txHash),
            timestamp: blockTimestamp,
          }),
        )

        mintedItems.push({
          minter,
          itemId,
          amount,
          instanceId,
          stackable,
          rarity,
          timestamp: blockTimestamp,
          txHash,
          blockNumber: block.header.height,
        })

        const rarityNames = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
        ctx.log.info(
          `Item minted: ${minter} minted ${amount}x item #${itemId} (${rarityNames[rarity] ?? 'Unknown'}, ${stackable ? 'stackable' : 'unique'})`,
        )
      } else if (eventSig === ITEM_BURNED) {
        const decoded = decodeLog({
          abi: itemsInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as ItemBurnedArgs

        const player = args.player.toLowerCase()
        const itemId = BigInt(args.itemId.toString())
        const amount = BigInt(args.amount.toString())

        const playerAccount = accountFactory.getOrCreate(
          player,
          block.header.height,
          blockTimestamp,
        )
        const tokenContract = getOrCreateContract(
          contractAddress,
          block.header.height,
          blockTimestamp,
        )
        tokenContract.isERC1155 = true

        // Track as ERC-1155 transfer (burn to zero address)
        tokenTransfers.push(
          new TokenTransfer({
            id: `${txHash}-${log.logIndex}`,
            logIndex: log.logIndex,
            tokenStandard: TokenStandard.ERC1155,
            from: playerAccount,
            to: accountFactory.getOrCreate(
              ZERO_ADDRESS,
              block.header.height,
              blockTimestamp,
            ),
            token: tokenContract,
            value: amount,
            tokenId: itemId.toString(),
            block: relationId<BlockEntity>(block.header.hash),
            transaction: relationId<TransactionEntity>(txHash),
            timestamp: blockTimestamp,
          }),
        )

        ctx.log.info(`Item burned: ${player} burned ${amount}x item #${itemId}`)
      } else if (eventSig === ITEM_TYPE_CREATED) {
        const decoded = decodeLog({
          abi: itemsInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as ItemTypeCreatedArgs

        const itemId = BigInt(args.itemId.toString())
        const name = args.name
        const stackable = args.stackable
        const rarity = args.rarity

        ctx.log.info(
          `Item type created: #${itemId} "${name}" (${stackable ? 'stackable' : 'unique'}, rarity: ${rarity})`,
        )
      } else if (eventSig === NFT_PROVENANCE) {
        const decoded = decodeLog({
          abi: itemsInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as NFTProvenanceArgs

        const originalMinter = args.originalMinter.toLowerCase()
        const itemId = BigInt(args.itemId.toString())
        const mintedAt = BigInt(args.mintedAt.toString())

        ctx.log.info(
          `NFT Provenance: item #${itemId} originally minted by ${originalMinter} at ${mintedAt}`,
        )
      } else if (eventSig === TRANSFER_SINGLE) {
        const decoded = decodeLog({
          abi: itemsInterface,
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as TransferSingleArgs

        const from = args.from.toLowerCase()
        const to = args.to.toLowerCase()
        const id = BigInt(args.id.toString())
        const value = BigInt(args.value.toString())

        // Skip mint/burn events (already handled above)
        if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) continue

        const fromAccount = accountFactory.getOrCreate(
          from,
          block.header.height,
          blockTimestamp,
        )
        const toAccount = accountFactory.getOrCreate(
          to,
          block.header.height,
          blockTimestamp,
        )
        const tokenContract = getOrCreateContract(
          contractAddress,
          block.header.height,
          blockTimestamp,
        )
        tokenContract.isERC1155 = true

        tokenTransfers.push(
          new TokenTransfer({
            id: `${txHash}-${log.logIndex}`,
            logIndex: log.logIndex,
            tokenStandard: TokenStandard.ERC1155,
            from: fromAccount,
            to: toAccount,
            token: tokenContract,
            value,
            tokenId: id.toString(),
            block: relationId<BlockEntity>(block.header.hash),
            transaction: relationId<TransactionEntity>(txHash),
            timestamp: blockTimestamp,
          }),
        )
      }
    }
  }

  // Persist all entities
  await ctx.store.upsert(accountFactory.getAll())
  await ctx.store.upsert([...contracts.values()])
  await ctx.store.insert(tokenTransfers)

  // Log stats
  if (goldClaims.length > 0) {
    ctx.log.info(`Processed ${goldClaims.length} gold claims`)
  }
  if (mintedItems.length > 0) {
    ctx.log.info(`Processed ${mintedItems.length} item mints`)
  }
}
