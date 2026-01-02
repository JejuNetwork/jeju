#!/usr/bin/env bun
/**
 * Deploy Cross-Chain Contracts
 *
 * Deploys EIL infrastructure across L1 and L2 local chains:
 * - L1: L1CrossDomainMessenger, L1StakeManager
 * - L2: L2CrossDomainMessenger, EntryPoint, CrossChainPaymasterUpgradeable
 *
 * Usage:
 *   bun packages/deployment/scripts/bridge/deploy-crosschain.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Configuration
const L1_RPC = process.env.L1_RPC_URL || 'http://127.0.0.1:6545'
const L2_RPC = process.env.L2_RPC_URL || 'http://127.0.0.1:6546'
const L1_CHAIN_ID = 1337
const L2_CHAIN_ID = 31337

// Deployer key (Anvil account #0)
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex

// Relayer address (account #1)
const RELAYER_ADDRESS = (process.env.RELAYER_ADDRESS ||
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8') as Address

interface DeploymentResult {
  l1ChainId: number
  l2ChainId: number
  l1Messenger: Address
  l2Messenger: Address
  l1StakeManager: Address
  entryPoint: Address
  simpleAccountFactory: Address
  crossChainPaymaster: Address
  deployedAt: string
}

async function main() {
  console.log('='.repeat(60))
  console.log('  CROSS-CHAIN DEPLOYMENT')
  console.log('='.repeat(60))
  console.log('')

  const account = privateKeyToAccount(DEPLOYER_KEY)
  console.log(`Deployer: ${account.address}`)
  console.log(`L1 RPC:   ${L1_RPC} (chain ${L1_CHAIN_ID})`)
  console.log(`L2 RPC:   ${L2_RPC} (chain ${L2_CHAIN_ID})`)
  console.log('')

  // Create chains
  const l1Chain = {
    id: L1_CHAIN_ID,
    name: 'L1 Localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [L1_RPC] } },
  } as const

  const l2Chain = {
    id: L2_CHAIN_ID,
    name: 'L2 Localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [L2_RPC] } },
  } as const

  // Create clients
  const l1Public = createPublicClient({
    chain: l1Chain,
    transport: http(L1_RPC),
  })
  const l2Public = createPublicClient({
    chain: l2Chain,
    transport: http(L2_RPC),
  })

  const l1Wallet = createWalletClient({
    account,
    chain: l1Chain,
    transport: http(L1_RPC),
  })

  const l2Wallet = createWalletClient({
    account,
    chain: l2Chain,
    transport: http(L2_RPC),
  })

  // Check both chains are running
  try {
    const [l1ChainId, l2ChainId] = await Promise.all([
      l1Public.getChainId(),
      l2Public.getChainId(),
    ])
    console.log(`L1 connected: chain ${l1ChainId}`)
    console.log(`L2 connected: chain ${l2ChainId}`)
  } catch (_error) {
    console.error(
      'Failed to connect to chains. Make sure both L1 and L2 are running.',
    )
    console.error('Run: jeju dev')
    process.exit(1)
  }

  console.log('')
  console.log('=== DEPLOYING TO L1 ===')

  // Deploy L1CrossDomainMessenger
  console.log('Deploying L1CrossDomainMessenger...')
  const l1MessengerAddress = await deployContract(
    l1Wallet,
    l1Public,
    'L1CrossDomainMessenger',
  )
  console.log(`  L1Messenger: ${l1MessengerAddress}`)

  // Deploy L1StakeManager
  console.log('Deploying L1StakeManager...')
  const l1StakeManagerAddress = await deployContract(
    l1Wallet,
    l1Public,
    'L1StakeManager',
  )
  console.log(`  L1StakeManager: ${l1StakeManagerAddress}`)

  // Configure L1StakeManager
  console.log('Configuring L1StakeManager...')
  await l1Wallet.writeContract({
    address: l1StakeManagerAddress,
    abi: [
      {
        name: 'setMessenger',
        type: 'function',
        inputs: [{ name: '_messenger', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setMessenger',
    args: [l1MessengerAddress],
  })
  console.log('  Set messenger')

  console.log('')
  console.log('=== DEPLOYING TO L2 ===')

  // Deploy EntryPoint
  console.log('Deploying EntryPoint v0.7...')
  const entryPointAddress = await deployContract(
    l2Wallet,
    l2Public,
    'EntryPoint',
  )
  console.log(`  EntryPoint: ${entryPointAddress}`)

  // Deploy SimpleAccountFactory with EntryPoint as constructor arg
  console.log('Deploying SimpleAccountFactory...')
  const accountFactoryAddress = await deployContractWithArgs(
    l2Wallet,
    l2Public,
    'SimpleAccountFactory',
    [entryPointAddress],
  )
  console.log(`  SimpleAccountFactory: ${accountFactoryAddress}`)

  // Deploy L2CrossDomainMessenger
  console.log('Deploying L2CrossDomainMessenger...')
  const l2MessengerAddress = await deployContract(
    l2Wallet,
    l2Public,
    'L2CrossDomainMessenger',
  )
  console.log(`  L2Messenger: ${l2MessengerAddress}`)

  // Configure L2 messenger with L1 messenger address
  await l2Wallet.writeContract({
    address: l2MessengerAddress,
    abi: [
      {
        name: 'setL1Messenger',
        type: 'function',
        inputs: [{ name: '_l1Messenger', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setL1Messenger',
    args: [l1MessengerAddress],
  })

  // Configure L1 messenger with L2 messenger address
  await l1Wallet.writeContract({
    address: l1MessengerAddress,
    abi: [
      {
        name: 'setL2Messenger',
        type: 'function',
        inputs: [{ name: '_l2Messenger', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setL2Messenger',
    args: [l2MessengerAddress],
  })
  console.log('  Linked L1 and L2 messengers')

  // Authorize the relayer on both messengers
  const setRelayerAbi = [
    {
      name: 'setRelayer',
      type: 'function',
      inputs: [
        { name: 'relayer', type: 'address' },
        { name: 'authorized', type: 'bool' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const

  await l1Wallet.writeContract({
    address: l1MessengerAddress,
    abi: setRelayerAbi,
    functionName: 'setRelayer',
    args: [RELAYER_ADDRESS, true],
  })
  console.log(`  Authorized relayer ${RELAYER_ADDRESS} on L1`)

  await l2Wallet.writeContract({
    address: l2MessengerAddress,
    abi: setRelayerAbi,
    functionName: 'setRelayer',
    args: [RELAYER_ADDRESS, true],
  })
  console.log(`  Authorized relayer ${RELAYER_ADDRESS} on L2`)

  // Deploy CrossChainPaymasterUpgradeable
  console.log('Deploying CrossChainPaymasterUpgradeable...')
  const paymasterImplAddress = await deployContract(
    l2Wallet,
    l2Public,
    'CrossChainPaymasterUpgradeable',
  )
  console.log(`  Implementation: ${paymasterImplAddress}`)

  // Deploy proxy with initialize call
  const initializeData = encodeInitializeCall(
    account.address,
    L1_CHAIN_ID,
    l1StakeManagerAddress,
    entryPointAddress,
  )

  const proxyAddress = await deployProxy(
    l2Wallet,
    l2Public,
    paymasterImplAddress,
    initializeData,
  )
  console.log(`  Proxy: ${proxyAddress}`)

  // Configure paymaster with L2 messenger
  await l2Wallet.writeContract({
    address: proxyAddress,
    abi: [
      {
        name: 'setL2Messenger',
        type: 'function',
        inputs: [{ name: '_messenger', type: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'setL2Messenger',
    args: [l2MessengerAddress],
  })

  // Register L2 paymaster with L1StakeManager
  await l1Wallet.writeContract({
    address: l1StakeManagerAddress,
    abi: [
      {
        name: 'registerL2Paymaster',
        type: 'function',
        inputs: [
          { name: '_chainId', type: 'uint256' },
          { name: '_paymaster', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ],
    functionName: 'registerL2Paymaster',
    args: [BigInt(L2_CHAIN_ID), proxyAddress],
  })
  console.log(`  Registered paymaster with L1StakeManager`)

  // Save deployment to crosschain file
  const deployment: DeploymentResult = {
    l1ChainId: L1_CHAIN_ID,
    l2ChainId: L2_CHAIN_ID,
    l1Messenger: l1MessengerAddress,
    l2Messenger: l2MessengerAddress,
    l1StakeManager: l1StakeManagerAddress,
    entryPoint: entryPointAddress,
    simpleAccountFactory: accountFactoryAddress,
    crossChainPaymaster: proxyAddress,
    deployedAt: new Date().toISOString(),
  }

  const deploymentsDir = join(process.cwd(), 'packages/contracts/deployments')
  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true })
  }

  writeFileSync(
    join(deploymentsDir, 'localnet-crosschain.json'),
    JSON.stringify(deployment, null, 2),
  )

  // Also update localnet-complete.json if it exists (for bundler and other services)
  const completeFile = join(deploymentsDir, 'localnet-complete.json')
  if (existsSync(completeFile)) {
    const complete = JSON.parse(readFileSync(completeFile, 'utf-8'))
    complete.contracts = complete.contracts || {}
    complete.contracts.entryPoint = entryPointAddress
    complete.contracts.crossChainPaymaster = proxyAddress
    complete.contracts.l1StakeManager = l1StakeManagerAddress
    complete.crossChain = {
      l1ChainId: L1_CHAIN_ID,
      l2ChainId: L2_CHAIN_ID,
      l1Messenger: l1MessengerAddress,
      l2Messenger: l2MessengerAddress,
      relayer: RELAYER_ADDRESS,
    }
    writeFileSync(completeFile, JSON.stringify(complete, null, 2))
    console.log('  Updated localnet-complete.json with cross-chain contracts')
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('  CROSS-CHAIN DEPLOYMENT COMPLETE')
  console.log('='.repeat(60))
  console.log('')
  console.log('L1 Contracts:')
  console.log(`  L1Messenger:      ${l1MessengerAddress}`)
  console.log(`  L1StakeManager:   ${l1StakeManagerAddress}`)
  console.log('')
  console.log('L2 Contracts:')
  console.log(`  L2Messenger:      ${l2MessengerAddress}`)
  console.log(`  EntryPoint:       ${entryPointAddress}`)
  console.log(`  AccountFactory:   ${accountFactoryAddress}`)
  console.log(`  CrossChainPM:     ${proxyAddress}`)
  console.log('')
  console.log(
    'Saved to: packages/contracts/deployments/localnet-crosschain.json',
  )
  console.log('')
  console.log('Message relay will automatically pick up messenger addresses.')
}

// Get contract artifact path
const artifactPaths: Record<string, string> = {
  L1CrossDomainMessenger:
    'packages/contracts/out/L1CrossDomainMessenger.sol/L1CrossDomainMessenger.json',
  L2CrossDomainMessenger:
    'packages/contracts/out/L2CrossDomainMessenger.sol/L2CrossDomainMessenger.json',
  L1StakeManager:
    'packages/contracts/out/L1StakeManager.sol/L1StakeManager.json',
  CrossChainPaymasterUpgradeable:
    'packages/contracts/out/CrossChainPaymasterUpgradeable.sol/CrossChainPaymasterUpgradeable.json',
  EntryPoint: 'packages/contracts/out/EntryPoint.sol/EntryPoint.json',
  ERC1967Proxy: 'packages/contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json',
  SimpleAccountFactory:
    'packages/contracts/out/SimpleAccountFactory.sol/SimpleAccountFactory.json',
}

async function deployContract(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  contractName: string,
): Promise<Address> {
  const { readFileSync } = await import('node:fs')

  const artifactPath = join(process.cwd(), artifactPaths[contractName])
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}. Run 'forge build' first.`,
    )
  }

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
  const bytecode = artifact.bytecode.object as Hex

  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain: wallet.chain,
    data: bytecode,
  } as Parameters<typeof wallet.sendTransaction>[0])

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) {
    throw new Error(`Failed to deploy ${contractName}`)
  }

  return receipt.contractAddress
}

async function deployContractWithArgs(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  contractName: string,
  args: Address[],
): Promise<Address> {
  const { readFileSync } = await import('node:fs')

  const artifactPath = join(process.cwd(), artifactPaths[contractName])
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}. Run 'forge build' first.`,
    )
  }

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))

  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args,
  })

  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain: wallet.chain,
    data: deployData,
  } as Parameters<typeof wallet.sendTransaction>[0])

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) {
    throw new Error(`Failed to deploy ${contractName}`)
  }

  return receipt.contractAddress
}

async function deployProxy(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  implementation: Address,
  initData: Hex,
): Promise<Address> {
  const { readFileSync } = await import('node:fs')

  const artifactPath = join(
    process.cwd(),
    'packages/contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json',
  )
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))

  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [implementation, initData],
  })

  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain: wallet.chain,
    data: deployData,
  } as Parameters<typeof wallet.sendTransaction>[0])

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) {
    throw new Error('Failed to deploy proxy')
  }

  return receipt.contractAddress
}

function encodeInitializeCall(
  owner: Address,
  l1ChainId: number,
  l1StakeManager: Address,
  entryPoint: Address,
): Hex {
  return encodeFunctionData({
    abi: [
      {
        name: 'initialize',
        type: 'function',
        inputs: [
          { name: '_owner', type: 'address' },
          { name: '_l1ChainId', type: 'uint256' },
          { name: '_l1StakeManager', type: 'address' },
          { name: '_entryPoint', type: 'address' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const,
    functionName: 'initialize',
    args: [owner, BigInt(l1ChainId), l1StakeManager, entryPoint],
  })
}

main().catch((error) => {
  console.error('Deployment failed:', error)
  process.exit(1)
})
