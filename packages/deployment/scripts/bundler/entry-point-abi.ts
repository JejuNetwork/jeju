/**
 * EntryPoint v0.7 ABI (minimal subset for bundler)
 */

export const ENTRY_POINT_ABI = [
  {
    name: 'handleOps',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'handleAggregatedOps',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'opsPerAggregator',
        type: 'tuple[]',
        components: [
          {
            name: 'userOps',
            type: 'tuple[]',
            components: [
              { name: 'sender', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'initCode', type: 'bytes' },
              { name: 'callData', type: 'bytes' },
              { name: 'accountGasLimits', type: 'bytes32' },
              { name: 'preVerificationGas', type: 'uint256' },
              { name: 'gasFees', type: 'bytes32' },
              { name: 'paymasterAndData', type: 'bytes' },
              { name: 'signature', type: 'bytes' },
            ],
          },
          { name: 'aggregator', type: 'address' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'simulateValidation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: 'getUserOpHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'getNonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  {
    name: 'depositTo',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getDepositInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      {
        name: 'info',
        type: 'tuple',
        components: [
          { name: 'deposit', type: 'uint256' },
          { name: 'staked', type: 'bool' },
          { name: 'stake', type: 'uint112' },
          { name: 'unstakeDelaySec', type: 'uint32' },
          { name: 'withdrawTime', type: 'uint48' },
        ],
      },
    ],
  },
  // Events
  {
    name: 'UserOperationEvent',
    type: 'event',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'actualGasCost', type: 'uint256', indexed: false },
      { name: 'actualGasUsed', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'UserOperationRevertReason',
    type: 'event',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'revertReason', type: 'bytes', indexed: false },
    ],
  },
  {
    name: 'AccountDeployed',
    type: 'event',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'factory', type: 'address', indexed: false },
      { name: 'paymaster', type: 'address', indexed: false },
    ],
  },
  // Errors
  {
    name: 'FailedOp',
    type: 'error',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    name: 'FailedOpWithRevert',
    type: 'error',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
      { name: 'inner', type: 'bytes' },
    ],
  },
] as const
