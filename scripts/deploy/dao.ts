#!/usr/bin/env bun
/**
 * Simple DAO Deployment Script
 * 
 * Deploys Council + CEOAgent to local anvil.
 * Start anvil first: anvil --port 9545
 */

import { createPublicClient, createWalletClient, http, type Address, parseEther, formatEther, keccak256, toUtf8Bytes, type Chain, type Abi } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { deployContract, waitForTransactionReceipt, getBalance } from 'viem/actions';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ConstructorArg, RawArtifactJson } from '../shared/contract-types';

const OUT = join(import.meta.dir, '../packages/contracts/out');
const AUTOCRAT_DIR = join(import.meta.dir, '../apps/autocrat');

const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Treasury
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Code
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // Community
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // Security
];

function load(name: string): { abi: Abi; bytecode: `0x${string}` } {
  const art = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), 'utf-8')) as RawArtifactJson;
  return { abi: art.abi, bytecode: art.bytecode.object as `0x${string}` };
}

async function deploy(
  walletClient: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  client: ReturnType<typeof createPublicClient>,
  name: string,
  args: ConstructorArg[]
): Promise<{ address: Address; abi: Abi }> {
  const { abi, bytecode } = load(name);
  const hash = await deployContract(walletClient, {
    abi,
    bytecode,
    args,
    account,
  });
  const receipt = await waitForTransactionReceipt(client, { hash });
  const address = receipt.contractAddress;
  if (!address) {
    throw new Error(`Failed to deploy ${name}`);
  }
  console.log(`✓ ${name}: ${address}`);
  return { address, abi };
}

async function main() {
  console.log('\n=== JEJU DAO DEPLOYMENT ===\n');
  
  const rpcUrl = 'http://127.0.0.1:6546';
  const chain = { id: 31337, name: 'local' } as Chain;
  
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  
  try {
    await client.getBlockNumber();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Cannot connect to anvil.');
    console.error(`Error: ${errorMessage}`);
    console.error('Run: anvil --port 9545');
    process.exit(1);
  }
  
  const deployerAccount = privateKeyToAccount(KEYS[0] as `0x${string}`);
  const walletClient = createWalletClient({
    account: deployerAccount,
    chain,
    transport: http(rpcUrl),
  });
  
  console.log('Deployer:', deployerAccount.address);
  console.log('Balance:', formatEther(await getBalance(client, { address: deployerAccount.address })), 'ETH\n');
  
  // Deploy contracts
  const { address: tokenAddr } = await deploy(walletClient, deployerAccount, client, 'TestERC20', 
    ['Network', 'JEJU', parseEther('1000000000')]);
  
  const { address: identityAddr } = await deploy(walletClient, deployerAccount, client, 'IdentityRegistry', []);
  
  const { address: reputationAddr } = await deploy(walletClient, deployerAccount, client, 'ReputationRegistry', [identityAddr]);
  
  const { address: councilAddr, abi: councilAbi } = await deploy(walletClient, deployerAccount, client, 'Council',
    [tokenAddr, identityAddr, reputationAddr, deployerAccount.address]);
  
  const { address: ceoAddr } = await deploy(walletClient, deployerAccount, client, 'CEOAgent',
    [tokenAddr, councilAddr, 'claude-opus-4-5', deployerAccount.address]);
  
  console.log('\n--- Configuring ---\n');
  
  // Set CEO
  const setCEOHash = await walletClient.writeContract({
    address: councilAddr,
    abi: councilAbi,
    functionName: 'setCEOAgent',
    args: [ceoAddr, 1],
    account: deployerAccount,
  });
  await waitForTransactionReceipt(client, { hash: setCEOHash });
  console.log('✓ CEO agent configured');
  
  // Set research operator
  const setOpHash = await walletClient.writeContract({
    address: councilAddr,
    abi: councilAbi,
    functionName: 'setResearchOperator',
    args: [deployerAccount.address, true],
    account: deployerAccount,
  });
  await waitForTransactionReceipt(client, { hash: setOpHash });
  console.log('✓ Research operator configured');
  
  // Register council agents
  const roles = ['Treasury', 'Code', 'Community', 'Security'];
  const agents: Record<string, { address: Address; agentId: number }> = {};
  
  const IDENTITY_REGISTER_ABI = [
    {
      name: 'register',
      type: 'function',
      inputs: [{ name: 'tokenURI', type: 'string' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'Transfer',
      type: 'event',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokenId', type: 'uint256', indexed: true },
      ],
    },
  ] as const;
  
  const COUNCIL_SET_AGENT_ABI = [
    {
      name: 'setCouncilAgent',
      type: 'function',
      inputs: [
        { name: 'index', type: 'uint256' },
        { name: 'agent', type: 'address' },
        { name: 'agentId', type: 'uint256' },
        { name: 'weight', type: 'uint256' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const;
  
  for (let i = 0; i < 4; i++) {
    const account = privateKeyToAccount(KEYS[i + 1] as `0x${string}`);
    const addr = account.address;
    
    // Register in identity
    const registerHash = await walletClient.writeContract({
      address: identityAddr,
      abi: IDENTITY_REGISTER_ABI,
      functionName: 'register',
      args: [`ipfs://agent-${roles[i].toLowerCase()}`],
      account,
    });
    const receipt = await waitForTransactionReceipt(client, { hash: registerHash });
    const evt = receipt.logs.find((l) => 
      l.topics[0] === keccak256(toUtf8Bytes('Transfer(address,address,uint256)'))
    );
    const agentId = evt && evt.topics[3] ? Number(BigInt(evt.topics[3])) : i + 1;
    
    // Set as council agent
    const setAgentHash = await walletClient.writeContract({
      address: councilAddr,
      abi: COUNCIL_SET_AGENT_ABI,
      functionName: 'setCouncilAgent',
      args: [BigInt(i), addr, BigInt(agentId), 100n],
      account: deployerAccount,
    });
    await waitForTransactionReceipt(client, { hash: setAgentHash });
    
    agents[roles[i]] = { address: addr, agentId };
    console.log(`✓ ${roles[i]}: ID=${agentId}`);
  }
  
  console.log('\n--- Saving ---\n');
  
  const deployment = {
    network: 'localnet',
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:6546',
    timestamp: new Date().toISOString(),
    deployer: deployerAccount.address,
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
  
  writeFileSync(join(AUTOCRAT_DIR, 'deployment-localnet.json'), JSON.stringify(deployment, null, 2));
  console.log('✓ Saved deployment-localnet.json');
  
  const env = `RPC_URL=http://127.0.0.1:6546
CHAIN_ID=31337
COUNCIL_ADDRESS=${councilAddr}
CEO_AGENT_ADDRESS=${ceoAddr}
GOVERNANCE_TOKEN_ADDRESS=${tokenAddr}
IDENTITY_REGISTRY_ADDRESS=${identityAddr}
REPUTATION_REGISTRY_ADDRESS=${reputationAddr}
OPERATOR_KEY=${KEYS[0]}
`;
  writeFileSync(join(AUTOCRAT_DIR, '.env.localnet'), env);
  console.log('✓ Saved .env.localnet');
  
  console.log('\n=== DONE ===\n');
  console.log('Council:', councilAddr);
  console.log('CEOAgent:', ceoAddr);
  console.log('\nNext: cp apps/autocrat/.env.localnet apps/autocrat/.env');
}

main().catch(e => { console.error(e.message); process.exit(1); });

