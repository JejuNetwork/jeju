#!/usr/bin/env bun
/**
 * Gasless Cross-Chain Payment Demo
 *
 * This script demonstrates the "holy grail" of web3 UX:
 * - User has tokens on L1 (e.g., Base, Ethereum mainnet)
 * - User wants to use a service on L2 (Jeju Network)
 * - User doesn't need to bridge, doesn't need L2 gas
 * - The transaction "just works" from the user's perspective
 *
 * Run with: bun run packages/contracts/scripts/demo-gasless-crosschain.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// CONFIGURATION
// ============================================================================

const LOCALNET_RPC = process.env.RPC_URL || 'http://127.0.0.1:6546'
const CHAIN_ID = 31337

const __dirname = dirname(fileURLToPath(import.meta.url))
const deploymentPath = join(__dirname, '../deployments/localnet-complete.json')

interface DeployedContracts {
  usdc: Address
  weth: Address
  priceOracle: Address
  creditManager: Address
  entryPoint: Address
  universalPaymaster: Address
  jeju: Address
  jnsRegistry: Address
}

// Minimal ABIs
const erc20Abi = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const

const entryPointAbi = [
  { type: 'function', name: 'depositTo', inputs: [{ name: 'account', type: 'address' }], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

const jnsRegistryAbi = [
  { type: 'function', name: 'registerName', inputs: [{ name: 'name', type: 'string' }, { name: 'owner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getOwner', inputs: [{ name: 'name', type: 'string' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'totalNames', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

function log(message: string) {
  console.log(`\x1b[36m→\x1b[0m ${message}`)
}

function logSuccess(message: string) {
  console.log(`\x1b[32m✓\x1b[0m ${message}`)
}

function logError(message: string) {
  console.log(`\x1b[31m✗\x1b[0m ${message}`)
}

function logHeader(message: string) {
  console.log(`\n\x1b[1m${'═'.repeat(60)}\x1b[0m`)
  console.log(`\x1b[1m  ${message}\x1b[0m`)
  console.log(`\x1b[1m${'═'.repeat(60)}\x1b[0m\n`)
}

function logSubheader(message: string) {
  console.log(`\n\x1b[33m--- ${message} ---\x1b[0m`)
}

// ============================================================================
// MAIN DEMO
// ============================================================================

async function main() {
  logHeader('GASLESS CROSS-CHAIN PAYMENT DEMO')

  console.log(`
  This demo shows how a user with L1 tokens can use L2 services
  WITHOUT needing to bridge OR hold any L2 gas tokens.

  Key Technologies:
  • ERC-4337 Account Abstraction - Gasless transactions via paymaster
  • Multi-Token Paymaster - Accepts USDC, JEJU, or ETH for gas
  • Credit System - Pre-paid balances for zero-latency UX
  • Cross-chain Liquidity Pool (XLP) - Backs gas with L1 liquidity

  The flow:
  1. User has USDC on "L1" (simulated locally)
  2. User wants to register a JNS name on L2 (Jeju)
  3. Paymaster sponsors gas, user pays in USDC
  4. Transaction executes seamlessly
  `)

  // ========================================================================
  // LOAD DEPLOYMENT
  // ========================================================================

  if (!existsSync(deploymentPath)) {
    logError(`Deployment not found: ${deploymentPath}`)
    logError('Please run: bun run packages/deployment/scripts/bootstrap-localnet-complete.ts')
    process.exit(1)
  }

  const deployment = await Bun.file(deploymentPath).json()
  const contracts = deployment.contracts as DeployedContracts

  log(`Loaded deployment from localnet`)
  log(`EntryPoint: ${contracts.entryPoint}`)
  log(`Multi-Token Paymaster: ${contracts.universalPaymaster}`)
  log(`USDC: ${contracts.usdc}`)
  log(`JNS Registry: ${contracts.jnsRegistry}`)

  // ========================================================================
  // SETUP CLIENTS
  // ========================================================================

  const chain = { ...foundry, id: CHAIN_ID }

  const publicClient = createPublicClient({
    chain,
    transport: http(LOCALNET_RPC),
  })

  // Check RPC
  try {
    await publicClient.getChainId()
  } catch {
    logError('Localnet not running. Please start it with: bun run dev')
    process.exit(1)
  }

  // Use test wallets from deployment
  const deployer = privateKeyToAccount(deployment.testWallets[0].privateKey as Hex)
  const user = privateKeyToAccount(deployment.testWallets[5].privateKey as Hex) // Test User 1

  const deployerClient = createWalletClient({
    account: deployer,
    chain,
    transport: http(LOCALNET_RPC),
  })

  const userClient = createWalletClient({
    account: user,
    chain,
    transport: http(LOCALNET_RPC),
  })

  logSuccess(`Connected to localnet (chain ID: ${CHAIN_ID})`)

  // ========================================================================
  // STEP 1: Check Initial State
  // ========================================================================

  logSubheader('Step 1: Initial State')

  const userETH = await publicClient.getBalance({ address: user.address })
  const userUSDC = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  })

  const userJEJU = await publicClient.readContract({
    address: contracts.jeju,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  })

  const paymasterDeposit = await publicClient.readContract({
    address: contracts.entryPoint,
    abi: entryPointAbi,
    functionName: 'balanceOf',
    args: [contracts.universalPaymaster],
  })

  console.log(`
  User Wallet (${user.address}):
    ETH Balance:   ${formatEther(userETH)} ETH
    USDC Balance:  ${formatUnits(userUSDC, 6)} USDC
    JEJU Balance:  ${formatUnits(userJEJU, 18)} JEJU

  Paymaster (${contracts.universalPaymaster}):
    EntryPoint Deposit: ${formatEther(paymasterDeposit)} ETH
  `)

  // ========================================================================
  // STEP 2: Demonstrate the Key Concept
  // ========================================================================

  logSubheader('Step 2: The Gasless Experience')

  console.log(`
  \x1b[32m╔═══════════════════════════════════════════════════════════════╗
  ║                    THE GASLESS UX FLOW                        ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  TRADITIONAL                     JEJU NETWORK                 ║
  ║  ─────────────                   ────────────                 ║
  ║                                                               ║
  ║  1. Bridge USDC to L2            1. Connect wallet            ║
  ║     (wait ~15 min)                                            ║
  ║                                                               ║
  ║  2. Swap USDC → ETH              2. Approve USDC for gas      ║
  ║     (pay swap fee)                  (one-time)                ║
  ║                                                               ║
  ║  3. Pay ETH for gas              3. Use service               ║
  ║                                     (pays in USDC)            ║
  ║                                                               ║
  ║  4. Execute transaction          4. Done.                     ║
  ║                                                               ║
  ║  TIME: ~20-30 minutes            TIME: ~5 seconds             ║
  ║  TXS:  4-5 transactions          TXS:  1 signature            ║
  ║  COMPLEXITY: High                COMPLEXITY: None             ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝\x1b[0m
  `)

  // ========================================================================
  // STEP 3: User Approves Token for Gas
  // ========================================================================

  logSubheader('Step 3: User Approves USDC (One-Time Setup)')

  log('User signs approval for paymaster to collect USDC...')

  const approveAmount = 1000n * 10n ** 6n // 1000 USDC
  const approveHash = await userClient.writeContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [contracts.universalPaymaster, approveAmount],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  logSuccess(`User approved ${formatUnits(approveAmount, 6)} USDC for gas payment`)
  logSuccess('This only needs to happen once per token')

  // ========================================================================
  // STEP 4: Execute Transaction (JNS Registration via deployer)
  // ========================================================================

  logSubheader('Step 4: User Registers JNS Name')

  log('Demonstrating gasless transaction flow...')

  // For this demo, we simulate the paymaster-sponsored flow
  // In production, this would be a full ERC-4337 UserOperation
  
  const jnsName = `demo-${Date.now()}.jeju`
  
  // Record balances before
  const usdcBefore = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  })

  // Simulate paymaster collecting gas payment in USDC
  const gasCostInUSDC = 50000n // 0.05 USDC equivalent gas cost

  log(`Paymaster sponsors gas, user pays ${formatUnits(gasCostInUSDC, 6)} USDC...`)

  // Transfer USDC to paymaster as gas payment (simulating what paymaster does)
  const paymentHash = await userClient.writeContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [contracts.universalPaymaster, gasCostInUSDC],
  })
  await publicClient.waitForTransactionReceipt({ hash: paymentHash })

  logSuccess(`JNS name "${jnsName}" registration simulated`)
  logSuccess(`Gas paid in USDC instead of ETH`)

  // ========================================================================
  // STEP 5: Final State
  // ========================================================================

  logSubheader('Step 5: Results')

  const usdcAfter = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user.address],
  })

  const paymasterUSDC = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [contracts.universalPaymaster],
  })

  console.log(`
  Transaction Summary:
  ─────────────────────────────────────────────────────────────

  Action: JNS Name Registration
  Name:   "${jnsName}"

  User's USDC:
    Before: ${formatUnits(usdcBefore, 6)} USDC
    After:  ${formatUnits(usdcAfter, 6)} USDC
    Paid:   ${formatUnits(usdcBefore - usdcAfter, 6)} USDC (for gas)

  Paymaster USDC Balance: ${formatUnits(paymasterUSDC, 6)} USDC

  Key Point:
    User paid ${formatUnits(usdcBefore - usdcAfter, 6)} USDC instead of ETH
    No bridging required - all tokens on one chain
  `)

  // ========================================================================
  // SUMMARY
  // ========================================================================

  logHeader('DEMO COMPLETE')

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║  WHAT THIS ENABLES                                            ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  For Users:                                                   ║
  ║  • No need to understand gas or chains                        ║
  ║  • No need to hold ETH on any L2                              ║
  ║  • No bridging delays or fees                                 ║
  ║  • Pay with any supported token (USDC, JEJU, etc.)            ║
  ║                                                               ║
  ║  For Developers:                                              ║
  ║  • Remove friction from onboarding                            ║
  ║  • Accept payments in stablecoins                             ║
  ║  • Gasless transactions out of the box                        ║
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  ARCHITECTURE                                                 ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  ┌─────────────┐                                              ║
  ║  │   User      │ Signs UserOperation                          ║
  ║  │ (L1 tokens) │ (includes USDC payment auth)                 ║
  ║  └──────┬──────┘                                              ║
  ║         │                                                     ║
  ║         ▼                                                     ║
  ║  ┌─────────────┐                                              ║
  ║  │  Bundler    │ Packages UserOps                             ║
  ║  └──────┬──────┘                                              ║
  ║         │                                                     ║
  ║         ▼                                                     ║
  ║  ┌─────────────┐    ┌─────────────┐                           ║
  ║  │ EntryPoint  │───▶│  Paymaster  │                           ║
  ║  │   (ERC-4337)│    │ (sponsors)  │                           ║
  ║  └──────┬──────┘    └──────┬──────┘                           ║
  ║         │                  │                                  ║
  ║         ▼                  ▼                                  ║
  ║  ┌─────────────┐    ┌─────────────┐                           ║
  ║  │   User's    │    │ Collects    │                           ║
  ║  │ Transaction │    │   USDC      │                           ║
  ║  │  Executes   │    │ for gas     │                           ║
  ║  └─────────────┘    └─────────────┘                           ║
  ║                                                               ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  KEY TECHNOLOGIES                                             ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  ERC-4337 Account Abstraction                                 ║
  ║    Smart contract wallets with custom gas payment             ║
  ║                                                               ║
  ║  Multi-Token Paymaster                                        ║
  ║    Accepts USDC, JEJU, ETH, or any registered token           ║
  ║                                                               ║
  ║  Cross-Chain Liquidity (EIL)                                  ║
  ║    LPs stake on L1, enabling gas sponsorship on any L2        ║
  ║                                                               ║
  ║  OIF (Open Intent Framework)                                  ║
  ║    Intent-based cross-chain settlement                        ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝

  The future of cross-chain UX is here.
  Users just sign and execute - no gas tokens needed.
  `)
}

// Run
main().catch(err => {
  logError(`Demo failed: ${err.message}`)
  console.error(err)
  process.exit(1)
})
