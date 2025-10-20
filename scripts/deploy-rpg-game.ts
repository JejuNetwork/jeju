/**
 * Deploy and register an RPG game to Jeju
 * 
 * This script:
 * 1. Deploys MUD World for the game
 * 2. Deploys RPGGold token
 * 3. Deploys RPGItems NFT
 * 4. Deploys RPGEscrow
 * 5. Registers game to IdentityRegistry with tags: ["games", "rpg"]
 * 6. Saves deployment addresses
 * 
 * Usage:
 *   bun run scripts/deploy-rpg-game.ts --game=hyperscape --network=localnet
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'DEPLOY-RPG' });

interface GameConfig {
  gameId: string;
  name: string;
  displayName: string;
  description: string;
  mudNamespace: string;
  tokens: {
    gold: { name: string; symbol: string; maxSupply: string };
    items: { name: string; symbol: string };
  };
  registration: {
    identityRegistry: string;
    tags: string[];
    metadataURI: string;
  };
  gameServer: {
    url: string;
    wsUrl: string;
  };
}

interface DeployedContracts {
  gameId: string;
  network: string;
  chainId: number;
  deployedAt: string;
  mudWorld: string;
  goldToken: string;
  itemsToken: string;
  escrow: string;
  registeredToRegistry: boolean;
}

async function loadGameConfig(gameName: string): Promise<GameConfig> {
  const configPath = join(
    process.cwd(),
    'contracts/src/games/rpg/instances',
    gameName,
    'game-config.json'
  );
  
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  return config;
}

async function deployRPGGame(
  gameName: string,
  network: 'localnet' | 'testnet' | 'mainnet'
): Promise<void> {
  logger.info(`Deploying RPG game: ${gameName} to ${network}`);
  
  // Load game configuration
  const config = await loadGameConfig(gameName);
  logger.info(`Loaded config for: ${config.displayName}`);
  
  // Connect to network
  const rpcUrl = getRPCUrl(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(getDeployerKey(network), provider);
  
  logger.info(`Deploying from: ${wallet.address}`);
  
  // Calculate gameId
  const gameId = ethers.keccak256(ethers.toUtf8Bytes(config.gameId));
  logger.info(`Game ID: ${gameId}`);
  
  // Step 1: Deploy MUD World
  logger.info('Step 1: Deploying MUD World...');
  const mudWorld = await deployMUDWorld(config.mudNamespace, wallet);
  logger.success(`MUD World deployed: ${mudWorld}`);
  
  // Step 2: Deploy RPGGold
  logger.info('Step 2: Deploying RPGGold...');
  const goldToken = await deployRPGGold(
    gameId,
    config.tokens.gold.name,
    config.tokens.gold.symbol,
    wallet.address,
    wallet.address, // Initial signer (update later)
    config.registration.identityRegistry,
    wallet
  );
  logger.success(`RPGGold deployed: ${goldToken}`);
  
  // Step 3: Deploy RPGItems
  logger.info('Step 3: Deploying RPGItems...');
  const itemsToken = await deployRPGItems(
    gameId,
    config.tokens.items.name,
    config.tokens.items.symbol,
    wallet.address,
    wallet.address, // Initial signer
    config.registration.identityRegistry,
    wallet
  );
  logger.success(`RPGItems deployed: ${itemsToken}`);
  
  // Step 4: Deploy RPGEscrow
  logger.info('Step 4: Deploying RPGEscrow...');
  const escrow = await deployRPGEscrow(
    gameId,
    wallet.address,
    config.registration.identityRegistry,
    wallet
  );
  logger.success(`RPGEscrow deployed: ${escrow}`);
  
  // Step 5: Approve game contracts in escrow
  logger.info('Step 5: Approving contracts in escrow...');
  await approveContractsInEscrow(escrow, goldToken, itemsToken, wallet);
  logger.success('Contracts approved');
  
  // Step 6: Register to IdentityRegistry
  logger.info('Step 6: Registering to IdentityRegistry...');
  const registered = await registerToIdentityRegistry(
    config,
    mudWorld,
    goldToken,
    itemsToken,
    escrow,
    wallet
  );
  logger.success(`Registered to IdentityRegistry: ${registered}`);
  
  // Step 7: Save deployment
  const deployment: DeployedContracts = {
    gameId: config.gameId,
    network,
    chainId: Number((await provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    mudWorld,
    goldToken,
    itemsToken,
    escrow,
    registeredToRegistry: registered,
  };
  
  const deploymentPath = join(
    process.cwd(),
    'contracts/src/games/rpg/instances',
    gameName,
    `deployed-${network}.json`
  );
  
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  logger.success(`Deployment saved: ${deploymentPath}`);
  
  // Summary
  logger.separator();
  logger.box(
    `✅ ${config.displayName} DEPLOYED!\n\n` +
    `MUD World: ${mudWorld}\n` +
    `Gold Token: ${goldToken}\n` +
    `Items NFT: ${itemsToken}\n` +
    `Escrow: ${escrow}\n\n` +
    `Registered with tags: ${config.registration.tags.join(', ')}`
  );
}

async function deployMUDWorld(_namespace: string, wallet: ethers.Wallet): Promise<string> {
  // MUD deployment happens via CLI: mud deploy
  // This is a placeholder - actual deployment uses MUD tooling
  logger.warn('MUD World deployment requires: cd to game dir and run "mud deploy"');
  logger.info(`Navigate to: contracts/src/games/rpg/instances/<game>/`);
  logger.info(`Run: mud deploy --rpc ${wallet.provider}`);
  
  // For now, return placeholder
  return 'TBD_MUD_WORLD_ADDRESS';
}

async function deployRPGGold(
  gameId: string,
  name: string,
  symbol: string,
  owner: string,
  signer: string,
  registryAddress: string,
  wallet: ethers.Wallet
): Promise<string> {
  const factory = new ethers.ContractFactory(
    RPGGoldABI,
    RPGGoldBytecode,
    wallet
  );
  
  const contract = await factory.deploy(
    gameId,
    name,
    symbol,
    owner,
    signer,
    registryAddress
  );
  
  await contract.waitForDeployment();
  return await contract.getAddress();
}

async function deployRPGItems(
  gameId: string,
  name: string,
  symbol: string,
  owner: string,
  signer: string,
  registryAddress: string,
  wallet: ethers.Wallet
): Promise<string> {
  const factory = new ethers.ContractFactory(
    RPGItemsABI,
    RPGItemsBytecode,
    wallet
  );
  
  const contract = await factory.deploy(
    gameId,
    name,
    symbol,
    owner,
    signer,
    registryAddress
  );
  
  await contract.waitForDeployment();
  return await contract.getAddress();
}

async function deployRPGEscrow(
  gameId: string,
  owner: string,
  registryAddress: string,
  wallet: ethers.Wallet
): Promise<string> {
  const factory = new ethers.ContractFactory(
    RPGEscrowABI,
    RPGEscrowBytecode,
    wallet
  );
  
  const contract = await factory.deploy(gameId, owner, registryAddress);
  await contract.waitForDeployment();
  return await contract.getAddress();
}

async function approveContractsInEscrow(
  escrowAddress: string,
  goldToken: string,
  itemsToken: string,
  wallet: ethers.Wallet
): Promise<void> {
  const escrow = new ethers.Contract(escrowAddress, RPGEscrowABI, wallet);
  
  await escrow.setApprovedContract(goldToken, true);
  await escrow.setApprovedContract(itemsToken, true);
}

async function registerToIdentityRegistry(
  config: GameConfig,
  mudWorld: string,
  goldToken: string,
  itemsToken: string,
  escrow: string,
  wallet: ethers.Wallet
): Promise<boolean> {
  const registryAddress = config.registration.identityRegistry;
  
  if (!registryAddress || registryAddress.startsWith('TBD')) {
    logger.warn('Identity Registry not configured, skipping registration');
    return false;
  }
  
  const registry = new ethers.Contract(registryAddress, IdentityRegistryABI, wallet);
  
  // Create metadata JSON
  const metadata = {
    name: config.displayName,
    description: config.description,
    gameType: 'rpg',
    version: config.version,
    contracts: {
      mudWorld,
      goldToken,
      itemsToken,
      escrow,
    },
    gameServer: config.gameServer,
    standard: 'RPG-v1.0.0',
  };
  
  const metadataURI = config.registration.metadataURI || `data:application/json,${JSON.stringify(metadata)}`;
  
  // Register game (MUD World address as the entity)
  const tx = await registry.register(
    mudWorld,
    config.displayName,
    config.registration.tags,
    metadataURI
  );
  
  await tx.wait();
  logger.success('Registered to IdentityRegistry');
  
  return true;
}

function getRPCUrl(network: string): string {
  const urls = {
    localnet: 'http://localhost:8545',
    testnet: process.env.TESTNET_RPC_URL || '',
    mainnet: process.env.MAINNET_RPC_URL || '',
  };
  return urls[network as keyof typeof urls];
}

function getDeployerKey(network: string): string {
  if (network === 'localnet') {
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  }
  return process.env.DEPLOYER_PRIVATE_KEY || '';
}

// Placeholder ABIs (load from artifacts in real implementation)
const RPGGoldABI: unknown[] = [];
const RPGGoldBytecode = '0x';
const RPGItemsABI: unknown[] = [];
const RPGItemsBytecode = '0x';
const RPGEscrowABI: unknown[] = [];
const RPGEscrowBytecode = '0x';
const IdentityRegistryABI: unknown[] = [];

// Main execution
const gameName = process.argv.find(arg => arg.startsWith('--game='))?.split('=')[1] || 'hyperscape';
const network = process.argv.find(arg => arg.startsWith('--network='))?.split('=')[1] || 'localnet';

deployRPGGame(gameName, network as 'localnet' | 'testnet' | 'mainnet')
  .then(() => {
    logger.success('Deployment complete!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Deployment failed:', error);
    process.exit(1);
  });


