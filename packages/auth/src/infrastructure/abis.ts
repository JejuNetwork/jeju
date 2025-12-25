/**
 * Contract ABIs for OAuth3 on-chain integration
 */

import { concat, keccak256, toBytes } from 'viem'

// JNS Registry
export const JNS_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'owner',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'resolver',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ttl',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recordExists',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const

// JNS Resolver
export const JNS_RESOLVER_ABI = [
  {
    type: 'function',
    name: 'addr',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'contenthash',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'text',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'name',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'appRecord',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

// OAuth3 App Registry
export const OAUTH3_APP_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getApp',
    inputs: [{ name: 'appId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'appId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'council', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAppConfig',
    inputs: [{ name: 'appId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'redirectUris', type: 'string[]' },
          { name: 'allowedProviders', type: 'uint8[]' },
          { name: 'jnsName', type: 'string' },
          { name: 'logoUri', type: 'string' },
          { name: 'policyUri', type: 'string' },
          { name: 'termsUri', type: 'string' },
          { name: 'webhookUrl', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'validateRedirectUri',
    inputs: [
      { name: 'appId', type: 'bytes32' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isProviderAllowed',
    inputs: [
      { name: 'appId', type: 'bytes32' },
      { name: 'provider', type: 'uint8' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalApps',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// OAuth3 Identity Registry
export const OAUTH3_IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getIdentity',
    inputs: [{ name: 'identityId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'smartAccount', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getIdentityByOwner',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'owner', type: 'address' },
          { name: 'smartAccount', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedProviders',
    inputs: [{ name: 'identityId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'provider', type: 'uint8' },
          { name: 'providerId', type: 'bytes32' },
          { name: 'providerHandle', type: 'string' },
          { name: 'linkedAt', type: 'uint256' },
          { name: 'verified', type: 'bool' },
          { name: 'credentialHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getMetadata',
    inputs: [{ name: 'identityId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'avatar', type: 'string' },
          { name: 'bio', type: 'string' },
          { name: 'url', type: 'string' },
          { name: 'jnsName', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isProviderLinked',
    inputs: [
      { name: 'identityId', type: 'bytes32' },
      { name: 'provider', type: 'uint8' },
      { name: 'providerId', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProviderIdentity',
    inputs: [
      { name: 'provider', type: 'uint8' },
      { name: 'providerId', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalIdentities',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// OAuth3 TEE Verifier
export const OAUTH3_TEE_VERIFIER_ABI = [
  {
    type: 'function',
    name: 'getNode',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'operator', type: 'address' },
      { name: 'publicKeyHash', type: 'bytes32' },
      {
        name: 'attestation',
        type: 'tuple',
        components: [
          { name: 'quote', type: 'bytes' },
          { name: 'measurement', type: 'bytes32' },
          { name: 'reportData', type: 'bytes32' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'provider', type: 'uint8' },
          { name: 'verified', type: 'bool' },
        ],
      },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isNodeActive',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getActiveNodes',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNodeStake',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifyNodeSignature',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'messageHash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isTrustedMeasurement',
    inputs: [{ name: 'measurement', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTrustedMeasurements',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MIN_STAKE',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ATTESTATION_VALIDITY',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/** Compute ENS-style namehash for a domain (e.g., "myapp.oauth3.jeju" -> bytes32) */
export function namehash(name: string): `0x${string}` {
  if (!name) return ZERO_HASH as `0x${string}`

  return name
    .split('.')
    .reverse()
    .reduce((node, label) => {
      const labelHash = keccak256(toBytes(label))
      return keccak256(concat([toBytes(node), toBytes(labelHash)]))
    }, ZERO_HASH) as `0x${string}`
}

/** Compute keccak256 hash of a label */
export function labelhash(label: string): `0x${string}` {
  return keccak256(toBytes(label))
}
