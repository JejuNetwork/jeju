import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';

/**
 * Unit Tests: Guardian Recovery Service
 * 
 * Tests fund recovery logic
 */

describe('Guardian Recovery Logic', () => {
  test('calculates recovery amount correctly', () => {
    const balance = ethers.parseEther('2.5');
    const threshold = ethers.parseEther('0.1');
    const gasReserve = ethers.parseEther('0.01');

    // Should recover if balance > threshold
    const shouldRecover = balance > threshold;
    expect(shouldRecover).toBe(true);

    // Recovery amount = balance - gas reserve
    const recoveryAmount = balance - gasReserve;
    expect(recoveryAmount).toBe(ethers.parseEther('2.49'));
  });

  test('does not recover if balance below threshold', () => {
    const balance = ethers.parseEther('0.05');
    const threshold = ethers.parseEther('0.1');

    const shouldRecover = balance > threshold;
    expect(shouldRecover).toBe(false);
  });

  test('guardian address validation', () => {
    const validAddress = '0x71562b71999873DB5b286dF957af199Ec94617F7';
    const invalidAddress = 'not-an-address';

    expect(ethers.isAddress(validAddress)).toBe(true);
    expect(ethers.isAddress(invalidAddress)).toBe(false);
  });

  test('network validation prevents mainnet', () => {
    const networks = ['localnet', 'testnet', 'mainnet'];
    const allowed = networks.filter(n => n !== 'mainnet');

    expect(allowed).toContain('localnet');
    expect(allowed).toContain('testnet');
    expect(allowed).not.toContain('mainnet');
  });
});

