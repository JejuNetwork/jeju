#!/usr/bin/env bun
/**
 * Federation System Demo
 * 
 * Demonstrates the complete federation workflow:
 * 1. Network registration
 * 2. Trust establishment
 * 3. Cross-network identity
 * 4. Federated solver routing
 * 5. Cross-network liquidity
 */

import { createPublicClient, createWalletClient, http, parseEther, keccak256, encodePacked, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { NETWORK_REGISTRY_ABI, FEDERATED_SOLVER_ABI, FEDERATED_LIQUIDITY_ABI } from '../../packages/shared/src/federation/abis';

const DEMO_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

console.log('\n' + '='.repeat(60));
console.log('  JEJU FEDERATION SYSTEM DEMO');
console.log('='.repeat(60) + '\n');

// Create test configuration
const config = {
  hubRpcUrl: 'http://localhost:8545',
  localRpcUrl: 'http://localhost:9545',
  hubChainId: 31337,
  localChainId: 1337,
};

console.log('Configuration:');
console.log(`  Hub Chain: ${config.hubChainId}`);
console.log(`  Local Chain: ${config.localChainId}`);
console.log('');

// Test contract deployment simulation
console.log('1. Simulating NetworkRegistry deployment...');

const mockNetworkRegistryAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address;

console.log(`   NetworkRegistry: ${mockNetworkRegistryAddress}`);
console.log('   Status: Ready for deployment');
console.log('');

// Test network info structure
console.log('2. Network Registration Demo...');

interface NetworkInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  wsUrl: string;
  operator: Address;
  contracts: {
    identityRegistry: Address;
    solverRegistry: Address;
    inputSettler: Address;
    outputSettler: Address;
    liquidityVault: Address;
    governance: Address;
    oracle: Address;
  };
  genesisHash: Hex;
  stake: bigint;
  isActive: boolean;
  isVerified: boolean;
}

const jejuTestnet: NetworkInfo = {
  chainId: 420690,
  name: 'Testnet',
  rpcUrl: 'https://testnet-rpc.jeju.network',
  explorerUrl: 'https://testnet-explorer.jeju.network',
  wsUrl: 'wss://testnet-ws.jeju.network',
  operator: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  contracts: {
    identityRegistry: '0x0000000000000000000000000000000000000001',
    solverRegistry: '0x0000000000000000000000000000000000000002',
    inputSettler: '0x0000000000000000000000000000000000000003',
    outputSettler: '0x0000000000000000000000000000000000000004',
    liquidityVault: '0x0000000000000000000000000000000000000005',
    governance: '0x0000000000000000000000000000000000000006',
    oracle: '0x0000000000000000000000000000000000000007',
  },
  genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  stake: parseEther('1'),
  isActive: true,
  isVerified: false,
};

const jejuMainnet: NetworkInfo = {
  chainId: 420691,
  name: 'Mainnet',
  rpcUrl: 'https://rpc.jeju.network',
  explorerUrl: 'https://explorer.jeju.network',
  wsUrl: 'wss://ws.jeju.network',
  operator: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  contracts: {
    identityRegistry: '0x0000000000000000000000000000000000000011',
    solverRegistry: '0x0000000000000000000000000000000000000012',
    inputSettler: '0x0000000000000000000000000000000000000013',
    outputSettler: '0x0000000000000000000000000000000000000014',
    liquidityVault: '0x0000000000000000000000000000000000000015',
    governance: '0x0000000000000000000000000000000000000016',
    oracle: '0x0000000000000000000000000000000000000017',
  },
  genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  stake: parseEther('10'),
  isActive: true,
  isVerified: true,
};

console.log('   Network A (Network Testnet):');
console.log(`     Chain ID: ${jejuTestnet.chainId}`);
console.log(`     Name: ${jejuTestnet.name}`);
console.log(`     Operator: ${jejuTestnet.operator}`);
console.log(`     Stake: ${Number(jejuTestnet.stake) / 1e18} ETH`);
console.log(`     Active: ${jejuTestnet.isActive}`);
console.log(`     Verified: ${jejuTestnet.isVerified}`);
console.log('');

console.log('   Network B (Network Mainnet):');
console.log(`     Chain ID: ${jejuMainnet.chainId}`);
console.log(`     Name: ${jejuMainnet.name}`);
console.log(`     Operator: ${jejuMainnet.operator}`);
console.log(`     Stake: ${Number(jejuMainnet.stake) / 1e18} ETH`);
console.log(`     Active: ${jejuMainnet.isActive}`);
console.log(`     Verified: ${jejuMainnet.isVerified}`);
console.log('');

// Test trust relationship
console.log('3. Trust Relationship Demo...');

interface TrustRelation {
  sourceChainId: number;
  targetChainId: number;
  isTrusted: boolean;
  establishedAt: number;
}

const trustRelations: TrustRelation[] = [
  {
    sourceChainId: 420690,
    targetChainId: 420691,
    isTrusted: true,
    establishedAt: Date.now(),
  },
  {
    sourceChainId: 420691,
    targetChainId: 420690,
    isTrusted: true,
    establishedAt: Date.now(),
  },
];

console.log('   Trust Graph:');
for (const relation of trustRelations) {
  console.log(`     ${relation.sourceChainId} -> ${relation.targetChainId}: ${relation.isTrusted ? 'TRUSTED' : 'NOT TRUSTED'}`);
}

const isMutuallyTrusted = trustRelations.every(r => r.isTrusted);
console.log(`   Mutual Trust: ${isMutuallyTrusted ? 'YES' : 'NO'}`);
console.log('');

// Test federated identity
console.log('4. Federated Identity Demo...');

function computeFederatedId(chainId: number, agentId: number): Hex {
  return keccak256(
    encodePacked(['string', 'uint256', 'string', 'uint256'], ['jeju:federated:', BigInt(chainId), ':', BigInt(agentId)])
  );
}

interface FederatedAgent {
  federatedId: Hex;
  originChainId: number;
  originAgentId: number;
  originOwner: Address;
  isActive: boolean;
  reputationScore: number;
}

const agents: FederatedAgent[] = [
  {
    federatedId: computeFederatedId(420690, 1),
    originChainId: 420690,
    originAgentId: 1,
    originOwner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    isActive: true,
    reputationScore: 100,
  },
  {
    federatedId: computeFederatedId(420691, 1),
    originChainId: 420691,
    originAgentId: 1,
    originOwner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    isActive: true,
    reputationScore: 95,
  },
];

console.log('   Federated Agents:');
for (const agent of agents) {
  console.log(`     Agent from chain ${agent.originChainId}:`);
  console.log(`       Federated ID: ${agent.federatedId.slice(0, 18)}...`);
  console.log(`       Owner: ${agent.originOwner}`);
  console.log(`       Reputation: ${agent.reputationScore}/100`);
  console.log(`       Active: ${agent.isActive}`);
}
console.log('');

// Test federated solver routing
console.log('5. Federated Solver Routing Demo...');

function computeFederatedSolverId(solver: Address, chainId: number): Hex {
  return keccak256(
    encodePacked(['string', 'uint256', 'string', 'address'], ['jeju:solver:', BigInt(chainId), ':', solver])
  );
}

interface FederatedSolver {
  federatedId: Hex;
  solverAddress: Address;
  homeChainId: number;
  supportedChains: number[];
  totalStake: bigint;
  totalFills: number;
  successfulFills: number;
  isActive: boolean;
}

const solvers: FederatedSolver[] = [
  {
    federatedId: computeFederatedSolverId('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 420690),
    solverAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    homeChainId: 420690,
    supportedChains: [420690, 420691, 84532],
    totalStake: parseEther('10'),
    totalFills: 150,
    successfulFills: 145,
    isActive: true,
  },
  {
    federatedId: computeFederatedSolverId('0x90F79bf6EB2c4f870365E785982E1f101E93b906', 420691),
    solverAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    homeChainId: 420691,
    supportedChains: [420690, 420691],
    totalStake: parseEther('25'),
    totalFills: 300,
    successfulFills: 285,
    isActive: true,
  },
];

console.log('   Registered Solvers:');
for (const solver of solvers) {
  const successRate = solver.totalFills > 0 
    ? Math.round((solver.successfulFills / solver.totalFills) * 10000) / 100
    : 100;
  console.log(`     Solver ${solver.solverAddress.slice(0, 10)}...:`);
  console.log(`       Home Chain: ${solver.homeChainId}`);
  console.log(`       Stake: ${Number(solver.totalStake) / 1e18} ETH`);
  console.log(`       Success Rate: ${successRate}%`);
  console.log(`       Fills: ${solver.successfulFills}/${solver.totalFills}`);
  console.log(`       Supported: ${solver.supportedChains.join(', ')}`);
}

// Find best solver for route
console.log('');
console.log('   Route Query: 420690 -> 420691');

const routeSolvers = solvers.filter(s => 
  s.supportedChains.includes(420690) && 
  s.supportedChains.includes(420691) &&
  s.isActive
);

let bestSolver = routeSolvers[0];
let bestScore = 0;

for (const solver of routeSolvers) {
  const rate = solver.totalFills > 0 
    ? (solver.successfulFills * 10000) / solver.totalFills 
    : 10000;
  const score = Number(solver.totalStake / BigInt(1e18)) * rate;
  if (score > bestScore) {
    bestScore = score;
    bestSolver = solver;
  }
}

console.log(`   Best Solver: ${bestSolver.solverAddress.slice(0, 10)}...`);
console.log(`   Score: ${bestScore}`);
console.log('');

// Test federated liquidity
console.log('6. Federated Liquidity Demo...');

interface NetworkLiquidity {
  chainId: number;
  ethLiquidity: bigint;
  tokenLiquidity: bigint;
  utilizationBps: number;
}

const networkLiquidity: NetworkLiquidity[] = [
  {
    chainId: 420690,
    ethLiquidity: parseEther('100'),
    tokenLiquidity: parseEther('50000'),
    utilizationBps: 3000,
  },
  {
    chainId: 420691,
    ethLiquidity: parseEther('250'),
    tokenLiquidity: parseEther('125000'),
    utilizationBps: 2000,
  },
  {
    chainId: 84532,
    ethLiquidity: parseEther('75'),
    tokenLiquidity: parseEther('30000'),
    utilizationBps: 4500,
  },
];

console.log('   Network Liquidity:');
let totalEth = 0n;
let totalToken = 0n;

for (const nl of networkLiquidity) {
  totalEth += nl.ethLiquidity;
  totalToken += nl.tokenLiquidity;
  console.log(`     Chain ${nl.chainId}:`);
  console.log(`       ETH: ${Number(nl.ethLiquidity) / 1e18}`);
  console.log(`       Token: ${Number(nl.tokenLiquidity) / 1e18}`);
  console.log(`       Utilization: ${nl.utilizationBps / 100}%`);
}

console.log('');
console.log(`   Total Federated Liquidity:`);
console.log(`     ETH: ${Number(totalEth) / 1e18}`);
console.log(`     Token: ${Number(totalToken) / 1e18}`);

// Find best network for liquidity request
const requestAmount = parseEther('50');
console.log('');
console.log(`   Liquidity Request: ${Number(requestAmount) / 1e18} ETH`);

let bestNetwork = networkLiquidity[0];
let bestUtilization = Number.MAX_VALUE;

for (const nl of networkLiquidity) {
  if (nl.ethLiquidity >= requestAmount && nl.utilizationBps < bestUtilization) {
    bestNetwork = nl;
    bestUtilization = nl.utilizationBps;
  }
}

console.log(`   Best Network: Chain ${bestNetwork.chainId}`);
console.log(`   Available: ${Number(bestNetwork.ethLiquidity) / 1e18} ETH`);
console.log(`   Utilization: ${bestNetwork.utilizationBps / 100}%`);
console.log('');

// Summary
console.log('='.repeat(60));
console.log('  DEMO COMPLETE');
console.log('='.repeat(60));
console.log('');
console.log('Summary:');
console.log('  - NetworkRegistry: Manages network registration with stake');
console.log('  - Trust Relations: Enables cross-network trust graphs');
console.log('  - FederatedIdentity: Cross-network agent attestation');
console.log('  - FederatedSolver: Best solver routing across networks');
console.log('  - FederatedLiquidity: Cross-network liquidity aggregation');
console.log('');
console.log('Integration Points:');
console.log('  - Superchain: Uses SuperchainOracle for L2-to-L2 messaging');
console.log('  - Governance: RegistryGovernance for verification/slashing');
console.log('  - Identity: ERC-8004 IdentityRegistry per network');
console.log('  - OIF: SolverRegistry + InputSettler/OutputSettler');
console.log('  - EIL: LiquidityVault + CrossChainPaymaster');
console.log('');
console.log('Next Steps:');
console.log('  1. Deploy contracts: bun run scripts/deploy/federation.ts testnet');
console.log('  2. Fork network: jeju fork --name MyNetwork --chain-id 420692');
console.log('  3. Register with federation via CLI or SDK');
console.log('');


