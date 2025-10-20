#!/usr/bin/env bun
/**
 * Deploy Game Token System to Localnet
 * 
 * This script deploys the standardized game token contracts:
 * 1. Gold (ERC-20 in-game currency)
 * 2. Items (ERC-1155 stackable and unique items)
 * 3. GameItemRegistry (identity integration)
 * 4. PlayerTradeEscrow (P2P trading)
 * 
 * Usage:
 *   bun run scripts/deploy-game-tokens.ts
 *   bun run scripts/deploy-game-tokens.ts --network=testnet
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface DeploymentResult {
  network: string;
  chainId: string;
  rpcUrl: string;
  deployer: string;
  gameSigner: string;
  contracts: {
    gold: string;
    items: string;
    registry: string;
    escrow: string;
  };
  itemTypes: {
    arrows: string;
    sword: string;
  };
  deployedAt: string;
}

async function main() {
  console.log('🎮 Deploying Game Token System');
  console.log('='.repeat(70));
  console.log('');

  // Network configuration
  const network = process.argv.find(arg => arg.startsWith('--network='))?.split('=')[1] || 'localnet';
  const rpcUrl = network === 'localnet' 
    ? 'http://localhost:8545' 
    : process.env.TESTNET_RPC_URL || '';
  const chainId = network === 'localnet' ? '1337' : '84532'; // Base Sepolia

  // Keys
  const deployerKey = network === 'localnet'
    ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Anvil default
    : process.env.DEPLOYER_PRIVATE_KEY || '';

  const gameSignerKey = network === 'localnet'
    ? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' // Anvil key #1
    : process.env.GAME_SIGNER_PRIVATE_KEY || '';

  // Get addresses
  const deployerAddress = execSync(
    `cast wallet address ${deployerKey}`,
    { encoding: 'utf-8' }
  ).trim();

  const gameSignerAddress = execSync(
    `cast wallet address ${gameSignerKey}`,
    { encoding: 'utf-8' }
  ).trim();

  console.log('Network:', network);
  console.log('RPC URL:', rpcUrl);
  console.log('Chain ID:', chainId);
  console.log('Deployer:', deployerAddress);
  console.log('Game Signer:', gameSignerAddress);
  console.log('');

  // Check RPC connectivity
  try {
    const blockNumber = execSync(
      `cast block-number --rpc-url ${rpcUrl}`,
      { encoding: 'utf-8' }
    ).trim();
    console.log('✅ RPC accessible, current block:', blockNumber);
  } catch (error) {
    console.error('❌ Cannot connect to RPC');
    console.error('   For localnet: bun run scripts/localnet/start.ts');
    console.error('   Or: bun run dev');
    process.exit(1);
  }
  console.log('');

  const result: DeploymentResult = {
    network,
    chainId,
    rpcUrl,
    deployer: deployerAddress,
    gameSigner: gameSignerAddress,
    contracts: {} as any,
    itemTypes: {} as any,
    deployedAt: new Date().toISOString(),
  };

  // Compile contracts first
  console.log('🔨 Compiling Contracts');
  console.log('-'.repeat(70));
  execSync(
    `cd contracts && forge build src/games/Gold.sol src/games/Items.sol src/games/GameItemRegistry.sol src/games/PlayerTradeEscrow.sol`,
    { encoding: 'utf-8', stdio: 'inherit' }
  );
  console.log('✅ Contracts compiled');
  console.log('');

  // Step 1: Deploy Gold
  console.log('📝 STEP 1: Deploying Gold (ERC-20)');
  console.log('-'.repeat(70));
  
  const goldDeploy = execSync(
    `cd contracts && forge create src/games/Gold.sol:Gold \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --constructor-args ${gameSignerAddress} ${deployerAddress} \
      --broadcast \
      2>&1 | grep -A5 "Deployed to:"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  const goldMatch = goldDeploy.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!goldMatch) throw new Error('Failed to parse Gold deployment address');
  result.contracts.gold = goldMatch[1];
  console.log('✅ Gold deployed at:', result.contracts.gold);
  console.log('');

  // Step 2: Deploy Items
  console.log('📝 STEP 2: Deploying Items (ERC-1155)');
  console.log('-'.repeat(70));
  
  const itemsDeploy = execSync(
    `cd contracts && forge create src/games/Items.sol:Items \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --constructor-args ${gameSignerAddress} ${deployerAddress} \
      --broadcast \
      2>&1 | grep -A5 "Deployed to:"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  const itemsMatch = itemsDeploy.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!itemsMatch) throw new Error('Failed to parse Items deployment address');
  result.contracts.items = itemsMatch[1];
  console.log('✅ Items deployed at:', result.contracts.items);
  console.log('');

  // Step 3: Deploy GameItemRegistry
  console.log('📝 STEP 3: Deploying GameItemRegistry');
  console.log('-'.repeat(70));
  
  const registryDeploy = execSync(
    `cd contracts && forge create src/games/GameItemRegistry.sol:GameItemRegistry \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --constructor-args ${deployerAddress} \
      --broadcast \
      2>&1 | grep -A5 "Deployed to:"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  const registryMatch = registryDeploy.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!registryMatch) throw new Error('Failed to parse Registry deployment address');
  result.contracts.registry = registryMatch[1];
  console.log('✅ GameItemRegistry deployed at:', result.contracts.registry);
  console.log('');

  // Step 4: Deploy PlayerTradeEscrow
  console.log('📝 STEP 4: Deploying PlayerTradeEscrow');
  console.log('-'.repeat(70));
  
  const escrowDeploy = execSync(
    `cd contracts && forge create src/games/PlayerTradeEscrow.sol:PlayerTradeEscrow \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --constructor-args ${deployerAddress} \
      --broadcast \
      2>&1 | grep -A5 "Deployed to:"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  const escrowMatch = escrowDeploy.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!escrowMatch) throw new Error('Failed to parse Escrow deployment address');
  result.contracts.escrow = escrowMatch[1];
  console.log('✅ PlayerTradeEscrow deployed at:', result.contracts.escrow);
  console.log('');

  // Step 5: Configure Registry
  console.log('🔐 STEP 5: Configuring GameItemRegistry');
  console.log('-'.repeat(70));
  
  execSync(
    `cast send ${result.contracts.registry} \
      "setContractAuthorization(address,bool)" \
      ${result.contracts.gold} true \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey}`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Authorized Gold in Registry');

  execSync(
    `cast send ${result.contracts.registry} \
      "setContractAuthorization(address,bool)" \
      ${result.contracts.items} true \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey}`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Authorized Items in Registry');
  console.log('');

  // Step 6: Configure Escrow
  console.log('🔐 STEP 6: Configuring PlayerTradeEscrow');
  console.log('-'.repeat(70));
  
  // Approve Gold (TokenType.ERC20 = 0)
  execSync(
    `cast send ${result.contracts.escrow} \
      "setContractApproval(address,uint8,bool)" \
      ${result.contracts.gold} 0 true \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey}`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Approved Gold (ERC-20) in Escrow');

  // Approve Items (TokenType.ERC1155 = 2)
  execSync(
    `cast send ${result.contracts.escrow} \
      "setContractApproval(address,uint8,bool)" \
      ${result.contracts.items} 2 true \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey}`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Approved Items (ERC-1155) in Escrow');
  console.log('');

  // Step 7: Create Item Types
  console.log('🎨 STEP 7: Creating Initial Item Types');
  console.log('-'.repeat(70));
  
  // Create Bronze Arrows (stackable)
  const arrowsTx = execSync(
    `cast send ${result.contracts.items} \
      "createItemType(string,bool,int16,int16,int16,uint8)" \
      "Bronze Arrows" true 5 0 0 0 \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --json`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Created item type: Bronze Arrows (stackable)');
  result.itemTypes.arrows = '1'; // First item ID

  // Create Legendary Sword (non-stackable)
  const swordTx = execSync(
    `cast send ${result.contracts.items} \
      "createItemType(string,bool,int16,int16,int16,uint8)" \
      "Legendary Sword" false 50 0 10 4 \
      --rpc-url ${rpcUrl} \
      --private-key ${deployerKey} \
      --json`,
    { encoding: 'utf-8' }
  );
  console.log('✅ Created item type: Legendary Sword (unique)');
  result.itemTypes.sword = '2'; // Second item ID
  console.log('');

  // Save deployment
  const deploymentPath = join(
    process.cwd(),
    `contracts/deployments/game-tokens-${network}.json`
  );
  
  writeFileSync(deploymentPath, JSON.stringify(result, null, 2));
  console.log('💾 Deployment saved to:', deploymentPath);
  console.log('');

  // Summary
  console.log('='.repeat(70));
  console.log('✅ GAME TOKEN SYSTEM DEPLOYED!');
  console.log('='.repeat(70));
  console.log('');
  console.log('📦 Contracts:');
  console.log('   Gold (ERC-20):', result.contracts.gold);
  console.log('   Items (ERC-1155):', result.contracts.items);
  console.log('   GameItemRegistry:', result.contracts.registry);
  console.log('   PlayerTradeEscrow:', result.contracts.escrow);
  console.log('');
  console.log('🎨 Item Types:');
  console.log('   Bronze Arrows (stackable):', result.itemTypes.arrows);
  console.log('   Legendary Sword (unique):', result.itemTypes.sword);
  console.log('');
  console.log('🔑 Signers:');
  console.log('   Deployer:', result.deployer);
  console.log('   Game Signer:', result.gameSigner);
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Integrate with game server');
  console.log('  2. Generate signatures for gold claims');
  console.log('  3. Generate signatures for item mints');
  console.log('  4. Test P2P trading');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  });

