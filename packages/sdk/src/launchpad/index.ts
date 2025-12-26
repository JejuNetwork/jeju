/**
 * Launchpad Module - Token launches, presales, and bonding curves
 *
 * Provides:
 * - Token creation and deployment
 * - Presale management
 * - Bonding curve launches
 * - LP locking
 * - NFT launches
 */

import type { NetworkType } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { encodeFunctionData, parseEther } from 'viem'
import { getContractAddresses } from '../config'
import { parseAddressFromLogs } from '../shared/api'
import type { JejuWallet } from '../wallet'

// Types

export type LaunchType = 'STANDARD' | 'BONDING_CURVE' | 'PRESALE' | 'NFT'
export type PresaleStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'

export interface TokenLaunchParams {
  name: string
  symbol: string
  totalSupply: bigint
  description?: string
  imageUri?: string
  website?: string
  twitter?: string
  telegram?: string
}

export interface PresaleParams {
  token: Address
  rate: bigint // tokens per ETH
  softCap: bigint
  hardCap: bigint
  minContribution: bigint
  maxContribution: bigint
  startTime: bigint
  endTime: bigint
  vestingDuration?: bigint
  vestingCliff?: bigint
}

export interface BondingCurveParams {
  name: string
  symbol: string
  reserveToken: Address
  initialPrice: bigint
  curveExponent: number // 1 = linear, 2 = quadratic
  targetMarketCap: bigint
  creatorFee: number // basis points
}

export interface TokenLaunch {
  launchId: Hex
  token: Address
  creator: Address
  launchType: LaunchType
  name: string
  symbol: string
  totalSupply: bigint
  createdAt: bigint
  status: PresaleStatus
  raised: bigint
  participants: bigint
}

export interface Presale {
  presaleId: Hex
  token: Address
  creator: Address
  rate: bigint
  softCap: bigint
  hardCap: bigint
  minContribution: bigint
  maxContribution: bigint
  startTime: bigint
  endTime: bigint
  raised: bigint
  participants: bigint
  status: PresaleStatus
  vestingDuration: bigint
  vestingCliff: bigint
}

export interface BondingCurve {
  curveId: Hex
  token: Address
  creator: Address
  reserveToken: Address
  currentPrice: bigint
  totalSupply: bigint
  reserveBalance: bigint
  curveExponent: number
  targetMarketCap: bigint
  graduated: boolean
}

export interface LPLock {
  lockId: Hex
  lpToken: Address
  owner: Address
  amount: bigint
  unlockTime: bigint
  isUnlocked: boolean
}

export interface UserContribution {
  presaleId: Hex
  amount: bigint
  claimed: boolean
  claimable: bigint
  vested: bigint
}

const TOKEN_LAUNCHPAD_ABI = [
  {
    type: 'function',
    name: 'createToken',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'metadata', type: 'string' },
    ],
    outputs: [{ type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'createPresale',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'rate', type: 'uint256' },
      { name: 'softCap', type: 'uint256' },
      { name: 'hardCap', type: 'uint256' },
      { name: 'minContribution', type: 'uint256' },
      { name: 'maxContribution', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'vestingDuration', type: 'uint256' },
      { name: 'vestingCliff', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'contribute',
    inputs: [{ name: 'presaleId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [{ name: 'presaleId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'refund',
    inputs: [{ name: 'presaleId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizePresale',
    inputs: [{ name: 'presaleId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPresale',
    inputs: [{ name: 'presaleId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'presaleId', type: 'bytes32' },
          { name: 'token', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'rate', type: 'uint256' },
          { name: 'softCap', type: 'uint256' },
          { name: 'hardCap', type: 'uint256' },
          { name: 'minContribution', type: 'uint256' },
          { name: 'maxContribution', type: 'uint256' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'raised', type: 'uint256' },
          { name: 'participants', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'vestingDuration', type: 'uint256' },
          { name: 'vestingCliff', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserContribution',
    inputs: [
      { name: 'presaleId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
      { name: 'claimable', type: 'uint256' },
      { name: 'vested', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActivePresales',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

const BONDING_CURVE_ABI = [
  {
    type: 'function',
    name: 'createCurve',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'reserveToken', type: 'address' },
      { name: 'initialPrice', type: 'uint256' },
      { name: 'curveExponent', type: 'uint256' },
      { name: 'targetMarketCap', type: 'uint256' },
      { name: 'creatorFee', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'buy',
    inputs: [
      { name: 'curveId', type: 'bytes32' },
      { name: 'minTokens', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sell',
    inputs: [
      { name: 'curveId', type: 'bytes32' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minOutput', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCurve',
    inputs: [{ name: 'curveId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'curveId', type: 'bytes32' },
          { name: 'token', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'reserveToken', type: 'address' },
          { name: 'currentPrice', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'reserveBalance', type: 'uint256' },
          { name: 'curveExponent', type: 'uint256' },
          { name: 'targetMarketCap', type: 'uint256' },
          { name: 'graduated', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBuyPrice',
    inputs: [
      { name: 'curveId', type: 'bytes32' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSellPrice',
    inputs: [
      { name: 'curveId', type: 'bytes32' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveCurves',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

const LP_LOCKER_ABI = [
  {
    type: 'function',
    name: 'lock',
    inputs: [
      { name: 'lpToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unlock',
    inputs: [{ name: 'lockId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'extendLock',
    inputs: [
      { name: 'lockId', type: 'bytes32' },
      { name: 'newUnlockTime', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getLock',
    inputs: [{ name: 'lockId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'lockId', type: 'bytes32' },
          { name: 'lpToken', type: 'address' },
          { name: 'owner', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'unlockTime', type: 'uint256' },
          { name: 'isUnlocked', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserLocks',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
] as const

export interface LaunchpadModule {
  // Token Creation
  createToken(params: TokenLaunchParams): Promise<{ hash: Hex; token: Address }>

  // Presale Management
  createPresale(params: PresaleParams): Promise<Hex>
  contribute(presaleId: Hex, amount: bigint): Promise<Hex>
  claim(presaleId: Hex): Promise<Hex>
  refund(presaleId: Hex): Promise<Hex>
  finalizePresale(presaleId: Hex): Promise<Hex>
  getPresale(presaleId: Hex): Promise<Presale>
  getUserContribution(presaleId: Hex, user?: Address): Promise<UserContribution>
  listActivePresales(): Promise<Presale[]>

  // Bonding Curve
  createBondingCurve(params: BondingCurveParams): Promise<Hex>
  buyFromCurve(curveId: Hex, amount: bigint, minTokens?: bigint): Promise<Hex>
  sellToCurve(
    curveId: Hex,
    tokenAmount: bigint,
    minOutput?: bigint,
  ): Promise<Hex>
  getCurve(curveId: Hex): Promise<BondingCurve>
  getBuyPrice(curveId: Hex, tokenAmount: bigint): Promise<bigint>
  getSellPrice(curveId: Hex, tokenAmount: bigint): Promise<bigint>
  listActiveCurves(): Promise<BondingCurve[]>

  // LP Locking
  lockLP(lpToken: Address, amount: bigint, unlockTime: bigint): Promise<Hex>
  unlockLP(lockId: Hex): Promise<Hex>
  extendLPLock(lockId: Hex, newUnlockTime: bigint): Promise<Hex>
  getLPLock(lockId: Hex): Promise<LPLock>
  listMyLPLocks(): Promise<LPLock[]>
}

export function createLaunchpadModule(
  wallet: JejuWallet,
  network: NetworkType,
): LaunchpadModule {
  const addresses = getContractAddresses(network)
  const launchpadAddress = addresses.tokenLaunchpad as Address
  const bondingCurveAddress = addresses.bondingCurve as Address
  const lpLockerAddress = addresses.lpLocker as Address

  const statusMap: Record<number, PresaleStatus> = {
    0: 'PENDING',
    1: 'ACTIVE',
    2: 'SUCCEEDED',
    3: 'FAILED',
    4: 'CANCELLED',
  }

  async function createToken(
    params: TokenLaunchParams,
  ): Promise<{ hash: Hex; token: Address }> {
    const metadata = JSON.stringify({
      description: params.description ?? '',
      image: params.imageUri ?? '',
      website: params.website ?? '',
      twitter: params.twitter ?? '',
      telegram: params.telegram ?? '',
    })

    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'createToken',
      args: [params.name, params.symbol, params.totalSupply, metadata],
    })

    const hash = await wallet.sendTransaction({
      to: launchpadAddress,
      data,
      value: parseEther('0.01'), // Creation fee
    })

    // Parse token address from TokenCreated event
    // Event signature: TokenCreated(address indexed token, address indexed creator, string name, string symbol)
    const token = await parseAddressFromLogs(
      wallet.publicClient,
      hash,
      'TokenCreated(address,address,string,string)',
    )

    return { hash, token }
  }

  async function createPresale(params: PresaleParams): Promise<Hex> {
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'createPresale',
      args: [
        params.token,
        params.rate,
        params.softCap,
        params.hardCap,
        params.minContribution,
        params.maxContribution,
        params.startTime,
        params.endTime,
        params.vestingDuration ?? 0n,
        params.vestingCliff ?? 0n,
      ],
    })

    return wallet.sendTransaction({
      to: launchpadAddress,
      data,
    })
  }

  async function contribute(presaleId: Hex, amount: bigint): Promise<Hex> {
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'contribute',
      args: [presaleId],
    })

    return wallet.sendTransaction({
      to: launchpadAddress,
      data,
      value: amount,
    })
  }

  async function claim(presaleId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'claim',
      args: [presaleId],
    })

    return wallet.sendTransaction({
      to: launchpadAddress,
      data,
    })
  }

  async function refund(presaleId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'refund',
      args: [presaleId],
    })

    return wallet.sendTransaction({
      to: launchpadAddress,
      data,
    })
  }

  async function finalizePresale(presaleId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'finalizePresale',
      args: [presaleId],
    })

    return wallet.sendTransaction({
      to: launchpadAddress,
      data,
    })
  }

  async function getPresale(presaleId: Hex): Promise<Presale> {
    const result = await wallet.publicClient.readContract({
      address: launchpadAddress,
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'getPresale',
      args: [presaleId],
    })

    return {
      ...result,
      status: statusMap[result.status] ?? 'PENDING',
    }
  }

  async function getUserContribution(
    presaleId: Hex,
    user?: Address,
  ): Promise<UserContribution> {
    const [amount, claimed, claimable, vested] =
      await wallet.publicClient.readContract({
        address: launchpadAddress,
        abi: TOKEN_LAUNCHPAD_ABI,
        functionName: 'getUserContribution',
        args: [presaleId, user ?? wallet.address],
      })

    return { presaleId, amount, claimed, claimable, vested }
  }

  async function listActivePresales(): Promise<Presale[]> {
    const presaleIds = await wallet.publicClient.readContract({
      address: launchpadAddress,
      abi: TOKEN_LAUNCHPAD_ABI,
      functionName: 'getActivePresales',
    })

    return Promise.all(presaleIds.map((id) => getPresale(id)))
  }

  async function createBondingCurve(params: BondingCurveParams): Promise<Hex> {
    const data = encodeFunctionData({
      abi: BONDING_CURVE_ABI,
      functionName: 'createCurve',
      args: [
        params.name,
        params.symbol,
        params.reserveToken,
        params.initialPrice,
        BigInt(params.curveExponent),
        params.targetMarketCap,
        BigInt(params.creatorFee),
      ],
    })

    return wallet.sendTransaction({
      to: bondingCurveAddress,
      data,
      value: parseEther('0.01'), // Creation fee
    })
  }

  async function buyFromCurve(
    curveId: Hex,
    amount: bigint,
    minTokens = 0n,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: BONDING_CURVE_ABI,
      functionName: 'buy',
      args: [curveId, minTokens],
    })

    return wallet.sendTransaction({
      to: bondingCurveAddress,
      data,
      value: amount,
    })
  }

  async function sellToCurve(
    curveId: Hex,
    tokenAmount: bigint,
    minOutput = 0n,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: BONDING_CURVE_ABI,
      functionName: 'sell',
      args: [curveId, tokenAmount, minOutput],
    })

    return wallet.sendTransaction({
      to: bondingCurveAddress,
      data,
    })
  }

  async function getCurve(curveId: Hex): Promise<BondingCurve> {
    const result = await wallet.publicClient.readContract({
      address: bondingCurveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getCurve',
      args: [curveId],
    })

    return {
      ...result,
      curveExponent: Number(result.curveExponent),
    }
  }

  async function getBuyPrice(
    curveId: Hex,
    tokenAmount: bigint,
  ): Promise<bigint> {
    return wallet.publicClient.readContract({
      address: bondingCurveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getBuyPrice',
      args: [curveId, tokenAmount],
    })
  }

  async function getSellPrice(
    curveId: Hex,
    tokenAmount: bigint,
  ): Promise<bigint> {
    return wallet.publicClient.readContract({
      address: bondingCurveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getSellPrice',
      args: [curveId, tokenAmount],
    })
  }

  async function listActiveCurves(): Promise<BondingCurve[]> {
    const curveIds = await wallet.publicClient.readContract({
      address: bondingCurveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: 'getActiveCurves',
    })

    return Promise.all(curveIds.map((id) => getCurve(id)))
  }

  async function lockLP(
    lpToken: Address,
    amount: bigint,
    unlockTime: bigint,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: LP_LOCKER_ABI,
      functionName: 'lock',
      args: [lpToken, amount, unlockTime],
    })

    return wallet.sendTransaction({
      to: lpLockerAddress,
      data,
    })
  }

  async function unlockLP(lockId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: LP_LOCKER_ABI,
      functionName: 'unlock',
      args: [lockId],
    })

    return wallet.sendTransaction({
      to: lpLockerAddress,
      data,
    })
  }

  async function extendLPLock(
    lockId: Hex,
    newUnlockTime: bigint,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: LP_LOCKER_ABI,
      functionName: 'extendLock',
      args: [lockId, newUnlockTime],
    })

    return wallet.sendTransaction({
      to: lpLockerAddress,
      data,
    })
  }

  async function getLPLock(lockId: Hex): Promise<LPLock> {
    return wallet.publicClient.readContract({
      address: lpLockerAddress,
      abi: LP_LOCKER_ABI,
      functionName: 'getLock',
      args: [lockId],
    })
  }

  async function listMyLPLocks(): Promise<LPLock[]> {
    const lockIds = await wallet.publicClient.readContract({
      address: lpLockerAddress,
      abi: LP_LOCKER_ABI,
      functionName: 'getUserLocks',
      args: [wallet.address],
    })

    return Promise.all(lockIds.map((id) => getLPLock(id)))
  }

  return {
    createToken,
    createPresale,
    contribute,
    claim,
    refund,
    finalizePresale,
    getPresale,
    getUserContribution,
    listActivePresales,
    createBondingCurve,
    buyFromCurve,
    sellToCurve,
    getCurve,
    getBuyPrice,
    getSellPrice,
    listActiveCurves,
    lockLP,
    unlockLP,
    extendLPLock,
    getLPLock,
    listMyLPLocks,
  }
}
