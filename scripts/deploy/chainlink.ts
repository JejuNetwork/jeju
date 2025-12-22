/**
 * Deploy Chainlink contracts for Jeju L2
 * Usage: bun run scripts/deploy/chainlink.ts --network [mainnet|testnet|localnet]
 */

import { createPublicClient, createWalletClient, http, type Address, type Hex, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import { parseArgs } from 'util';

import VRFCoordinatorABI from '../../packages/contracts/abis/VRFCoordinatorV2_5.json';
import AutomationRegistryABI from '../../packages/contracts/abis/AutomationRegistry.json';
import OracleRouterABI from '../../packages/contracts/abis/OracleRouter.json';
import ChainlinkGovernanceABI from '../../packages/contracts/abis/ChainlinkGovernance.json';

const CHAINS = {
  mainnet: { chain: base, linkToken: '0x0' as Address }, // TODO: Deploy LINK bridge
  testnet: { chain: baseSepolia, linkToken: '0x0' as Address },
  localnet: { chain: foundry, linkToken: '0x0' as Address },
} as const;

type Network = keyof typeof CHAINS;

async function deploy(network: Network) {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');

  const { chain, linkToken } = CHAINS[network];
  const rpcUrl = process.env[`${network.toUpperCase()}_RPC_URL`] ?? 'http://localhost:9545';
  const autocrat = (process.env.AUTOCRAT_ADDRESS ?? '0x0') as Address;
  const treasury = (process.env.TREASURY_ADDRESS ?? '0x0') as Address;

  const account = privateKeyToAccount(deployerKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  console.log(`\nDeploying to ${network}`);
  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${formatEther(await publicClient.getBalance({ address: account.address }))} ETH\n`);

  // Deploy VRF
  console.log('Deploying VRFCoordinatorV2_5...');
  const vrfHash = await walletClient.deployContract({
    abi: VRFCoordinatorABI.abi,
    bytecode: VRFCoordinatorABI.bytecode as Hex,
    args: [linkToken, '0x0', autocrat],
  });
  const vrfReceipt = await publicClient.waitForTransactionReceipt({ hash: vrfHash });
  const vrfCoordinator = vrfReceipt.contractAddress as Address;
  console.log(`  ${vrfCoordinator} (gas: ${vrfReceipt.gasUsed})`);

  // Deploy Automation
  console.log('Deploying AutomationRegistry...');
  const autoHash = await walletClient.deployContract({
    abi: AutomationRegistryABI.abi,
    bytecode: AutomationRegistryABI.bytecode as Hex,
    args: [autocrat],
  });
  const autoReceipt = await publicClient.waitForTransactionReceipt({ hash: autoHash });
  const automationRegistry = autoReceipt.contractAddress as Address;
  console.log(`  ${automationRegistry} (gas: ${autoReceipt.gasUsed})`);

  // Deploy Oracle Router
  console.log('Deploying OracleRouter...');
  const oracleHash = await walletClient.deployContract({
    abi: OracleRouterABI.abi,
    bytecode: OracleRouterABI.bytecode as Hex,
    args: [autocrat],
  });
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash });
  const oracleRouter = oracleReceipt.contractAddress as Address;
  console.log(`  ${oracleRouter} (gas: ${oracleReceipt.gasUsed})`);

  // Deploy Governance
  console.log('Deploying ChainlinkGovernance...');
  const govHash = await walletClient.deployContract({
    abi: ChainlinkGovernanceABI.abi,
    bytecode: ChainlinkGovernanceABI.bytecode as Hex,
    args: [autocrat, vrfCoordinator, automationRegistry, oracleRouter],
  });
  const govReceipt = await publicClient.waitForTransactionReceipt({ hash: govHash });
  const governance = govReceipt.contractAddress as Address;
  console.log(`  ${governance} (gas: ${govReceipt.gasUsed})`);

  // Configure
  console.log('\nConfiguring...');
  await walletClient.writeContract({ address: vrfCoordinator, abi: VRFCoordinatorABI.abi, functionName: 'setGovernance', args: [governance] });
  await walletClient.writeContract({ address: automationRegistry, abi: AutomationRegistryABI.abi, functionName: 'setGovernance', args: [governance] });
  await walletClient.writeContract({ address: oracleRouter, abi: OracleRouterABI.abi, functionName: 'setGovernance', args: [governance] });
  await walletClient.writeContract({ address: vrfCoordinator, abi: VRFCoordinatorABI.abi, functionName: 'setFeeRecipient', args: [treasury] });
  await walletClient.writeContract({ address: automationRegistry, abi: AutomationRegistryABI.abi, functionName: 'setFeeRecipient', args: [treasury] });
  await walletClient.writeContract({ address: oracleRouter, abi: OracleRouterABI.abi, functionName: 'setFeeRecipient', args: [treasury] });

  const result = { vrfCoordinator, automationRegistry, oracleRouter, governance, network, deployedAt: new Date().toISOString() };
  const outputPath = `packages/contracts/deployments/chainlink-${network}.json`;
  await Bun.write(outputPath, JSON.stringify(result, null, 2));

  console.log('\nDeployment complete:');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}

const args = parseArgs({ options: { network: { type: 'string', default: 'localnet' } } });
deploy(args.values.network as Network).catch(console.error);
