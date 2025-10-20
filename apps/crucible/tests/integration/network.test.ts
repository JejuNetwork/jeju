import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Integration Tests: Network Connectivity
 * 
 * Tests connection to Jeju localnet and contract availability
 */

describe('Network Connectivity', () => {
  const RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';

  test('can connect to Jeju L2 RPC', async () => {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const network = await provider.getNetwork();
      
      expect(network.chainId).toBe(1337n);
      console.log('✅ Connected to Jeju localnet (Chain ID: 1337)');
    } catch (error: any) {
      console.error('❌ Cannot connect to Jeju localnet');
      console.error('   Make sure localnet is running: bun run dev');
      throw error;
    }
  });

  test('can query block number', async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const blockNumber = await provider.getBlockNumber();
    
    expect(blockNumber).toBeGreaterThan(0);
    console.log(`✅ Current block: ${blockNumber}`);
  });

  test('test wallets have sufficient balance', async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallets = [
      process.env.HACKER_WALLET_1,
      process.env.CITIZEN_WALLET_1,
      process.env.GUARDIAN_WALLET_1
    ];

    for (const walletKey of wallets) {
      if (walletKey) {
        const wallet = new ethers.Wallet(walletKey, provider);
        const balance = await provider.getBalance(wallet.address);
        
        expect(balance).toBeGreaterThan(ethers.parseEther('0.5'));
        console.log(`✅ Wallet ${wallet.address.slice(0, 10)}... has ${ethers.formatEther(balance)} ETH`);
      }
    }
  });
});

describe('Contract Availability', () => {
  const RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';

  const contracts = [
    {name: 'Identity Registry', address: process.env.IDENTITY_REGISTRY},
    {name: 'Reputation Registry', address: process.env.REPUTATION_REGISTRY},
    {name: 'Service Registry', address: process.env.SERVICE_REGISTRY},
    {name: 'elizaOS Token', address: process.env.ELIZA_TOKEN}
  ];

  test('all critical contracts are deployed', async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    for (const contract of contracts) {
      if (contract.address) {
        const code = await provider.getCode(contract.address);
        expect(code).not.toBe('0x');
        expect(code.length).toBeGreaterThan(2);
        console.log(`✅ ${contract.name} deployed at ${contract.address}`);
      } else {
        console.warn(`⚠️  ${contract.name} address not configured`);
      }
    }
  });

  test('can interact with Identity Registry', async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const registry = new ethers.Contract(
      process.env.IDENTITY_REGISTRY!,
      ['function totalSupply() external view returns (uint256)'],
      provider
    );

    const supply = await registry.totalSupply();
    expect(typeof supply).toBe('bigint');
    console.log(`✅ Identity Registry has ${supply} registered agents`);
  });
});

describe('Guardian Address', () => {
  test('guardian address is configured and valid', () => {
    const guardian = process.env.GUARDIAN_ADDRESS_LOCALNET;
    
    expect(guardian).toBeDefined();
    expect(ethers.isAddress(guardian!)).toBe(true);
    console.log(`✅ Guardian address: ${guardian}`);
  });

  test('guardian address has balance', async () => {
    const provider = new ethers.JsonRpcProvider(process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545');
    const guardian = process.env.GUARDIAN_ADDRESS_LOCALNET!;
    const balance = await provider.getBalance(guardian);
    
    expect(balance).toBeGreaterThan(0n);
    console.log(`✅ Guardian has ${ethers.formatEther(balance)} ETH`);
  });
});

