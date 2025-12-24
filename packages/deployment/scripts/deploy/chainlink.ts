/**
 * Deploy Chainlink contracts for Jeju L2
 * Usage: bun run scripts/deploy/chainlink.ts --network [mainnet|testnet|localnet]
 */

import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'

// Forge artifacts contain abi and bytecode
interface ForgeArtifact {
  abi: readonly Record<string, unknown>[]
  bytecode: { object: string }
}

const CONTRACTS_OUT = join(import.meta.dir, '../../../contracts/out')

async function loadArtifact(
  contractDir: string,
  contractName: string,
): Promise<ForgeArtifact> {
  const path = join(CONTRACTS_OUT, contractDir, `${contractName}.json`)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(
      `Contract artifact not found: ${path}. Run 'forge build' in packages/contracts.`,
    )
  }
  return file.json() as Promise<ForgeArtifact>
}

// LINK token addresses per network (mainnet uses official LINK, others use mock)
const CHAINS = {
  mainnet: { chain: base, linkToken: '0x0' as Address }, // Set via LINK_TOKEN_ADDRESS env after bridging
  testnet: { chain: baseSepolia, linkToken: '0x0' as Address }, // Use testnet LINK or deploy mock
  localnet: { chain: foundry, linkToken: '0x0' as Address }, // Deploy mock LINK via bootstrap script
} as const

type Network = keyof typeof CHAINS

async function deploy(network: Network) {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set')

  const { chain, linkToken } = CHAINS[network]
  const rpcUrl =
    process.env[`${network.toUpperCase()}_RPC_URL`] ?? 'http://localhost:6546'
  const autocrat = (process.env.AUTOCRAT_ADDRESS ?? '0x0') as Address
  const treasury = (process.env.TREASURY_ADDRESS ?? '0x0') as Address

  // Load forge artifacts
  console.log('Loading contract artifacts...')
  const [vrfArtifact, autoArtifact, oracleArtifact, govArtifact] =
    await Promise.all([
      loadArtifact('VRFCoordinatorV2_5.sol', 'VRFCoordinatorV2_5'),
      loadArtifact('AutomationRegistry.sol', 'AutomationRegistry'),
      loadArtifact('OracleRouter.sol', 'OracleRouter'),
      loadArtifact('ChainlinkGovernance.sol', 'ChainlinkGovernance'),
    ])

  const account = privateKeyToAccount(deployerKey)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  console.log(`\nDeploying to ${network}`)
  console.log(`Deployer: ${account.address}`)
  console.log(
    `Balance: ${formatEther(await publicClient.getBalance({ address: account.address }))} ETH\n`,
  )

  // Deploy VRF
  console.log('Deploying VRFCoordinatorV2_5...')
  const vrfHash = await walletClient.deployContract({
    abi: vrfArtifact.abi,
    bytecode: `0x${vrfArtifact.bytecode.object}` as Hex,
    args: [linkToken, '0x0', autocrat],
  })
  const vrfReceipt = await publicClient.waitForTransactionReceipt({
    hash: vrfHash,
  })
  const vrfCoordinator = vrfReceipt.contractAddress as Address
  console.log(`  ${vrfCoordinator} (gas: ${vrfReceipt.gasUsed})`)

  // Deploy Automation
  console.log('Deploying AutomationRegistry...')
  const autoHash = await walletClient.deployContract({
    abi: autoArtifact.abi,
    bytecode: `0x${autoArtifact.bytecode.object}` as Hex,
    args: [autocrat],
  })
  const autoReceipt = await publicClient.waitForTransactionReceipt({
    hash: autoHash,
  })
  const automationRegistry = autoReceipt.contractAddress as Address
  console.log(`  ${automationRegistry} (gas: ${autoReceipt.gasUsed})`)

  // Deploy Oracle Router
  console.log('Deploying OracleRouter...')
  const oracleHash = await walletClient.deployContract({
    abi: oracleArtifact.abi,
    bytecode: `0x${oracleArtifact.bytecode.object}` as Hex,
    args: [autocrat],
  })
  const oracleReceipt = await publicClient.waitForTransactionReceipt({
    hash: oracleHash,
  })
  const oracleRouter = oracleReceipt.contractAddress as Address
  console.log(`  ${oracleRouter} (gas: ${oracleReceipt.gasUsed})`)

  // Deploy Governance
  console.log('Deploying ChainlinkGovernance...')
  const govHash = await walletClient.deployContract({
    abi: govArtifact.abi,
    bytecode: `0x${govArtifact.bytecode.object}` as Hex,
    args: [autocrat, vrfCoordinator, automationRegistry, oracleRouter],
  })
  const govReceipt = await publicClient.waitForTransactionReceipt({
    hash: govHash,
  })
  const governance = govReceipt.contractAddress as Address
  console.log(`  ${governance} (gas: ${govReceipt.gasUsed})`)

  // Configure
  console.log('\nConfiguring...')
  await walletClient.writeContract({
    address: vrfCoordinator,
    abi: vrfArtifact.abi,
    functionName: 'setGovernance',
    args: [governance],
  })
  await walletClient.writeContract({
    address: automationRegistry,
    abi: autoArtifact.abi,
    functionName: 'setGovernance',
    args: [governance],
  })
  await walletClient.writeContract({
    address: oracleRouter,
    abi: oracleArtifact.abi,
    functionName: 'setGovernance',
    args: [governance],
  })
  await walletClient.writeContract({
    address: vrfCoordinator,
    abi: vrfArtifact.abi,
    functionName: 'setFeeRecipient',
    args: [treasury],
  })
  await walletClient.writeContract({
    address: automationRegistry,
    abi: autoArtifact.abi,
    functionName: 'setFeeRecipient',
    args: [treasury],
  })
  await walletClient.writeContract({
    address: oracleRouter,
    abi: oracleArtifact.abi,
    functionName: 'setFeeRecipient',
    args: [treasury],
  })

  const result = {
    vrfCoordinator,
    automationRegistry,
    oracleRouter,
    governance,
    network,
    deployedAt: new Date().toISOString(),
  }
  const outputPath = `packages/contracts/deployments/chainlink-${network}.json`
  await Bun.write(outputPath, JSON.stringify(result, null, 2))

  console.log('\nDeployment complete:')
  console.log(JSON.stringify(result, null, 2))
  console.log(`\nSaved to ${outputPath}`)
}

const args = parseArgs({
  options: { network: { type: 'string', default: 'localnet' } },
})
deploy(args.values.network as Network).catch(console.error)
