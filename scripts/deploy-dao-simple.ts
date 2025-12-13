#!/usr/bin/env bun
/**
 * Simple DAO Deployment Script
 * 
 * Deploys Council + CEOAgent to local anvil.
 * Start anvil first: anvil --port 9545
 */

import { ethers, ContractFactory, Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUT = join(import.meta.dir, '../packages/contracts/out');
const COUNCIL_DIR = join(import.meta.dir, '../apps/council');

const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Treasury
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Code
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // Community
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // Security
];

function load(name: string) {
  const art = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), 'utf-8'));
  return { abi: art.abi, bytecode: art.bytecode.object };
}

async function deploy(w: Wallet, name: string, args: unknown[]) {
  const { abi, bytecode } = load(name);
  const f = new ContractFactory(abi, bytecode, w);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`✓ ${name}: ${addr}`);
  return { address: addr, contract: new ethers.Contract(addr, abi, w) };
}

async function main() {
  console.log('\n=== JEJU DAO DEPLOYMENT ===\n');
  
  const provider = new JsonRpcProvider('http://127.0.0.1:9545');
  await provider.getBlockNumber().catch(() => {
    console.error('Cannot connect to anvil. Run: anvil --port 9545');
    process.exit(1);
  });
  
  const deployer = new Wallet(KEYS[0], provider);
  console.log('Deployer:', await deployer.getAddress());
  console.log('Balance:', formatEther(await provider.getBalance(await deployer.getAddress())), 'ETH\n');
  
  // Deploy contracts
  const { address: tokenAddr, contract: token } = await deploy(deployer, 'TestERC20', 
    ['Jeju', 'JEJU', parseEther('1000000000')]);
  
  const { address: identityAddr, contract: identity } = await deploy(deployer, 'IdentityRegistry', []);
  
  const { address: reputationAddr } = await deploy(deployer, 'ReputationRegistry', [identityAddr]);
  
  const { address: councilAddr, contract: council } = await deploy(deployer, 'Council',
    [tokenAddr, identityAddr, reputationAddr, await deployer.getAddress()]);
  
  const { address: ceoAddr } = await deploy(deployer, 'CEOAgent',
    [tokenAddr, councilAddr, 'claude-opus-4-5', await deployer.getAddress()]);
  
  console.log('\n--- Configuring ---\n');
  
  // Set CEO
  await (await council.setCEOAgent(ceoAddr, 1)).wait();
  console.log('✓ CEO agent configured');
  
  // Set research operator
  await (await council.setResearchOperator(await deployer.getAddress(), true)).wait();
  console.log('✓ Research operator configured');
  
  // Register council agents
  const roles = ['Treasury', 'Code', 'Community', 'Security'];
  const agents: Record<string, { address: string; agentId: number }> = {};
  
  for (let i = 0; i < 4; i++) {
    const w = new Wallet(KEYS[i + 1], provider);
    const addr = await w.getAddress();
    
    // Register in identity
    const tx = await identity.connect(w).register(`ipfs://agent-${roles[i].toLowerCase()}`);
    const r = await tx.wait();
    const evt = r.logs.find((l: { topics: string[] }) => 
      l.topics[0] === ethers.id('Transfer(address,address,uint256)'));
    const agentId = evt ? parseInt(evt.topics[3], 16) : i + 1;
    
    // Set as council agent
    await (await council.setCouncilAgent(i, addr, agentId, 100)).wait();
    
    agents[roles[i]] = { address: addr, agentId };
    console.log(`✓ ${roles[i]}: ID=${agentId}`);
  }
  
  console.log('\n--- Saving ---\n');
  
  const deployment = {
    network: 'localnet',
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:9545',
    timestamp: new Date().toISOString(),
    deployer: await deployer.getAddress(),
    contracts: {
      GovernanceToken: tokenAddr,
      IdentityRegistry: identityAddr,
      ReputationRegistry: reputationAddr,
      Council: councilAddr,
      CEOAgent: ceoAddr,
    },
    agents: {
      ceo: { modelId: 'claude-opus-4-5', contractAddress: ceoAddr },
      council: agents,
    },
  };
  
  writeFileSync(join(COUNCIL_DIR, 'deployment-localnet.json'), JSON.stringify(deployment, null, 2));
  console.log('✓ Saved deployment-localnet.json');
  
  const env = `RPC_URL=http://127.0.0.1:9545
CHAIN_ID=31337
COUNCIL_ADDRESS=${councilAddr}
CEO_AGENT_ADDRESS=${ceoAddr}
GOVERNANCE_TOKEN_ADDRESS=${tokenAddr}
IDENTITY_REGISTRY_ADDRESS=${identityAddr}
REPUTATION_REGISTRY_ADDRESS=${reputationAddr}
OPERATOR_KEY=${KEYS[0]}
`;
  writeFileSync(join(COUNCIL_DIR, '.env.localnet'), env);
  console.log('✓ Saved .env.localnet');
  
  console.log('\n=== DONE ===\n');
  console.log('Council:', councilAddr);
  console.log('CEOAgent:', ceoAddr);
  console.log('\nNext: cp apps/council/.env.localnet apps/council/.env');
}

main().catch(e => { console.error(e.message); process.exit(1); });
