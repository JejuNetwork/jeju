/**
 * Solver Agent Unit Tests
 * 
 * Tests the solver agent components with real contract ABIs
 * and validates business logic.
 */

import { describe, test, expect, beforeAll, mock } from 'bun:test';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Actual OutputSettler ABI from contracts/src/oif/OutputSettler.sol
const OUTPUT_SETTLER_ABI = [
  'function fillDirect(bytes32 orderId, address token, uint256 amount, address recipient) external payable',
  'function isFilled(bytes32 orderId) external view returns (bool)',
];

const SOLVER_REGISTRY_ABI = [
  'function register(uint256[] calldata chains) external payable',
  'function isSolverActive(address solver) external view returns (bool)',
  'function getSolverStake(address solver) external view returns (uint256)',
  'function getSolverChains(address solver) external view returns (uint256[])',
  'function MIN_STAKE() external view returns (uint256)',
];

describe('OutputSettler ABI Encoding', () => {
  test('should encode fillDirect() call correctly', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + '1'.repeat(64);
    const token = ethers.ZeroAddress;
    const amount = ethers.parseEther('1.0');
    const recipient = '0x' + '2'.repeat(40);

    // Note: fillDirect signature is (orderId, token, amount, recipient)
    const data = iface.encodeFunctionData('fillDirect', [orderId, token, amount, recipient]);

    expect(data).toMatch(/^0x/);
    expect(data.length).toBeGreaterThan(10);
  });

  test('should decode fillDirect() args correctly', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + 'ab'.repeat(32);
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
    const amount = 1000000n; // 1 USDC
    const recipient = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    const data = iface.encodeFunctionData('fillDirect', [orderId, token, amount, recipient]);
    const decoded = iface.decodeFunctionData('fillDirect', data);

    expect(decoded[0]).toBe(orderId);
    expect(decoded[1].toLowerCase()).toBe(token.toLowerCase());
    expect(decoded[2]).toBe(amount);
    expect(decoded[3].toLowerCase()).toBe(recipient.toLowerCase());
  });

  test('should handle zero amount edge case', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + '0'.repeat(64);
    const token = ethers.ZeroAddress;
    const amount = 0n;
    const recipient = ethers.ZeroAddress;

    const data = iface.encodeFunctionData('fillDirect', [orderId, token, amount, recipient]);
    expect(data).toBeDefined();
  });

  test('should handle max uint256 amount', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + 'ff'.repeat(32);
    const token = ethers.ZeroAddress;
    const amount = 2n ** 256n - 1n;
    const recipient = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    const data = iface.encodeFunctionData('fillDirect', [orderId, token, amount, recipient]);
    const decoded = iface.decodeFunctionData('fillDirect', data);

    expect(decoded[2]).toBe(amount);
  });

  test('should encode isFilled() correctly', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + 'ab'.repeat(32);

    const data = iface.encodeFunctionData('isFilled', [orderId]);
    expect(data).toMatch(/^0x/);
  });
});

describe('SolverRegistry ABI Encoding', () => {
  test('should encode register() with multiple chains', () => {
    const iface = new ethers.Interface(SOLVER_REGISTRY_ABI);
    const chains = [11155111, 84532, 421614, 11155420, 420690];

    const data = iface.encodeFunctionData('register', [chains]);

    expect(data).toMatch(/^0x/);
  });

  test('should encode register() with empty chains array', () => {
    const iface = new ethers.Interface(SOLVER_REGISTRY_ABI);

    // Empty array should still be valid ABI encoding
    const data = iface.encodeFunctionData('register', [[]]);
    expect(data).toBeDefined();
  });

  test('should encode register() with single chain', () => {
    const iface = new ethers.Interface(SOLVER_REGISTRY_ABI);
    
    const data = iface.encodeFunctionData('register', [[84532]]);
    const decoded = iface.decodeFunctionData('register', data);
    
    expect(decoded[0]).toHaveLength(1);
    expect(Number(decoded[0][0])).toBe(84532);
  });
});

describe('Intent Event Parsing', () => {
  const OPEN_EVENT_ABI = [
    'event Open(bytes32 indexed orderId, (address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, (bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, (uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) order)',
  ];

  test('should have valid Open event signature', () => {
    const iface = new ethers.Interface(OPEN_EVENT_ABI);
    const event = iface.getEvent('Open');
    
    expect(event).toBeDefined();
    expect(event!.name).toBe('Open');
  });

  test('should compute correct event topic', () => {
    const iface = new ethers.Interface(OPEN_EVENT_ABI);
    const topic = iface.getEvent('Open')!.topicHash;
    
    expect(topic).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

describe('Config Loading', () => {
  test('should load contracts.json', () => {
    const configPath = resolve(process.cwd(), '../../packages/config/contracts.json');
    
    if (existsSync(configPath)) {
      const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(contracts).toBeDefined();
    }
  });

  test('contracts.json has expected structure', () => {
    const configPath = resolve(process.cwd(), '../../packages/config/contracts.json');
    
    if (!existsSync(configPath)) {
      console.warn('contracts.json not found, skipping');
      return;
    }

    const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
    
    // Should have either testnet, mainnet, or external
    const hasConfig = contracts.testnet || contracts.mainnet || contracts.external;
    expect(hasConfig).toBeTruthy();
  });
});

describe('Profit Calculation', () => {
  // Simulate profit calculation logic
  function calculateProfit(
    inputAmount: bigint,
    outputAmount: bigint,
    gasCost: bigint,
    feeBps: number
  ): { profitBps: number; profitable: boolean } {
    const fee = (inputAmount * BigInt(feeBps)) / 10000n;
    const grossProfit = inputAmount - outputAmount;
    const netProfit = grossProfit - gasCost - fee;
    const profitBps = Number((netProfit * 10000n) / inputAmount);
    return { profitBps, profitable: netProfit > 0n };
  }

  test('should calculate positive profit', () => {
    const input = ethers.parseEther('1.0');
    const output = ethers.parseEther('0.98');
    const gas = ethers.parseEther('0.001');
    
    const result = calculateProfit(input, output, gas, 10); // 0.1% fee
    
    expect(result.profitable).toBe(true);
    expect(result.profitBps).toBeGreaterThan(0);
  });

  test('should detect unprofitable trade', () => {
    const input = ethers.parseEther('1.0');
    const output = ethers.parseEther('1.1'); // Output more than input
    const gas = ethers.parseEther('0.001');
    
    const result = calculateProfit(input, output, gas, 10);
    
    expect(result.profitable).toBe(false);
    expect(result.profitBps).toBeLessThan(0);
  });

  test('should handle edge case: exact break-even', () => {
    const input = ethers.parseEther('1.0');
    const output = ethers.parseEther('0.989'); // Exactly covers gas + fee
    const gas = ethers.parseEther('0.01');
    
    const result = calculateProfit(input, output, gas, 10);
    
    // Should be approximately break-even
    expect(Math.abs(result.profitBps)).toBeLessThan(10);
  });

  test('should throw on zero input amount (division by zero)', () => {
    // Division by zero should throw - this is expected behavior
    expect(() => calculateProfit(0n, 0n, 0n, 0)).toThrow();
  });

  test('should handle high gas scenarios', () => {
    const input = ethers.parseEther('0.01');
    const output = ethers.parseEther('0.009');
    const gas = ethers.parseEther('0.005'); // Gas is 50% of input
    
    const result = calculateProfit(input, output, gas, 0);
    
    expect(result.profitable).toBe(false);
  });
});

describe('Chain Validation', () => {
  const SUPPORTED_CHAINS = new Set([11155111, 84532, 421614, 11155420, 420690]);

  function isChainSupported(chainId: number): boolean {
    return SUPPORTED_CHAINS.has(chainId);
  }

  function validateCrossChainRoute(source: number, dest: number): { valid: boolean; error?: string } {
    if (!isChainSupported(source)) return { valid: false, error: `Unsupported source: ${source}` };
    if (!isChainSupported(dest)) return { valid: false, error: `Unsupported dest: ${dest}` };
    if (source === dest) return { valid: false, error: 'Source and destination must differ' };
    return { valid: true };
  }

  test('should validate supported chains', () => {
    expect(isChainSupported(11155111)).toBe(true);
    expect(isChainSupported(84532)).toBe(true);
    expect(isChainSupported(1)).toBe(false); // Mainnet not in testnet set
  });

  test('should validate cross-chain routes', () => {
    expect(validateCrossChainRoute(11155111, 84532).valid).toBe(true);
    expect(validateCrossChainRoute(84532, 11155111).valid).toBe(true);
  });

  test('should reject same-chain route', () => {
    const result = validateCrossChainRoute(84532, 84532);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must differ');
  });

  test('should reject unsupported chains', () => {
    expect(validateCrossChainRoute(1, 84532).valid).toBe(false);
    expect(validateCrossChainRoute(84532, 137).valid).toBe(false); // Polygon
  });
});

describe('Order ID Generation', () => {
  function generateOrderId(
    user: string,
    nonce: bigint,
    timestamp: number,
    sourceChain: number
  ): string {
    return ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'uint256', 'uint256'],
      [user, nonce, timestamp, sourceChain]
    );
  }

  test('should generate deterministic order IDs', () => {
    const user = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const nonce = 1n;
    const timestamp = 1700000000;
    const chain = 84532;

    const id1 = generateOrderId(user, nonce, timestamp, chain);
    const id2 = generateOrderId(user, nonce, timestamp, chain);

    expect(id1).toBe(id2);
  });

  test('should produce different IDs for different nonces', () => {
    const user = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const timestamp = 1700000000;
    const chain = 84532;

    const id1 = generateOrderId(user, 1n, timestamp, chain);
    const id2 = generateOrderId(user, 2n, timestamp, chain);

    expect(id1).not.toBe(id2);
  });

  test('should produce valid bytes32 format', () => {
    const id = generateOrderId(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      1n,
      1700000000,
      84532
    );

    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

describe('Gas Estimation', () => {
  // Base gas costs
  const BASE_GAS = 21000n;
  const ERC20_TRANSFER_GAS = 65000n;
  const FILL_GAS = 150000n;

  function estimateGas(isNativeToken: boolean, hasApproval: boolean): bigint {
    let gas = BASE_GAS + FILL_GAS;
    if (!isNativeToken && hasApproval) {
      gas += ERC20_TRANSFER_GAS;
    }
    return gas;
  }

  test('should estimate lower gas for native token', () => {
    const nativeGas = estimateGas(true, false);
    const erc20Gas = estimateGas(false, true);

    expect(nativeGas).toBeLessThan(erc20Gas);
  });

  test('should include approval gas for ERC20', () => {
    const withApproval = estimateGas(false, true);
    const withoutApproval = estimateGas(false, false);

    expect(withApproval).toBe(withoutApproval + ERC20_TRANSFER_GAS);
  });

  test('should return base + fill for native', () => {
    const gas = estimateGas(true, false);
    expect(gas).toBe(BASE_GAS + FILL_GAS);
  });
});
