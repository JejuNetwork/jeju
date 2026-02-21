/**
 * Faucet Service
 *
 * Uses a wallet client to send JEJU tokens to registered users.
 * For testnet: uses FAUCET_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY directly.
 * For production: should be replaced with KMS-based signing.
 */

import { expectAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getChain } from '../../lib/chains'
import {
  IDENTITY_REGISTRY_ADDRESS,
  JEJU_TOKEN_ADDRESS,
} from '../../lib/config/contracts'
import {
  getChainName,
  getRpcUrl,
  JEJU_CHAIN_ID,
} from '../../lib/config/networks'
import { faucetState, initializeState } from './state'

const FAUCET_CONFIG = {
  cooldownMs: 12 * 60 * 60 * 1000,
  amountPerClaim: parseEther('100'),
  gasGrantAmount: parseEther('0.001'),
  gasGrantCooldownMs: 24 * 60 * 60 * 1000,
  jejuTokenAddress: JEJU_TOKEN_ADDRESS,
  identityRegistryAddress: IDENTITY_REGISTRY_ADDRESS,
}

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

initializeState().catch(console.error)

const chain = getChain(JEJU_CHAIN_ID)
const rpcUrl = getRpcUrl(JEJU_CHAIN_ID)
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

function getFaucetPrivateKey(): `0x${string}` {
  const key = process.env.FAUCET_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY
  if (!key || !key.startsWith('0x') || key.length !== 66) {
    throw new Error(
      'FAUCET_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY must be set (0x + 64 hex chars)',
    )
  }
  return key as `0x${string}`
}

let faucetAddress: Address | null = null

function getFaucetAddress(): Address {
  if (!faucetAddress) {
    const account = privateKeyToAccount(getFaucetPrivateKey())
    faucetAddress = account.address
    console.log(`[Faucet] Using address: ${faucetAddress}`)
  }
  return faucetAddress
}

export interface FaucetStatus {
  eligible: boolean
  isRegistered: boolean
  cooldownRemaining: number
  nextClaimAt: number | null
  amountPerClaim: string
  faucetBalance: string
  /** Whether user can claim a gas grant to register */
  gasGrantEligible: boolean
  /** Gas grant cooldown remaining (ms) */
  gasGrantCooldownRemaining: number
}

export interface FaucetClaimResult {
  success: boolean
  txHash?: string
  amount?: string
  error?: string
  cooldownRemaining?: number
}

export interface FaucetInfo {
  name: string
  description: string
  tokenSymbol: string
  amountPerClaim: string
  cooldownHours: number
  requirements: string[]
  chainId: number
  chainName: string
}

async function isRegisteredAgent(address: Address): Promise<boolean> {
  if (FAUCET_CONFIG.identityRegistryAddress === ZERO_ADDRESS) {
    return false
  }

  const balance = await publicClient.readContract({
    address: FAUCET_CONFIG.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [address],
  })
  return balance > 0n
}

async function getCooldownRemaining(address: string): Promise<number> {
  const lastClaim = await faucetState.getLastClaim(address)
  if (!lastClaim) return 0
  return Math.max(0, FAUCET_CONFIG.cooldownMs - (Date.now() - lastClaim))
}

async function getGasGrantCooldownRemaining(address: string): Promise<number> {
  const lastGasGrant = await faucetState.getLastGasGrant(address)
  if (!lastGasGrant) return 0
  return Math.max(
    0,
    FAUCET_CONFIG.gasGrantCooldownMs - (Date.now() - lastGasGrant),
  )
}

async function getFaucetBalance(): Promise<bigint> {
  if (FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS) {
    return 0n
  }

  const address = getFaucetAddress()
  return await publicClient.readContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })
}

export async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  const validated = expectAddress(address, 'getFaucetStatus address')

  const [
    isRegistered,
    cooldownRemaining,
    faucetBalance,
    lastClaim,
    gasGrantCooldownRemaining,
  ] = await Promise.all([
    isRegisteredAgent(validated),
    getCooldownRemaining(validated),
    getFaucetBalance().catch(() => 0n),
    faucetState.getLastClaim(validated),
    getGasGrantCooldownRemaining(validated),
  ])

  const gasGrantEligible = !isRegistered && gasGrantCooldownRemaining === 0

  return {
    eligible:
      isRegistered &&
      cooldownRemaining === 0 &&
      faucetBalance >= FAUCET_CONFIG.amountPerClaim,
    isRegistered,
    cooldownRemaining,
    nextClaimAt: lastClaim ? lastClaim + FAUCET_CONFIG.cooldownMs : null,
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    faucetBalance: formatEther(faucetBalance),
    gasGrantEligible,
    gasGrantCooldownRemaining,
  }
}

export async function claimFromFaucet(
  address: Address,
): Promise<FaucetClaimResult> {
  const validated = expectAddress(address, 'claimFromFaucet address')

  const isRegistered = await isRegisteredAgent(validated)
  if (!isRegistered) {
    throw new Error(
      'Address must be registered in the ERC-8004 Identity Registry',
    )
  }

  const cooldownRemaining = await getCooldownRemaining(validated)
  if (cooldownRemaining > 0) {
    throw new Error(
      `Faucet cooldown active: ${Math.ceil(cooldownRemaining / 3600000)}h remaining`,
    )
  }

  const faucetBalance = await getFaucetBalance()
  if (faucetBalance < FAUCET_CONFIG.amountPerClaim) {
    throw new Error('Faucet is empty, please try again later')
  }

  if (FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS) {
    throw new Error('JEJU token not configured')
  }

  const account = privateKeyToAccount(getFaucetPrivateKey())
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const hash = await walletClient.writeContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [validated, FAUCET_CONFIG.amountPerClaim],
  })

  await faucetState.recordClaim(validated)
  return {
    success: true,
    txHash: hash,
    amount: formatEther(FAUCET_CONFIG.amountPerClaim),
  }
}

export interface GasGrantResult {
  success: boolean
  txHash?: string
  amount?: string
  error?: string
}

/**
 * Claim a small amount of ETH for gas to register.
 * Only available to unregistered users, with a 24h cooldown.
 */
export async function claimGasGrant(address: Address): Promise<GasGrantResult> {
  const validated = expectAddress(address, 'claimGasGrant address')

  // Check if already registered (no grant needed)
  const isRegistered = await isRegisteredAgent(validated)
  if (isRegistered) {
    return {
      success: false,
      error: 'Already registered - claim JEJU tokens instead',
    }
  }

  // Check gas grant cooldown
  const cooldownRemaining = await getGasGrantCooldownRemaining(validated)
  if (cooldownRemaining > 0) {
    return {
      success: false,
      error: `Gas grant cooldown active: ${Math.ceil(cooldownRemaining / 3600000)}h remaining`,
    }
  }

  const account = privateKeyToAccount(getFaucetPrivateKey())
  const signerAddress = account.address

  // Check faucet ETH balance
  const ethBalance = await publicClient.getBalance({ address: signerAddress })
  if (ethBalance < FAUCET_CONFIG.gasGrantAmount) {
    return {
      success: false,
      error: 'Faucet ETH balance too low for gas grant',
    }
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const hash = await walletClient.sendTransaction({
    to: validated,
    value: FAUCET_CONFIG.gasGrantAmount,
  })

  await faucetState.recordGasGrant(validated)
  return {
    success: true,
    txHash: hash,
    amount: formatEther(FAUCET_CONFIG.gasGrantAmount),
  }
}

export function getFaucetInfo(): FaucetInfo {
  return {
    name: `${getChainName(JEJU_CHAIN_ID)} Faucet`,
    description:
      'Get JEJU tokens for testing. Requires ERC-8004 registry registration.',
    tokenSymbol: 'JEJU',
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    cooldownHours: FAUCET_CONFIG.cooldownMs / (60 * 60 * 1000),
    requirements: [
      'Wallet must be registered in ERC-8004 Identity Registry',
      '12 hour cooldown between claims',
      'New users can claim a small gas grant to register',
    ],
    chainId: JEJU_CHAIN_ID,
    chainName: getChainName(JEJU_CHAIN_ID),
  }
}

export const faucetService = {
  getFaucetStatus,
  claimFromFaucet,
  claimGasGrant,
  getFaucetInfo,
}
