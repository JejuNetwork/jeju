/**
 * Fund agent wallets on localnet
 *
 * SECURITY: This script uses a well-known test private key and should
 * ONLY run in localnet. The network check below enforces this.
 *
 * Usage:
 *   bun run scripts/fund-agents.ts
 *
 * This script:
 * 1. Gets the list of registered autonomous agents
 * 2. Funds each agent wallet with test ETH from the localnet faucet
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// SECURITY: Only allow this script to run in localnet
const network = getCurrentNetwork()
if (network !== 'localnet') {
  console.error(
    `ERROR: This script is only for localnet. Current network: ${network}`,
  )
  console.error(
    'This script uses a well-known test private key that must not be used in production.',
  )
  process.exit(1)
}

// Anvil's first dev account (funded with 10000 ETH)
// NOTE: This is a well-known test key - ONLY safe for localnet
const FAUCET_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

// Amount to fund each agent (1 ETH is plenty for localnet testing)
const FUND_AMOUNT = parseEther('1')

// Localnet RPC
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:6546'

// Pre-defined agent wallets (can be extended via AGENT_WALLETS env var)
const DEFAULT_AGENT_WALLETS: Address[] = [
  // These would be actual agent wallet addresses
  // For now we just fund the main dev account
]

async function main() {
  console.log('=== Agent Wallet Funding Script ===\n')
  console.log(`RPC: ${RPC_URL}`)
  console.log(`Amount per agent: ${formatEther(FUND_AMOUNT)} ETH\n`)

  // Create clients
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  })

  const faucetAccount = privateKeyToAccount(FAUCET_PRIVATE_KEY)
  const walletClient = createWalletClient({
    account: faucetAccount,
    chain: foundry,
    transport: http(RPC_URL),
  })

  // Check faucet balance
  const faucetBalance = await publicClient.getBalance({
    address: faucetAccount.address,
  })
  console.log(`Faucet wallet: ${faucetAccount.address}`)
  console.log(`Faucet balance: ${formatEther(faucetBalance)} ETH\n`)

  if (faucetBalance < FUND_AMOUNT) {
    console.error('Faucet has insufficient balance')
    process.exit(1)
  }

  // Get agent wallets to fund
  const agentWallets: Address[] = [...DEFAULT_AGENT_WALLETS]

  // Try to get wallets from Crucible API if running
  try {
    const response = await fetch(
      'http://localhost:4021/api/v1/autonomous/status',
    )
    if (response.ok) {
      const status = (await response.json()) as {
        agents?: Array<{ id: string }>
      }
      console.log(`Found ${status.agents?.length ?? 0} registered agents`)
      // Note: Agents currently share the same wallet from PRIVATE_KEY
      // In future, each agent could have its own derived wallet
    }
  } catch {
    console.log('Crucible not running - using default wallets only')
  }

  // Add wallet from env if provided
  if (process.env.AGENT_WALLET) {
    agentWallets.push(process.env.AGENT_WALLET as Address)
  }

  // Parse additional wallets from comma-separated env var
  if (process.env.AGENT_WALLETS) {
    const additionalWallets = process.env.AGENT_WALLETS.split(',').map(
      (w) => w.trim() as Address,
    )
    agentWallets.push(...additionalWallets)
  }

  // The main agent wallet (from PRIVATE_KEY) is pre-funded by Anvil
  // So we just verify it has balance
  const mainAgentAccount = privateKeyToAccount(FAUCET_PRIVATE_KEY)
  const mainBalance = await publicClient.getBalance({
    address: mainAgentAccount.address,
  })
  console.log(`Main agent wallet: ${mainAgentAccount.address}`)
  console.log(`Balance: ${formatEther(mainBalance)} ETH`)

  if (mainBalance < parseEther('10')) {
    console.log(
      'Main agent has low balance, but Anvil should have pre-funded it',
    )
  } else {
    console.log('Main agent wallet has sufficient funds')
  }

  // Fund any additional wallets
  if (agentWallets.length === 0) {
    console.log('\nNo additional agent wallets to fund.')
    console.log('All agents share the main dev wallet on localnet.')
    return
  }

  console.log(`\nFunding ${agentWallets.length} additional wallet(s)...`)

  for (const wallet of agentWallets) {
    const currentBalance = await publicClient.getBalance({ address: wallet })

    if (currentBalance >= FUND_AMOUNT) {
      console.log(
        `  ${wallet}: Already funded (${formatEther(currentBalance)} ETH)`,
      )
      continue
    }

    try {
      const txHash = await walletClient.sendTransaction({
        to: wallet,
        value: FUND_AMOUNT,
      })

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      const newBalance = await publicClient.getBalance({ address: wallet })
      console.log(`  ${wallet}: Funded (${formatEther(newBalance)} ETH)`)
    } catch (error) {
      console.error(`  ${wallet}: Failed to fund - ${error}`)
    }
  }

  console.log('\nAgent wallet funding complete.')
}

main().catch(console.error)
