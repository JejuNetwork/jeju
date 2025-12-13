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

interface OifDeployment {
  chains: Record<string, {
    chainId: number;
    status: string;
    contracts: {
      inputSettler?: string;
      outputSettler?: string;
      oracle?: string;
      solverRegistry?: string;
    };
  }>;
}

type OifContractKey = 'inputSettler' | 'outputSettler' | 'oracle' | 'solverRegistry';

function loadOifDeployments(): Record<number, OifDeployment['chains'][string]['contracts']> {
  const out: Record<number, OifDeployment['chains'][string]['contracts']> = {};
  const deploymentPaths = [
    resolve(process.cwd(), '../../packages/contracts/deployments/oif-testnet.json'),
    resolve(process.cwd(), '../../packages/contracts/deployments/oif-mainnet.json'),
    resolve(process.cwd(), 'packages/contracts/deployments/oif-testnet.json'),
    resolve(process.cwd(), 'packages/contracts/deployments/oif-mainnet.json'),
  ];

  for (const path of deploymentPaths) {
    if (!existsSync(path)) continue;
    const deployment: OifDeployment = JSON.parse(readFileSync(path, 'utf-8'));
    for (const chain of Object.values(deployment.chains)) {
      if (chain.status === 'deployed' && chain.contracts) {
        out[chain.chainId] = chain.contracts;
      }
    }
  }
  return out;
}

function loadOifContracts(key: OifContractKey): Record<number, `0x${string}`> {
  const deployments = loadOifDeployments();
  const out: Record<number, `0x${string}`> = {};

  for (const [chainId, contracts] of Object.entries(deployments)) {
    const addr = contracts[key];
    if (addr && addr !== '') {
      out[Number(chainId)] = addr as `0x${string}`;
    }
  }
  return out;
}

export const INPUT_SETTLERS = loadOifContracts('inputSettler');
export const OUTPUT_SETTLERS = loadOifContracts('outputSettler');
export const ORACLES = loadOifContracts('oracle');
export const SOLVER_REGISTRIES = loadOifContracts('solverRegistry');

/** Convert bytes32 address to 0x address format */
export function bytes32ToAddress(b32: `0x${string}`): `0x${string}` {
  return ('0x' + b32.slice(26)) as `0x${string}`;
}

/** Check if address is the zero/native address */
export function isNativeToken(addr: string): boolean {
  return addr === '0x0000000000000000000000000000000000000000' ||
         addr === '0x' || !addr;
}

