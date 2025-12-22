/**
 * ElizaOS Plugin Tests
 * 
 * Verifies the wallet plugin is properly structured for ElizaOS.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  jejuWalletPlugin,
  walletStateProvider,
  portfolioProvider,
  sendTokenAction,
  swapTokenAction,
  portfolioAction,
  registerNameAction,
} from './eliza-plugin';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

// Mock runtime
const createMockRuntime = (settings: Record<string, string | undefined> = {}): IAgentRuntime => ({
  getSetting: vi.fn((key: string) => settings[key]),
} as unknown as IAgentRuntime);

// Mock message
const createMockMessage = (text: string): Memory => ({
  content: { text },
} as unknown as Memory);

describe('jejuWalletPlugin', () => {
  it('should have the correct name and description', () => {
    expect(jejuWalletPlugin.name).toBe('jeju-wallet');
    expect(jejuWalletPlugin.description).toContain('wallet');
  });

  it('should have providers', () => {
    expect(jejuWalletPlugin.providers).toBeDefined();
    expect(jejuWalletPlugin.providers?.length).toBeGreaterThan(0);
  });

  it('should have actions', () => {
    expect(jejuWalletPlugin.actions).toBeDefined();
    expect(jejuWalletPlugin.actions?.length).toBeGreaterThan(0);
  });

  it('should have no evaluators (optional)', () => {
    expect(jejuWalletPlugin.evaluators).toEqual([]);
  });
});

describe('walletStateProvider', () => {
  it('should return connected state when wallet is configured', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x1234567890abcdef' });
    const result = await walletStateProvider.get(runtime, {} as Memory, {} as State);
    
    expect(result.data).toHaveProperty('connected', true);
    expect(result.data).toHaveProperty('address', '0x1234567890abcdef');
    expect(result.text).toContain('0x1234567890abcdef');
  });

  it('should return disconnected state when no wallet', async () => {
    const runtime = createMockRuntime({});
    const result = await walletStateProvider.get(runtime, {} as Memory, {} as State);
    
    expect(result.data).toHaveProperty('connected', false);
    expect(result.text).toContain('not connected');
  });
});

describe('portfolioProvider', () => {
  it('should return portfolio info when wallet connected', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0xabc' });
    const result = await portfolioProvider.get(runtime, {} as Memory, {} as State);
    
    expect(result.data).toHaveProperty('address', '0xabc');
    expect(result.text).toContain('0xabc');
  });

  it('should return message when no wallet connected', async () => {
    const runtime = createMockRuntime({});
    const result = await portfolioProvider.get(runtime, {} as Memory, {} as State);
    
    expect(result.text).toContain('No wallet connected');
  });
});

describe('sendTokenAction', () => {
  it('should have correct name and similes', () => {
    expect(sendTokenAction.name).toBe('JEJU_SEND_TOKEN');
    expect(sendTokenAction.similes).toContain('TRANSFER');
    expect(sendTokenAction.similes).toContain('SEND');
  });

  it('should validate when wallet is connected', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('test');
    const isValid = await sendTokenAction.validate(runtime, message);
    expect(isValid).toBe(true);
  });

  it('should not validate when no wallet', async () => {
    const runtime = createMockRuntime({});
    const message = createMockMessage('test');
    const isValid = await sendTokenAction.validate(runtime, message);
    expect(isValid).toBe(false);
  });

  it('should parse address and amount from message', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Send 0.5 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
    
    const callback = vi.fn();
    await sendTokenAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content).toHaveProperty('params');
    expect(callArg.content.params).toHaveProperty('recipient', '0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
    expect(callArg.content.params).toHaveProperty('amount', '0.5');
    expect(callArg.content.params).toHaveProperty('token', 'ETH');
  });

  it('should require address in message', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Send some ETH');
    
    const callback = vi.fn();
    await sendTokenAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content).toHaveProperty('error');
  });
});

describe('swapTokenAction', () => {
  it('should have correct name and similes', () => {
    expect(swapTokenAction.name).toBe('JEJU_SWAP');
    expect(swapTokenAction.similes).toContain('SWAP');
    expect(swapTokenAction.similes).toContain('TRADE');
  });

  it('should parse swap parameters', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Swap 100 USDC for ETH');
    
    const callback = vi.fn();
    await swapTokenAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content.params).toHaveProperty('amount', '100');
    expect(callArg.content.params).toHaveProperty('fromToken', 'USDC');
    expect(callArg.content.params).toHaveProperty('toToken', 'ETH');
  });

  it('should handle "to" keyword in swap', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Trade 0.5 ETH to USDC');
    
    const callback = vi.fn();
    await swapTokenAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content.params).toHaveProperty('amount', '0.5');
    expect(callArg.content.params).toHaveProperty('fromToken', 'ETH');
    expect(callArg.content.params).toHaveProperty('toToken', 'USDC');
  });
});

describe('portfolioAction', () => {
  it('should have correct name', () => {
    expect(portfolioAction.name).toBe('JEJU_PORTFOLIO');
  });

  it('should always validate (to show connect prompt)', async () => {
    const runtime = createMockRuntime({});
    const message = createMockMessage('show portfolio');
    const isValid = await portfolioAction.validate(runtime, message);
    expect(isValid).toBe(true);
  });

  it('should show connect prompt when no wallet', async () => {
    const runtime = createMockRuntime({});
    const message = createMockMessage('Show my portfolio');
    
    const callback = vi.fn();
    await portfolioAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.text).toContain('connect');
    expect(callArg.content).toHaveProperty('connected', false);
  });

  it('should show portfolio when wallet connected', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0xabc123' });
    const message = createMockMessage('Show my portfolio');
    
    const callback = vi.fn();
    await portfolioAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.text).toContain('0xabc123');
    expect(callArg.content).toHaveProperty('address', '0xabc123');
  });
});

describe('registerNameAction', () => {
  it('should have correct name', () => {
    expect(registerNameAction.name).toBe('JEJU_REGISTER_NAME');
  });

  it('should parse .jeju name from message', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Register alice.jeju');
    
    const callback = vi.fn();
    await registerNameAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content.params).toHaveProperty('name', 'alice');
  });

  it('should require a name in message', async () => {
    const runtime = createMockRuntime({ WALLET_ADDRESS: '0x123' });
    const message = createMockMessage('Register a name for me');
    
    const callback = vi.fn();
    await registerNameAction.handler(runtime, message, undefined, undefined, callback);
    
    expect(callback).toHaveBeenCalled();
    const callArg = callback.mock.calls[0][0];
    expect(callArg.content).toHaveProperty('error');
  });
});

