/**
 * Deploy Fee Governance Configuration
 *
 * This script configures the fee system for DAO governance control:
 * 1. Deploys AppFeeRegistry
 * 2. Connects FeeDistributor to AppFeeRegistry
 * 3. Transfers FeeConfig ownership to DAO governance
 * 4. Sets Board and Director addresses in FeeConfig
 *
 * Core Principle: Network gets 0% - fees go to apps and community
 *
 * Fee Split:
 * - 45% to apps (developers who build on Jeju)
 * - 45% to LPs (ETH + token liquidity providers)
 * - 10% to contributors/dependencies (deep funding pool)
 * - 0% to network (Jeju receives nothing)
 */

import type { PrivateKeyAccount, PublicClient, WalletClient } from 'viem'
import { type Address, type Hex, zeroAddress } from 'viem'

interface DeploymentConfig {
  // Existing contracts
  feeConfigAddress: Address
  feeDistributorAddress: Address
  liquidityVaultAddress: Address
  daoRegistryAddress: Address
  identityRegistryAddress: Address

  // Governance addresses
  daoGovernanceAddress: Address // The DAO multisig or governance contract
  boardContractAddress: Address // Board governance contract
  directorAgentAddress: Address // AI Director agent address

  // Paymasters to authorize
  paymasterAddresses: Address[]
}

interface DeployedContracts {
  appFeeRegistry: Address
}

export async function deployFeeGovernance(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: PrivateKeyAccount,
  config: DeploymentConfig,
): Promise<DeployedContracts> {
  console.log('Deploying Fee Governance Configuration...')
  console.log(
    'Core Principle: Network gets 0% - fees go to apps and community\n',
  )

  // 1. Deploy AppFeeRegistry
  console.log('1. Deploying AppFeeRegistry...')
  const appFeeRegistryBytecode = await getAppFeeRegistryBytecode()

  const appFeeRegistryHash = await walletClient.deployContract({
    account,
    abi: AppFeeRegistryABI,
    bytecode: appFeeRegistryBytecode,
    args: [
      config.daoRegistryAddress,
      config.identityRegistryAddress,
      account.address, // Initial owner (will be transferred)
    ],
  })

  const appFeeRegistryReceipt = await publicClient.waitForTransactionReceipt({
    hash: appFeeRegistryHash,
  })

  const appFeeRegistryAddress = appFeeRegistryReceipt.contractAddress
  if (!appFeeRegistryAddress) {
    throw new Error('Failed to deploy AppFeeRegistry')
  }
  console.log(`   AppFeeRegistry deployed at: ${appFeeRegistryAddress}`)

  // 2. Configure AppFeeRegistry
  console.log('\n2. Configuring AppFeeRegistry...')

  // Set FeeDistributor as authorized
  await walletClient.writeContract({
    account,
    address: appFeeRegistryAddress,
    abi: AppFeeRegistryABI,
    functionName: 'setFeeDistributor',
    args: [config.feeDistributorAddress],
  })
  console.log('   Set FeeDistributor as authorized')

  // 3. Connect FeeDistributor to AppFeeRegistry
  console.log('\n3. Connecting FeeDistributor to AppFeeRegistry...')

  await walletClient.writeContract({
    account,
    address: config.feeDistributorAddress,
    abi: FeeDistributorABI,
    functionName: 'setAppFeeRegistry',
    args: [appFeeRegistryAddress],
  })
  console.log('   FeeDistributor connected to AppFeeRegistry')

  // 4. Configure FeeConfig governance
  console.log('\n4. Configuring FeeConfig governance...')

  // Set Board contract
  if (config.boardContractAddress !== zeroAddress) {
    await walletClient.writeContract({
      account,
      address: config.feeConfigAddress,
      abi: FeeConfigABI,
      functionName: 'setBoard',
      args: [config.boardContractAddress],
    })
    console.log(`   Board set to: ${config.boardContractAddress}`)
  }

  // Set Director agent
  if (config.directorAgentAddress !== zeroAddress) {
    await walletClient.writeContract({
      account,
      address: config.feeConfigAddress,
      abi: FeeConfigABI,
      functionName: 'setDirector',
      args: [config.directorAgentAddress],
    })
    console.log(`   Director set to: ${config.directorAgentAddress}`)
  }

  // 5. Verify default fee configuration
  console.log('\n5. Verifying fee configuration...')
  const distributionFees = await publicClient.readContract({
    address: config.feeConfigAddress,
    abi: FeeConfigABI,
    functionName: 'getDistributionFees',
  })

  console.log('   Current fee distribution:')
  console.log(`   - App Share: ${Number(distributionFees.appShareBps) / 100}%`)
  console.log(`   - LP Share: ${Number(distributionFees.lpShareBps) / 100}%`)
  console.log(
    `   - Contributor Share: ${Number(distributionFees.contributorShareBps) / 100}%`,
  )
  console.log(
    `   - ETH LP (of LP share): ${Number(distributionFees.ethLpShareBps) / 100}%`,
  )
  console.log(
    `   - Token LP (of LP share): ${Number(distributionFees.tokenLpShareBps) / 100}%`,
  )

  // Verify the network gets 0%
  const totalFees =
    Number(distributionFees.appShareBps) +
    Number(distributionFees.lpShareBps) +
    Number(distributionFees.contributorShareBps)
  if (totalFees !== 10000) {
    console.warn(
      `   Warning: Total fees don't sum to 100% (got ${totalFees / 100}%)`,
    )
  }
  console.log('   Network share: 0% (all fees go to apps and community)')

  // 6. Transfer ownership to DAO governance
  console.log('\n6. Transferring ownership to DAO governance...')

  if (config.daoGovernanceAddress !== zeroAddress) {
    // Transfer FeeConfig ownership
    await walletClient.writeContract({
      account,
      address: config.feeConfigAddress,
      abi: FeeConfigABI,
      functionName: 'transferOwnership',
      args: [config.daoGovernanceAddress],
    })
    console.log(
      `   FeeConfig ownership transferred to: ${config.daoGovernanceAddress}`,
    )

    // Transfer AppFeeRegistry ownership
    await walletClient.writeContract({
      account,
      address: appFeeRegistryAddress,
      abi: AppFeeRegistryABI,
      functionName: 'transferOwnership',
      args: [config.daoGovernanceAddress],
    })
    console.log(
      `   AppFeeRegistry ownership transferred to: ${config.daoGovernanceAddress}`,
    )
  } else {
    console.log(
      '   Skipping ownership transfer (no governance address provided)',
    )
  }

  console.log('\nDeployment complete.')
  console.log('\nFee Flow Summary:')
  console.log('1. User transacts through app')
  console.log('2. Paymaster collects fees in tokens')
  console.log('3. FeeDistributor splits fees:')
  console.log('   - 45% to app that generated transaction')
  console.log('   - 45% to LP stakers (ETH + token providers)')
  console.log('   - 10% to contributor/dependency pool')
  console.log('   - 0% to network (Jeju gets nothing)')
  console.log('4. Apps claim accumulated fees via FeeDistributor')
  console.log('5. LPs earn proportional to their stake')

  return {
    appFeeRegistry: appFeeRegistryAddress,
  }
}

// Minimal ABIs for deployment
const AppFeeRegistryABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_daoRegistry', type: 'address' },
      { name: '_identityRegistry', type: 'address' },
      { name: '_owner', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'setFeeDistributor',
    inputs: [{ name: '_feeDistributor', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const FeeDistributorABI = [
  {
    type: 'function',
    name: 'setAppFeeRegistry',
    inputs: [{ name: '_appFeeRegistry', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const FeeConfigABI = [
  {
    type: 'function',
    name: 'setBoard',
    inputs: [{ name: 'newBoard', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setDirector',
    inputs: [{ name: 'newDirector', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDistributionFees',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'appShareBps', type: 'uint16' },
          { name: 'lpShareBps', type: 'uint16' },
          { name: 'contributorShareBps', type: 'uint16' },
          { name: 'ethLpShareBps', type: 'uint16' },
          { name: 'tokenLpShareBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

async function getAppFeeRegistryBytecode(): Promise<Hex> {
  // In production, this would read from the compiled contract
  // For now, we throw an error requiring the bytecode to be provided
  throw new Error(
    'AppFeeRegistry bytecode not available. Build contracts first with: bun run build:contracts',
  )
}

/**
 * Verify fee configuration is correct
 */
export async function verifyFeeConfiguration(
  publicClient: PublicClient,
  feeConfigAddress: Address,
): Promise<boolean> {
  const fees = await publicClient.readContract({
    address: feeConfigAddress,
    abi: FeeConfigABI,
    functionName: 'getDistributionFees',
  })

  const total =
    Number(fees.appShareBps) +
    Number(fees.lpShareBps) +
    Number(fees.contributorShareBps)

  if (total !== 10000) {
    console.error(`Fee total is ${total / 100}%, expected 100%`)
    return false
  }

  // Verify expected splits
  if (Number(fees.appShareBps) !== 4500) {
    console.warn(
      `App share is ${Number(fees.appShareBps) / 100}%, expected 45%`,
    )
  }
  if (Number(fees.lpShareBps) !== 4500) {
    console.warn(`LP share is ${Number(fees.lpShareBps) / 100}%, expected 45%`)
  }
  if (Number(fees.contributorShareBps) !== 1000) {
    console.warn(
      `Contributor share is ${Number(fees.contributorShareBps) / 100}%, expected 10%`,
    )
  }

  console.log('Fee configuration verified:')
  console.log(`- App: ${Number(fees.appShareBps) / 100}%`)
  console.log(`- LP: ${Number(fees.lpShareBps) / 100}%`)
  console.log(`- Contributors: ${Number(fees.contributorShareBps) / 100}%`)
  console.log('- Network: 0%')

  return true
}
