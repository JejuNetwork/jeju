#!/usr/bin/env bun
/**
 * Deploy Full DAO Stack
 * 
 * Deploys all contracts needed for the AI Council DAO:
 * - GovernanceToken (TestERC20)
 * - IdentityRegistry (ERC-8004)
 * - ReputationRegistry (ERC-8004)
 * - Council.sol
 * - CEOAgent.sol
 * 
 * Usage:
 *   bun scripts/deploy-dao-full.ts [network]
 * 
 * Networks: localnet (default), testnet
 * 
 * For localnet, start anvil first:
 *   anvil --port 9545
 */

import { ethers, ContractFactory, Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const CONTRACTS_DIR = join(import.meta.dir, '../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');
const COUNCIL_DIR = join(import.meta.dir, '../apps/council');

// Anvil default accounts (first 5)
const ANVIL_ACCOUNTS = [
  { key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', name: 'Deployer' },
  { key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', name: 'Treasury Agent' },
  { key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', name: 'Code Agent' },
  { key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', name: 'Community Agent' },
  { key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', name: 'Security Agent' },
];

interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    name: 'Jeju Localnet',
    chainId: 31337,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:9545',
  },
  testnet: {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
  },
};

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const success = (msg: string) => console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
const warn = (msg: string) => console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
const fail = (msg: string) => console.error(`\x1b[31m✗ ${msg}\x1b[0m`);

function loadArtifact(name: string): { abi: unknown[]; bytecode: string } {
  const p = join(OUT_DIR, `${name}.sol`, `${name}.json`);
  if (!existsSync(p)) throw new Error(`Artifact not found: ${p}. Run 'forge build' first.`);
  const art = JSON.parse(readFileSync(p, 'utf-8'));
  return { abi: art.abi, bytecode: art.bytecode.object };
}

async function deploy(
  wallet: Wallet,
  name: string,
  args: unknown[]
): Promise<{ address: string; contract: ethers.Contract }> {
  log(`Deploying ${name}...`);
  const { abi, bytecode } = loadArtifact(name);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  success(`${name} deployed at: ${address}`);
  return { address, contract: new ethers.Contract(address, abi, wallet) };
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║           JEJU AI COUNCIL - FULL DAO DEPLOYMENT           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const network = process.argv[2] ?? 'localnet';
  const config = NETWORKS[network];
  
  if (!config) {
    fail(`Unknown network: ${network}. Available: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }

  log(`Network: ${config.name} (Chain ID: ${config.chainId})`);
  log(`RPC: ${config.rpcUrl}`);

  // Get deployer key
  let deployerKey = process.env.DEPLOYER_KEY;
  if (!deployerKey && network === 'localnet') {
    deployerKey = ANVIL_ACCOUNTS[0].key;
    log('Using anvil default deployer account');
  }
  if (!deployerKey) {
    fail('DEPLOYER_KEY environment variable required');
    process.exit(1);
  }

  const provider = new JsonRpcProvider(config.rpcUrl);
  
  try {
    await provider.getBlockNumber();
  } catch {
    fail(`Cannot connect to RPC at ${config.rpcUrl}`);
    if (network === 'localnet') console.log('\nStart anvil: anvil --port 9545');
    process.exit(1);
  }

  const deployer = new Wallet(deployerKey, provider);
  const deployerAddress = await deployer.getAddress();
  
  log(`Deployer: ${deployerAddress}`);
  log(`Balance: ${formatEther(await provider.getBalance(deployerAddress))} ETH`);

  // Setup council agent wallets for localnet
  const agentWallets = network === 'localnet'
    ? ANVIL_ACCOUNTS.slice(1, 5).map(a => ({ wallet: new Wallet(a.key, provider), name: a.name }))
    : [];

  console.log('\n--- Phase 1: Deploy Core Infrastructure ---\n');

  // 1. Deploy Governance Token
  const { address: tokenAddress, contract: token } = await deploy(deployer, 'TestERC20', [
    'Jeju Governance', 'JEJU', parseEther('1000000000')
  ]);

  // 2. Deploy IdentityRegistry
  const { address: identityAddress, contract: identity } = await deploy(deployer, 'IdentityRegistry', []);

  // 3. Deploy ReputationRegistry
  const { address: reputationAddress } = await deploy(deployer, 'ReputationRegistry', [identityAddress]);

  console.log('\n--- Phase 2: Deploy Council System ---\n');

  // 4. Deploy Council
  const { address: councilAddress, contract: council } = await deploy(deployer, 'Council', [
    tokenAddress, identityAddress, reputationAddress, deployerAddress
  ]);

  // 5. Deploy CEOAgent
  const { address: ceoAgentAddress } = await deploy(deployer, 'CEOAgent', [
    tokenAddress, councilAddress, 'claude-opus-4-5-20250514', deployerAddress
  ]);

  // 6. Try to deploy Predimarket
  let predimarketAddress = ethers.ZeroAddress;
  try {
    const { address } = await deploy(deployer, 'Predimarket', [deployerAddress]);
    predimarketAddress = address;
  } catch {
    warn('Predimarket not available, skipping futarchy');
  }

  console.log('\n--- Phase 3: Configure Relationships ---\n');

  // Set CEO Agent
  log('Setting CEO agent...');
  let tx = await council.setCEOAgent(ceoAgentAddress, 1);
  await tx.wait();
  success('CEO agent configured');

  // Set Predimarket if available
  if (predimarketAddress !== ethers.ZeroAddress) {
    log('Setting Predimarket...');
    tx = await council.setPredimarket(predimarketAddress);
    await tx.wait();
    success('Predimarket configured');
  }

  // Register Council Agents
  const agentIds: Record<string, number> = {};
  const agentAddresses: Record<string, string> = {};
  
  const roles = [
    { name: 'Treasury', role: 0, weight: 100 },
    { name: 'Code', role: 1, weight: 100 },
    { name: 'Community', role: 2, weight: 100 },
    { name: 'Security', role: 3, weight: 100 },
  ];

  for (let i = 0; i < roles.length; i++) {
    const { name, role, weight } = roles[i];
    const agentWallet = agentWallets[i]?.wallet ?? deployer;
    const agentAddress = await agentWallet.getAddress();
    
    log(`Registering ${name} agent...`);
    
    // Register agent in IdentityRegistry
    const identityWithSigner = identity.connect(agentWallet) as ethers.Contract;
    const registerTx = await identityWithSigner.register(`ipfs://council-agent-${name.toLowerCase()}`);
    const receipt = await registerTx.wait();
    
    // Get agent ID from Transfer event
    const transferSig = ethers.id('Transfer(address,address,uint256)');
    const transferEvent = receipt.logs.find((l: { topics: string[] }) => l.topics[0] === transferSig);
    const agentId = transferEvent ? parseInt(transferEvent.topics[3], 16) : i + 1;
    
    agentIds[name] = agentId;
    agentAddresses[name] = agentAddress;
    
    // Set council agent
    tx = await council.setCouncilAgent(role, agentAddress, agentId, weight);
    await tx.wait();
    
    success(`${name} agent: ID=${agentId}, ${agentAddress.slice(0, 10)}...`);
  }

  // Set Research Operator
  log('Setting research operator...');
  tx = await council.setResearchOperator(deployerAddress, true);
  await tx.wait();
  success('Research operator configured');

  // Distribute tokens
  if (network === 'localnet') {
    log('Distributing tokens...');
    for (const addr of Object.values(agentAddresses)) {
      if (addr !== deployerAddress) {
        tx = await token.transfer(addr, parseEther('10000'));
        await tx.wait();
      }
    }
    success('Tokens distributed');
  }

  console.log('\n--- Phase 4: Save Deployment Info ---\n');

  const deployment = {
    network,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      GovernanceToken: tokenAddress,
      IdentityRegistry: identityAddress,
      ReputationRegistry: reputationAddress,
      Council: councilAddress,
      CEOAgent: ceoAgentAddress,
      Predimarket: predimarketAddress,
    },
    agents: {
      ceo: { modelId: 'claude-opus-4-5-20250514', contractAddress: ceoAgentAddress },
      council: Object.fromEntries(
        roles.map(r => [r.name.toLowerCase(), { address: agentAddresses[r.name], agentId: agentIds[r.name], role: r.role, weight: r.weight }])
      ),
    },
    researchOperator: deployerAddress,
  };

  const deploymentJson = JSON.stringify(deployment, null, 2);
  
  // Save to council app
  writeFileSync(join(COUNCIL_DIR, `deployment-${network}.json`), deploymentJson);
  success(`Saved: apps/council/deployment-${network}.json`);

  // Save to contracts deployments
  const contractsDeploymentsDir = join(CONTRACTS_DIR, 'deployments');
  if (!existsSync(contractsDeploymentsDir)) mkdirSync(contractsDeploymentsDir, { recursive: true });
  writeFileSync(join(contractsDeploymentsDir, `council-${network}.json`), deploymentJson);
  success(`Saved: packages/contracts/deployments/council-${network}.json`);

  // Generate .env file
  const envContent = `# Auto-generated by deploy-dao-full.ts (${new Date().toISOString()})
RPC_URL=${config.rpcUrl}
CHAIN_ID=${config.chainId}

COUNCIL_ADDRESS=${councilAddress}
CEO_AGENT_ADDRESS=${ceoAgentAddress}
GOVERNANCE_TOKEN_ADDRESS=${tokenAddress}
IDENTITY_REGISTRY_ADDRESS=${identityAddress}
REPUTATION_REGISTRY_ADDRESS=${reputationAddress}
PREDIMARKET_ADDRESS=${predimarketAddress}

TREASURY_AGENT_ADDRESS=${agentAddresses.Treasury}
CODE_AGENT_ADDRESS=${agentAddresses.Code}
COMMUNITY_AGENT_ADDRESS=${agentAddresses.Community}
SECURITY_AGENT_ADDRESS=${agentAddresses.Security}

RESEARCH_OPERATOR_ADDRESS=${deployerAddress}
${network === 'localnet' ? `
DEPLOYER_KEY=${deployerKey}
OPERATOR_KEY=${deployerKey}
TREASURY_AGENT_KEY=${ANVIL_ACCOUNTS[1].key}
CODE_AGENT_KEY=${ANVIL_ACCOUNTS[2].key}
COMMUNITY_AGENT_KEY=${ANVIL_ACCOUNTS[3].key}
SECURITY_AGENT_KEY=${ANVIL_ACCOUNTS[4].key}
` : ''}`;

  writeFileSync(join(COUNCIL_DIR, `.env.${network}`), envContent);
  success(`Saved: apps/council/.env.${network}`);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                  DEPLOYMENT COMPLETE                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Contracts:');
  console.log(`  GovernanceToken:    ${tokenAddress}`);
  console.log(`  IdentityRegistry:   ${identityAddress}`);
  console.log(`  ReputationRegistry: ${reputationAddress}`);
  console.log(`  Council:            ${councilAddress}`);
  console.log(`  CEOAgent:           ${ceoAgentAddress}`);
  if (predimarketAddress !== ethers.ZeroAddress) {
    console.log(`  Predimarket:        ${predimarketAddress}`);
  }

  console.log('\nCouncil Agents:');
  for (const { name } of roles) {
    console.log(`  ${name}: ${agentAddresses[name]} (ID: ${agentIds[name]})`);
  }

  console.log('\nNext Steps:');
  console.log(`1. cp apps/council/.env.${network} apps/council/.env`);
  console.log('2. cd apps/council && bun run dev');
  console.log('3. cd apps/council/app && bun run dev');
}

main().catch((err) => {
  fail(err.message);
  console.error(err);
  process.exit(1);
});
