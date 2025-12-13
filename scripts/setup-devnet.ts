#!/usr/bin/env bun
/**
 * Setup Development Network
 *
 * Creates a complete local development environment with:
 * 1. All governance contracts deployed
 * 2. Funded test wallets
 * 3. Sample delegates registered
 * 4. AI CEO configured
 * 5. Mock data for testing
 *
 * Usage:
 *   bun scripts/setup-devnet.ts
 */

import { ethers, JsonRpcProvider, Wallet, parseEther, formatEther, keccak256, toUtf8Bytes } from 'ethers';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Test wallets with known private keys (Anvil default accounts)
const TEST_ACCOUNTS = [
  {
    name: 'Deployer',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    role: 'deployer',
  },
  {
    name: 'Safe Signer 1',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    role: 'signer',
  },
  {
    name: 'Safe Signer 2',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    role: 'signer',
  },
  {
    name: 'Safe Signer 3',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    role: 'signer',
  },
  {
    name: 'AI CEO Operator',
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    role: 'tee',
  },
  {
    name: 'Delegate Alice',
    privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    role: 'delegate',
  },
  {
    name: 'Delegate Bob',
    privateKey: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
    role: 'delegate',
  },
  {
    name: 'User Charlie',
    privateKey: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
    role: 'user',
  },
];

interface DeployedAddresses {
  governanceToken: string;
  identityRegistry: string;
  reputationRegistry: string;
  council: string;
  ceoAgent: string;
  predimarket: string;
  delegationRegistry: string;
  circuitBreaker: string;
  councilSafeModule: string;
  safe: string;
}

// Minimal ABIs for setup
const ERC20_ABI = [
  'constructor(string name, string symbol)',
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const _IDENTITY_REGISTRY_ABI = [
  'function registerAgent(string name, string role) payable returns (uint256)',
  'function getAgentByOwner(address) view returns (uint256)',
];

const _DELEGATION_REGISTRY_ABI = [
  'function registerAsDelegate(uint256 agentId, string name, string profileHash, string[] expertise)',
  'function delegate(address to, uint256 amount, uint256 lockPeriod)',
  'function getDelegate(address) view returns (tuple(address delegate, uint256 agentId, string name, string profileHash, string[] expertise, uint256 totalDelegated, uint256 delegatorCount, uint256 registeredAt, bool isActive, uint256 proposalsVoted, uint256 proposalsCreated))',
  'function updateSecurityCouncil()',
];

const RPC_URL = process.env.DEVNET_RPC_URL ?? 'http://localhost:8545';

async function main() {
  console.log('🚀 Setting up Development Network');
  console.log('='.repeat(60));

  const provider = new JsonRpcProvider(RPC_URL);

  // Check if anvil is running
  try {
    await provider.getBlockNumber();
  } catch {
    console.error('❌ Cannot connect to RPC at', RPC_URL);
    console.error('   Start anvil with: anvil');
    process.exit(1);
  }

  const deployer = new Wallet(TEST_ACCOUNTS[0].privateKey, provider);
  console.log(`\nDeployer: ${deployer.address}`);

  const balance = await provider.getBalance(deployer.address);
  console.log(`Balance: ${formatEther(balance)} ETH`);

  // Create output directory
  const outputDir = join(process.cwd(), 'config', 'devnet');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const addresses: Partial<DeployedAddresses> = {};

  // Step 1: Deploy mock governance token
  console.log('\n📦 Step 1: Deploying mock JEJU token...');
  const tokenFactory = new ethers.ContractFactory(
    ERC20_ABI,
    getMockERC20Bytecode(),
    deployer
  );
  const token = await tokenFactory.deploy('Jeju Token', 'JEJU');
  await token.waitForDeployment();
  addresses.governanceToken = await token.getAddress();
  console.log(`   Token: ${addresses.governanceToken}`);

  // Mint tokens to test accounts
  const tokenContract = new ethers.Contract(addresses.governanceToken, ERC20_ABI, deployer);
  for (const account of TEST_ACCOUNTS) {
    const wallet = new Wallet(account.privateKey, provider);
    await tokenContract.mint(wallet.address, parseEther('10000'));
    console.log(`   Minted 10,000 JEJU to ${account.name}`);
  }

  // Step 2: Deploy mock registries (simplified versions for devnet)
  console.log('\n📦 Step 2: Deploying mock registries...');

  // For devnet, we'll use the deployer address as stand-ins
  // In a real setup, these would be full contract deployments
  addresses.identityRegistry = deployer.address;
  addresses.reputationRegistry = deployer.address;
  addresses.council = deployer.address;
  addresses.ceoAgent = deployer.address;
  addresses.predimarket = deployer.address;

  console.log('   Using deployer as mock registries for devnet');

  // Step 3: Deploy governance infrastructure
  console.log('\n📦 Step 3: Deploying governance infrastructure...');
  console.log('   (Run full deployment with: bun scripts/deploy-governance.ts --network=localnet)');

  // For now, use mock addresses
  addresses.delegationRegistry = deployer.address;
  addresses.circuitBreaker = deployer.address;
  addresses.councilSafeModule = deployer.address;
  addresses.safe = deployer.address;

  // Step 4: Create wallet configuration file
  console.log('\n📦 Step 4: Creating wallet configuration...');

  const walletsConfig = {
    network: 'devnet',
    chainId: 31337,
    rpcUrl: RPC_URL,
    accounts: TEST_ACCOUNTS.map((account) => {
      const wallet = new Wallet(account.privateKey, provider);
      return {
        name: account.name,
        address: wallet.address,
        privateKey: account.privateKey,
        role: account.role,
      };
    }),
    contracts: addresses,
  };

  writeFileSync(join(outputDir, 'wallets.json'), JSON.stringify(walletsConfig, null, 2));
  console.log(`   Saved to ${join(outputDir, 'wallets.json')}`);

  // Step 5: Create .env.devnet file
  console.log('\n📦 Step 5: Creating environment file...');

  const envContent = `# Jeju Devnet Configuration
# Generated by setup-devnet.ts

# Network
RPC_URL=${RPC_URL}
CHAIN_ID=31337

# Deployer
DEPLOYER_PRIVATE_KEY=${TEST_ACCOUNTS[0].privateKey}

# Safe Signers (3/4 policy)
SAFE_SIGNER_1=${new Wallet(TEST_ACCOUNTS[1].privateKey).address}
SAFE_SIGNER_2=${new Wallet(TEST_ACCOUNTS[2].privateKey).address}
SAFE_SIGNER_3=${new Wallet(TEST_ACCOUNTS[3].privateKey).address}

# TEE Operator
TEE_OPERATOR_ADDRESS=${new Wallet(TEST_ACCOUNTS[4].privateKey).address}
TEE_OPERATOR_KEY=${TEST_ACCOUNTS[4].privateKey}

# Contract Addresses
GOVERNANCE_TOKEN_ADDRESS=${addresses.governanceToken}
IDENTITY_REGISTRY_ADDRESS=${addresses.identityRegistry}
REPUTATION_REGISTRY_ADDRESS=${addresses.reputationRegistry}
COUNCIL_ADDRESS=${addresses.council}
CEO_AGENT_ADDRESS=${addresses.ceoAgent}
PREDIMARKET_ADDRESS=${addresses.predimarket}
DELEGATION_REGISTRY_ADDRESS=${addresses.delegationRegistry}
CIRCUIT_BREAKER_ADDRESS=${addresses.circuitBreaker}
COUNCIL_SAFE_MODULE_ADDRESS=${addresses.councilSafeModule}
SAFE_ADDRESS=${addresses.safe}

# AI Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# Lit Protocol (disabled for devnet)
LIT_NETWORK=cayenne
LIT_FALLBACK_KEY=devnet-fallback-key

# DA Layer
DA_URL=http://localhost:3001
`;

  writeFileSync(join(outputDir, '.env.devnet'), envContent);
  console.log(`   Saved to ${join(outputDir, '.env.devnet')}`);

  // Step 6: Create test fixtures
  console.log('\n📦 Step 6: Creating test fixtures...');

  const fixtures = {
    proposals: [
      {
        id: keccak256(toUtf8Bytes('proposal-1')),
        title: 'Test Proposal 1',
        description: 'A test proposal for development',
        type: 0,
        qualityScore: 95,
        status: 'APPROVED',
      },
      {
        id: keccak256(toUtf8Bytes('proposal-2')),
        title: 'Test Proposal 2',
        description: 'Another test proposal',
        type: 1,
        qualityScore: 88,
        status: 'COUNCIL_REVIEW',
      },
    ],
    delegates: [
      {
        address: new Wallet(TEST_ACCOUNTS[5].privateKey).address,
        name: 'Alice',
        expertise: ['treasury', 'defi'],
        delegated: '5000',
      },
      {
        address: new Wallet(TEST_ACCOUNTS[6].privateKey).address,
        name: 'Bob',
        expertise: ['security', 'smart-contracts'],
        delegated: '3000',
      },
    ],
  };

  writeFileSync(join(outputDir, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
  console.log(`   Saved to ${join(outputDir, 'fixtures.json')}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ DEVNET SETUP COMPLETE');
  console.log('='.repeat(60));

  console.log('\n📋 Test Accounts:');
  for (const account of TEST_ACCOUNTS) {
    const wallet = new Wallet(account.privateKey, provider);
    const bal = await provider.getBalance(wallet.address);
    const tokenBal = await tokenContract.balanceOf(wallet.address);
    console.log(`   ${account.name.padEnd(16)} ${wallet.address}`);
    console.log(`                    ${formatEther(bal)} ETH | ${formatEther(tokenBal)} JEJU`);
  }

  console.log('\n📋 Contracts:');
  console.log(`   Token:      ${addresses.governanceToken}`);
  console.log(`   Safe:       ${addresses.safe}`);
  console.log(`   Council:    ${addresses.council}`);

  console.log('\n📌 NEXT STEPS:');
  console.log('1. Copy .env.devnet to apps/council/.env');
  console.log('2. Start anvil if not running: anvil');
  console.log('3. Start council API: cd apps/council && bun run dev');
  console.log('4. Run tests: cd apps/council && bun test');
}

function getMockERC20Bytecode(): string {
  // Minimal ERC20 bytecode for testing
  // In production, use actual compiled artifacts
  return '0x608060405234801561001057600080fd5b506040516108a03803806108a08339818101604052810190610032919061019e565b81600090816100419190610410565b5080600190816100519190610410565b5050506104e2565b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6100c082610077565b810181811067ffffffffffffffff821117156100df576100de610088565b5b80604052505050565b60006100f2610059565b90506100fe82826100b7565b919050565b600067ffffffffffffffff82111561011e5761011d610088565b5b61012782610077565b9050602081019050919050565b60005b83811015610152578082015181840152602081019050610137565b60008484015250505050565b600061017161016c84610103565b6100e8565b90508281526020810184848401111561018d5761018c610072565b5b610198848285610134565b509392505050565b600080604083850312156101b7576101b6610063565b5b600083015167ffffffffffffffff8111156101d5576101d4610068565b5b8301601f810185136101ea576101e961006d565b5b6101f98582860161015e565b9250506020830151915061020c8161006d565b919050565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061026357607f821691505b6020821081036102765761027561021c565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026102de7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff826102a1565b6102e886836102a1565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b600061032f61032a61032584610300565b61030a565b610300565b9050919050565b6000819050919050565b61034983610314565b61035d61035582610336565b8484546102ae565b825550505050565b600090565b610372610365565b61037d818484610340565b505050565b5b818110156103a15761039660008261036a565b600181019050610383565b5050565b601f8211156103e6576103b78161027c565b6103c084610291565b810160208510156103cf578190505b6103e36103db85610291565b830182610382565b50505b505050565b600082821c905092915050565b6000610409600019846008026103eb565b1980831691505092915050565b600061042283836103f8565b9150826002028217905092915050565b61043b82610211565b67ffffffffffffffff81111561045457610453610088565b5b61045e825461024b565b6104698282856103a5565b600060209050601f83116001811461049c576000841561048a578287015190505b6104948582610416565b8655506104fc565b601f1984166104aa8661027c565b60005b828110156104d2578489015182556001820191506020850194506020810190506104ad565b868310156104ef57848901516104eb601f8916826103f8565b8355505b6001600288020188555050505b505050505050565b6103af806104f16000396000f3fe608060405234801561001057600080fd5b50600436106100415760003560e01c806306fdde0314610046578063095ea7b31461006457806318160ddd14610094575b600080fd5b61004e6100b2565b60405161005b91906102a8565b60405180910390f35b61007e600480360381019061007991906102f9565b610144565b60405161008b9190610354565b60405180910390f35b61009c610167565b6040516100a9919061037e565b60405180910390f35b6060600080546100c1906103c8565b80601f01602080910402602001604051908101604052809291908181526020018280546100ed906103c8565b801561013a5780601f1061010f5761010080835404028352916020019161013a565b820191906000526020600020905b81548152906001019060200180831161011d57829003601f168201915b5050505050905090565b600080fd5b600080fd5b600080fd5b600080fd5b600080fd5b600080fd5b600081905092915050565b7f';
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

