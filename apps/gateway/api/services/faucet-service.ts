import { safeReadContract, safeWriteContract } from '@jejunetwork/shared'
import { expectAddress, parseEnvHex, ZERO_ADDRESS } from '@jejunetwork/types'
import { IERC20_ABI } from '@jejunetwork/ui'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { jejuTestnet } from '../../lib/chains'
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
  jejuTokenAddress: JEJU_TOKEN_ADDRESS,
  identityRegistryAddress: IDENTITY_REGISTRY_ADDRESS,
  faucetPrivateKey: parseEnvHex(process.env.FAUCET_PRIVATE_KEY),
}

const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

initializeState().catch(console.error)

const publicClient = createPublicClient({
  chain: jejuTestnet,
  transport: http(getRpcUrl(JEJU_CHAIN_ID)),
})

function getWalletClient() {
  if (!FAUCET_CONFIG.faucetPrivateKey)
    throw new Error('FAUCET_PRIVATE_KEY not configured')
  const account = privateKeyToAccount(FAUCET_CONFIG.faucetPrivateKey)
  return createWalletClient({
    account,
    chain: jejuTestnet,
    transport: http(getRpcUrl(JEJU_CHAIN_ID)),
  })
}

export interface FaucetStatus {
  eligible: boolean
  isRegistered: boolean
  cooldownRemaining: number
  nextClaimAt: number | null
  amountPerClaim: string
  faucetBalance: string
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
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.FAUCET_SKIP_REGISTRY === 'true'
  ) {
    return true
  }

  if (FAUCET_CONFIG.identityRegistryAddress === ZERO_ADDRESS) {
    return false
  }

  const balance = await safeReadContract<bigint>(publicClient, {
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

async function getFaucetBalance(): Promise<bigint> {
  if (
    FAUCET_CONFIG.jejuTokenAddress === ZERO_ADDRESS ||
    !FAUCET_CONFIG.faucetPrivateKey
  ) {
    return 0n
  }
  const account = privateKeyToAccount(FAUCET_CONFIG.faucetPrivateKey)
  return await safeReadContract<bigint>(publicClient, {
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: IERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })
}

export async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  const validated = expectAddress(address, 'getFaucetStatus address')

  const [isRegistered, cooldownRemaining, faucetBalance, lastClaim] =
    await Promise.all([
      isRegisteredAgent(validated),
      getCooldownRemaining(validated),
      getFaucetBalance(),
      faucetState.getLastClaim(validated),
    ])

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

  const walletClient = getWalletClient()
  const hash = await safeWriteContract(walletClient, {
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: IERC20_ABI,
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
    ],
    chainId: JEJU_CHAIN_ID,
    chainName: getChainName(JEJU_CHAIN_ID),
  }
}

export const faucetService = { getFaucetStatus, claimFromFaucet, getFaucetInfo }
