/**
 * Shared contract loading for solver components
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const OUTPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'fillDirect',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'isFilled',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

export const INPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'settle',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'canSettle',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOrder',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'user', type: 'address' },
        { name: 'inputToken', type: 'address' },
        { name: 'inputAmount', type: 'uint256' },
        { name: 'outputToken', type: 'address' },
        { name: 'outputAmount', type: 'uint256' },
        { name: 'destinationChainId', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'openDeadline', type: 'uint32' },
        { name: 'fillDeadline', type: 'uint32' },
        { name: 'solver', type: 'address' },
        { name: 'filled', type: 'bool' },
        { name: 'refunded', type: 'bool' },
        { name: 'createdBlock', type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

export const ORACLE_ABI = [
  {
    type: 'function',
    name: 'hasAttested',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'submitAttestation',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const ERC20_APPROVE_ABI = [{
  type: 'function',
  name: 'approve',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
  stateMutability: 'nonpayable',
}] as const;

interface ContractConfig {
  chainId?: number;
  oif?: { inputSettler?: string; outputSettler?: string; oracle?: string };
}

function loadContractsJson(): Record<string, ContractConfig> {
  const path = resolve(process.cwd(), '../../packages/config/contracts.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

type OifContractKey = 'inputSettler' | 'outputSettler' | 'oracle';

function loadOifContracts(key: OifContractKey): Record<number, `0x${string}`> {
  const contracts = loadContractsJson();
  const out: Record<number, `0x${string}`> = {};

  for (const chain of Object.values(contracts.external || {})) {
    const c = chain as ContractConfig;
    if (c.chainId && c.oif?.[key]) out[c.chainId] = c.oif[key] as `0x${string}`;
  }
  for (const net of ['testnet', 'mainnet'] as const) {
    const cfg = contracts[net] as ContractConfig | undefined;
    if (cfg?.chainId && cfg.oif?.[key]) out[cfg.chainId] = cfg.oif[key] as `0x${string}`;
  }
  return out;
}

export const INPUT_SETTLERS = loadOifContracts('inputSettler');
export const OUTPUT_SETTLERS = loadOifContracts('outputSettler');
export const ORACLES = loadOifContracts('oracle');

/** Convert bytes32 address to 0x address format */
export function bytes32ToAddress(b32: `0x${string}`): `0x${string}` {
  return ('0x' + b32.slice(26)) as `0x${string}`;
}

/** Check if address is the zero/native address */
export function isNativeToken(addr: string): boolean {
  return addr === '0x0000000000000000000000000000000000000000' ||
         addr === '0x' || !addr;
}

