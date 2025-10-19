#!/usr/bin/env bun
/**
 * Setup Test Environment for eHorse
 * Deploys contracts, funds wallets, configures everything for E2E testing
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const RPC_URL = 'http://localhost:8545';
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Test wallets (Anvil defaults)
const TEST_WALLETS = [
  { name: 'Deployer', key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
  { name: 'Agent1', key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { name: 'Agent2', key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
  { name: 'Agent3', key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' }
];

function exec(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
}

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function step(num: number, title: string): void {
  console.log(`\n${num}. ${title}`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   🧪 eHorse Test Environment Setup                           ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const addresses: Record<string, string> = {};

  function deployContract(name: string, path: string, args: string): string {
    const output = exec(`cd ../../contracts && forge create ${path} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY} --constructor-args ${args} --legacy --broadcast 2>&1`);
    const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
    if (!match) {
      console.error(`Failed to deploy ${name}, output was:`, output.substring(0, 500));
      throw new Error(`Failed to deploy ${name}`);
    }
    return match[1];
  }

  step(1, 'Deploying elizaOS Token');
  addresses.elizaOS = deployContract('elizaOS', 'src/tokens/ElizaOSToken.sol:ElizaOSToken', TEST_WALLETS[0].address);
  log(`✅ elizaOS: ${addresses.elizaOS}`);

  step(2, 'Deploying CLANKER Token');
  addresses.clanker = deployContract('CLANKER', 'src/tokens/MockCLANKER.sol:MockCLANKER', TEST_WALLETS[0].address);
  log(`✅ CLANKER: ${addresses.clanker}`);

  step(3, 'Deploying VIRTUAL Token');
  addresses.virtual = deployContract('VIRTUAL', 'src/tokens/MockVIRTUAL.sol:MockVIRTUAL', TEST_WALLETS[0].address);
  log(`✅ VIRTUAL: ${addresses.virtual}`);

  step(4, 'Deploying CLANKERMON Token');
  addresses.clankermon = deployContract('CLANKERMON', 'src/tokens/MockClankermon.sol:MockClankermon', TEST_WALLETS[0].address);
  log(`✅ CLANKERMON: ${addresses.clankermon}`);

  step(5, 'Deploying PredictionOracle');
  addresses.predictionOracle = deployContract('PredictionOracle', 'src/prediction-markets/PredictionOracle.sol:PredictionOracle', TEST_WALLETS[0].address);
  log(`✅ PredictionOracle: ${addresses.predictionOracle}`);

  step(6, 'Deploying Predimarket');
  addresses.predimarket = deployContract('Predimarket', 'src/prediction-markets/Predimarket.sol:Predimarket', `${addresses.elizaOS} ${addresses.predictionOracle} ${TEST_WALLETS[0].address} ${TEST_WALLETS[0].address}`);
  log(`✅ Predimarket: ${addresses.predimarket}`);

  step(7, 'Deploying MarketFactory');
  addresses.marketFactory = deployContract('MarketFactory', 'src/prediction-markets/MarketFactory.sol:MarketFactory', `${addresses.predimarket} ${addresses.predictionOracle} 1000000000000000000000 ${TEST_WALLETS[0].address}`);
  log(`✅ MarketFactory: ${addresses.marketFactory}`);

  step(8, 'Configuring Contracts');
  
  exec(`cast send ${addresses.predictionOracle} "setGameServer(address)" ${TEST_WALLETS[0].address} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
  log(`✅ Set gameServer in oracle`);

  const tokensToEnable = [
    { name: 'elizaOS', address: addresses.elizaOS },
    { name: 'CLANKER', address: addresses.clanker },
    { name: 'VIRTUAL', address: addresses.virtual },
    { name: 'CLANKERMON', address: addresses.clankermon }
  ];
  
  for (const token of tokensToEnable) {
    exec(`cast send ${addresses.predimarket} "setTokenSupport(address,bool)" ${token.address} true --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
    log(`✅ Enabled ${token.name} in Predimarket`);
  }

  exec(`cast send ${addresses.predimarket} "transferOwnership(address)" ${addresses.marketFactory} --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
  log(`✅ Transferred Predimarket ownership to MarketFactory`);

  step(9, 'Funding Test Wallets');
  
  for (const wallet of TEST_WALLETS.slice(1)) {
    exec(`cast send ${addresses.elizaOS} "transfer(address,uint256)" ${wallet.address} 10000000000000000000000 --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
    exec(`cast send ${addresses.clanker} "transfer(address,uint256)" ${wallet.address} 10000000000000000000000 --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
    exec(`cast send ${addresses.virtual} "transfer(address,uint256)" ${wallet.address} 10000000000000000000000 --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
    exec(`cast send ${addresses.clankermon} "transfer(address,uint256)" ${wallet.address} 10000000000000000000000 --rpc-url ${RPC_URL} --private-key ${DEPLOYER_KEY}`);
    log(`✅ Funded ${wallet.name} with all tokens`);
  }

  step(10, 'Saving Configuration');
  
  const config = {
    rpcUrl: RPC_URL,
    chainId: 31337,
    addresses,
    testWallets: TEST_WALLETS,
    timestamp: new Date().toISOString()
  };

  writeFileSync('tests/test-config.json', JSON.stringify(config, null, 2));
  log(`✅ Saved to tests/test-config.json`);

  const envContent = `# Test Environment Configuration
# Generated: ${config.timestamp}

RPC_URL=${RPC_URL}
CHAIN_ID=31337

# Contracts
PREDICTION_ORACLE_ADDRESS=${addresses.predictionOracle}
MARKET_FACTORY_ADDRESS=${addresses.marketFactory}
PREDIMARKET_ADDRESS=${addresses.predimarket}
ELIZAOS_ADDRESS=${addresses.elizaOS}
CLANKER_ADDRESS=${addresses.clanker}
VIRTUAL_ADDRESS=${addresses.virtual}
CLANKERMON_ADDRESS=${addresses.clankermon}

# eHorse wallet (deployer in tests)
PRIVATE_KEY=${DEPLOYER_KEY}
EHORSE_PORT=5700

# Test wallets
AGENT1_PRIVATE_KEY=${TEST_WALLETS[1].key}
AGENT2_PRIVATE_KEY=${TEST_WALLETS[2].key}
AGENT3_PRIVATE_KEY=${TEST_WALLETS[3].key}
`;

  writeFileSync('.env.test', envContent);
  log(`✅ Created .env.test`);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║   ✅ Test Environment Ready!                                 ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Contract Addresses:');
  console.log(`  elizaOS:          ${addresses.elizaOS}`);
  console.log(`  CLANKER:          ${addresses.clanker}`);
  console.log(`  VIRTUAL:          ${addresses.virtual}`);
  console.log(`  CLANKERMON:       ${addresses.clankermon}`);
  console.log(`  PredictionOracle: ${addresses.predictionOracle}`);
  console.log(`  Predimarket:      ${addresses.predimarket}`);
  console.log(`  MarketFactory:    ${addresses.marketFactory}`);
  console.log('');
  console.log('Test Wallets (all funded with 10,000 of each token):');
  TEST_WALLETS.slice(1).forEach(w => {
    console.log(`  ${w.name}: ${w.address}`);
  });
  console.log('');
  console.log('Next: Run tests with `bun run test:e2e`');
}

main();

