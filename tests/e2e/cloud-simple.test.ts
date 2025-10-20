#!/usr/bin/env bun
/**
 * Simplified Cloud Integration E2E Tests
 * Tests actual deployed contracts on localnet
 */

import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';

const ADDRESSES = {
  identityRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  reputationRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  serviceRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  creditManager: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  cloudReputationProvider: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
  usdc: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  elizaOS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
};

const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);

describe('Cloud Contracts Deployment', () => {
  test('all contracts have code', async () => {
    for (const [name, address] of Object.entries(ADDRESSES)) {
      const code = await provider.getCode(address);
      expect(code).not.toBe('0x');
      console.log(`✓ ${name}: ${address}`);
    }
  });
  
  test('cloud agent is registered', async () => {
    const identityRegistry = new ethers.Contract(
      ADDRESSES.identityRegistry,
      ['function agentExists(uint256) external view returns (bool)'],
      provider
    );
    
    const exists = await identityRegistry.agentExists(1);
    expect(exists).toBe(true);
    console.log('✓ Cloud agent ID 1 exists');
  });
  
  test('all 5 services are registered', async () => {
    const serviceRegistry = new ethers.Contract(
      ADDRESSES.serviceRegistry,
      ['function isServiceAvailable(string) external view returns (bool)'],
      provider
    );
    
    const services = ['chat-completion', 'image-generation', 'embeddings', 'storage', 'compute'];
    
    for (const service of services) {
      const available = await serviceRegistry.isServiceAvailable(service);
      expect(available).toBe(true);
      console.log(`✓ ${service} is available`);
    }
  });
  
  test('multi-sig has 4 approvers', async () => {
    const cloudRep = new ethers.Contract(
      ADDRESSES.cloudReputationProvider,
      ['function getBanApprovers() external view returns (address[])'],
      provider
    );
    
    const approvers = await cloudRep.getBanApprovers();
    expect(approvers.length).toBe(4);
    console.log(`✓ ${approvers.length} ban approvers configured`);
  });
  
  test('multi-sig threshold is 2/4', async () => {
    const cloudRep = new ethers.Contract(
      ADDRESSES.cloudReputationProvider,
      ['function banApprovalThreshold() external view returns (uint256)'],
      provider
    );
    
    const threshold = await cloudRep.banApprovalThreshold();
    expect(Number(threshold)).toBe(2);
    console.log(`✓ Ban threshold: ${threshold}/4`);
  });
});

describe('Cloud Service Costs', () => {
  test('can query service costs', async () => {
    const serviceRegistry = new ethers.Contract(
      ADDRESSES.serviceRegistry,
      ['function getServiceCost(string,address) external view returns (uint256)'],
      provider
    );
    
    const cost = await serviceRegistry.getServiceCost(
      'chat-completion',
      await deployer.getAddress()
    );
    
    expect(cost).toBeGreaterThan(0n);
    console.log(`✓ Chat completion cost: ${ethers.formatEther(cost)} elizaOS`);
  });
});

describe('Cloud Credit System', () => {
  test('can check user balances', async () => {
    const creditManager = new ethers.Contract(
      ADDRESSES.creditManager,
      ['function getBalance(address,address) external view returns (uint256)'],
      provider
    );
    
    const balance = await creditManager.getBalance(
      await deployer.getAddress(),
      ADDRESSES.usdc
    );
    
    console.log(`✓ User USDC balance in credit manager: ${ethers.formatUnits(balance, 6)} USDC`);
  });
});


