/**
 * Contract Deployer - Loads Foundry artifacts and deploys contracts
 * Supports both standard deployment and CREATE2 deterministic deployment
 */

import {
  type Address,
  encodeDeployData,
  getContractAddress,
  type Hex,
  keccak256,
  type PublicClient,
  type WalletClient,
} from 'viem'

export type ContractName =
  | 'Token'
  | 'TokenVesting'
  | 'FeeDistributor'
  | 'Presale'
  | 'CCALauncher'
  | 'Airdrop'
  | 'WarpRoute'
  // Hyperlane infrastructure
  | 'Mailbox'
  | 'InterchainGasPaymaster'
  | 'MultisigISM'

interface FoundryArtifact {
  abi: readonly object[]
  bytecode: {
    object: Hex
    linkReferences: Record<
      string,
      Record<string, { start: number; length: number }[]>
    >
  }
  deployedBytecode: {
    object: Hex
  }
}

// CREATE2 Factory (Deterministic Deployment Proxy - same address on all chains)
// https://github.com/Arachnid/deterministic-deployment-proxy
const CREATE2_FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address

// Cache for loaded artifacts
const artifactCache = new Map<ContractName, FoundryArtifact>()

// Hyperlane contracts are in a subdirectory
const HYPERLANE_CONTRACTS = ['Mailbox', 'InterchainGasPaymaster', 'MultisigISM']

/**
 * Load a Foundry artifact from the contracts/out directory
 */
export async function loadArtifact(
  contractName: ContractName,
): Promise<FoundryArtifact> {
  const cached = artifactCache.get(contractName)
  if (cached) return cached

  // Hyperlane contracts are in hyperlane/ subdirectory
  const subdir = HYPERLANE_CONTRACTS.includes(contractName) ? 'hyperlane/' : ''
  const artifactPath = new URL(
    `../../contracts/out/${subdir}${contractName}.sol/${contractName}.json`,
    import.meta.url,
  )

  const file = Bun.file(artifactPath.pathname)
  const exists = await file.exists()

  if (!exists) {
    throw new Error(
      `Artifact not found: ${artifactPath.pathname}\n` +
        `Run 'forge build --root contracts' first`,
    )
  }

  const artifact = (await file.json()) as FoundryArtifact

  if (!artifact.bytecode?.object) {
    throw new Error(`Invalid artifact: ${contractName} has no bytecode`)
  }

  artifactCache.set(contractName, artifact)
  return artifact
}

/**
 * Compute CREATE2 address for deterministic deployment
 */
export function computeCreate2Address(
  salt: Hex,
  initCodeHash: Hex,
  deployer: Address = CREATE2_FACTORY,
): Address {
  const hash = keccak256(
    `0xff${deployer.slice(2)}${salt.slice(2)}${initCodeHash.slice(2)}` as Hex,
  )
  return `0x${hash.slice(-40)}` as Address
}

/**
 * Deploy a contract using standard deployment
 */
export async function deployContract(
  publicClient: PublicClient,
  walletClient: WalletClient,
  contractName: ContractName,
  constructorArgs: readonly unknown[],
): Promise<{ address: Address; txHash: Hex }> {
  const artifact = await loadArtifact(contractName)

  const account = walletClient.account
  if (!account) {
    throw new Error('WalletClient must have an account')
  }

  // Constructor args typed as unknown[] because each contract has different args
  // Type safety is enforced by the ABI during encoding
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [...constructorArgs],
  })

  // Get the nonce for address prediction
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  })

  // Deploy the contract
  const txHash = await walletClient.sendTransaction({
    data: deployData,
    chain: null,
    account,
  })

  // Wait for confirmation with timeout
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 120_000, // 2 minutes for testnet
  })

  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${contractName} (tx: ${txHash})`)
  }

  // Get address from receipt or compute it
  let address: Address
  if (receipt.contractAddress) {
    address = receipt.contractAddress
  } else {
    address = getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    })
  }

  // Wait a bit for the node to sync the new contract
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Verify the contract was deployed (retry up to 3 times)
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await publicClient.getCode({ address })
    if (code && code !== '0x') {
      return { address, txHash }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  throw new Error(
    `Contract not found at expected address: ${address} (tx: ${txHash})`,
  )
}

/**
 * Deploy a contract using CREATE2 for deterministic addresses
 */
export async function deployContractCreate2(
  publicClient: PublicClient,
  walletClient: WalletClient,
  contractName: ContractName,
  constructorArgs: readonly unknown[],
  salt: Hex,
): Promise<{ address: Address; txHash: Hex }> {
  const artifact = await loadArtifact(contractName)

  const account = walletClient.account
  if (!account) {
    throw new Error('WalletClient must have an account')
  }

  // Encode the deployment data (bytecode + constructor args)
  // Constructor args typed as unknown[] because each contract has different args
  // Type safety is enforced by the ABI during encoding
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [...constructorArgs],
  })

  // Compute the init code hash
  const initCodeHash = keccak256(initCode)

  // Compute the expected address
  const expectedAddress = computeCreate2Address(salt, initCodeHash)

  // Check if already deployed
  const existingCode = await publicClient.getCode({ address: expectedAddress })
  if (existingCode && existingCode !== '0x') {
    console.log(
      `Contract ${contractName} already deployed at ${expectedAddress}`,
    )
    return { address: expectedAddress, txHash: '0x' as Hex }
  }

  // Deploy via CREATE2 factory
  // The factory expects: salt (32 bytes) + initCode
  const deployData = `${salt}${initCode.slice(2)}` as Hex

  const txHash = await walletClient.sendTransaction({
    to: CREATE2_FACTORY,
    data: deployData,
    chain: null,
    account,
  })

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  })

  if (receipt.status !== 'success') {
    throw new Error(
      `CREATE2 deployment failed: ${contractName} (tx: ${txHash})`,
    )
  }

  // Verify the contract was deployed at the expected address
  const code = await publicClient.getCode({ address: expectedAddress })
  if (!code || code === '0x') {
    throw new Error(
      `Contract not deployed at expected CREATE2 address: ${expectedAddress}`,
    )
  }

  return { address: expectedAddress, txHash }
}

/**
 * Preload all artifacts (useful for startup validation)
 */
export async function preloadAllArtifacts(): Promise<void> {
  const contracts: ContractName[] = [
    'Token',
    'TokenVesting',
    'FeeDistributor',
    'Presale',
    'CCALauncher',
    'Airdrop',
    'WarpRoute',
    // Hyperlane infrastructure (optional - may not be built yet)
    'Mailbox',
    'InterchainGasPaymaster',
    'MultisigISM',
  ]

  // Load core contracts, skip Hyperlane if not built yet
  const results = await Promise.allSettled(contracts.map(loadArtifact))
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? contracts[i] : null))
    .filter((c): c is ContractName => c !== null)

  if (
    failed.length > 0 &&
    !failed.every((c) => HYPERLANE_CONTRACTS.includes(c))
  ) {
    throw new Error(`Failed to load artifacts: ${failed.join(', ')}`)
  }
}
