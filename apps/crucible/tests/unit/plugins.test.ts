import { describe, test, expect } from 'bun:test';
import { cruciblePlugin } from '../../packages/plugin-crucible/src/index';

/**
 * Unit Tests: Plugin Structure
 * 
 * Tests that all plugins are properly structured
 */

describe('Crucible Plugin Structure', () => {
  test('cruciblePlugin is defined', () => {
    expect(cruciblePlugin).toBeDefined();
    expect(cruciblePlugin.name).toBe('@crucible/plugin');
  });

  test('cruciblePlugin has actions', () => {
    expect(cruciblePlugin.actions).toBeDefined();
    expect(Array.isArray(cruciblePlugin.actions)).toBe(true);
    expect(cruciblePlugin.actions!.length).toBeGreaterThan(0);
  });

  test('cruciblePlugin has services', () => {
    expect(cruciblePlugin.services).toBeDefined();
    expect(Array.isArray(cruciblePlugin.services)).toBe(true);
    expect(cruciblePlugin.services!.length).toBeGreaterThan(0);
  });

  test('all actions have required properties', () => {
    for (const action of cruciblePlugin.actions || []) {
      expect(action.name).toBeDefined();
      expect(action.description).toBeDefined();
      expect(action.handler).toBeDefined();
      expect(typeof action.handler).toBe('function');
    }
  });

  test('has REGISTER_TO_NETWORK action', () => {
    const registerAction = cruciblePlugin.actions?.find(a => a.name === 'REGISTER_TO_NETWORK');
    expect(registerAction).toBeDefined();
    expect(registerAction?.description).toContain('ERC-8004');
  });

  test('has SUBMIT_REPORT action', () => {
    const reportAction = cruciblePlugin.actions?.find(a => a.name === 'SUBMIT_REPORT');
    expect(reportAction).toBeDefined();
    expect(reportAction?.description).toContain('UnifiedReportingSystem');
  });

  test('has VOTE_ON_APPEAL action', () => {
    const appealAction = cruciblePlugin.actions?.find(a => a.name === 'VOTE_ON_APPEAL');
    expect(appealAction).toBeDefined();
    expect(appealAction?.description).toContain('Guardian');
  });

  test('has REENTRANCY_ATTACK action', () => {
    const attackAction = cruciblePlugin.actions?.find(a => a.name === 'REENTRANCY_ATTACK');
    expect(attackAction).toBeDefined();
    expect(attackAction?.description).toContain('reentrancy');
  });

  test('has CREATE_FAKE_SERVICE action', () => {
    const scamAction = cruciblePlugin.actions?.find(a => a.name === 'CREATE_FAKE_SERVICE');
    expect(scamAction).toBeDefined();
  });
});

describe('Plugin Services', () => {
  test('has RegistryService', () => {
    const registryService = cruciblePlugin.services?.find(s => s.name === 'RegistryService' || (s as any).serviceType === 'registry_service');
    expect(registryService).toBeDefined();
  });

  test('has GuardianRecoveryService', () => {
    const recoveryService = cruciblePlugin.services?.find(s => s.name === 'GuardianRecoveryService' || (s as any).serviceType === 'guardian_recovery');
    expect(recoveryService).toBeDefined();
  });

  test('has ContractService', () => {
    const contractService = cruciblePlugin.services?.find(s => s.name === 'ContractService' || (s as any).serviceType === 'contract_service');
    expect(contractService).toBeDefined();
  });
});

