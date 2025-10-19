/**
 * Deploy Canonical RPG Contracts
 * 
 * Deploys the shared RPG infrastructure contracts that ALL RPG games use:
 * - RPGGold: Canonical gold token contract
 * - RPGItems: Canonical items NFT contract
 * - RPGEscrow: Canonical trading escrow
 * - RPGCrossGameEscrow: Cross-game trading support
 * 
 * These are deployed ONCE per network and shared by all RPG games.
 * 
 * Usage:
 *   bun run scripts/deploy-rpg-canonical.ts --network=localnet
 *   bun run scripts/deploy-rpg-canonical.ts --network=testnet
 *   bun run scripts/deploy-rpg-canonical.ts --network=mainnet
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'RPG-DEPLOY' });

interface DeploymentAddresses {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  rpgGold: string;
  rpgItems: string;
  rpgEscrow: string;
  rpgCrossGameEscrow: string;
  identityRegistry: string;
}

async function deployCanonicalRPGContracts(network: 'localnet' | 'testnet' | 'mainnet'): Promise<void> {
  logger.box(`🎮 Deploying Canonical RPG Contracts\n   Network: ${network}`);
  
  // Setup provider and wallet
  const rpcUrl = getRPCUrl(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(getDeployerKey(network), provider);
  const chainId = (await provider.getNetwork()).chainId;
  
  logger.info(`Deploying from: ${wallet.address}`);
  logger.info(`Chain ID: ${chainId}`);
  
  // Get IdentityRegistry address (must be deployed first)
  const identityRegistry = await getIdentityRegistryAddress(network);
  logger.info(`IdentityRegistry: ${identityRegistry}`);
  
  // Deploy RPGGold
  logger.separator();
  logger.info('1️⃣  Deploying RPGGold (Canonical)...');
  const rpgGold = await deployRPGGold(wallet.address, identityRegistry, wallet);
  logger.success(`   ✅ RPGGold: ${rpgGold}`);
  
  // Deploy RPGItems
  logger.info('2️⃣  Deploying RPGItems (Canonical)...');
  const rpgItems = await deployRPGItems(wallet.address, identityRegistry, wallet);
  logger.success(`   ✅ RPGItems: ${rpgItems}`);
  
  // Deploy RPGEscrow
  logger.info('3️⃣  Deploying RPGEscrow...');
  const rpgEscrow = await deployRPGEscrow(wallet.address, identityRegistry, wallet);
  logger.success(`   ✅ RPGEscrow: ${rpgEscrow}`);
  
  // Deploy RPGCrossGameEscrow
  logger.info('4️⃣  Deploying RPGCrossGameEscrow...');
  const rpgCrossGameEscrow = await deployRPGCrossGameEscrow(identityRegistry, wallet);
  logger.success(`   ✅ RPGCrossGameEscrow: ${rpgCrossGameEscrow}`);
  
  // Setup escrow contracts
  logger.separator();
  logger.info('5️⃣  Configuring escrow contracts...');
  await configureEscrows(rpgEscrow, rpgCrossGameEscrow, rpgGold, rpgItems, wallet);
  logger.success('   ✅ Escrows configured');
  
  // Save deployment
  const deployment: DeploymentAddresses = {
    network,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    rpgGold,
    rpgItems,
    rpgEscrow,
    rpgCrossGameEscrow,
    identityRegistry,
  };
  
  const deploymentPath = join(
    process.cwd(),
    'contracts/deployments',
    `rpg-canonical-${network}.json`
  );
  
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  logger.success(`Deployment saved: ${deploymentPath}`);
  
  // Update network config
  await updateNetworkConfig(network, deployment);
  
  // Summary
  logger.separator();
  logger.box(
    `✅ CANONICAL RPG CONTRACTS DEPLOYED!\n\n` +
    `Network: ${network}\n` +
    `Chain ID: ${chainId}\n\n` +
    `📦 Deployed Contracts:\n` +
    `   RPGGold: ${rpgGold}\n` +
    `   RPGItems: ${rpgItems}\n` +
    `   RPGEscrow: ${rpgEscrow}\n` +
    `   CrossGameEscrow: ${rpgCrossGameEscrow}\n\n` +
    `🎮 Any RPG game can now:\n` +
    `   1. Register to IdentityRegistry with tags: ["games", "rpg"]\n` +
    `   2. Call RPGGold.registerGame(gameId, signer)\n` +
    `   3. Call RPGItems.registerGame(gameId, signer)\n` +
    `   4. Players can claim gold and mint items!\n` +
    `   5. Auto-indexed by Bazaar for discovery`
  );
}

async function deployRPGGold(
  owner: string,
  identityRegistry: string,
  wallet: ethers.Wallet
): Promise<string> {
  // Load contract artifacts
  const artifactPath = join(process.cwd(), 'contracts/out/RPGGold.sol/RPGGold.json');
  
  if (!existsSync(artifactPath)) {
    logger.warn('RPGGold not compiled, compiling now...');
    await compileContracts();
  }
  
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  
  const contract = await factory.deploy(owner, identityRegistry);
  await contract.waitForDeployment();
  
  return await contract.getAddress();
}

async function deployRPGItems(
  owner: string,
  identityRegistry: string,
  wallet: ethers.Wallet
): Promise<string> {
  const artifactPath = join(process.cwd(), 'contracts/out/RPGItems.sol/RPGItems.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  
  const contract = await factory.deploy(owner, identityRegistry);
  await contract.waitForDeployment();
  
  return await contract.getAddress();
}

async function deployRPGEscrow(
  owner: string,
  identityRegistry: string,
  wallet: ethers.Wallet
): Promise<string> {
  const artifactPath = join(process.cwd(), 'contracts/out/RPGEscrow.sol/RPGEscrow.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  
  // gameId is 0x0 for canonical escrow (handles all games)
  const contract = await factory.deploy(ethers.ZeroHash, owner, identityRegistry);
  await contract.waitForDeployment();
  
  return await contract.getAddress();
}

async function deployRPGCrossGameEscrow(
  identityRegistry: string,
  wallet: ethers.Wallet
): Promise<string> {
  const artifactPath = join(process.cwd(), 'contracts/out/RPGCrossGameEscrow.sol/RPGCrossGameEscrow.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  
  const contract = await factory.deploy(identityRegistry);
  await contract.waitForDeployment();
  
  return await contract.getAddress();
}

async function configureEscrows(
  escrow: string,
  crossGameEscrow: string,
  goldToken: string,
  itemsToken: string,
  wallet: ethers.Wallet
): Promise<void> {
  // Approve canonical contracts in escrows
  const escrowContract = new ethers.Contract(
    escrow,
    ['function setApprovedContract(address,bool) external'],
    wallet
  );
  
  await escrowContract.setApprovedContract(goldToken, true);
  await escrowContract.setApprovedContract(itemsToken, true);
}

async function getIdentityRegistryAddress(network: string): Promise<string> {
  const deploymentPath = join(process.cwd(), 'contracts/deployments', `identity-registry-${network}.json`);
  
  if (!existsSync(deploymentPath)) {
    throw new Error(`IdentityRegistry not deployed on ${network}. Deploy it first.`);
  }
  
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  return deployment.registry || deployment.identityRegistry || deployment.address;
}

async function updateNetworkConfig(network: string, deployment: DeploymentAddresses): Promise<void> {
  const configPath = join(process.cwd(), 'config/localnet-config.json');
  
  if (!existsSync(configPath)) return;
  
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  if (!config.contracts) config.contracts = {};
  
  config.contracts.rpgGames = {
    rpgGold: deployment.rpgGold,
    rpgItems: deployment.rpgItems,
    rpgEscrow: deployment.rpgEscrow,
    rpgCrossGameEscrow: deployment.rpgCrossGameEscrow,
    note: "Canonical RPG contracts - shared by all RPG games",
  };
  
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  logger.info(`Updated ${configPath}`);
}

async function compileContracts(): Promise<void> {
  const { execSync } = await import('child_process');
  logger.info('Compiling contracts...');
  execSync('cd contracts && forge build', { stdio: 'inherit' });
}

function getRPCUrl(network: string): string {
  const urls = {
    localnet: process.env.LOCALNET_RPC_URL || 'http://localhost:9545',
    testnet: process.env.TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    mainnet: process.env.MAINNET_RPC_URL || 'https://rpc.jeju.network',
  };
  return urls[network as keyof typeof urls];
}

function getDeployerKey(network: string): string {
  if (network === 'localnet') {
    // Hardhat test account #0
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  }
  
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  return key;
}

// Main execution
const network = (process.argv.find(arg => arg.startsWith('--network='))?.split('=')[1] || 'localnet') as 'localnet' | 'testnet' | 'mainnet';

deployCanonicalRPGContracts(network)
  .then(() => {
    logger.success('✅ Deployment complete!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Deployment failed:', error);
    process.exit(1);
  });

