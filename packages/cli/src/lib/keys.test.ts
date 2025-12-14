import { describe, test, expect } from 'bun:test';
import {
  getDevKeys,
  generateKey,
  generateOperatorKeys,
  validatePassword,
  generateEntropyString,
} from './keys';

describe('Key Management', () => {
  test('getDevKeys returns 5 development accounts', () => {
    const keys = getDevKeys();
    expect(keys.length).toBe(5);
    expect(keys[0].address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  test('generateKey creates valid key', () => {
    const key = generateKey('Test Key', 'tester');
    expect(key.name).toBe('Test Key');
    expect(key.role).toBe('tester');
    expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(key.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  test('generateOperatorKeys creates all required operators', () => {
    const operators = generateOperatorKeys();
    expect(operators.sequencer).toBeDefined();
    expect(operators.batcher).toBeDefined();
    expect(operators.proposer).toBeDefined();
    expect(operators.challenger).toBeDefined();
    expect(operators.admin).toBeDefined();
    expect(operators.feeRecipient).toBeDefined();
    expect(operators.guardian).toBeDefined();
  });

  test('validatePassword enforces requirements', () => {
    // Too short
    expect(validatePassword('short').valid).toBe(false);
    
    // No uppercase
    expect(validatePassword('verylongpassword1!').valid).toBe(false);
    
    // No lowercase
    expect(validatePassword('VERYLONGPASSWORD1!').valid).toBe(false);
    
    // No numbers
    expect(validatePassword('VeryLongPassword!!').valid).toBe(false);
    
    // No special chars
    expect(validatePassword('VeryLongPassword1').valid).toBe(false);
    
    // Valid password
    expect(validatePassword('VeryLongPassword1!').valid).toBe(true);
  });

  test('generateEntropyString returns hex string', () => {
    const entropy = generateEntropyString();
    expect(entropy.length).toBe(64);
    expect(entropy).toMatch(/^[a-f0-9]+$/);
  });
});

