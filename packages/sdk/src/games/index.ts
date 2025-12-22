/**
 * Games Module - Integration with game contracts (Babylon, Hyperscape)
 *
 * Provides:
 * - GameIntegration contract interaction
 * - Gold (ERC-20) token operations
 * - Items (ERC-1155) NFT operations
 * - Player registration and ban checking
 */

import type { NetworkType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'
import { getContractAddresses } from '../config'
import type { JejuWallet } from '../wallet'

export interface GameContracts {
  gameIntegration: Address
  gold: Address
  items: Address
  bazaar: Address
  banManager: Address
  identityRegistry: Address
  paymaster: Address
}

export interface PlayerInfo {
  address: Address
  agentId: bigint
  isAllowed: boolean
  goldBalance: bigint
  itemBalances: ItemBalance[]
}

export interface ItemBalance {
  itemId: bigint
  balance: bigint
  metadata?: ItemMetadata
}

export interface ItemMetadata {
  name: string
  description: string
  imageUri: string
  attributes: Record<string, string | number>
}

export interface GameStats {
  totalPlayers: bigint
  totalItems: bigint
  totalGoldSupply: bigint
  gameAgentId: bigint
}

export interface MintItemParams {
  to: Address
  itemId: bigint
  amount: bigint
  data?: Hex
}

export interface TransferGoldParams {
  to: Address
  amount: bigint
}

export interface TransferItemParams {
  to: Address
  itemId: bigint
  amount: bigint
  data?: Hex
}

const GAME_INTEGRATION_ABI = [
  {
    type: 'function',
    name: 'appId',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'gameAgentId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getContracts',
    inputs: [],
    outputs: [
      { name: 'banManager', type: 'address' },
      { name: 'identityRegistry', type: 'address' },
      { name: 'itemsContract', type: 'address' },
      { name: 'goldContract', type: 'address' },
      { name: 'bazaar', type: 'address' },
      { name: 'paymaster', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPlayerAllowed',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPlayerAgentId',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'linkAgentId',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unlinkAgentId',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const GOLD_ABI = [
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'burn',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const ITEMS_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOfBatch',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'ids', type: 'uint256[]' },
    ],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'uri',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'mintBatch',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'ids', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'burn',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'safeTransferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'safeBatchTransferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'ids', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isApprovedForAll',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const

export interface GamesModule {
  // Game Integration
  getContracts(): Promise<GameContracts>
  getGameAgentId(): Promise<bigint>
  isPlayerAllowed(player: Address): Promise<boolean>
  getPlayerAgentId(player: Address): Promise<bigint>
  linkAgentId(agentId: bigint): Promise<Hex>
  unlinkAgentId(): Promise<Hex>

  // Gold Operations
  getGoldBalance(account?: Address): Promise<bigint>
  getGoldTotalSupply(): Promise<bigint>
  transferGold(params: TransferGoldParams): Promise<Hex>
  approveGold(spender: Address, amount: bigint): Promise<Hex>
  mintGold(to: Address, amount: bigint): Promise<Hex>
  burnGold(amount: bigint): Promise<Hex>

  // Items Operations
  getItemBalance(itemId: bigint, account?: Address): Promise<bigint>
  getItemBalances(itemIds: bigint[], account?: Address): Promise<bigint[]>
  getItemUri(itemId: bigint): Promise<string>
  mintItem(params: MintItemParams): Promise<Hex>
  mintItems(
    to: Address,
    itemIds: bigint[],
    amounts: bigint[],
    data?: Hex,
  ): Promise<Hex>
  burnItem(itemId: bigint, amount: bigint): Promise<Hex>
  transferItem(params: TransferItemParams): Promise<Hex>
  transferItems(
    to: Address,
    itemIds: bigint[],
    amounts: bigint[],
    data?: Hex,
  ): Promise<Hex>
  setItemApprovalForAll(operator: Address, approved: boolean): Promise<Hex>
  isItemApprovedForAll(operator: Address, account?: Address): Promise<boolean>

  // Player Info
  getPlayerInfo(player?: Address): Promise<PlayerInfo>
  getGameStats(): Promise<GameStats>
}

export function createGamesModule(
  wallet: JejuWallet,
  network: NetworkType,
  gameIntegrationAddress?: Address,
): GamesModule {
  const addresses = getContractAddresses(network)
  const gameIntegration =
    gameIntegrationAddress ?? (addresses.gameIntegration as Address)

  let cachedContracts: GameContracts | null = null

  async function getContracts(): Promise<GameContracts> {
    if (cachedContracts) return cachedContracts

    const result = await wallet.publicClient.readContract({
      address: gameIntegration,
      abi: GAME_INTEGRATION_ABI,
      functionName: 'getContracts',
    })

    cachedContracts = {
      gameIntegration,
      banManager: result[0],
      identityRegistry: result[1],
      items: result[2],
      gold: result[3],
      bazaar: result[4],
      paymaster: result[5],
    }

    return cachedContracts
  }

  async function getGameAgentId(): Promise<bigint> {
    return wallet.publicClient.readContract({
      address: gameIntegration,
      abi: GAME_INTEGRATION_ABI,
      functionName: 'gameAgentId',
    })
  }

  async function isPlayerAllowed(player: Address): Promise<boolean> {
    return wallet.publicClient.readContract({
      address: gameIntegration,
      abi: GAME_INTEGRATION_ABI,
      functionName: 'isPlayerAllowed',
      args: [player],
    })
  }

  async function getPlayerAgentId(player: Address): Promise<bigint> {
    return wallet.publicClient.readContract({
      address: gameIntegration,
      abi: GAME_INTEGRATION_ABI,
      functionName: 'getPlayerAgentId',
      args: [player],
    })
  }

  async function linkAgentId(agentId: bigint): Promise<Hex> {
    const data = encodeFunctionData({
      abi: GAME_INTEGRATION_ABI,
      functionName: 'linkAgentId',
      args: [agentId],
    })

    return wallet.sendTransaction({
      to: gameIntegration,
      data,
    })
  }

  async function unlinkAgentId(): Promise<Hex> {
    const data = encodeFunctionData({
      abi: GAME_INTEGRATION_ABI,
      functionName: 'unlinkAgentId',
    })

    return wallet.sendTransaction({
      to: gameIntegration,
      data,
    })
  }

  // Gold operations
  async function getGoldBalance(account?: Address): Promise<bigint> {
    const contracts = await getContracts()
    return wallet.publicClient.readContract({
      address: contracts.gold,
      abi: GOLD_ABI,
      functionName: 'balanceOf',
      args: [account ?? wallet.address],
    })
  }

  async function getGoldTotalSupply(): Promise<bigint> {
    const contracts = await getContracts()
    return wallet.publicClient.readContract({
      address: contracts.gold,
      abi: GOLD_ABI,
      functionName: 'totalSupply',
    })
  }

  async function transferGold(params: TransferGoldParams): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: GOLD_ABI,
      functionName: 'transfer',
      args: [params.to, params.amount],
    })

    return wallet.sendTransaction({
      to: contracts.gold,
      data,
    })
  }

  async function approveGold(spender: Address, amount: bigint): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: GOLD_ABI,
      functionName: 'approve',
      args: [spender, amount],
    })

    return wallet.sendTransaction({
      to: contracts.gold,
      data,
    })
  }

  async function mintGold(to: Address, amount: bigint): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: GOLD_ABI,
      functionName: 'mint',
      args: [to, amount],
    })

    return wallet.sendTransaction({
      to: contracts.gold,
      data,
    })
  }

  async function burnGold(amount: bigint): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: GOLD_ABI,
      functionName: 'burn',
      args: [amount],
    })

    return wallet.sendTransaction({
      to: contracts.gold,
      data,
    })
  }

  // Items operations
  async function getItemBalance(
    itemId: bigint,
    account?: Address,
  ): Promise<bigint> {
    const contracts = await getContracts()
    return wallet.publicClient.readContract({
      address: contracts.items,
      abi: ITEMS_ABI,
      functionName: 'balanceOf',
      args: [account ?? wallet.address, itemId],
    })
  }

  async function getItemBalances(
    itemIds: bigint[],
    account?: Address,
  ): Promise<bigint[]> {
    const contracts = await getContracts()
    const addr = account ?? wallet.address
    const result = await wallet.publicClient.readContract({
      address: contracts.items,
      abi: ITEMS_ABI,
      functionName: 'balanceOfBatch',
      args: [itemIds.map(() => addr), itemIds],
    })
    return [...result]
  }

  async function getItemUri(itemId: bigint): Promise<string> {
    const contracts = await getContracts()
    return wallet.publicClient.readContract({
      address: contracts.items,
      abi: ITEMS_ABI,
      functionName: 'uri',
      args: [itemId],
    })
  }

  async function mintItem(params: MintItemParams): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'mint',
      args: [params.to, params.itemId, params.amount, params.data ?? '0x'],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data,
    })
  }

  async function mintItems(
    to: Address,
    itemIds: bigint[],
    amounts: bigint[],
    data?: Hex,
  ): Promise<Hex> {
    const contracts = await getContracts()
    const txData = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'mintBatch',
      args: [to, itemIds, amounts, data ?? '0x'],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data: txData,
    })
  }

  async function burnItem(itemId: bigint, amount: bigint): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'burn',
      args: [wallet.address, itemId, amount],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data,
    })
  }

  async function transferItem(params: TransferItemParams): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'safeTransferFrom',
      args: [
        wallet.address,
        params.to,
        params.itemId,
        params.amount,
        params.data ?? '0x',
      ],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data,
    })
  }

  async function transferItems(
    to: Address,
    itemIds: bigint[],
    amounts: bigint[],
    data?: Hex,
  ): Promise<Hex> {
    const contracts = await getContracts()
    const txData = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'safeBatchTransferFrom',
      args: [wallet.address, to, itemIds, amounts, data ?? '0x'],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data: txData,
    })
  }

  async function setItemApprovalForAll(
    operator: Address,
    approved: boolean,
  ): Promise<Hex> {
    const contracts = await getContracts()
    const data = encodeFunctionData({
      abi: ITEMS_ABI,
      functionName: 'setApprovalForAll',
      args: [operator, approved],
    })

    return wallet.sendTransaction({
      to: contracts.items,
      data,
    })
  }

  async function isItemApprovedForAll(
    operator: Address,
    account?: Address,
  ): Promise<boolean> {
    const contracts = await getContracts()
    return wallet.publicClient.readContract({
      address: contracts.items,
      abi: ITEMS_ABI,
      functionName: 'isApprovedForAll',
      args: [account ?? wallet.address, operator],
    })
  }

  async function getPlayerInfo(player?: Address): Promise<PlayerInfo> {
    const addr = player ?? wallet.address
    const [isAllowed, agentId, goldBalance] = await Promise.all([
      isPlayerAllowed(addr),
      getPlayerAgentId(addr),
      getGoldBalance(addr),
    ])

    return {
      address: addr,
      agentId,
      isAllowed,
      goldBalance,
      itemBalances: [], // Can be populated by calling getItemBalances with specific IDs
    }
  }

  async function getGameStats(): Promise<GameStats> {
    const [gameAgentId, totalGoldSupply] = await Promise.all([
      getGameAgentId(),
      getGoldTotalSupply(),
    ])

    return {
      totalPlayers: 0n, // Would need to track this separately
      totalItems: 0n, // Would need to track this separately
      totalGoldSupply,
      gameAgentId,
    }
  }

  return {
    getContracts,
    getGameAgentId,
    isPlayerAllowed,
    getPlayerAgentId,
    linkAgentId,
    unlinkAgentId,
    getGoldBalance,
    getGoldTotalSupply,
    transferGold,
    approveGold,
    mintGold,
    burnGold,
    getItemBalance,
    getItemBalances,
    getItemUri,
    mintItem,
    mintItems,
    burnItem,
    transferItem,
    transferItems,
    setItemApprovalForAll,
    isItemApprovedForAll,
    getPlayerInfo,
    getGameStats,
  }
}
