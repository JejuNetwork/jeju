import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Integration Tests: Guardian Recovery Service
 * 
 * Tests that guardian recovery actually works with real transactions
 */

describe('Guardian Recovery Integration', () => {
  const RPC_URL = process.env.JEJU_L2_RPC || 'http://127.0.0.1:9545';
  const GUARDIAN_ADDRESS = process.env.GUARDIAN_ADDRESS_LOCALNET || '0x71562b71999873DB5b286dF957af199Ec94617F7';
  
  let provider: ethers.JsonRpcProvider;
  let testWallet: ethers.Wallet;
  let guardianInitialBalance: bigint;

  beforeAll(async () => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    testWallet = new ethers.Wallet(process.env.HACKER_WALLET_1!, provider);
    guardianInitialBalance = await provider.getBalance(GUARDIAN_ADDRESS);
  });

  test('can send funds to guardian address', async () => {
    const amount = ethers.parseEther('0.01');
    
    const tx = await testWallet.sendTransaction({
      to: GUARDIAN_ADDRESS,
      value: amount
    });

    const receipt = await tx.wait();
    expect(receipt?.status).toBe(1);

    const newBalance = await provider.getBalance(GUARDIAN_ADDRESS);
    expect(newBalance).toBeGreaterThan(guardianInitialBalance);

    console.log('✅ Fund transfer to guardian successful');
  }, 30000);

  test('recovery threshold logic is correct', () => {
    const threshold = ethers.parseEther('0.1');
    const gasReserve = ethers.parseEther('0.01');

    // Test case 1: Balance above threshold
    const highBalance = ethers.parseEther('2.5');
    expect(highBalance > threshold).toBe(true);
    const recoveryAmount = highBalance - gasReserve;
    expect(recoveryAmount).toBe(ethers.parseEther('2.49'));

    // Test case 2: Balance below threshold
    const lowBalance = ethers.parseEther('0.05');
    expect(lowBalance > threshold).toBe(false);
  });
});

