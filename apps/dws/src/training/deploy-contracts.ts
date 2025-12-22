#!/usr/bin/env bun

/**
 * Deploy Training Contracts to Local Anvil
 *
 * Deploys real EVM contracts for fully decentralized training:
 * - Mock ERC20 reward token
 * - DistributedTrainingCoordinator
 *
 * Outputs deployed addresses for use in E2E tests.
 */

import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Anvil default private key
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const ANVIL_RPC = 'http://127.0.0.1:9545'
const CONTRACTS_PATH = '/home/shaw/Documents/jeju/packages/contracts'

// Read compiled artifact
async function loadArtifact(name: string): Promise<{ abi: readonly object[]; bytecode: Hex }> {
  const artifactPath = `${CONTRACTS_PATH}/out/${name}.sol/${name}.json`
  const file = Bun.file(artifactPath)
  if (!(await file.exists())) {
    throw new Error(`Artifact not found: ${artifactPath}. Run: cd packages/contracts && forge build`)
  }
  const artifact = await file.json()
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  }
}

export interface DeployedContracts {
  rewardToken: Hex
  coordinator: Hex
  deployer: Hex
}

export async function deployTrainingContracts(): Promise<DeployedContracts> {
  console.log('='.repeat(70))
  console.log('DEPLOYING TRAINING CONTRACTS')
  console.log('='.repeat(70))

  const account = privateKeyToAccount(DEPLOYER_KEY)
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(ANVIL_RPC),
  })
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(ANVIL_RPC),
  })

  // Check anvil is running
  const blockNumber = await publicClient.getBlockNumber().catch(() => null)
  if (blockNumber === null) {
    throw new Error('Anvil not running. Start with: anvil --port 9545')
  }
  console.log(`[Deploy] Connected to Anvil at block ${blockNumber}`)
  console.log(`[Deploy] Deployer: ${account.address}`)

  // 1. Deploy Mock ERC20 Reward Token
  console.log('\n[1/3] Deploying Reward Token (TRAIN)...')
  const mockToken = await loadArtifact('MockToken')

  const tokenHash = await walletClient.deployContract({
    abi: mockToken.abi,
    bytecode: mockToken.bytecode,
    args: ['Training Reward Token', 'TRAIN', 18],
  })

  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenHash,
  })
  const rewardTokenAddress = tokenReceipt.contractAddress
  if (!rewardTokenAddress) throw new Error('Token deployment failed')
  console.log(`       Reward Token: ${rewardTokenAddress}`)

  // 2. Deploy DistributedTrainingCoordinator
  console.log('\n[2/3] Deploying DistributedTrainingCoordinator...')
  const coordinator = await loadArtifact('DistributedTrainingCoordinator')

  const coordinatorHash = await walletClient.deployContract({
    abi: coordinator.abi,
    bytecode: coordinator.bytecode,
    args: [rewardTokenAddress],
  })

  const coordinatorReceipt = await publicClient.waitForTransactionReceipt({
    hash: coordinatorHash,
  })
  const coordinatorAddress = coordinatorReceipt.contractAddress
  if (!coordinatorAddress) throw new Error('Coordinator deployment failed')
  console.log(`       Coordinator: ${coordinatorAddress}`)

  // 3. Authorize deployer as bridge
  console.log('\n[3/3] Authorizing deployer as bridge...')
  const authHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: coordinator.abi,
    functionName: 'authorizeBridge',
    args: [account.address, true],
  })
  await publicClient.waitForTransactionReceipt({ hash: authHash })
  console.log('       Deployer authorized as bridge')

  // Summary
  console.log(`\n${'='.repeat(70)}`)
  console.log('DEPLOYMENT COMPLETE')
  console.log('='.repeat(70))
  console.log(`Reward Token:  ${rewardTokenAddress}`)
  console.log(`Coordinator:   ${coordinatorAddress}`)
  console.log(`Deployer:      ${account.address}`)
  console.log('='.repeat(70))

  // Save to file
  const contracts: DeployedContracts = {
    rewardToken: rewardTokenAddress,
    coordinator: coordinatorAddress,
    deployer: account.address,
  }

  await Bun.spawn(['mkdir', '-p', './training_output']).exited
  await Bun.write('./training_output/deployed-contracts.json', JSON.stringify(contracts, null, 2))
  console.log('\nConfig written to: ./training_output/deployed-contracts.json')

  return contracts
}

// Run if called directly
if (import.meta.main) {
  deployTrainingContracts().catch((err) => {
    console.error('Deployment failed:', err)
    process.exit(1)
  })
}
