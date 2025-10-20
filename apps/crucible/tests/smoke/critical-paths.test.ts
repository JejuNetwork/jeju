import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Smoke Tests: Critical Paths
 * 
 * Quick validation tests for critical functionality
 * These must all pass for the system to be functional
 */

describe('Critical Path: Configuration', () => {
  test('all required environment variables are set', () => {
    const required = [
      'JEJU_L2_RPC',
      'GUARDIAN_ADDRESS_LOCALNET',
      'IDENTITY_REGISTRY',
      'REPUTATION_REGISTRY',
      'HACKER_WALLET_1',
      'CITIZEN_WALLET_1',
      'GUARDIAN_WALLET_1'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing environment variables:', missing);
      console.error('   Check your .env file');
    }
    
    expect(missing.length).toBe(0);
  });

  test('OpenAI API key is configured', () => {
    const apiKey = process.env.OPENAI_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey?.length).toBeGreaterThan(20);
  });

  test('network is not mainnet', () => {
    const network = process.env.NETWORK || 'localnet';
    expect(network).not.toBe('mainnet');
  });
});

describe('Critical Path: Blockchain Connection', () => {
  test('can connect to RPC endpoint', async () => {
    const rpcUrl = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
    
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await provider.getNetwork();
      expect(network.chainId).toBe(1337n);
      
      console.log('✅ RPC connection successful');
    } catch (error) {
      console.error('❌ Cannot connect to RPC');
      console.error('   Start localnet with: bun run dev');
      throw error;
    }
  });

  test('Identity Registry contract exists and responds', async () => {
    const provider = new ethers.JsonRpcProvider(process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545');
    const registry = new ethers.Contract(
      process.env.IDENTITY_REGISTRY!,
      ['function totalSupply() view returns (uint256)'],
      provider
    );

    const supply = await registry.totalSupply();
    expect(supply).toBeGreaterThanOrEqual(0n);
    
    console.log(`✅ Identity Registry operational (${supply} agents)`);
  });
});

describe('Critical Path: Wallet Funding', () => {
  test('test wallets are funded', async () => {
    const provider = new ethers.JsonRpcProvider(process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545');
    
    const wallets = [
      {name: 'Hacker', key: process.env.HACKER_WALLET_1, minBalance: '1.0'},
      {name: 'Citizen', key: process.env.CITIZEN_WALLET_1, minBalance: '0.5'},
      {name: 'Guardian', key: process.env.GUARDIAN_WALLET_1, minBalance: '2.0'}
    ];

    for (const wallet of wallets) {
      if (wallet.key) {
        const w = new ethers.Wallet(wallet.key, provider);
        const balance = await provider.getBalance(w.address);
        
        expect(balance).toBeGreaterThan(ethers.parseEther(wallet.minBalance));
        console.log(`✅ ${wallet.name} wallet funded: ${ethers.formatEther(balance)} ETH`);
      }
    }
  });
});

