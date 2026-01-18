#!/usr/bin/env bun
/**
 * Cross-Chain Message Relay Service
 *
 * Simulates OP Stack L1↔L2 bridge messaging for local development.
 * Watches for SentMessage events on both chains and relays them to the target.
 *
 * Usage:
 *   bun packages/deployment/scripts/bridge/message-relay.ts
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Configuration
const L1_RPC = process.env.L1_RPC_URL || 'http://127.0.0.1:6545'
const L2_RPC = process.env.L2_RPC_URL || 'http://127.0.0.1:6546'
const L1_CHAIN_ID = parseInt(process.env.L1_CHAIN_ID || '1337', 10)
const L2_CHAIN_ID = parseInt(process.env.L2_CHAIN_ID || '31337', 10)

// Relayer account - uses Anvil account #1 (same as authorized in deploy-crosschain.ts)
const RELAYER_PRIVATE_KEY = (process.env.RELAYER_PRIVATE_KEY ||
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as Hex

// Deployed contract addresses (set via environment or discovered)
function getMessengerAddresses(): {
  l1Messenger: Address | undefined
  l2Messenger: Address | undefined
} {
  return {
    l1Messenger: process.env.L1_MESSENGER_ADDRESS as Address | undefined,
    l2Messenger: process.env.L2_MESSENGER_ADDRESS as Address | undefined,
  }
}

// ABI for CrossDomainMessenger events
const SENT_MESSAGE_EVENT = parseAbiItem(
  'event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)',
)

const RELAY_MESSAGE_ABI = [
  {
    name: 'relayMessage',
    type: 'function',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'sender', type: 'address' },
      { name: 'message', type: 'bytes' },
      { name: 'messageNonce', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

interface RelayConfig {
  sourceRpc: string
  sourceChainId: number
  targetRpc: string
  targetChainId: number
  sourceMessenger: Address
  targetMessenger: Address
  name: string
}

class MessageRelayer {
  private relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  private processedMessages: Set<string> = new Set()
  private isRunning = true
  private l1Messenger: Address | null = null
  private l2Messenger: Address | null = null

  async start() {
    console.log('='.repeat(60))
    console.log('  CROSS-CHAIN MESSAGE RELAY SERVICE')
    console.log('='.repeat(60))
    console.log('')
    console.log(`Relayer:  ${this.relayerAccount.address}`)
    console.log(`L1 RPC:   ${L1_RPC} (chain ${L1_CHAIN_ID})`)
    console.log(`L2 RPC:   ${L2_RPC} (chain ${L2_CHAIN_ID})`)
    console.log('')

    const addresses = getMessengerAddresses()
    this.l1Messenger = addresses.l1Messenger ?? null
    this.l2Messenger = addresses.l2Messenger ?? null

    if (!this.l1Messenger || !this.l2Messenger) {
      console.log('Waiting for messenger addresses...')
      console.log('Set L1_MESSENGER_ADDRESS and L2_MESSENGER_ADDRESS env vars')
      console.log('')

      // Poll for deployment file
      await this.waitForDeployment()
    }

    if (!this.l1Messenger || !this.l2Messenger) {
      throw new Error('Failed to obtain messenger addresses')
    }

    console.log(`L1 Messenger: ${this.l1Messenger}`)
    console.log(`L2 Messenger: ${this.l2Messenger}`)
    console.log('')
    console.log('Listening for cross-chain messages...')
    console.log('='.repeat(60))

    // Start watching both directions
    await Promise.all([
      this.watchAndRelay({
        sourceRpc: L1_RPC,
        sourceChainId: L1_CHAIN_ID,
        targetRpc: L2_RPC,
        targetChainId: L2_CHAIN_ID,
        sourceMessenger: this.l1Messenger,
        targetMessenger: this.l2Messenger,
        name: 'L1→L2',
      }),
      this.watchAndRelay({
        sourceRpc: L2_RPC,
        sourceChainId: L2_CHAIN_ID,
        targetRpc: L1_RPC,
        targetChainId: L1_CHAIN_ID,
        sourceMessenger: this.l2Messenger,
        targetMessenger: this.l1Messenger,
        name: 'L2→L1',
      }),
    ])
  }

  private async waitForDeployment() {
    const { existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    const deploymentFile = join(
      process.cwd(),
      'packages/contracts/deployments/localnet-crosschain.json',
    )

    while (!this.l1Messenger || !this.l2Messenger) {
      if (existsSync(deploymentFile)) {
        try {
          const deployment = JSON.parse(
            readFileSync(deploymentFile, 'utf-8'),
          ) as {
            l1Messenger?: Address
            l2Messenger?: Address
          }
          if (deployment.l1Messenger && deployment.l2Messenger) {
            this.l1Messenger = deployment.l1Messenger
            this.l2Messenger = deployment.l2Messenger
            return
          }
        } catch {
          // Continue waiting
        }
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  private async watchAndRelay(config: RelayConfig) {
    const sourceChain = {
      id: config.sourceChainId,
      name: `Chain ${config.sourceChainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.sourceRpc] } },
    } as const

    const targetChain = {
      id: config.targetChainId,
      name: `Chain ${config.targetChainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.targetRpc] } },
    } as const

    const sourceClient = createPublicClient({
      chain: sourceChain,
      transport: http(config.sourceRpc),
    })

    const targetClient = createPublicClient({
      chain: targetChain,
      transport: http(config.targetRpc),
    })

    const targetWallet = createWalletClient({
      account: this.relayerAccount,
      chain: targetChain,
      transport: http(config.targetRpc),
    })

    // Poll for new events - start from block 0 to catch all messages
    let lastBlock = 0n

    while (this.isRunning) {
      try {
        const currentBlock = await sourceClient.getBlockNumber()

        if (currentBlock > lastBlock) {
          // Get logs for SentMessage events
          const logs = await sourceClient.getLogs({
            address: config.sourceMessenger,
            event: SENT_MESSAGE_EVENT,
            fromBlock: lastBlock + 1n,
            toBlock: currentBlock,
          })

          for (const log of logs) {
            const messageKey = `${log.transactionHash}-${log.logIndex}`

            if (this.processedMessages.has(messageKey)) {
              continue
            }

            this.processedMessages.add(messageKey)

            const { target, sender, message, messageNonce, gasLimit } =
              log.args as {
                target: Address
                sender: Address
                message: Hex
                messageNonce: bigint
                gasLimit: bigint
              }

            console.log(`\n[${config.name}] Message detected:`)
            console.log(`  From: ${sender}`)
            console.log(`  To: ${target}`)
            console.log(`  Nonce: ${messageNonce}`)
            console.log(`  Gas Limit: ${gasLimit}`)

            // Relay message to target chain
            try {
              const hash = await targetWallet.writeContract({
                address: config.targetMessenger,
                abi: RELAY_MESSAGE_ABI,
                functionName: 'relayMessage',
                args: [target, sender, message, messageNonce],
                gas: gasLimit > 0n ? gasLimit : 500000n,
              })

              const receipt = await targetClient.waitForTransactionReceipt({
                hash,
              })
              console.log(
                `  ✅ Relayed: ${hash} (${receipt.status === 'success' ? 'success' : 'failed'})`,
              )
            } catch (error) {
              console.log(
                `  ❌ Relay failed: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }

          lastBlock = currentBlock
        }
      } catch (error) {
        console.error(
          `[${config.name}] Error polling:`,
          error instanceof Error ? error.message : String(error),
        )
      }

      await new Promise((r) => setTimeout(r, 500)) // Poll every 500ms
    }
  }

  stop() {
    this.isRunning = false
  }
}

// Main
const relayer = new MessageRelayer()

process.on('SIGINT', () => {
  console.log('\nShutting down relay service...')
  relayer.stop()
  process.exit(0)
})

relayer.start().catch((error) => {
  console.error('Relay service failed:', error)
  process.exit(1)
})
