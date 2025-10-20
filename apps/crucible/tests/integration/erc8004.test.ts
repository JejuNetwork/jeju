import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Integration Tests: ERC-8004 Identity Registry
 * 
 * Tests real contract interactions with Jeju localnet
 */

const IDENTITY_REGISTRY_ABI = [
  'function register(string metadata) external payable returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)'
];

describe('ERC-8004 Registration', () => {
  const RPC_URL = 'http://127.0.0.1:9545';
  const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  
  let provider: ethers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  let registry: ethers.Contract;

  beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(process.env.HACKER_WALLET_1!, provider);
    registry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, wallet);
  });

  test('can register to ERC-8004 with metadata', async () => {
    const metadata = JSON.stringify({
      type: 'test-agent',
      name: 'TestAgent',
      category: 'testing'
    });

    const initialSupply = await registry.totalSupply();

    // Register with SMALL stake (0.001 ETH)
    const tx = await registry.register(metadata, {
      value: ethers.parseEther('0.001')
    });

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    // Verify total supply increased
    const newSupply = await registry.totalSupply();
    expect(newSupply).toBeGreaterThan(initialSupply);

    console.log(`✅ Registered agent. Total supply: ${initialSupply} → ${newSupply}`);
  }, 30000);

  test('can query agent data', async () => {
    const totalSupply = await registry.totalSupply();
    
    if (totalSupply > 0n) {
      // Get first agent
      const owner = await registry.ownerOf(1);
      expect(ethers.isAddress(owner)).toBe(true);

      const exists = await registry.agentExists(1);
      expect(exists).toBe(true);

      console.log(`✅ Agent #1 owner: ${owner}`);
    }
  });
});

describe('Reputation Registry', () => {
  const RPC_URL = 'http://127.0.0.1:9545';
  const REPUTATION_REGISTRY = process.env.REPUTATION_REGISTRY || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';

  test('Reputation Registry contract exists', async () => {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider.getCode(REPUTATION_REGISTRY);
    
    expect(code).not.toBe('0x');
    expect(code.length).toBeGreaterThan(2);
  });
});

