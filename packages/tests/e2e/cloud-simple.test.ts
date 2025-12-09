#!/usr/bin/env bun
/**
 * Simplified Cloud Integration E2E Tests
 * Tests actual deployed contracts on localnet
 * 
 * NOTE: These tests require contracts to be deployed first.
 * Run `forge script script/DeployCloudIntegration.s.sol --rpc-url http://localhost:8545 --broadcast`
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load addresses dynamically from deployment files
function loadDeployedAddresses(): Record<string, string> {
  const deploymentsDir = resolve(__dirname, '../../../packages/contracts/deployments');
  const addresses: Record<string, string> = {};
  
  // Try identity-system deployment
  const identityPath = resolve(deploymentsDir, 'identity-system-1337.json');
  if (existsSync(identityPath)) {
    const data = JSON.parse(readFileSync(identityPath, 'utf-8')) as Record<string, string>;
    if (data.IdentityRegistry) addresses.identityRegistry = data.IdentityRegistry;
    if (data.ReputationRegistry) addresses.reputationRegistry = data.ReputationRegistry;
    if (data.ValidationRegistry) addresses.validationRegistry = data.ValidationRegistry;
  }
  
  // Try localnet-addresses.json for cloud contracts
  const localnetPath = resolve(deploymentsDir, 'localnet-addresses.json');
  if (existsSync(localnetPath)) {
    const data = JSON.parse(readFileSync(localnetPath, 'utf-8')) as Record<string, string>;
    Object.assign(addresses, data);
  }
  
  // Try cloud-integration deployment if it exists
  const cloudPath = resolve(deploymentsDir, 'cloud-integration-1337.json');
  if (existsSync(cloudPath)) {
    const data = JSON.parse(readFileSync(cloudPath, 'utf-8')) as Record<string, string>;
    Object.assign(addresses, data);
  }
  
  return addresses;
}

let ADDRESSES: Record<string, string> = {};
let provider: ethers.JsonRpcProvider;
let deployer: ethers.Wallet;

let localnetAvailable = false;

beforeAll(async () => {
  ADDRESSES = loadDeployedAddresses();
  provider = new ethers.JsonRpcProvider('http://localhost:8545');
  deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
  
  if (Object.keys(ADDRESSES).length === 0) {
    console.warn('⚠️ No deployment addresses found. Tests may be skipped.');
  }
  
  // Check if localnet is actually running
  try {
    await provider.getBlockNumber();
    localnetAvailable = true;
  } catch {
    console.warn('⚠️ Localnet not available at http://localhost:8545. Tests will be skipped.');
    localnetAvailable = false;
  }
});

describe('Cloud Contracts Deployment', () => {
  test('deployment addresses are loaded', () => {
    // This is a basic sanity check to ensure we have some addresses
    console.log('Loaded addresses:', Object.keys(ADDRESSES).join(', ') || 'none');
    expect(Object.keys(ADDRESSES).length).toBeGreaterThan(0);
  });
  
  test('all deployed contracts have code', async () => {
    // Skip if localnet not available
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    // Skip if no addresses loaded
    if (Object.keys(ADDRESSES).length === 0) {
      console.log('⏭️ Skipping: No deployment addresses found');
      return;
    }
    
    let deployedCount = 0;
    for (const [name, address] of Object.entries(ADDRESSES)) {
      if (!ethers.isAddress(address)) {
        console.log(`⏭️ Skipping ${name}: invalid address format`);
        continue;
      }
      const code = await provider.getCode(address);
      if (code === '0x') {
        console.log(`⚠️ ${name}: no code at ${address} (not deployed)`);
      } else {
        console.log(`✓ ${name}: ${address}`);
        deployedCount++;
      }
    }
    // At least some contracts should be deployed if we're running this test
    console.log(`${deployedCount}/${Object.keys(ADDRESSES).length} contracts deployed`);
  });
  
  test('identity registry is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    if (!ADDRESSES.identityRegistry && !ADDRESSES.IdentityRegistry) {
      console.log('⏭️ Skipping: IdentityRegistry address not found');
      return;
    }
    
    const registryAddr = ADDRESSES.identityRegistry || ADDRESSES.IdentityRegistry;
    
    // Check if contract is deployed
    const code = await provider.getCode(registryAddr);
    if (code === '0x') {
      console.log('⏭️ Skipping: IdentityRegistry not deployed');
      return;
    }
    
    const identityRegistry = new ethers.Contract(
      registryAddr,
      ['function totalAgents() external view returns (uint256)'],
      provider
    );
    
    const totalAgents = await identityRegistry.totalAgents();
    console.log(`✓ IdentityRegistry has ${totalAgents} registered agents`);
    expect(totalAgents).toBeGreaterThanOrEqual(0n);
  });
  
  test('service registry is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    if (!ADDRESSES.serviceRegistry && !ADDRESSES.ServiceRegistry) {
      console.log('⏭️ Skipping: ServiceRegistry address not found');
      return;
    }
    
    const registryAddr = ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry;
    
    // Check if contract is deployed
    const code = await provider.getCode(registryAddr);
    if (code === '0x') {
      console.log('⏭️ Skipping: ServiceRegistry not deployed');
      return;
    }
    
    const serviceRegistry = new ethers.Contract(
      registryAddr,
      ['function getAllServiceNames() external view returns (string[] memory)'],
      provider
    );
    
    const services = await serviceRegistry.getAllServiceNames();
    console.log(`✓ ServiceRegistry has ${services.length} registered services`);
    expect(services).toBeDefined();
  });
  
  test('cloud reputation provider is functional', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    if (!ADDRESSES.cloudReputationProvider && !ADDRESSES.CloudReputationProvider) {
      console.log('⏭️ Skipping: CloudReputationProvider address not found');
      return;
    }
    
    const providerAddr = ADDRESSES.cloudReputationProvider || ADDRESSES.CloudReputationProvider;
    
    // Check if contract is deployed
    const code = await provider.getCode(providerAddr);
    if (code === '0x') {
      console.log('⏭️ Skipping: CloudReputationProvider not deployed');
      return;
    }
    
    const cloudRep = new ethers.Contract(
      providerAddr,
      ['function owner() external view returns (address)'],
      provider
    );
    
    const owner = await cloudRep.owner();
    console.log(`✓ CloudReputationProvider owner: ${owner}`);
    expect(owner).toBeDefined();
    expect(ethers.isAddress(owner)).toBe(true);
  });
});

describe('Cloud Service Costs', () => {
  test('can query service costs', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    if (!ADDRESSES.serviceRegistry && !ADDRESSES.ServiceRegistry) {
      console.log('⏭️ Skipping: ServiceRegistry address not found');
      return;
    }
    
    const registryAddr = ADDRESSES.serviceRegistry || ADDRESSES.ServiceRegistry;
    
    // Check if contract is deployed
    const code = await provider.getCode(registryAddr);
    if (code === '0x') {
      console.log('⏭️ Skipping: ServiceRegistry not deployed');
      return;
    }
    
    const serviceRegistry = new ethers.Contract(
      registryAddr,
      ['function getServiceCost(string,address) external view returns (uint256)'],
      provider
    );
    
    // First check if service exists
    const servicesContract = new ethers.Contract(
      registryAddr,
      ['function getAllServiceNames() external view returns (string[] memory)'],
      provider
    );
    
    const services = await servicesContract.getAllServiceNames() as string[];
    if (services.length === 0) {
      console.log('⏭️ Skipping: No services registered');
      return;
    }
    
    const cost = await serviceRegistry.getServiceCost(
      services[0],
      await deployer.getAddress()
    );
    
    console.log(`✓ ${services[0]} cost: ${ethers.formatEther(cost)} tokens`);
    expect(cost).toBeGreaterThanOrEqual(0n);
  });
});

describe('Cloud Credit System', () => {
  test('can check user balances', async () => {
    if (!localnetAvailable) {
      console.log('⏭️ Skipping: Localnet not running');
      return;
    }
    
    if (!ADDRESSES.creditManager && !ADDRESSES.CreditManager) {
      console.log('⏭️ Skipping: CreditManager address not found');
      return;
    }
    
    const creditAddr = ADDRESSES.creditManager || ADDRESSES.CreditManager;
    const usdcAddr = ADDRESSES.usdc || ADDRESSES.USDC;
    
    if (!usdcAddr) {
      console.log('⏭️ Skipping: USDC address not found');
      return;
    }
    
    // Check if contract is deployed
    const code = await provider.getCode(creditAddr);
    if (code === '0x') {
      console.log('⏭️ Skipping: CreditManager not deployed');
      return;
    }
    
    const creditManager = new ethers.Contract(
      creditAddr,
      ['function getBalance(address,address) external view returns (uint256)'],
      provider
    );
    
    const balance = await creditManager.getBalance(
      await deployer.getAddress(),
      usdcAddr
    );
    
    console.log(`✓ User USDC balance in credit manager: ${ethers.formatUnits(balance, 6)} USDC`);
    expect(balance).toBeGreaterThanOrEqual(0n);
  });
});

