import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Integration Tests: ERC-8004 Registration
 * 
 * Tests actual registration to Identity Registry contract
 */

const IDENTITY_REGISTRY_ABI = [
  'function register(string metadata) external payable returns (uint256)',
  'function registerWithTier(string metadata, uint8 tier, address token) external payable returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)'
];

describe('ERC-8004 Agent Registration', () => {
  const RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
  const IDENTITY_REGISTRY = process.env.IDENTITY_REGISTRY!;
  
  let provider: ethers.JsonRpcProvider;
  let hackerWallet: ethers.Wallet;
  let citizenWallet: ethers.Wallet;
  let guardianWallet: ethers.Wallet;

  beforeAll(() => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    hackerWallet = new ethers.Wallet(process.env.HACKER_WALLET_1!, provider);
    citizenWallet = new ethers.Wallet(process.env.CITIZEN_WALLET_1!, provider);
    guardianWallet = new ethers.Wallet(process.env.GUARDIAN_WALLET_1!, provider);
  });

  test('hacker can register with SMALL stake (0.001 ETH)', async () => {
    const registry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, hackerWallet);
    
    const metadata = JSON.stringify({
      type: 'crucible-hacker',
      name: 'TestHacker',
      category: 'security-testing'
    });

    const initialSupply = await registry.totalSupply();

    const tx = await registry.registerWithTier(
      metadata,
      1, // SMALL tier
      ethers.ZeroAddress, // ETH
      {value: ethers.parseEther('0.001')}
    );

    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);

    const newSupply = await registry.totalSupply();
    expect(newSupply).toBeGreaterThan(initialSupply);

    // Extract agent ID from event
    const event = receipt?.logs
      .map((log: ethers.Log) => {
        try {
          return registry.interface.parseLog({topics: log.topics as string[], data: log.data});
        } catch {
          return null;
        }
      })
      .find(e => e?.name === 'Registered');

    const agentId = event?.args?.agentId;
    expect(agentId).toBeGreaterThan(0n);

    console.log(`✅ Hacker registered as agent #${agentId}`);
  }, 30000);

  test('citizen can register with MEDIUM stake (0.01 ETH)', async () => {
    const registry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, citizenWallet);
    
    const metadata = JSON.stringify({
      type: 'crucible-citizen',
      name: 'TestCitizen',
      category: 'defender'
    });

    const tx = await registry.registerWithTier(
      metadata,
      2, // MEDIUM tier
      ethers.ZeroAddress,
      {value: ethers.parseEther('0.01')}
    );

    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);

    console.log('✅ Citizen registered successfully');
  }, 30000);

  test('guardian can register with HIGH stake (0.1 ETH)', async () => {
    const registry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, guardianWallet);
    
    const metadata = JSON.stringify({
      type: 'crucible-guardian',
      name: 'TestGuardian',
      category: 'governance'
    });

    const tx = await registry.registerWithTier(
      metadata,
      3, // HIGH tier
      ethers.ZeroAddress,
      {value: ethers.parseEther('0.1')}
    );

    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);

    console.log('✅ Guardian registered successfully');
  }, 30000);
});

